import asyncio
import json
from typing import Dict, Set

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

router = APIRouter()

_subscribers: Dict[str, Set[asyncio.Queue]] = {}

TERMINAL_EVENTS = {"PIPELINE_COMPLETED", "PIPELINE_FAILED"}

async def emit(project_id: str, event_type: str, data: dict) -> None:
    """Push an SSE event to all active subscribers for this project."""
    queues = _subscribers.get(project_id, set())
    payload = json.dumps({"type": event_type, **data})
    for q in list(queues):
        await q.put({"event": event_type, "data": payload})


# <-- UPDATED: Added username parameter
def _catchup_event(username: str, project_id: str) -> dict | None:
    """Read current S3 state and return a synthetic catch-up SSE payload."""
    try:
        from app.graph.services.state_manager import StateManager
        # <-- UPDATED: Pass username
        state = StateManager().get_state(username, project_id)
        if state.status == "INITIALIZED":
            return None
        payload = {
            "type": "PIPELINE_STATE_CATCHUP",
            "pipeline_status": state.status,
            "planning_status": state.planning_status,
            "planning_hitl_token": state.planning_hitl_token,
            "plan_summary": (state.plan_md_content or "")[:500],
            "epic_records": [r.model_dump() for r in state.epic_records],
            "last_error": state.last_error,
        }
        return {"data": json.dumps(payload)}
    except Exception:
        return None

@router.get("/pipeline/status/{project_id}")
async def pipeline_status(project_id: str, username: str):
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(project_id, set()).add(queue)

    catchup = _catchup_event(username, project_id)
    if catchup:
        await queue.put(catchup)

    async def generator():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30)
                    yield msg
                    payload = json.loads(msg.get("data", "{}"))
                    if payload.get("type") in TERMINAL_EVENTS:
                        break
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            subs = _subscribers.get(project_id, set())
            subs.discard(queue)
            if not subs:
                _subscribers.pop(project_id, None)

    return EventSourceResponse(generator())