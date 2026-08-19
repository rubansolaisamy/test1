import asyncio
import json
import logging
import re
import secrets
import subprocess
import time
from datetime import datetime, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

import boto3
import httpx
from botocore.exceptions import ClientError

from app.api.sse import emit
from app.core.config import settings
from app.graph.nodes.jira_node import build_epic_task_spec
from app.graph.services import hitl_manager, task_callback_manager
from app.graph.services.state_manager import StateManager
from app.graph.state import EpicImplementationRecord, GraphState, SDLCStateDocument
from app.services.ci_monitor import (
    CIResult,
    build_ci_fix_spec,
    get_pr_details,
    poll_ci_until_complete,
)
from app.services.jira_issue_service import JiraIssueService
from app.services.openhands_client import OpenHandsClient, OpenHandsError


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _cleanup_stale_sandboxes() -> None:
    """Remove ALL oh-agent-server containers (running and stopped) to free ports.

    Previous-epic sandboxes stay running after their conversation ends, holding
    low port numbers and pushing Docker into Windows' excluded port range.
    All oh-agent-server containers are ephemeral — safe to remove at any time.
    """
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                ["docker", "ps", "-a",
                 "--filter", "name=oh-agent-server",
                 "--format", "{{.Names}}"],
                capture_output=True, text=True, timeout=10,
            )
        )
        containers = [c.strip() for c in result.stdout.splitlines() if c.strip()]
        if not containers:
            return
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                ["docker", "rm", "-f"] + containers,
                capture_output=True, text=True, timeout=30,
            )
        )
        logger.info(f"Cleaned up {len(containers)} sandbox containers")
    except Exception as exc:
        logger.warning(f"Sandbox cleanup failed (non-fatal): {exc}")


def _completed_summaries(epic_records: List[EpicImplementationRecord]) -> List[str]:
    summaries = []
    for r in epic_records:
        if r.status == "COMPLETED":
            line = f"{r.epic_id}: {r.epic_title}"
            if r.merged_sha:
                line += f" [MERGED to main, sha: {r.merged_sha[:8]}]"
            if r.implementation_summary:
                line += f"\n  Summary: {r.implementation_summary[:300]}"
            summaries.append(line)
    return summaries


def _build_guidance_message(record: EpicImplementationRecord) -> str:
    return (
        f"You seem to be idle. Current Epic: {record.epic_title}.\n"
        "Please review your progress and continue implementing the remaining stories.\n"
        "If you are blocked, describe what is preventing you from proceeding."
    )


def _build_escalation_message(record: EpicImplementationRecord) -> str:
    return (
        f"You have been idle for an extended period on Epic: {record.epic_title}.\n"
        "Please summarize: (1) what you have completed so far, "
        "(2) what you are currently attempting, "
        "(3) the specific issue preventing you from proceeding."
    )


def _parse_test_results(output: str, record: EpicImplementationRecord) -> None:
    # pytest: "X passed, Y failed"
    m = re.search(r"(\d+) passed", output)
    if m:
        record.tests_passed = int(m.group(1))
    m = re.search(r"(\d+) failed", output)
    if m:
        record.tests_failed = int(m.group(1))

    # jest / vitest
    m = re.search(r"Tests:\s+(?:\d+ skipped,\s+)?(\d+) passed", output)
    if m:
        record.tests_passed = int(m.group(1))
    m = re.search(r"Tests:.*?(\d+) failed", output)
    if m:
        record.tests_failed = int(m.group(1))

    # go test
    if re.search(r"\bok\b", output):
        record.tests_passed = (record.tests_passed or 0) + 1
    if re.search(r"\bFAIL\b", output):
        record.tests_failed = (record.tests_failed or 0) + 1

    record.test_output = output[-2000:]


def _extract_pr_url(event: dict) -> Optional[str]:
    text = json.dumps(event)
    m = re.search(r"https://github\.com/[^\s\"']+/pull/\d+", text)
    return m.group(0) if m else None


def _extract_pr_number(pr_url: str) -> Optional[int]:
    m = re.search(r"/pull/(\d+)", pr_url)
    return int(m.group(1)) if m else None


def _s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
        verify=False
    )


def _write_hitl_token(
    username: str,
    project_id: str,
    epic_index: int,
    record: EpicImplementationRecord,
) -> str:
    token = secrets.token_urlsafe(32)
    payload = {
        "phase": "epic",
        "project_id": project_id,
        "epic_index": epic_index,
        "epic_id": record.epic_id,
        "epic_title": record.epic_title,
        "pr_url": record.pr_url,
        "conversation_url": record.conversation_url,
        "implementation_summary": record.implementation_summary,
        "tests_passed": record.tests_passed,
        "tests_failed": record.tests_failed,
        "status": "pending",
    }
    try:
        _s3_client().put_object(
            Bucket=settings.SDLC_STATE_BUCKET,
            Key=f"users/{username}/{project_id}/hitl/{token}.json",
            Body=json.dumps(payload),
            ContentType="application/json",
        )
    except ClientError as exc:
        raise OpenHandsError(f"Failed to write HITL token for {project_id}/{epic_index}: {exc}") from exc
    return token


async def _merge_pr_to_main(
    record: EpicImplementationRecord,
    repo: str,
    github_token: str,
    project_id: str,
) -> str:
    """Merge the epic's approved PR via GitHub squash merge. Returns the merge commit SHA."""
    pr_number = _extract_pr_number(record.pr_url)
    if pr_number is None:
        raise OpenHandsError(f"Cannot parse PR number from URL: {record.pr_url}")
    if "/" not in repo:
        raise OpenHandsError(f"Invalid repo format (expected owner/repo): {repo}")
    owner, repo_name = repo.split("/", 1)

    async with httpx.AsyncClient(timeout=30.0) as http:
        # Final CI re-check only if CI wasn't already confirmed passing by the repair loop.
        # Skipping avoids a short-timeout race with slow security scans (e.g. Trivy, SAST).
        if record.ci_status != "PASSING":
            pr = await get_pr_details(github_token, owner, repo_name, pr_number, http)
            if pr:
                ci = await poll_ci_until_complete(
                    github_token, owner, repo_name, pr["sha"],
                    timeout=120, poll_interval=10, http=http,
                )
                if not ci.passing and "No CI checks configured" not in ci.failure_summary:
                    raise OpenHandsError(
                        f"Merge blocked — CI still failing for {record.epic_title}: "
                        f"{ci.failure_summary[:300]}"
                    )

        # Convert draft PR to ready-for-review before merging
        draft_check = await http.get(
            f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}",
            headers={"Authorization": f"token {github_token}", "Accept": "application/vnd.github+json"},
        )
        if draft_check.is_success and draft_check.json().get("draft"):
            pr_node_id = draft_check.json()["node_id"]
            await http.post(
                "https://api.github.com/graphql",
                headers={"Authorization": f"bearer {github_token}"},
                json={"query": f'mutation {{ markPullRequestReadyForReview(input: {{pullRequestId: "{pr_node_id}"}}) {{ pullRequest {{ isDraft }} }} }}'},
            )

        resp = await http.put(
            f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/merge",
            headers={
                "Authorization": f"token {github_token}",
                "Accept": "application/vnd.github+json",
            },
            json={
                "commit_title": f"{record.epic_id}: {record.epic_title}",
                "merge_method": "squash",
            },
        )

    if resp.status_code == 200:
        return resp.json().get("sha", "")
    raise OpenHandsError(
        f"GitHub merge API returned {resp.status_code} for {record.epic_title}: {resp.text[:300]}"
    )


async def _wait_for_hitl(
    username: str,
    project_id: str,
    token: str,
    sm: StateManager,
) -> str:
    """Wait for HITL decision via asyncio.Event; fall back to S3 poll on restart."""
    # Fast path: decision already written to S3 before pipeline resumed
    state_doc = sm.get_state(username, project_id)
    for r in state_doc.epic_records:
        if r.hitl_token == token and r.hitl_decision:
            return r.hitl_decision

    event = hitl_manager.register_hitl(token)
    try:
        await asyncio.wait_for(
            event.wait(),
            timeout=settings.HITL_APPROVAL_TIMEOUT_HOURS * 3600,
        )
    except asyncio.TimeoutError:
        pass
    finally:
        hitl_manager.resolve_hitl(token)

    state_doc = sm.get_state(username, project_id)
    for r in state_doc.epic_records:
        if r.hitl_token == token:
            return r.hitl_decision or "rejected"
    return "rejected"


# ---------------------------------------------------------------------------
# Streaming helper — used for both initial implementation and CI fix rounds
# ---------------------------------------------------------------------------

async def _stream_until_finished(
    client: OpenHandsClient,
    conversation_id: str,
    record: EpicImplementationRecord,
    project_id: str,
    state_doc: SDLCStateDocument,
    sm: StateManager,
    timeout: int,
    stuck_threshold: int,
    send_guidance: bool = True,
) -> None:
    """
    Stream events from *conversation_id* until the agent signals completion
    (FinishAction, STOPPED state, or a recognised completion message).
    Updates *record* in-place (pr_url, test results, implementation_summary).
    Applies stuck-detection and sends guidance/escalation messages as needed.
    """
    last_event_time = time.monotonic()
    stuck_stage: int = 0  # 0=fine, 1=guidance sent, 2=escalated, 3=giving up

    async for event in client.stream_events(conversation_id, timeout=timeout):
        if event is None:
            elapsed = time.monotonic() - last_event_time
            await emit(
                project_id,
                "EPIC_IN_PROGRESS",
                {"epic_id": record.epic_id, "elapsed_seconds": int(elapsed)},
            )
            if not send_guidance:
                # CI fix stream: never poke the agent — it will finish on its own.
                # stream_events exits via consecutive-empty-poll detection; this is a fallback.
                if elapsed > stuck_threshold:
                    sm.update_state(state_doc)
                    return
                continue
            if elapsed > stuck_threshold * 3 and stuck_stage < 3:
                stuck_stage = 3
                raise OpenHandsError(
                    f"Agent stuck for {int(elapsed // 60)} min with no progress on {record.epic_title}"
                )
            elif elapsed > stuck_threshold * 2 and stuck_stage < 2:
                await client.send_message(conversation_id, _build_escalation_message(record))
                stuck_stage = 2
                await emit(project_id, "EPIC_GUIDANCE_SENT", {"epic_id": record.epic_id, "stage": 2})
            elif elapsed > stuck_threshold and stuck_stage < 1:
                await client.send_message(conversation_id, _build_guidance_message(record))
                stuck_stage = 1
                await emit(project_id, "EPIC_GUIDANCE_SENT", {"epic_id": record.epic_id, "stage": 1})
            continue

        last_event_time = time.monotonic()
        # Don't reset stuck_stage to 0 — once guidance is sent, keep escalating
        # so the loop eventually terminates even if the agent keeps responding.

        kind = event.get("kind", "")

        # Terminal output → parse test results
        if kind == "ObservationEvent":
            obs = event.get("observation") or {}
            raw = obs.get("content") or obs.get("output") or ""
            if isinstance(raw, list):
                output = " ".join(
                    c.get("text", "") for c in raw
                    if isinstance(c, dict) and c.get("type") == "text"
                )
            else:
                output = raw
            if output:
                _parse_test_results(output, record)

        # Agent text messages — capture PR URL, surface to SSE, detect completion
        if kind == "MessageEvent" and event.get("source") == "agent":
            llm_msg = event.get("llm_message") or {}
            content_list = llm_msg.get("content", [])
            msg = " ".join(
                c.get("text", "") for c in content_list
                if isinstance(c, dict) and c.get("type") == "text"
            )
            if msg:
                pr_candidate = _extract_pr_url(event)
                if pr_candidate:
                    record.pr_url = pr_candidate
                await emit(
                    project_id,
                    "EPIC_AGENT_MESSAGE",
                    {"epic_id": record.epic_id, "message": msg[:500]},
                )
                msg_lower = msg.lower()
                if (
                    "IMPLEMENTATION COMPLETE" in msg
                    or '"status": "complete"' in msg
                    or '"status": "partial"' in msg
                    or "ci checks are now passing" in msg_lower
                    or "all ci checks are now passing" in msg_lower
                    or "ci is now passing" in msg_lower
                    or "all checks are passing" in msg_lower
                    or "all ci checks pass" in msg_lower
                ):
                    sm.update_state(state_doc)
                    break

        # FinishAction — terminal signal from the agent
        if kind == "ActionEvent":
            action = event.get("action") or {}
            if action.get("kind") == "FinishAction":
                record.implementation_summary = record.implementation_summary or action.get("message", "")
                record.pr_url = record.pr_url or _extract_pr_url(event)
                sm.update_state(state_doc)
                break

        # Conversation reached a terminal state inside OpenHands
        if kind == "ConversationStateUpdateEvent":
            if event.get("key") == "status" and event.get("value") in ("STOPPED", "ERROR"):
                record.pr_url = record.pr_url or _extract_pr_url(event)
                sm.update_state(state_doc)
                break


# ---------------------------------------------------------------------------
# CI repair loop
# ---------------------------------------------------------------------------

async def _run_ci_repair_loop(
    project_id: str,
    record: EpicImplementationRecord,
    state_doc: SDLCStateDocument,
    sm: StateManager,
    client: OpenHandsClient,
    github_token: str,
    repo: str,
    cs,  # CodegenSettings
    stuck_threshold: int,
) -> None:
    """
    After an OpenHands conversation creates a PR, poll GitHub CI checks.
    If any fail, start a targeted fix conversation, re-stream it, then re-poll.
    Repeats up to cs.max_ci_fix_attempts times.
    Raises OpenHandsError if CI still fails after all attempts.
    If no PR exists, or GitHub is unreachable, silently skips.
    """
    if not record.pr_url:
        return  # No PR — nothing to check

    pr_number = _extract_pr_number(record.pr_url)
    if pr_number is None:
        return

    if "/" not in repo:
        return
    owner, repo_name = repo.split("/", 1)

    ci_timeout = cs.ci_check_timeout_minutes * 60
    # Fix streaming gets half the normal epic timeout, capped at 30 min
    fix_stream_timeout = min(cs.conversation_timeout_minutes * 30, 1800)

    async with httpx.AsyncClient(timeout=30.0) as http:
        for attempt in range(cs.max_ci_fix_attempts):
            # --- Wait for GH Actions to trigger ---
            await emit(project_id, "EPIC_CI_CHECKING", {
                "epic_id": record.epic_id,
                "attempt": attempt + 1,
                "max_attempts": cs.max_ci_fix_attempts,
            })
            record.ci_status = "CHECKING"
            record.ci_fix_attempts = attempt
            sm.update_state(state_doc)

            # Give GitHub Actions time to register and queue the checks
            await asyncio.sleep(settings.CI_INITIAL_WAIT_SECONDS)

            # Get the PR's current head commit SHA and branch name
            pr_details = await get_pr_details(github_token, owner, repo_name, pr_number, http)
            if not pr_details:
                # GitHub unreachable — skip CI gate rather than block the pipeline
                record.ci_status = None
                sm.update_state(state_doc)
                return

            sha = pr_details["sha"]
            epic_branch = pr_details["branch"]

            # --- Poll until all checks conclude ---
            ci_result = await poll_ci_until_complete(
                github_token, owner, repo_name, sha,
                timeout=ci_timeout,
                poll_interval=settings.CI_POLL_INTERVAL_SECONDS,
                http=http,
            )

            if ci_result.passing:
                record.ci_status = "PASSING"
                sm.update_state(state_doc)
                await emit(project_id, "EPIC_CI_PASSED", {
                    "epic_id": record.epic_id,
                    "attempt": attempt + 1,
                })
                return  # All good — proceed to HITL

            # --- CI failed ---
            record.ci_status = "FAILED"
            record.ci_failure_summary = ci_result.failure_summary
            sm.update_state(state_doc)

            if attempt >= cs.max_ci_fix_attempts - 1:
                # All fix attempts exhausted
                await emit(project_id, "EPIC_CI_EXHAUSTED", {
                    "epic_id": record.epic_id,
                    "failed_checks": [c.name for c in ci_result.failed_checks],
                    "failure_summary": ci_result.failure_summary[:800],
                })
                raise OpenHandsError(
                    f"CI checks still failing after {cs.max_ci_fix_attempts} repair attempt(s) "
                    f"for {record.epic_title}. "
                    f"Failing: {', '.join(c.name for c in ci_result.failed_checks)}. "
                    f"See ci_failure_summary on the epic record for details."
                )

            # --- Start a new targeted fix conversation ---
            await emit(project_id, "EPIC_CI_FIXING", {
                "epic_id": record.epic_id,
                "attempt": attempt + 1,
                "failed_checks": [c.name for c in ci_result.failed_checks],
            })
            record.ci_status = "FIXING"
            sm.update_state(state_doc)

            fix_spec = build_ci_fix_spec(
                pr_url=record.pr_url,
                epic_title=record.epic_title,
                ci_result=ci_result,
                repo=repo,
                branch=epic_branch,
                attempt=attempt + 1,
                max_attempts=cs.max_ci_fix_attempts,
            )

            fix_ready = None
            for _fix_attempt in range(3):
                if _fix_attempt > 0:
                    await _cleanup_stale_sandboxes()
                    await asyncio.sleep(15)
                fix_task_id = await client.execute_task(fix_spec, repo, epic_branch)
                try:
                    fix_ready = await client.wait_for_ready(fix_task_id)
                    break
                except OpenHandsError as exc:
                    err_lower = str(exc).lower()
                    is_infra_error = any(k in err_lower for k in (
                        "sandbox", "container", "ports are not available",
                        "failed to start", "bind:", "access permissions",
                        "500:", "error state",
                    ))
                    if _fix_attempt < 2 and is_infra_error:
                        await emit(project_id, "EPIC_AGENT_MESSAGE", {
                            "epic_id": record.epic_id,
                            "message": f"CI fix sandbox startup failed (attempt {_fix_attempt+1}/3), retrying…",
                        })
                        continue
                    raise
            fix_conv_id = fix_ready["app_conversation_id"]

            await emit(project_id, "EPIC_AGENT_MESSAGE", {
                "epic_id": record.epic_id,
                "message": f"[CI fix attempt {attempt + 1}] Starting repair conversation…",
            })

            # Stream the fix conversation — it updates the branch with the fixes
            await _stream_until_finished(
                client=client,
                conversation_id=fix_conv_id,
                record=record,
                project_id=project_id,
                state_doc=state_doc,
                sm=sm,
                timeout=fix_stream_timeout,
                stuck_threshold=stuck_threshold,
                send_guidance=False,
            )

            # Loop back — re-poll CI on the next iteration (new commits pushed)


# ---------------------------------------------------------------------------
# Main orchestrator node
# ---------------------------------------------------------------------------

async def orchestrator_node(state: GraphState) -> GraphState:
    project_id = state["project_id"]
    state_doc = state["state_doc"]
    sm = StateManager()
    username = state_doc.username

    # # ========================================================
    # # 🟡 TEMPORARY MOCK FOR ORCHESTRATOR NODE
    # # ========================================================
    # import asyncio
    # print("🟡 MOCKING ORCHESTRATOR: Bypassing OpenHands & GitHub CI...")
    
    # total_epics = len(state_doc.epic_records)
    
    # for i in range(total_epics):
    #     state_doc = sm.get_state(username, project_id)
    #     record = state_doc.epic_records[i]

    #     if record.status == "COMPLETED":
    #         continue

    #     # 1. Resume HITL gate if we are waiting for human UI click
    #     if record.status == "AWAITING_APPROVAL" and record.hitl_token:
    #         decision = await _wait_for_hitl(username, project_id, record.hitl_token, sm)
    #         state_doc = sm.get_state(username, project_id)
    #         record = state_doc.epic_records[i]
            
    #         if decision == "approved":
    #             record.status = "COMPLETED"
    #             record.merged_sha = f"mock-merge-sha-{i}"
    #             sm.update_state(state_doc)
    #             await emit(project_id, "EPIC_APPROVED", {"epic_id": record.epic_id})
    #             await emit(project_id, "EPIC_COMPLETED", {"epic_id": record.epic_id, "pr_url": record.pr_url, "merged_sha": record.merged_sha})
    #         else:
    #             record.status = "FAILED"
    #             sm.update_state(state_doc)
    #             await emit(project_id, "EPIC_REJECTED", {"epic_id": record.epic_id})
    #         continue

    #     # 2. Start mock implementation
    #     record.status = "IMPLEMENTING"
    #     record.started_at = _now_iso()
    #     sm.update_state(state_doc)
        
    #     await emit(
    #         project_id, "EPIC_STARTED", 
    #         {"epic_id": record.epic_id, "epic_title": record.epic_title, "epic_index": i, "total_epics": total_epics}
    #     )
        
    #     # Fake "AI Coding" and "GitHub CI" time
    #     await asyncio.sleep(3)
        
    #     # Fake successful PR and Test results
    #     record.pr_url = f"https://github.com/mock/repo/pull/{100 + i}"
    #     record.implementation_summary = f"Mock implementation for {record.epic_title} completed successfully.\n- Added endpoints\n- Wrote tests"
    #     record.tests_passed = 42
    #     record.tests_failed = 0
    #     record.ci_status = "PASSING"
    #     record.completed_at = _now_iso()
    #     sm.update_state(state_doc)

    #     # 3. Trigger Frontend UI Gate
    #     if state_doc.hitl_enabled:
    #         token = _write_hitl_token(username, project_id, i, record)
    #         record.hitl_token = token
    #         record.status = "AWAITING_APPROVAL"
    #         sm.update_state(state_doc)

    #         await emit(
    #             project_id, "EPIC_AWAITING_APPROVAL",
    #             {
    #                 "epic_id": record.epic_id,
    #                 "hitl_token": token,
    #                 "pr_url": record.pr_url,
    #                 "conversation_url": "http://localhost:3000/conversations/mock",
    #                 "implementation_summary": record.implementation_summary,
    #                 "tests_passed": record.tests_passed,
    #                 "tests_failed": record.tests_failed,
    #                 "ci_status": record.ci_status,
    #                 "changed_files": ["src/mock_api.py", "tests/test_mock.py"],
    #             },
    #         )
            
    #         # Wait for user to click Approve/Reject in UI
    #         decision = await _wait_for_hitl(username, project_id, token, sm)
    #         state_doc = sm.get_state(username, project_id)
    #         record = state_doc.epic_records[i]
            
    #         if decision == "approved":
    #             record.status = "COMPLETED"
    #             record.merged_sha = f"mock-merge-sha-{i}"
    #             sm.update_state(state_doc)
    #             await emit(project_id, "EPIC_APPROVED", {"epic_id": record.epic_id})
    #             await emit(project_id, "EPIC_COMPLETED", {"epic_id": record.epic_id, "pr_url": record.pr_url, "merged_sha": record.merged_sha})
    #         else:
    #             record.status = "FAILED"
    #             sm.update_state(state_doc)
    #             await emit(project_id, "EPIC_REJECTED", {"epic_id": record.epic_id})
    #     else:
    #         # Auto-approve
    #         record.status = "COMPLETED"
    #         record.merged_sha = f"mock-merge-sha-auto-{i}"
    #         sm.update_state(state_doc)
    #         await emit(project_id, "EPIC_COMPLETED", {"epic_id": record.epic_id, "pr_url": record.pr_url, "merged_sha": record.merged_sha})

    # # 4. Finish overall pipeline logic
    # state_doc = sm.get_state(username, project_id)
    # completed = sum(1 for r in state_doc.epic_records if r.status == "COMPLETED")
    # failed = sum(1 for r in state_doc.epic_records if r.status == "FAILED")
    # state_doc.status = "COMPLETED" if failed == 0 else "COMPLETED_WITH_ERRORS"
    # sm.update_state(state_doc)

    # await emit(project_id, "PIPELINE_COMPLETED", {"completed_epics": completed, "failed_epics": failed})

    # return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}

    client = OpenHandsClient(base_url=state_doc.openhands_url)
    repo = state_doc.github_repo or ""
    branch = state_doc.github_branch or "main"
    total_epics = len(state_doc.epic_records)

    try:
        cs = state_doc.codegen_settings
        await client.configure(
            github_token=state_doc.github_token,
            llm_model=cs.llm_model,
            git_user_name=cs.git_user_name,
            git_user_email=cs.git_user_email,
        )

        state_doc.status = "CODE_GENERATION_IN_PROGRESS"
        sm.update_state(state_doc)
        await emit(project_id, "CODE_GENERATION_STARTED", {"total_epics": total_epics})

        for i in range(total_epics):
            # Re-read fresh state each iteration so HITL resume is clean
            state_doc = sm.get_state(username, project_id)
            cs = state_doc.codegen_settings
            record = state_doc.epic_records[i]

            if record.status == "COMPLETED":
                continue

            # Hard stop: too many retries for a genuinely failing epic
            if record.status == "FAILED" and record.retry_count >= cs.max_epic_retries:
                continue

            # Resume HITL gate if we restarted mid-approval
            if record.status == "AWAITING_APPROVAL" and record.hitl_token:
                decision = await _wait_for_hitl(username, project_id, record.hitl_token, sm)
                state_doc = sm.get_state(username, project_id)
                record = state_doc.epic_records[i]
                await _apply_hitl_result(project_id, record, state_doc, sm, repo, state_doc.github_token)
                continue

            # --- Start or resume epic ---
            previous_status = record.status
            record.status = "IMPLEMENTING"
            record.started_at = _now_iso()
            record.retry_count = record.retry_count + 1

            # On retry of a FAILED epic, discard stale execution data.
            # Preserve pr_url if already set — lets us skip straight to CI repair
            # without redoing the full implementation conversation.
            if previous_status == "FAILED":
                existing_pr_url = record.pr_url  # may be None
                record.conversation_id = None
                record.conversation_url = None
                record.start_task_id = None
                record.pr_url = existing_pr_url  # keep if implementation was already done
                record.implementation_summary = None
                record.tests_passed = None
                record.tests_failed = None
                record.test_output = None
                record.ci_status = None
                record.ci_fix_attempts = 0
                record.ci_failure_summary = None
                record.merged_sha = None
                record.merge_error = None
                # hitl_feedback intentionally preserved — gives retry context to the agent
            sm.update_state(state_doc)

            await emit(
                project_id,
                "EPIC_STARTED",
                {
                    "epic_id": record.epic_id,
                    "epic_title": record.epic_title,
                    "epic_index": i,
                    "total_epics": total_epics,
                },
            )

            # Emit story list so frontend can show what will be implemented
            _chunked = state_doc.chunked_epics[i] if i < len(state_doc.chunked_epics) else {}
            _stories = [
                {"id": s["story"].get("id", ""), "title": s["story"].get("title", "")}
                for s in _chunked.get("stories", [])
            ]
            await emit(project_id, "EPIC_STORIES", {
                "epic_id": record.epic_id,
                "stories": _stories,
            })

            stuck_threshold = settings.OPENHANDS_STUCK_TIMEOUT_SECONDS
            epic_timeout = cs.conversation_timeout_minutes * 60

            try:
                # If PR already exists (e.g. retry after CI failure), skip straight to CI repair
                if record.pr_url and not record.conversation_id:
                    await emit(project_id, "EPIC_AGENT_MESSAGE", {
                        "epic_id": record.epic_id,
                        "message": f"PR already exists ({record.pr_url}), skipping implementation — proceeding to CI checks.",
                    })

                # Resume an existing OpenHands conversation if one was already started
                elif record.conversation_id:
                    await emit(
                        project_id,
                        "EPIC_CONVERSATION_READY",
                        {
                            "epic_id": record.epic_id,
                            "conversation_url": record.conversation_url,
                        },
                    )
                else:
                    spec = build_epic_task_spec(
                        state_doc.chunked_epics[i],
                        state_doc.plan_md_content or "",
                        repo,
                        branch,
                        _completed_summaries(state_doc.epic_records),
                        state_doc.implementation_ticket_ids,
                        record.hitl_feedback,
                    )
                    callback_token = f"{project_id}/{i}"
                    task_callback_manager.register(callback_token)

                    callback_url: str | None = None
                    if settings.SDLC_ORCHESTRATOR_BASE_URL:
                        callback_url = (
                            f"{settings.SDLC_ORCHESTRATOR_BASE_URL}"
                            f"/api/v1/pipeline/task-callback/{project_id}/{i}"
                        )

                    # Clean up stale sandbox containers before starting
                    await _cleanup_stale_sandboxes()

                    # Create the initial task before the retry loop
                    task_id = await client.execute_task(
                        spec, repo, branch,
                        callback_url=callback_url,
                        llm_model=cs.llm_model,
                    )
                    record.start_task_id = task_id
                    sm.update_state(state_doc)

                    # Retry sandbox startup up to 3 times — sandbox errors are
                    # transient OpenHands infra failures, not epic-level failures.
                    ready = None
                    for _startup_attempt in range(3):
                        if _startup_attempt > 0:
                            # Previous sandbox failed — create a fresh task
                            task_id = await client.execute_task(
                                spec, repo, branch,
                                callback_url=callback_url,
                                llm_model=cs.llm_model,
                            )
                            record.start_task_id = task_id
                            sm.update_state(state_doc)
                        try:
                            ready = await client.wait_for_ready(record.start_task_id)
                            break
                        except OpenHandsError as exc:
                            err_lower = str(exc).lower()
                            is_infra_error = any(k in err_lower for k in (
                                "sandbox", "container", "ports are not available",
                                "failed to start", "bind:", "access permissions",
                                "500:", "error state",
                            ))
                            if _startup_attempt < 2 and is_infra_error:
                                await emit(project_id, "EPIC_AGENT_MESSAGE", {
                                    "epic_id": record.epic_id,
                                    "message": f"Sandbox startup failed (attempt {_startup_attempt+1}/3), cleaning up and retrying…",
                                })
                                await _cleanup_stale_sandboxes()
                                await asyncio.sleep(15)
                                continue
                            raise
                    record.conversation_id = ready["app_conversation_id"]
                    record.conversation_url = (
                        f"{state_doc.openhands_url}/conversations/{record.conversation_id}"
                    )
                    sm.update_state(state_doc)

                    await emit(
                        project_id,
                        "EPIC_CONVERSATION_READY",
                        {
                            "epic_id": record.epic_id,
                            "conversation_url": record.conversation_url,
                        },
                    )

                # --- Stream initial implementation (skip if PR already exists) ---
                if record.conversation_id:
                    await _stream_until_finished(
                        client=client,
                        conversation_id=record.conversation_id,
                        record=record,
                        project_id=project_id,
                        state_doc=state_doc,
                        sm=sm,
                        timeout=epic_timeout,
                        stuck_threshold=stuck_threshold,
                    )

                # Merge structured callback results if PhaseCompletionCallbackProcessor fired
                cb = task_callback_manager.get_result(f"{project_id}/{i}")
                if cb:
                    cb_test = cb.get("test_status", "")
                    if cb_test == "pass" and record.tests_passed is None:
                        record.tests_passed = 1
                    if cb_test == "fail" and record.tests_failed is None:
                        record.tests_failed = 1
                    cb_summary = cb.get("test_output_summary", "")
                    if cb_summary:
                        record.test_output = (record.test_output or "") + "\n" + cb_summary
                    if not record.implementation_summary:
                        record.implementation_summary = f"phase={cb.get('phase')} status={cb.get('status')}"
                task_callback_manager.cleanup(f"{project_id}/{i}")

                # --- CI Repair loop (between implementation and HITL) ---
                if state_doc.github_token and record.pr_url:
                    await _run_ci_repair_loop(
                        project_id=project_id,
                        record=record,
                        state_doc=state_doc,
                        sm=sm,
                        client=client,
                        github_token=state_doc.github_token,
                        repo=repo,
                        cs=cs,
                        stuck_threshold=stuck_threshold,
                    )
                elif record.pr_url and not state_doc.github_token:
                    await emit(project_id, "EPIC_CI_SKIPPED", {
                        "epic_id": record.epic_id,
                        "reason": "No GitHub token configured — CI checks were not run",
                    })

                # Hard gate: no PR means the agent didn't complete its work
                if not record.pr_url:
                    raise OpenHandsError(
                        f"No PR was created for {record.epic_title} — agent may not have completed implementation."
                    )

                # CI still failing after all repair attempts — warn but let human decide
                if record.ci_status == "FAILED":
                    await emit(project_id, "EPIC_AGENT_MESSAGE", {
                        "epic_id": record.epic_id,
                        "message": (
                            f"⚠️ CI checks are still failing after all repair attempts "
                            f"({record.ci_failure_summary or 'see PR for details'}). "
                            "Proceeding to manual approval — you can approve despite CI failures."
                        ),
                    })

            except Exception as exc:
                record.status = "FAILED"
                record.error_message = str(exc)
                record.completed_at = _now_iso()
                sm.update_state(state_doc)
                await emit(
                    project_id,
                    "EPIC_FAILED",
                    {"epic_id": record.epic_id, "error": str(exc)},
                )
                task_callback_manager.cleanup(f"{project_id}/{i}")
                if record.retry_count >= cs.max_epic_retries:
                    continue  # exhausted retries — skip, proceed to next epic
                state_doc.status = "RETRY_PENDING"
                sm.update_state(state_doc)
                await emit(
                    project_id,
                    "PIPELINE_PAUSED",
                    {
                        "epic_id": record.epic_id,
                        "error": str(exc),
                        "retry_count": record.retry_count,
                        "max_retries": cs.max_epic_retries,
                    },
                )
                break  # stop and wait — user re-launches to retry

            # --- HITL Gate ---
            record.completed_at = _now_iso()
            sm.update_state(state_doc)

            if state_doc.hitl_enabled:
                token = _write_hitl_token(username, project_id, i, record)
                record.hitl_token = token
                record.status = "AWAITING_APPROVAL"
                sm.update_state(state_doc)

                changed_files = await _fetch_pr_files(
                    record.pr_url or "", state_doc.github_token or ""
                )
                await emit(
                    project_id,
                    "EPIC_AWAITING_APPROVAL",
                    {
                        "epic_id": record.epic_id,
                        "hitl_token": token,
                        "pr_url": record.pr_url,
                        "conversation_url": record.conversation_url,
                        "implementation_summary": record.implementation_summary,
                        "tests_passed": record.tests_passed,
                        "tests_failed": record.tests_failed,
                        "ci_status": record.ci_status,
                        "ci_failure_summary": record.ci_failure_summary,
                        "changed_files": changed_files,
                    },
                )

                await _wait_for_hitl(username, project_id, token, sm)
                state_doc = sm.get_state(username, project_id)
                record = state_doc.epic_records[i]
            else:
                record.hitl_decision = "approved"
                sm.update_state(state_doc)

            await _apply_hitl_result(project_id, record, state_doc, sm, repo, state_doc.github_token)

        # --- Pipeline complete ---
        state_doc = sm.get_state(username, project_id)
        completed = sum(1 for r in state_doc.epic_records if r.status == "COMPLETED")
        failed = sum(1 for r in state_doc.epic_records if r.status == "FAILED")
        state_doc.status = "COMPLETED" if failed == 0 else "COMPLETED_WITH_ERRORS"
        sm.update_state(state_doc)

        await emit(
            project_id,
            "PIPELINE_COMPLETED",
            {"completed_epics": completed, "failed_epics": failed},
        )

    except Exception as exc:
        state_doc.status = "FAILED"
        state_doc.last_error = str(exc)
        sm.update_state(state_doc)
        await emit(project_id, "PIPELINE_FAILED", {"error": str(exc)})
    finally:
        await client.close()

    return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}


async def _fetch_pr_files(pr_url: str, github_token: str) -> List[str]:
    """Return changed filenames from GitHub PR Files API. Non-fatal — returns [] on any error."""
    m = re.search(r"github\.com/([^/]+/[^/]+)/pull/(\d+)", pr_url or "")
    if not m:
        return []
    owner_repo, pr_number = m.group(1), m.group(2)
    url = f"https://api.github.com/repos/{owner_repo}/pulls/{pr_number}/files"
    headers = {"Authorization": f"token {github_token}", "Accept": "application/vnd.github+json"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.get(url, headers=headers)
            if resp.status_code == 200:
                return [f["filename"] for f in resp.json()][:50]
    except Exception:
        pass
    return []


async def _update_jira_for_epic(
    project_id: str,
    record: EpicImplementationRecord,
    state_doc: SDLCStateDocument,
) -> None:
    """Transition matching JIRA issues to Done and add a PR comment. Non-fatal."""
    jira_key_map = state_doc.jira_key_map
    if not jira_key_map:
        return

    epic_ticket_ids: List[str] = []
    for chunk in state_doc.chunked_epics:
        for epic in chunk.get("epics", []):
            if epic.get("epic_id") == record.epic_id:
                for story in epic.get("stories", []):
                    epic_ticket_ids.append(story.get("id", ""))
                    for task in story.get("tasks", []):
                        epic_ticket_ids.append(task.get("id", ""))
                break

    jira_keys = [jira_key_map[tid] for tid in epic_ticket_ids if tid in jira_key_map]
    if not jira_keys:
        return

    comment = (
        f"Implemented in PR: {record.pr_url or 'N/A'}\n"
        f"Merged SHA: {record.merged_sha or 'N/A'}\n"
        f"Epic: {record.epic_title}"
    )
    svc = JiraIssueService()
    loop = asyncio.get_event_loop()
    for key in jira_keys:
        try:
            await loop.run_in_executor(None, svc.transition_issue, key, "Done")
            await loop.run_in_executor(None, svc.add_comment, key, comment)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(f"JIRA update failed for {key}: {exc}")

    await emit(project_id, "JIRA_UPDATED", {
        "epic_id": record.epic_id,
        "updated_keys": jira_keys,
        "jira_base_url": settings.JIRA_BASE_URL,
    })


async def _apply_hitl_result(
    project_id: str,
    record: EpicImplementationRecord,
    state_doc: SDLCStateDocument,
    sm: StateManager,
    repo: str = "",
    github_token: Optional[str] = None,
) -> None:
    decision = record.hitl_decision or "rejected"
    if decision == "approved":
        record.status = "COMPLETED"
        sm.update_state(state_doc)
        await emit(project_id, "EPIC_APPROVED", {"epic_id": record.epic_id})

        # Auto-merge PR to main so the next epic builds on the accumulated codebase
        if record.pr_url and github_token and repo:
            try:
                sha = await _merge_pr_to_main(record, repo, github_token, project_id)
                record.merged_sha = sha
                sm.update_state(state_doc)
                await _update_jira_for_epic(project_id, record, state_doc)
            except OpenHandsError as exc:
                record.status = "FAILED"
                record.merge_error = str(exc)
                sm.update_state(state_doc)
                await emit(project_id, "EPIC_MERGE_FAILED", {
                    "epic_id": record.epic_id,
                    "error": str(exc),
                })
                return

        await emit(
            project_id,
            "EPIC_COMPLETED",
            {"epic_id": record.epic_id, "pr_url": record.pr_url, "merged_sha": record.merged_sha},
        )
    else:
        record.status = "FAILED"
        sm.update_state(state_doc)
        await emit(project_id, "EPIC_REJECTED", {"epic_id": record.epic_id})
