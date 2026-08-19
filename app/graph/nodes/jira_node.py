import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

from app.api.sse import emit
from app.core.config import settings
from app.graph.services.state_manager import StateManager
from app.graph.state import EpicImplementationRecord, GraphState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Jira REST API helpers
# ---------------------------------------------------------------------------

def _extract_adf_text(node: Any) -> str:
    """Recursively extract plain text from an Atlassian Document Format node."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_extract_adf_text(c) for c in node)
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type", "")
    if node_type == "text":
        return node.get("text", "")
    if node_type == "hardBreak":
        return "\n"
    text = "".join(_extract_adf_text(c) for c in node.get("content", []))
    if node_type in ("paragraph", "heading", "listItem", "bulletList", "orderedList"):
        return text + "\n"
    return text


def _convert_jira_issue(issue: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a Jira REST API v3 issue dict to the orchestrator's internal ticket format."""
    fields = issue.get("fields", {})

    # Normalize issue type: sub-task → task
    raw_type = (fields.get("issuetype") or {}).get("name", "task")
    issue_type = raw_type.lower().replace("-", "").replace(" ", "")
    if issue_type in ("subtask", "subask"):
        issue_type = "task"
    # Keep epic/story/task; anything unknown → task
    if issue_type not in ("epic", "story", "task"):
        issue_type = "task"

    description_text = _extract_adf_text(fields.get("description")).strip()

    # Resolve parent / epic_link.
    # Next-gen Jira: hierarchy is expressed via the `parent` field.
    # Classic Jira: stories link to epics via customfield_10014 (Epic Link).
    parent_field = fields.get("parent") or {}
    parent_key = parent_field.get("key")
    parent_type = (
        (parent_field.get("fields") or {}).get("issuetype", {}).get("name", "")
    ).lower()

    epic_link: Optional[str] = None
    parent_id: Optional[str] = None

    if parent_type == "epic":
        epic_link = parent_key
    elif parent_key:
        parent_id = parent_key
        # For classic Jira, stories may also carry the Epic Link custom field
        epic_link = fields.get("customfield_10014") or None
    else:
        # Classic Jira epic-link on stories (no parent field set)
        epic_link = fields.get("customfield_10014") or None

    return {
        "id": issue["key"],
        "title": fields.get("summary", ""),
        "issue_type": issue_type,
        "description": description_text,
        "user_story": description_text,
        "acceptance_criteria": [],   # no standard Jira field; OpenHands uses description
        "story_points": fields.get("customfield_10016"),
        "labels": fields.get("labels", []),
        "epic_link": epic_link,
        "parent_id": parent_id,
        "priority": (fields.get("priority") or {}).get("name", "Medium"),
    }


async def _fetch_tickets_from_jira(project_key: str) -> List[Dict[str, Any]]:
    """
    Fetch all issues for *project_key* from the Jira REST API (paginated).
    Returns a list in the orchestrator's internal ticket format.
    Raises httpx.HTTPStatusError on auth/permission failures so the caller
    can surface a meaningful error to the pipeline.
    """
    base_url = settings.JIRA_BASE_URL.rstrip("/")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    auth = (settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)

    jql = (
        f'project = "{project_key}" '
        f'ORDER BY issuetype DESC, created ASC'
    )
    # Request exactly the fields we need; avoids bloated payloads
    fields_param = ",".join([
        "summary",
        "description",
        "issuetype",
        "parent",
        "priority",
        "labels",
        "customfield_10014",   # classic Jira Epic Link
        "customfield_10016",   # Story Points
    ])

    tickets: List[Dict[str, Any]] = []
    page_size = 100
    next_page_token: Optional[str] = None

    async with httpx.AsyncClient(timeout=30.0) as http:
        while True:
            body: Dict[str, Any] = {
                "jql": jql,
                "maxResults": page_size,
                "fields": fields_param.split(","),
            }
            if next_page_token:
                body["nextPageToken"] = next_page_token

            resp = await http.post(
                f"{base_url}/rest/api/3/search/jql",
                json=body,
                headers=headers,
                auth=auth,
            )
            resp.raise_for_status()
            data = resp.json()
            issues = data.get("issues", [])

            for issue in issues:
                tickets.append(_convert_jira_issue(issue))

            next_page_token = data.get("nextPageToken")
            if not issues or not next_page_token:
                break

    return tickets


# ---------------------------------------------------------------------------
# Grouping helpers (unchanged)
# ---------------------------------------------------------------------------

def _phase_number(title: str) -> int:
    """Extract [Phase N] from epic title for sorting; default 999."""
    m = re.search(r"\[Phase\s+(\d+)\]", title, re.IGNORECASE)
    return int(m.group(1)) if m else 999


def _group_tickets(
    raw_tickets: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Group flat ticket list into chunked_epics:
    [{epic, stories: [{story, tasks: [...]}]}]
    sorted by epic phase number.
    """
    epics: Dict[str, Dict] = {}
    stories: Dict[str, Dict] = {}

    for t in raw_tickets:
        itype = (t.get("issue_type") or "").lower()
        tid = t.get("id", "")
        if itype == "epic":
            epics[tid] = {"epic": t, "stories": []}
        elif itype == "story":
            stories[tid] = {"story": t, "tasks": []}

    for t in raw_tickets:
        itype = (t.get("issue_type") or "").lower()
        if itype == "task":
            parent = t.get("parent_id") or t.get("story_id")
            if parent and parent in stories:
                stories[parent]["tasks"].append(t)

    for sid, s_data in stories.items():
        epic_link = s_data["story"].get("epic_link") or s_data["story"].get("parent_id")
        if epic_link and epic_link in epics:
            epics[epic_link]["stories"].append(s_data)

    return sorted(
        epics.values(),
        key=lambda e: _phase_number(e["epic"].get("title", "")),
    )


# ---------------------------------------------------------------------------
# Prompt builder (unchanged)
# ---------------------------------------------------------------------------

def build_epic_task_spec(
    epic_chunk: Dict[str, Any],
    plan_md: str,
    repo: str,
    base_branch: str,
    completed_summaries: List[str],
    implementation_ids: List[str] = None,
    feedback: str | None = None,
) -> str:
    """Build the full prompt string for an Epic implementation conversation.
    
    Args:
        epic_chunk: Epic data with stories and tasks
        plan_md: PLAN.md content
        repo: GitHub repository
        base_branch: Branch to create PR against
        completed_summaries: Summaries of previously completed epics
        implementation_ids: List of task IDs to actually implement (filters tasks)
        feedback: Feedback from previous attempt if retry
    """
    implementation_ids = implementation_ids or []
    epic = epic_chunk["epic"]
    epic_id = epic.get("id", "EPIC")
    epic_title = epic.get("title", "")
    epic_description = (epic.get("description") or "").strip()

    completed_block = ""
    if completed_summaries:
        bullets = "\n".join(f"- {s}" for s in completed_summaries)
        completed_block = f"\n## Previously Implemented (already in {base_branch})\n{bullets}\n"

    # Filter to only implementation tasks if implementation_ids provided
    stories_to_implement = []
    for s_data in epic_chunk.get("stories", []):
        story = s_data["story"]
        tasks = s_data.get("tasks", [])
        
        # If implementation_ids provided, filter tasks; otherwise include all
        if implementation_ids:
            impl_tasks = [t for t in tasks if t.get("id") in implementation_ids]
        else:
            impl_tasks = tasks
        
        # Only include story if it has tasks to implement
        if impl_tasks:
            stories_to_implement.append({
                "story": story,
                "tasks": impl_tasks
            })
    
    # Build stories block
    stories_block_parts = []
    for s_data in stories_to_implement:
        story = s_data["story"]
        sid = story.get("id", "")
        stitle = story.get("title", "")
        description = (story.get("user_story") or story.get("description", "")).strip()

        subtask_lines = []
        for t in s_data["tasks"]:
            tid = t.get("id", "")
            ttitle = t.get("title", "")
            tdesc = (t.get("description") or t.get("user_story") or "").strip()
            if tdesc:
                subtask_lines.append(f"  - [ ] [{tid}] {ttitle}\n        {tdesc}")
            else:
                subtask_lines.append(f"  - [ ] [{tid}] {ttitle}")

        subtasks_block = (
            "Subtasks (complete all before committing this story):\n" + "\n".join(subtask_lines)
            if subtask_lines else ""
        )

        stories_block_parts.append(
            f"### {sid}: {stitle}\n"
            f"{description}\n\n"
            f"{subtasks_block}\n"
            f"Commit: `git commit -m \"feat({sid}): {stitle}\"`"
        )

    stories_block = "\n\n---\n\n".join(stories_block_parts)

    epic_desc_block = f"\n{epic_description}\n" if epic_description else ""

    feedback_block = ""
    if feedback:
        feedback_block = (
            f"\n## Feedback from Previous Attempt — Must Address\n{feedback}\n"
        )
    
    # Build list of task IDs for PR title
    task_ids = [t.get("id") for s in stories_to_implement for t in s["tasks"]]
    task_ids_str = ", ".join(task_ids) if task_ids else "tasks"
    
    phase_note = ""
    if implementation_ids:
        phase_note = "\nNote: This is Phase 1 implementation. PLAN.md describes the complete feature, but you are implementing selected tasks only."

    return f"""You are a senior software engineer implementing {epic_id}: {epic_title} in {repo}.
{epic_desc_block}{phase_note}
## Step 0 — Set Git Identity (do this before any git operation)
`git config user.name "{settings.OPENHANDS_GIT_USER_NAME}" && git config user.email "{settings.OPENHANDS_GIT_USER_EMAIL}"`

## Step 1 — Read PLAN.md
Read PLAN.md from the repo root before writing any code. It defines the architecture, tech stack, and conventions — follow it strictly.
{completed_block}
## Stories to Implement (in order)

{stories_block}

## Final Steps (after all stories are committed)
1. Run the full test suite and save output:
   `mkdir -p test-results && python -m pytest tests/ -v --tb=short 2>&1 | tee test-results/report.txt || true`
   Fix ALL failures before continuing. Do NOT open a PR with failing tests.
2. Commit test results:
   `git add tests/ test-results/ && git commit -m "test({epic_id}): add test suite and results" 2>/dev/null || true`
3. Create a PR from your working branch to {base_branch}
   - Title: "{epic_id}: {epic_title} {'(Phase 1 - ' + task_ids_str + ')' if implementation_ids else ''}"
   - Body: stories implemented (Jira keys + titles), test results (X passed / Y failed), any known limitations
   - Output exactly one line: PR_URL: https://github.com/...
4. Call the finish tool with message: IMPLEMENTATION COMPLETE
{feedback_block}"""


# ---------------------------------------------------------------------------
# Node entrypoint
# ---------------------------------------------------------------------------

async def jira_node(state: GraphState) -> GraphState:
    project_id = state["project_id"]
    state_doc = state["state_doc"]
    username = state_doc.username

    print(f"🔵 [JIRA_NODE] Starting for project {project_id}")  # ← ADD THIS
    print(f"🔵 [JIRA_NODE] jira_project_key = {state_doc.jira_project_key}")  # ← ADD THIS

    # Idempotent: skip if chunked_epics already populated
    if state_doc.chunked_epics:
        return state

    sm = StateManager()
    username = state_doc.username

    # ---- Strategy 1: fetch live from Jira using the project key ----
    # This is the primary path when IRA and orchestrator are separate services.
    # IRA creates tickets on the Jira board; we read them directly from Jira.
    raw: List[Dict[str, Any]] = []
    jira_key_map: Dict[str, str] = {}

    project_key = state_doc.jira_project_key
    if project_key:
        await emit(project_id, "JIRA_FETCHING", {"project_key": project_key})
        print(f"🔵 [JIRA_NODE] Fetching from JIRA project key: {project_key}")  # ← ADD THIS
        try:
            raw = await _fetch_tickets_from_jira(project_key)
            print(f"[JIRA_NODE] Successfully fetched {len(raw)} tickets")  # ← ADD THIS
            # Ticket IDs ARE real Jira keys (e.g. KAN-42), so the map is identity.
            # _update_jira_for_epic still works without any changes.
            jira_key_map = {t["id"]: t["id"] for t in raw}
            logger.info(
                "Fetched %d tickets from Jira project %s", len(raw), project_key
            )
        except httpx.HTTPStatusError as exc:
            err = f"Jira API error fetching project {project_key}: {exc.response.status_code} {exc.response.text[:200]}"
            logger.error(err)
            state_doc.status = "FAILED"
            state_doc.last_error = err
            sm.update_state(state_doc)
            await emit(project_id, "PIPELINE_FAILED", {"error": err})
            return {"project_id": project_id, "state_doc": state_doc}
        except Exception as exc:
            err = f"Failed to connect to Jira for project {project_key}: {exc}"
            logger.error(err)
            state_doc.status = "FAILED"
            state_doc.last_error = err
            sm.update_state(state_doc)
            await emit(project_id, "PIPELINE_FAILED", {"error": err})
            return {"project_id": project_id, "state_doc": state_doc}

    # ---- Strategy 2: fall back to raw_jira_tickets in S3 state ----
    # Used when IRA is embedded in the orchestrator (Abhinav branch approach)
    # or when tickets were manually loaded into state.
    if not raw:
        raw = state_doc.raw_jira_tickets
        if not raw:
            err = (
                        "jira_node: no tickets found. "
                        "Set jira_project_key in pipeline config to fetch from Jira, "
                        "or populate raw_jira_tickets in state."
                    )
            print(f"[JIRA_NODE] {err}")
            state_doc = sm.get_state(username, project_id)
            raw = state_doc.raw_jira_tickets

    if not raw:
        err = (
            "jira_node: no tickets found. "
            "Set jira_project_key in pipeline config to fetch from Jira, "
            "or populate raw_jira_tickets in state."
        )
        state_doc.status = "FAILED"
        state_doc.last_error = err
        sm.update_state(state_doc)
        await emit(project_id, "PIPELINE_FAILED", {"error": err})
        return {"project_id": project_id, "state_doc": state_doc}

    chunked = _group_tickets(raw)
    state_doc.chunked_epics = [json.loads(json.dumps(e, default=str)) for e in chunked]
    state_doc.raw_jira_tickets = raw

    # Persist the key map so _update_jira_for_epic can transition issues after merge
    if jira_key_map:
        state_doc.jira_key_map = jira_key_map

    # Build initial epic_records (PENDING, no conversation yet)
    state_doc.epic_records = [
        EpicImplementationRecord(
            epic_index=i,
            epic_id=chunk["epic"].get("id", f"EPIC-{i+1}"),
            epic_title=chunk["epic"].get("title", f"Epic {i+1}"),
        )
        for i, chunk in enumerate(chunked)
    ]
    state_doc.status = "JIRA_FETCHED_AWAITING_SELECTION"

    sm.update_state(state_doc)

    total_stories = sum(len(c.get("stories", [])) for c in chunked)
    total_tasks = sum(
        len(s.get("tasks", []))
        for c in chunked
        for s in c.get("stories", [])
    )
    await emit(
        project_id,
        "JIRA_LOADED",
        {
            "project_key": project_key or "state",
            "epic_count": len(chunked),
            "total_stories": total_stories,
            "total_tasks": total_tasks,
        },
    )

    return {"project_id": project_id, "state_doc": state_doc}
