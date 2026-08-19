import asyncio
from typing import Set

# Track active pipelines using a combined key: "username:project_id"
_running_pipelines: Set[str] = set()

async def run_pipeline_tracked(username: str, project_id: str) -> None:
    from app.graph.workflow import run_pipeline
    try:
        # Pass BOTH to workflow.py!
        await run_pipeline(username, project_id) 
    finally:
        _running_pipelines.discard(f"{username}:{project_id}")

def launch_pipeline(username: str, project_id: str) -> bool:
    """Schedule the pipeline as an asyncio task. Returns False if already running."""
    task_key = f"{username}:{project_id}"
    
    if task_key in _running_pipelines:
        return False
        
    _running_pipelines.add(task_key)
    asyncio.create_task(run_pipeline_tracked(username, project_id))
    return True