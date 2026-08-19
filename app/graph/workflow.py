# LangGraph removed: direct async chain (health_check → jira_node → planning_node → orchestrator_node → delivery_node).
# HITL is handled by asyncio.Event in hitl_manager, not graph interrupts.
from app.api.sse import emit
from app.graph.nodes.delivery_node import delivery_node
from app.graph.nodes.jira_node import jira_node
from app.graph.nodes.orchestrator import orchestrator_node
from app.graph.nodes.planning_node import planning_node
from app.graph.services.state_manager import StateManager
from app.services.openhands_client import OpenHandsClient, OpenHandsError
from app.graph.services import hitl_manager

async def run_pipeline(username: str, project_id: str) -> None:
    sm = StateManager()
    state_doc = sm.get_state(username, project_id)
    state = {"project_id": project_id, "state_doc": state_doc}
    print(state_doc, "initiating pipeline with state_doc")

    # Fail fast if OpenHands is not reachable before touching any epic work
    client = OpenHandsClient(base_url=state_doc.openhands_url)
    try:
        await client.health_check()
    except OpenHandsError as exc:
        state_doc.status = "FAILED"
        state_doc.last_error = str(exc)
        sm.update_state(state_doc)
        await emit(project_id, "PIPELINE_FAILED", {"error": str(exc)})
        return
    finally:
        await client.close()

    state = await jira_node(state)
    print(state["state_doc"], "state_doc after jira_node")
    if state["state_doc"].status == "FAILED":
        return

    state_doc = sm.get_state(username, project_id)
    if not state_doc.chunked_epics:
        # Tickets not selected yet — wait for /pipeline/select-tickets
        selection_token = f"ticket_selection_{project_id}"
        event = hitl_manager.register_hitl(selection_token)
        await event.wait()
        state["state_doc"] = sm.get_state(username, project_id)
    
    state = await planning_node(state)
    print(state["state_doc"], "state_doc after planning_node")
    if state["state_doc"].planning_status != "APPROVED":
        return

    state = await orchestrator_node(state)
    print(state["state_doc"], "state_doc after orchestrator_node")
    if state["state_doc"].status != "FAILED":
        await delivery_node(state)