"""
CI Monitor — polls GitHub Actions check-runs after a PR is created,
extracts failure details, and builds fix specs for OpenHands.
"""
import asyncio
import re
import time
from dataclasses import dataclass, field
from typing import List, Optional

import httpx


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class CICheckRun:
    name: str
    conclusion: str
    job_id: Optional[str]


@dataclass
class CIResult:
    passing: bool
    failure_summary: str = ""
    failed_checks: List[CICheckRun] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Log parsing helpers
# ---------------------------------------------------------------------------

_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?")

_ERROR_RE = re.compile(
    r"error|Error|ERROR|FAILED|failed|Exception|ImportError|ModuleNotFound|"
    r"SyntaxError|TypeError|cannot find|Cannot|npm error|assert",
    re.IGNORECASE,
)

_NOISE_RE = re.compile(
    r"Node\.js 20 actions|deprecated|FORCE_JAVASCRIPT|ACTIONS_ALLOW|"
    r"git config|git submodule|git version|Cleaning up orphan|Post job cleanup|"
    r"safe\.directory|\.extraheader|sshCommand|overriding HOME|"
    r"hint:|Temporarily overriding|Adding repository",
)


def _strip_ts(line: str) -> str:
    return _TIMESTAMP_RE.sub("", line).rstrip()


def _extract_error_lines(raw: str, max_lines: int = 50) -> str:
    """Extract the most relevant error lines from a raw CI job log."""
    lines = [_strip_ts(ln) for ln in raw.splitlines()]
    # Focus on the tail — errors are almost always at the end
    tail = lines[-120:]
    errors = [
        ln for ln in tail
        if ln.strip() and _ERROR_RE.search(ln) and not _NOISE_RE.search(ln)
    ]
    if not errors:
        # Fall back to all non-noise, non-empty lines in the tail
        errors = [ln for ln in tail if ln.strip() and not _NOISE_RE.search(ln)]
    return "\n".join(errors[:max_lines])


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------

def _gh_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}


def _extract_job_id(details_url: str) -> Optional[str]:
    m = re.search(r"/job/(\d+)", details_url)
    return m.group(1) if m else None


async def get_pr_details(
    token: str,
    owner: str,
    repo: str,
    pr_number: int,
    http: httpx.AsyncClient,
) -> Optional[dict]:
    """Return {'sha': str, 'branch': str} for the PR's head commit."""
    try:
        resp = await http.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}",
            headers=_gh_headers(token),
        )
        if resp.is_success:
            data = resp.json()
            return {
                "sha": data["head"]["sha"],
                "branch": data["head"]["ref"],
            }
    except httpx.RequestError:
        pass
    return None


async def _fetch_job_log_errors(
    token: str,
    owner: str,
    repo: str,
    job_id: str,
    http: httpx.AsyncClient,
) -> str:
    try:
        resp = await http.get(
            f"https://api.github.com/repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
            headers=_gh_headers(token),
            follow_redirects=True,
        )
        if resp.is_success:
            return _extract_error_lines(resp.text)
    except Exception:
        pass
    return "(could not fetch log details)"


# ---------------------------------------------------------------------------
# Core poll loop
# ---------------------------------------------------------------------------

async def poll_ci_until_complete(
    token: str,
    owner: str,
    repo: str,
    sha: str,
    timeout: int,
    poll_interval: int,
    http: httpx.AsyncClient,
) -> CIResult:
    """
    Poll check-runs for *sha* until every run has a conclusion or timeout.
    Returns CIResult(passing=True) when all pass (or no checks are configured).
    """
    headers = _gh_headers(token)
    deadline = time.monotonic() + timeout
    # Allow up to 2 minutes for GH Actions workflow to be queued and appear
    checks_appear_deadline = time.monotonic() + 120

    while time.monotonic() < deadline:
        try:
            resp = await http.get(
                f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}/check-runs",
                headers=headers,
            )
        except httpx.RequestError:
            await asyncio.sleep(poll_interval)
            continue

        if not resp.is_success:
            await asyncio.sleep(poll_interval)
            continue

        runs = resp.json().get("check_runs", [])

        if not runs:
            if time.monotonic() > checks_appear_deadline:
                # No CI workflow configured for this repo — treat as passing
                return CIResult(passing=True, failure_summary="No CI checks configured.")
            await asyncio.sleep(poll_interval)
            continue

        # Wait for all runs to reach a terminal state
        if any(r.get("conclusion") is None for r in runs):
            await asyncio.sleep(poll_interval)
            continue

        # All concluded — evaluate results
        failed = [
            CICheckRun(
                name=r["name"],
                conclusion=r["conclusion"],
                job_id=_extract_job_id(r.get("details_url", "")),
            )
            for r in runs
            if r.get("conclusion") not in ("success", "skipped", "neutral")
        ]

        if not failed:
            return CIResult(passing=True)

        # Fetch error details for each failing check
        parts: List[str] = []
        for check in failed:
            if check.job_id:
                errors = await _fetch_job_log_errors(token, owner, repo, check.job_id, http)
            else:
                errors = "(no job ID available)"
            parts.append(f"### {check.name} — FAILED\n{errors}")

        return CIResult(
            passing=False,
            failure_summary="\n\n".join(parts),
            failed_checks=failed,
        )

    return CIResult(
        passing=False,
        failure_summary="CI checks did not complete within the allotted time.",
    )


# ---------------------------------------------------------------------------
# Fix spec builder
# ---------------------------------------------------------------------------

def build_ci_fix_spec(
    pr_url: str,
    epic_title: str,
    ci_result: CIResult,
    repo: str,
    branch: str,
    attempt: int,
    max_attempts: int,
) -> str:
    failed_names = ", ".join(c.name for c in ci_result.failed_checks) or "unknown"
    return f"""You are a CI repair agent. GitHub Actions CI checks failed for a pull request and you must fix ALL of them.

Epic: {epic_title}
Repository: {repo}
Branch to fix: {branch}
PR URL: {pr_url}
Fix attempt: {attempt} of {max_attempts}
Failing checks: {failed_names}

## Failing CI check details

{ci_result.failure_summary}

## How to fix (read carefully)

- `ModuleNotFoundError: No module named 'X'`
  → The package is missing from requirements.txt. Add it. Note the import name often differs from the pip package name:
    - `email_validator` is installed as `email-validator`
    - `PIL` is installed as `Pillow`
    - `cv2` is installed as `opencv-python`
  → After adding, verify with: `pip install -r requirements.txt && python -c "from app.main import app"`

- Ruff / Flake8 lint errors (W291, W293, E501, F401, etc.)
  → Run `ruff check --fix .` (or `ruff --fix .`) inside the backend directory.
  → Commit ALL files changed by ruff, not just the ones you edited manually.

- `npm ci` failing with "Missing from lock file"
  → The package-lock.json is out of sync with package.json.
  → Run `npm install` inside the frontend directory.
  → Commit BOTH `package.json` AND `package-lock.json`.

- Import errors at app startup
  → Fix the import path or add the missing package to requirements.txt.

## Required steps

1. The `{branch}` branch is already checked out in your workspace.
2. Read each failure above and identify the root cause.
3. Make the minimal targeted fix for EVERY failing check.
4. Verify locally:
   - Backend: `cd backend && pip install -r requirements.txt && python -c "from app.main import app" && ruff check .`
   - Frontend: `cd frontend && npm install && npm run build`
5. Commit and push ALL changed files to the `{branch}` branch.
6. Do NOT create a new PR. Do NOT modify unrelated code.
7. When done, confirm what you fixed.
"""
