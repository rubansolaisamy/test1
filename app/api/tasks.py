# app/api/tasks.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from enum import Enum

from app.graph.services.state_manager import StateManager

router = APIRouter()
state_manager = StateManager()


# Enums for task properties
class TaskStatus(str, Enum):
    """Task status for Kanban board"""
    BACKLOG = "backlog"
    IN_PROGRESS = "in-progress"
    REVIEW = "review"
    COMPLETED = "completed"


class TaskPriority(str, Enum):
    """Task priority levels"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Request/Response Schemas
class TaskResponse(BaseModel):
    """Response schema for task details"""
    id: str
    title: str
    description: Optional[str] = None
    status: TaskStatus
    priority: TaskPriority
    phase: str
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    project: str
    epic_id: Optional[str] = None
    story_id: Optional[str] = None
    # Additional Jira fields
    jira_key: Optional[str] = None
    jira_url: Optional[str] = None
    status_color: str = "#3b82f6"  # Default blue


class UpdateTaskStatusRequest(BaseModel):
    """
    Request schema for updating task status.
    Junior dev: Implement Jira API call here to update the task in Jira board.
    """
    status: TaskStatus
    assignee: Optional[str] = None
    comment: Optional[str] = None  # Add comment to Jira ticket


class UpdateTaskRequest(BaseModel):
    """
    Full update request for task.
    Junior dev: Implement Jira API calls to update these fields.
    """
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None


# Helper Functions

def _map_jira_status(jira_status: str) -> TaskStatus:
    """
    Map Jira status to our TaskStatus enum.
    Customize this based on your Jira workflow.
    """
    status_lower = jira_status.lower()
    
    # Common Jira statuses mapped to our Kanban board
    if status_lower in ["to do", "open", "backlog"]:
        return TaskStatus.BACKLOG
    elif status_lower in ["in progress", "in development", "doing"]:
        return TaskStatus.IN_PROGRESS
    elif status_lower in ["in review", "code review", "review"]:
        return TaskStatus.REVIEW
    elif status_lower in ["done", "completed", "closed", "resolved"]:
        return TaskStatus.COMPLETED
    else:
        return TaskStatus.BACKLOG  # Default


def _map_jira_priority(jira_priority: str) -> TaskPriority:
    """Map Jira priority to our TaskPriority enum"""
    priority_lower = jira_priority.lower()
    
    if priority_lower in ["highest", "critical", "blocker"]:
        return TaskPriority.CRITICAL
    elif priority_lower in ["high"]:
        return TaskPriority.HIGH
    elif priority_lower in ["medium"]:
        return TaskPriority.MEDIUM
    elif priority_lower in ["low", "lowest"]:
        return TaskPriority.LOW
    else:
        return TaskPriority.MEDIUM


def _infer_phase_from_epic(epic: Dict[str, Any]) -> str:
    """Infer SDLC phase from epic title or labels"""
    title = epic.get("title", "").lower()
    
    # Check for phase markers in title like [Phase 1]
    if "phase 1" in title or "requirements" in title:
        return "Requirements Analysis"
    elif "phase 2" in title or "planning" in title:
        return "Planning"
    elif "phase 3" in title or "design" in title:
        return "Design"
    elif "phase 4" in title or "development" in title or "implementation" in title:
        return "Development"
    elif "phase 5" in title or "testing" in title or "qa" in title:
        return "Testing"
    elif "phase 6" in title or "deployment" in title or "release" in title:
        return "Deployment"
    else:
        return "Development"  # Default


def _get_status_color(status: TaskStatus) -> str:
    """Get color code for task status"""
    color_map = {
        TaskStatus.BACKLOG: "#eab308",      # Yellow
        TaskStatus.IN_PROGRESS: "#ef4444",  # Red (active)
        TaskStatus.REVIEW: "#f97316",        # Orange
        TaskStatus.COMPLETED: "#10b981"      # Green
    }
    return color_map.get(status, "#3b82f6")


# API Endpoints

@router.get("/projects/{project_id}/tasks", response_model=List[TaskResponse])
async def get_tasks(project_id: str, username: str, refresh: bool = False):
    """
    Get all tasks for a project.
    
    Args:
        project_id: Project ID
        username: Username
        refresh: If True, re-fetch from Jira (TODO: implement Jira fetch)
    
    Returns:
        List of tasks mapped from raw_jira_tickets and chunked_epics
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: If refresh=True, call Jira API to fetch latest tickets
    # and update state.raw_jira_tickets
    
    tasks = []
    
    # Map tasks from chunked_epics (grouped structure)
    for epic_chunk in state.chunked_epics:
        epic = epic_chunk.get("epic", {})
        epic_id = epic.get("id", "")
        phase = _infer_phase_from_epic(epic)
        
        for story_data in epic_chunk.get("stories", []):
            story = story_data.get("story", {})
            story_id = story.get("id", "")
            
            for task in story_data.get("tasks", []):
                task_id = task.get("id", "")
                jira_status = task.get("status", "backlog")
                jira_priority = task.get("priority", "medium")
                
                mapped_status = _map_jira_status(jira_status)
                
                tasks.append(TaskResponse(
                    id=task_id,
                    title=task.get("title", "Untitled Task"),
                    description=task.get("description"),
                    status=mapped_status,
                    priority=_map_jira_priority(jira_priority),
                    phase=phase,
                    assignee=task.get("assignee"),
                    due_date=task.get("due_date"),
                    project=state.project_title or project_id,
                    epic_id=epic_id,
                    story_id=story_id,
                    jira_key=task.get("key"),
                    jira_url=task.get("url"),
                    status_color=_get_status_color(mapped_status)
                ))
    
    return tasks


@router.get("/projects/{project_id}/tasks/{task_id}", response_model=TaskResponse)
async def get_task(project_id: str, task_id: str, username: str):
    """
    Get a single task by ID.
    Searches through chunked_epics to find the task.
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Search for task in chunked_epics
    for epic_chunk in state.chunked_epics:
        epic = epic_chunk.get("epic", {})
        phase = _infer_phase_from_epic(epic)
        
        for story_data in epic_chunk.get("stories", []):
            story = story_data.get("story", {})
            
            for task in story_data.get("tasks", []):
                if task.get("id") == task_id:
                    jira_status = task.get("status", "backlog")
                    mapped_status = _map_jira_status(jira_status)
                    
                    return TaskResponse(
                        id=task.get("id", ""),
                        title=task.get("title", "Untitled Task"),
                        description=task.get("description"),
                        status=mapped_status,
                        priority=_map_jira_priority(task.get("priority", "medium")),
                        phase=phase,
                        assignee=task.get("assignee"),
                        due_date=task.get("due_date"),
                        project=state.project_title or project_id,
                        epic_id=epic.get("id"),
                        story_id=story.get("id"),
                        jira_key=task.get("key"),
                        jira_url=task.get("url"),
                        status_color=_get_status_color(mapped_status)
                    )
    
    raise HTTPException(status_code=404, detail=f"Task {task_id} not found")


@router.put("/projects/{project_id}/tasks/{task_id}/status")
async def update_task_status(
    project_id: str,
    task_id: str,
    username: str,
    request: UpdateTaskStatusRequest
):
    """
    Update task status (for Kanban drag-and-drop).
    
    TODO:
    1. Implement Jira API call to update task status in Jira board
    2. Map our TaskStatus enum to Jira workflow states
    3. Handle Jira API errors gracefully
    4. Optionally add comment to Jira if request.comment is provided
    5. Update the task in state.raw_jira_tickets and chunked_epics
    6. Call state_manager.update_state(state) to persist changes
    
    Example Jira API call:
        jira_client.update_issue(
            issue_key=task.jira_key,
            fields={
                "status": {"name": jira_status_name},
                "assignee": {"name": request.assignee} if request.assignee else None
            }
        )
        
        if request.comment:
            jira_client.add_comment(task.jira_key, request.comment)
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: Implement Jira update logic here
    # For now, return a placeholder response
    
    return {
        "message": "Task status update not yet implemented",
        "task_id": task_id,
        "new_status": request.status,
        "note": "Junior dev: Implement Jira API call to update task status"
    }


@router.put("/projects/{project_id}/tasks/{task_id}")
async def update_task(
    project_id: str,
    task_id: str,
    username: str,
    request: UpdateTaskRequest
):
    """
    Update task details (full update).
    
    TODO :
    1. Implement Jira API call to update task fields
    2. Update the task in state.raw_jira_tickets and chunked_epics
    3. Call state_manager.update_state(state) to persist changes
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: Implement Jira update logic here
    
    return {
        "message": "Task update not yet implemented",
        "task_id": task_id,
        "note": "Junior dev: Implement Jira API call to update task fields"
    }
