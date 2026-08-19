import asyncio
import json
from typing import Any, Dict, Optional, List

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from app.api.sse import emit
from app.api import user_config_routes
from app.core.config import settings
from app.graph.services import hitl_manager, task_callback_manager
from app.graph.services.pipeline_runner import launch_pipeline
from app.graph.services.state_manager import StateManager
from app.graph.state import CodegenSettings, EpicImplementationRecord
from app.graph.nodes.jira_node import _group_tickets

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter()


def _s3():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
        verify=False
    )

def _load_hitl_token(username: str, project_id: str, token: str) -> dict:
    try:
        resp = _s3().get_object(
            Bucket=settings.SDLC_STATE_BUCKET,
            Key=f"users/{username}/{project_id}/hitl/{token}.json",
        )
        return json.loads(resp["Body"].read())
    except Exception:
        raise HTTPException(status_code=404, detail="HITL token not found")

def _save_hitl_token(username: str, project_id: str, token: str, payload: dict) -> None:
    try:
        _s3().put_object(
            Bucket=settings.SDLC_STATE_BUCKET,
            Key=f"users/{username}/{project_id}/hitl/{token}.json",
            Body=json.dumps(payload),
            ContentType="application/json",
        )
    except ClientError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save HITL token: {exc}") from exc


# ---------------------------------------------------------------------------
# Pipeline configuration
# ---------------------------------------------------------------------------

class CodegenSettingsRequest(BaseModel):
    llm_model: Optional[str] = None
    git_user_name: Optional[str] = None
    git_user_email: Optional[str] = None
    browser_allowed_domains: Optional[str] = None
    conversation_timeout_minutes: Optional[int] = None
    max_epic_retries: Optional[int] = None
    max_ci_fix_attempts: Optional[int] = None
    ci_check_timeout_minutes: Optional[int] = None

class PipelineConfigRequest(BaseModel):
    github_repo: str
    github_branch: str = "main"
    github_token: str
    hitl_enabled: bool = True
    openhands_url: Optional[str] = None
    jira_project_key: Optional[str] = None   # e.g. "KAN"
    codegen_settings: Optional[CodegenSettingsRequest] = None

class SelectTicketsRequest(BaseModel):
    username: str
    project_id: str
    selected_ticket_ids: List[str]           # All tickets (includes parents for context)
    implementation_ticket_ids: Optional[List[str]] = None  # Only tasks to implement (optional for backwards compatibility)


@router.post("/pipeline/configure/{project_id}", tags=["Orchestration"])
async def configure_pipeline(project_id: str, username: str, body: PipelineConfigRequest):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    state_doc.github_repo = body.github_repo
    state_doc.github_branch = body.github_branch
    state_doc.github_token = body.github_token
    state_doc.hitl_enabled = body.hitl_enabled
    if body.openhands_url:
        state_doc.openhands_url = body.openhands_url
    if body.jira_project_key is not None:
        state_doc.jira_project_key = body.jira_project_key
    if body.codegen_settings:
        cs = body.codegen_settings
        current = state_doc.codegen_settings
        if cs.llm_model is not None: current.llm_model = cs.llm_model
        if cs.git_user_name is not None: current.git_user_name = cs.git_user_name
        if cs.git_user_email is not None: current.git_user_email = cs.git_user_email
        if cs.browser_allowed_domains is not None: current.browser_allowed_domains = cs.browser_allowed_domains
        if cs.conversation_timeout_minutes is not None: current.conversation_timeout_minutes = cs.conversation_timeout_minutes
        if cs.max_epic_retries is not None: current.max_epic_retries = cs.max_epic_retries
        if cs.max_ci_fix_attempts is not None: current.max_ci_fix_attempts = cs.max_ci_fix_attempts
        if cs.ci_check_timeout_minutes is not None: current.ci_check_timeout_minutes = cs.ci_check_timeout_minutes
        state_doc.codegen_settings = current
    sm.update_state(state_doc)

    await emit(project_id, "PIPELINE_CONFIGURED", {"github_repo": body.github_repo, "hitl_enabled": body.hitl_enabled})
    return {"message": "Pipeline configured", "project_id": project_id}


@router.get("/pipeline/configure/{project_id}", tags=["Orchestration"])
async def get_pipeline_config(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    return {
        "github_repo": state_doc.github_repo,
        "github_branch": state_doc.github_branch,
        "github_token": "***" if state_doc.github_token else None,
        "hitl_enabled": state_doc.hitl_enabled,
        "openhands_url": state_doc.openhands_url,
        "jira_project_key": state_doc.jira_project_key,
        "codegen_settings": state_doc.codegen_settings.model_dump(),
    }


class EnvVarsRequest(BaseModel):
    env_vars: Dict[str, str]

@router.post("/pipeline/env-vars/{project_id}", tags=["Orchestration"])
async def submit_env_vars(project_id: str, username: str, body: EnvVarsRequest):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    state_doc.project_env_vars.update(body.env_vars)
    sm.update_state(state_doc)
    return {"status": "ok", "stored": list(body.env_vars.keys())}


@router.post("/pipeline/task-callback/{project_id}/{epic_index}", tags=["Orchestration"])
async def task_callback(project_id: str, epic_index: int, body: Dict[str, Any] = Body(...)):
    token = f"{project_id}/{epic_index}"
    task_callback_manager.resolve(token, body)
    return {"ok": True}


@router.get("/pipeline/state/{project_id}", tags=["Orchestration"])
async def get_pipeline_state(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username
    data = state_doc.model_dump()
    if data.get("github_token"): data["github_token"] = "***"
    data["pipeline_status"] = data.get("status")
    return data


# ---------------------------------------------------------------------------
# HITL endpoints
# ---------------------------------------------------------------------------

@router.get("/pipeline/hitl/{project_id}/{token}", tags=["Orchestration"])
async def get_hitl_details(project_id: str, token: str, username: str):
    payload = _load_hitl_token(username, project_id, token) 
    return payload


class RejectRequest(BaseModel):
    feedback: Optional[str] = None


@router.post("/pipeline/hitl/{project_id}/{token}/approve", tags=["Orchestration"])
async def approve_hitl(project_id: str, token: str, username: str):
    payload = _load_hitl_token(username, project_id, token) # <-- Added username
    if payload.get("status") == "rejected":
        raise HTTPException(status_code=409, detail="Token already rejected")

    payload["status"] = "approved"
    _save_hitl_token(username, project_id, token, payload) # <-- Added username

    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username

    phase = payload.get("phase")
    if phase == "planning":
        state_doc.planning_hitl_decision = "approved"
        state_doc.planning_status = "APPROVED"  # write directly — don't rely on async task wakeup
        sm.update_state(state_doc)
        hitl_manager.resolve_hitl(token)
        await emit(project_id, "PLANNING_APPROVED", {})
    else:
        epic_index = payload.get("epic_index")
        if epic_index is not None and epic_index < len(state_doc.epic_records):
            record = state_doc.epic_records[epic_index]
            record.hitl_decision = "approved"
            sm.update_state(state_doc)
        hitl_manager.resolve_hitl(token)
        await emit(project_id, "EPIC_APPROVED", {"epic_id": payload.get("epic_id", "")})

    launch_pipeline(username, project_id)
    return {"message": "Approved"}


@router.post("/pipeline/hitl/{project_id}/{token}/reject", tags=["Orchestration"])
async def reject_hitl(project_id: str, token: str, username: str, body: RejectRequest = RejectRequest()):
    payload = _load_hitl_token(username, project_id, token) # <-- Added username
    if payload.get("status") == "approved":
        raise HTTPException(status_code=409, detail="Token already approved")

    payload["status"] = "rejected"
    _save_hitl_token(username, project_id, token, payload)

    sm = StateManager()
    state_doc = sm.get_state(username, project_id)

    phase = payload.get("phase")
    if phase == "planning":
        state_doc.planning_hitl_decision = "rejected"
        sm.update_state(state_doc)
        hitl_manager.resolve_hitl(token)
        await emit(project_id, "PLANNING_REJECTED", {})
    else:
        epic_index = payload.get("epic_index")
        if epic_index is not None and epic_index < len(state_doc.epic_records):
            record = state_doc.epic_records[epic_index]
            record.hitl_decision = "rejected"
            if body.feedback: record.hitl_feedback = body.feedback
            sm.update_state(state_doc)
        hitl_manager.resolve_hitl(token)
        await emit(project_id, "EPIC_REJECTED", {"epic_id": payload.get("epic_id", "")})

    launch_pipeline(username, project_id)
    return {"message": "Rejected"}


class DeployRequest(BaseModel):
    env_vars: Optional[Dict[str, str]] = None

@router.post("/pipeline/deploy/{project_id}", tags=["Orchestration"])
async def deploy_pipeline(project_id: str, username: str, body: DeployRequest = DeployRequest()):
    from app.graph.nodes.delivery_node import delivery_node
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username

    if body.env_vars:
        state_doc.project_env_vars = {**(state_doc.project_env_vars or {}), **body.env_vars}

    state_doc.delivery_status = "BUILDING"
    sm.update_state(state_doc)

    state = {"project_id": project_id, "state_doc": state_doc}
    asyncio.create_task(delivery_node(state))
    return {"status": "started"}

# Docker commands omitted for brevity (kept them exactly the same)
async def _docker_run(cmd: str) -> tuple:
    proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, _ = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace")

async def _stop_compose_containers(container_id: str) -> None:
    rc, project_name = await _docker_run(f'docker inspect {container_id} --format "{{{{index .Config.Labels \\"com.docker.compose.project\\"}}}}"')
    project_name = project_name.strip()
    if rc == 0 and project_name:
        rc2, ids_out = await _docker_run(f'docker ps -q --filter "label=com.docker.compose.project={project_name}"')
        if rc2 == 0 and ids_out.strip(): await _docker_run(f"docker stop {' '.join(ids_out.strip().splitlines())}")
    else: await _docker_run(f"docker stop {container_id}")

async def _remove_compose_containers(container_id: str) -> None:
    rc, project_name = await _docker_run(f'docker inspect {container_id} --format "{{{{index .Config.Labels \\"com.docker.compose.project\\"}}}}"')
    project_name = project_name.strip()
    if rc == 0 and project_name:
        rc2, ids_out = await _docker_run(f'docker ps -aq --filter "label=com.docker.compose.project={project_name}"')
        if rc2 == 0 and ids_out.strip():
            ids = " ".join(ids_out.strip().splitlines())
            await _docker_run(f"docker stop {ids}")
            await _docker_run(f"docker rm {ids}")
    else:
        await _docker_run(f"docker stop {container_id}")
        await _docker_run(f"docker rm {container_id}")


@router.post("/pipeline/stop-delivery/{project_id}", tags=["Orchestration"])
async def stop_delivery(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username
    container_id = state_doc.delivery_container_id
    if not container_id: raise HTTPException(status_code=404, detail="No running delivery container")
    await _stop_compose_containers(container_id)
    state_doc.delivery_status = "STOPPED"
    sm.update_state(state_doc)
    await emit(project_id, "DELIVERY_STOPPED", {"message": "App stopped"})
    return {"status": "stopped"}


@router.post("/pipeline/remove-delivery/{project_id}", tags=["Orchestration"])
async def remove_delivery(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username
    container_id = state_doc.delivery_container_id
    if not container_id: raise HTTPException(status_code=404, detail="No delivery container to remove")
    await _remove_compose_containers(container_id)
    state_doc.delivery_status = None
    state_doc.delivery_container_id = None
    state_doc.delivery_url = None
    sm.update_state(state_doc)
    await emit(project_id, "DELIVERY_REMOVED", {"message": "Containers removed"})
    return {"status": "removed"}


@router.post("/pipeline/resume/{project_id}", tags=["Orchestration"])
async def resume_pipeline(project_id: str, username: str):
    """Re-launch the pipeline task (e.g. after a server restart following plan approval)."""
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    if not state_doc.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    launched = launch_pipeline(username, project_id)
    return {"message": "Pipeline resumed" if launched else "Pipeline already running", "project_id": project_id}


@router.post("/pipeline/{project_id}/cancel", tags=["Orchestration"])
async def cancel_pipeline(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username
    state_doc.status = "CANCELLED"
    sm.update_state(state_doc)
    await emit(project_id, "PIPELINE_FAILED", {"error": "Cancelled by user"})
    return {"message": "Pipeline cancelled"}


@router.post("/pipeline/{project_id}/reset", tags=["Orchestration"])
async def reset_pipeline(project_id: str, username: str):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username

    state_doc.status = "INITIALIZED"
    state_doc.last_error = None
    state_doc.planning_status = None
    state_doc.planning_hitl_token = None
    state_doc.planning_hitl_decision = None
    state_doc.plan_md_content = None
    state_doc.planning_conversation_id = None
    state_doc.planning_conversation_url = None
    state_doc.delivery_status = None
    state_doc.delivery_url = None
    state_doc.delivery_container_id = None

    for record in state_doc.epic_records:
        record.status = "PENDING"
        record.conversation_id = None
        record.conversation_url = None
        record.start_task_id = None
        record.pr_url = None
        record.branch_name = None
        record.implementation_summary = None
        record.tests_passed = None
        record.tests_failed = None
        record.test_output = None
        record.hitl_token = None
        record.hitl_decision = None
        record.hitl_feedback = None
        record.ci_status = None
        record.ci_fix_attempts = 0
        record.ci_failure_summary = None
        record.merged_sha = None
        record.merge_error = None
        record.started_at = None
        record.completed_at = None
        record.error_message = None
        record.retry_count = 0

    sm.update_state(state_doc)
    await emit(project_id, "PIPELINE_RESET", {"project_id": project_id})
    return {"message": "Pipeline reset to INITIALIZED", "project_id": project_id}


@router.post("/pipeline/gate", tags=["Orchestration"])
async def process_gate(
    username: str = Body(...),
    project_id: str = Body(...),
    action: str = Body(...),
    feedback: str = Body("Approved via UI")
):
    sm = StateManager()
    state_doc = sm.get_state(username, project_id) # <-- Added username
    
    if not state_doc.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if action == "approve":
        if state_doc.status == "READY_FOR_REVIEW":
            state_doc.status = "APPROVAL_RECEIVED_DEPLOYING"
        await emit(project_id, "GATE_APPROVED", {"project_id": project_id, "feedback": feedback})
    elif action == "reject":
        state_doc.status = "REJECTED"
        await emit(project_id, "GATE_REJECTED", {"project_id": project_id, "feedback": feedback})
    else:
        raise HTTPException(status_code=400, detail=f"Invalid action: {action}")
    
    sm.update_state(state_doc)
    return {"status": "success", "action": action, "project_id": project_id}


@router.post("/pipeline/select-tickets", tags=["Orchestration"])
async def select_tickets(body: SelectTicketsRequest):
    username = body.username
    project_id = body.project_id
    selected_ticket_ids = body.selected_ticket_ids
    implementation_ticket_ids = body.implementation_ticket_ids or selected_ticket_ids  # Default to all selected for backwards compatibility
    
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    print(state_doc, "---")

    if not state_doc.project_title:
        raise HTTPException(status_code=404, detail="Project not found")

    if state_doc.status not in ["INITIALIZED","JIRA_FETCHED_AWAITING_SELECTION", "JIRA_ANALYZED"]:
        raise HTTPException(status_code=400, detail=f"Cannot select tickets at this stage. Current status: {state_doc.status}")

    state_doc.selected_ticket_ids = selected_ticket_ids
    state_doc.implementation_ticket_ids = implementation_ticket_ids
    
    # Filter to keep all selected tickets (includes context)
    state_doc.raw_jira_tickets = [
        t for t in state_doc.raw_jira_tickets
        if t.get("id") in selected_ticket_ids or t.get("key") in selected_ticket_ids
    ]
    
    # Mark which tickets are for implementation
    for ticket in state_doc.raw_jira_tickets:
        ticket_id = ticket.get("id") or ticket.get("key")
        ticket["_for_implementation"] = ticket_id in implementation_ticket_ids

    chunked = _group_tickets(state_doc.raw_jira_tickets)
    state_doc.chunked_epics = [json.loads(json.dumps(e, default=str)) for e in chunked]

    state_doc.epic_records = [
        EpicImplementationRecord(epic_index=i, epic_id=chunk["epic"].get("id", f"EPIC-{i+1}"), epic_title=chunk["epic"].get("title", f"Epic {i+1}"))
        for i, chunk in enumerate(chunked)
    ]

    state_doc.status = "JIRA_ANALYZED"
    sm.update_state(state_doc)

    try:
        hitl_manager.resolve_hitl(f"ticket_selection_{project_id}")
    except Exception as e:
        # Ignore if it wasn't waiting, which is expected with the frontend flow.
        pass

    return {"message": "Tickets selected successfully", "total_epics": len(chunked)}


@router.get("/pipeline/{project_id}/tickets", tags=["Orchestration"])
async def get_tickets_for_selection(project_id: str, username: str):
    from app.graph.nodes.jira_node import _fetch_tickets_from_jira
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)

    if not state_doc.project_title:
        raise HTTPException(status_code=404, detail="Project not found")

    # Auto-fetch from Jira if we have a project key but no tickets in state yet
    if not state_doc.raw_jira_tickets and state_doc.jira_project_key:
        try:
            raw = await _fetch_tickets_from_jira(state_doc.jira_project_key)
            state_doc.raw_jira_tickets = raw
            sm.update_state(state_doc)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch tickets from Jira: {exc}")

    tickets = []
    for ticket in state_doc.raw_jira_tickets:
        tickets.append({
            "id": ticket.get("id"),
            "key": ticket.get("id"),
            "summary": ticket.get("title", ""),
            "type": ticket.get("issue_type", "task"),
            "description": (ticket.get("description") or ticket.get("user_story") or "")[:200],
            "status": ticket.get("status", ""),
            "priority": ticket.get("priority", ""),
            "story_points": ticket.get("story_points"),  # Add story points
            "epic_link": ticket.get("epic_link"),
            "parent_id": ticket.get("parent_id"),
        })

    return {
        "project_id": project_id,
        "status": state_doc.status,
        "total_tickets": len(tickets),
        "tickets": tickets,
        "selected_ticket_ids": state_doc.selected_ticket_ids
    }


@router.get("/pipeline/analyzer", tags=["Orchestration"])
async def list_analyzer_projects(username: str):
    sm = StateManager()
    projects = sm.list_analyzer_projects(username)
    return {"projects": projects}
