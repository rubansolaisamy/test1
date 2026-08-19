import asyncio
import base64
import json
import secrets

import boto3
import httpx
from botocore.exceptions import ClientError

from app.api.sse import emit
from app.core.config import settings
from app.graph.services import hitl_manager
from app.graph.services.state_manager import StateManager
from app.graph.state import GraphState, SDLCStateDocument
from app.services.openhands_client import OpenHandsClient


def _build_planning_prompt(chunked_epics: list, repo: str, branch: str, implementation_ids: list = None) -> str:
    """Build planning prompt with markers for implementation vs context tickets.
    
    Args:
        chunked_epics: List of epic chunks with stories and tasks
        repo: GitHub repository
        branch: Branch name
        implementation_ids: List of ticket IDs to actually implement (vs context only)
    """
    implementation_ids = implementation_ids or []
    
    # Format epic structure with markers
    epic_structure = _format_epics_with_markers(chunked_epics, implementation_ids)
    
    context_note = ""
    if implementation_ids:
        context_note = """
## Important Context
Some tasks are marked for IMMEDIATE IMPLEMENTATION, others are FUTURE WORK.
- Define architecture for the COMPLETE feature (all tasks shown below)
- This ensures consistency when future tasks are implemented later
- Mark sections clearly as "Phase 1" (implement now) vs "Phase 2+" (future)
"""
    
    return f"""You are a principal software architect working in the repository {repo} on branch {branch}.

Your task: create PLAN.md at the repo root and push it to GitHub.
{context_note}
## Steps (do them in order)
1. Set git identity before any commit:
   `git config user.name "{settings.OPENHANDS_GIT_USER_NAME}" && git config user.email "{settings.OPENHANDS_GIT_USER_EMAIL}"`
2. Read the existing repo structure so you understand what is already there.
3. Write PLAN.md to the repo root. It must contain:
   - Architecture overview: languages, frameworks, key design decisions
   - Exact directory/file layout all agents must follow
   - Naming conventions (files, classes, functions, API endpoint patterns)
   - Shared data contracts and API shapes that cross Epic boundaries
   - Infrastructure: required env vars, Docker services, ports
   - Testing strategy: test runner, test locations, patterns, minimum coverage
   - Epic dependency map: what each Epic builds on top of
   - Definition of done per Epic
   {'- Implementation phases: clearly mark what is Phase 1 (immediate) vs Phase 2+ (future)' if implementation_ids else ''}
4. Commit PLAN.md: `git add PLAN.md && git commit -m "docs: add PLAN.md"`
5. Push to {branch}: `git push origin {branch}`
6. Call the finish tool. Your finish message must be exactly: PLAN.md COMPLETE

## Full JIRA Structure
{epic_structure}"""


def _format_epics_with_markers(chunked_epics: list, implementation_ids: list) -> str:
    """Format epic structure with implementation markers."""
    output = []
    
    for epic_chunk in chunked_epics:
        epic = epic_chunk.get("epic", {})
        output.append(f"\n## EPIC: {epic.get('id', 'N/A')} - {epic.get('title', 'Untitled')}")
        if epic.get("description"):
            output.append(f"Description: {epic['description']}")
        
        for story_data in epic_chunk.get("stories", []):
            story = story_data.get("story", {})
            output.append(f"\n### STORY: {story.get('id', 'N/A')} - {story.get('title', 'Untitled')}")
            if story.get("user_story"):
                output.append(f"User Story: {story['user_story']}")
            
            impl_tasks = []
            future_tasks = []
            
            for task in story_data.get("tasks", []):
                task_id = task.get("id", "")
                task_line = f"- [{task_id}] {task.get('title', 'Untitled')}"
                if task.get("description"):
                    task_line += f"\n  Description: {task['description']}"
                
                if task_id in implementation_ids or not implementation_ids:
                    impl_tasks.append(task_line + " ⭐ PHASE 1 - IMPLEMENT NOW")
                else:
                    future_tasks.append(task_line + " 📅 PHASE 2+ - FUTURE WORK")
            
            if impl_tasks:
                output.append("\n**Immediate Implementation:**")
                output.extend(impl_tasks)
            
            if future_tasks:
                output.append("\n**Future Work:**")
                output.extend(future_tasks)
    
    return "\n".join(output)


async def _fetch_plan_from_github(repo: str, branch: str, github_token: str) -> str | None:
    """Fallback: fetch PLAN.md content via GitHub Contents API when WriteFileAction was missed."""
    # Normalise to owner/repo
    slug = repo.rstrip("/").split("github.com/")[-1] if "github.com" in repo else repo
    url = f"https://api.github.com/repos/{slug}/contents/PLAN.md"
    headers = {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github+json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers, params={"ref": branch})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("encoding") == "base64":
                    return base64.b64decode(data["content"]).decode("utf-8")
    except Exception:
        pass
    return None


def _s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
        verify=False
    )


async def _await_hitl(
    username: str,
    project_id: str,
    token: str,
    sm: StateManager,
    timeout_hours: int,
) -> str:
    """Wait for HITL decision. Returns 'approved' or 'rejected'.

    Checks S3 first so a server-restart-after-approval doesn't stall for the full timeout.
    """
    # Fast path: decision already written to S3 (approve/reject called before pipeline resumed)
    state_doc = sm.get_state(username, project_id)
    if state_doc.planning_hitl_decision:
        return state_doc.planning_hitl_decision

    # Normal path: wait for asyncio.Event signal from the approve/reject endpoint
    event = hitl_manager.register_hitl(token)
    try:
        await asyncio.wait_for(
            event.wait(),
            timeout=timeout_hours * 3600,
        )
    except asyncio.TimeoutError:
        pass

    state_doc = sm.get_state(username, project_id)
    return state_doc.planning_hitl_decision or "rejected"


async def _apply_planning_decision(
    project_id: str,
    state_doc: SDLCStateDocument,
    sm: StateManager,
    decision: str,
) -> None:
    if decision == "approved":
        state_doc.planning_status = "APPROVED"
        sm.update_state(state_doc)
        await emit(project_id, "PLANNING_APPROVED", {})
    else:
        state_doc.planning_status = "FAILED"
        state_doc.last_error = "Planning rejected by reviewer"
        sm.update_state(state_doc)
        await emit(project_id, "PLANNING_REJECTED", {})


async def _run_planning_hitl_gate(
    project_id: str,
    state_doc: SDLCStateDocument,
    sm: StateManager,
) -> None:
    """Issue the planning HITL gate (idempotent) and wait for a decision."""
    plan_summary = (state_doc.plan_md_content or "")[:500]
    username = state_doc.username

    if not state_doc.hitl_enabled:
        state_doc.planning_hitl_decision = "approved"
        sm.update_state(state_doc)
        await _apply_planning_decision(project_id, state_doc, sm, "approved")
        return

    # Issue a new token only if we don't already have one
    if not state_doc.planning_hitl_token:
        token = secrets.token_urlsafe(32)
        state_doc.planning_hitl_token = token
        state_doc.planning_status = "AWAITING_APPROVAL"
        sm.update_state(state_doc)

        try:
            _s3_client().put_object(
                Bucket=settings.SDLC_STATE_BUCKET,
                Key=f"users/{username}/{project_id}/hitl/{token}.json",
                Body=json.dumps({
                    "phase": "planning",
                    "project_id": project_id,
                    "plan_summary": plan_summary,
                    "conversation_url": state_doc.planning_conversation_url,
                    "status": "pending",
                }),
                ContentType="application/json",
            )
        except ClientError as exc:
            raise RuntimeError(f"Failed to write planning HITL token for {project_id}: {exc}") from exc
    else:
        token = state_doc.planning_hitl_token

    # Always emit so the SSE subscriber (including reconnected clients) sees the gate
    await emit(
        project_id,
        "PLANNING_AWAITING_APPROVAL",
        {
            "hitl_token": token,
            "plan_summary": plan_summary,
            "conversation_url": state_doc.planning_conversation_url,
        },
    )

    decision = await _await_hitl(
        username, project_id, token, sm, settings.HITL_APPROVAL_TIMEOUT_HOURS
    )
    state_doc = sm.get_state(username, project_id)
    await _apply_planning_decision(project_id, state_doc, sm, decision)


async def planning_node(state: GraphState) -> GraphState:
    project_id = state["project_id"]
    state_doc = state["state_doc"]
    sm = StateManager()
    username = state_doc.username

    # Already fully approved — nothing to do
    if state_doc.planning_status == "APPROVED":
        return state

    client = OpenHandsClient(base_url=state_doc.openhands_url)
    repo = state_doc.github_repo or ""
    branch = state_doc.github_branch or "main"

    try:
        # Resume: HITL decision already written (server restarted after /approve)
        if state_doc.planning_status == "AWAITING_APPROVAL" and state_doc.planning_hitl_decision:
            await _apply_planning_decision(
                project_id, state_doc, sm, state_doc.planning_hitl_decision
            )
            return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}

        # Resume: still waiting for HITL decision (re-register listener and wait)
        if state_doc.planning_status == "AWAITING_APPROVAL":
            await _run_planning_hitl_gate(project_id, state_doc, sm)
            return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}

        # Resume: conversation completed but HITL gate not yet opened (server restarted mid-transition)
        
#         # ========================================================
#         # 🟡 TEMPORARY MOCK FOR AWS BEDROCK
#         # ========================================================
#         import asyncio
#         print("🟡 MOCKING PLANNING NODE: Bypassing OpenHands...")
        
#         # 1. Pretend we started OpenHands
#         state_doc.planning_status = "IN_PROGRESS"
#         state_doc.planning_conversation_url = f"{state_doc.openhands_url}/conversations/mock-123"
#         sm.update_state(state_doc)
#         await emit(project_id, "PLANNING_STARTED", {"conversation_url": state_doc.planning_conversation_url})
        
#         # 2. Wait 3 seconds to simulate the AI "thinking"
#         await asyncio.sleep(3)
        
#         # 3. Inject a fake PLAN.md
#         state_doc.plan_md_content = """# Mock Architecture Plan
# ## Overview
# This is a mocked plan to bypass AWS Bedrock.
# - **Frontend**: React
# - **Backend**: FastAPI
# - **Database**: PostgreSQL

# ## Testing
# - Pytest with 80% coverage.
# """
#         state_doc.planning_status = "COMPLETED"
#         sm.update_state(state_doc)

#         # 4. Trigger the frontend UI gate!
#         plan_summary = state_doc.plan_md_content[:500]
#         await emit(
#             project_id,
#             "PLANNING_COMPLETED",
#             {
#                 "plan_summary": plan_summary,
#                 "conversation_url": state_doc.planning_conversation_url,
#             },
#         )
        
#         await _run_planning_hitl_gate(project_id, state_doc, sm)
#         return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}
    
#     #=========================================================

        if state_doc.planning_status in ("IN_PROGRESS", "COMPLETED"):
            plan_summary = (state_doc.plan_md_content or "")[:500]
            await emit(
                project_id,
                "PLANNING_COMPLETED",
                {
                    "plan_summary": plan_summary,
                    "conversation_url": state_doc.planning_conversation_url or "",
                },
            )
            await _run_planning_hitl_gate(project_id, state_doc, sm)
            return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}

        # Fresh run — launch OpenHands conversation
        cs = state_doc.codegen_settings
        await client.configure(
            github_token=state_doc.github_token,
            llm_model=cs.llm_model,
            git_user_name=cs.git_user_name,
            git_user_email=cs.git_user_email,
        )

        prompt = _build_planning_prompt(state_doc.chunked_epics, repo, branch, state_doc.implementation_ticket_ids)
        task_id = await client.start_conversation(prompt, repo, branch)
        state_doc.planning_status = "IN_PROGRESS"
        state_doc.status = "PLANNING"
        sm.update_state(state_doc)

        ready = await client.wait_for_ready(task_id)
        conversation_id = ready["app_conversation_id"]
        state_doc.planning_conversation_id = conversation_id
        state_doc.planning_conversation_url = (
            f"{state_doc.openhands_url}/conversations/{conversation_id}"
        )
        sm.update_state(state_doc)

        await emit(
            project_id,
            "PLANNING_STARTED",
            {"conversation_url": state_doc.planning_conversation_url},
        )

        plan_content: list[str] = []

        async for event in client.stream_events(
            conversation_id,
            timeout=settings.OPENHANDS_CONVERSATION_TIMEOUT_SECONDS,
        ):
            if event is None:
                await emit(project_id, "PLANNING_IN_PROGRESS", {"latest_message": ""})
                continue

            kind = event.get("kind", "")

            if kind == "ActionEvent":
                action = event.get("action") or {}
                action_kind = action.get("kind", "")
                if action_kind == "WriteFileAction":
                    if "PLAN.md" in action.get("file_path", ""):
                        plan_content.append(action.get("content", ""))
                elif action_kind == "FileEditorAction":
                    if "PLAN.md" in action.get("path", "") and action.get("command") in ("write", "create"):
                        plan_content.append(action.get("file_text", ""))
                elif action_kind == "FinishAction":
                    break

            if kind == "MessageEvent" and event.get("source") == "agent":
                llm_msg = event.get("llm_message") or {}
                content_list = llm_msg.get("content", [])
                msg = " ".join(
                    c.get("text", "") for c in content_list
                    if isinstance(c, dict) and c.get("type") == "text"
                )
                if msg:
                    await emit(project_id, "PLANNING_IN_PROGRESS", {"latest_message": msg[:500]})
                    if "PLAN.md COMPLETE" in msg:
                        break

            if kind == "ConversationStateUpdateEvent":
                if event.get("key") == "status" and event.get("value") in ("STOPPED", "ERROR"):
                    break

        state_doc.plan_md_content = "\n".join(plan_content) if plan_content else None

        # WriteFileAction may be missed if agent writes via shell — fetch from GitHub as fallback
        if not state_doc.plan_md_content and state_doc.github_token:
            state_doc.plan_md_content = await _fetch_plan_from_github(
                repo, branch, state_doc.github_token
            )

        state_doc.planning_status = "COMPLETED"
        sm.update_state(state_doc)

        plan_summary = (state_doc.plan_md_content or "")[:500]
        await emit(
            project_id,
            "PLANNING_COMPLETED",
            {
                "plan_summary": plan_summary,
                "conversation_url": state_doc.planning_conversation_url,
            },
        )

        await _run_planning_hitl_gate(project_id, state_doc, sm)

    except Exception as exc:
        state_doc.planning_status = "FAILED"
        state_doc.last_error = str(exc)
        sm.update_state(state_doc)
        await emit(project_id, "PIPELINE_FAILED", {"error": str(exc)})
    finally:
        await client.close()

    return {"project_id": project_id, "state_doc": sm.get_state(username, project_id)}
