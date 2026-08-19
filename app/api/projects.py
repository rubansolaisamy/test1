# app/api/projects.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from app.graph.services.state_manager import StateManager
from app.graph.state import SDLCStateDocument

router = APIRouter()
state_manager = StateManager()

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# Request/Response Schemas
class CreateProjectRequest(BaseModel):
    """Request body for creating a new project"""
    project_id: str
    username: str
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    jira_board_id: Optional[str] = None
    jira_project_key: Optional[str] = None
    github_repo: Optional[str] = None
    github_branch: str = "main"
    github_token: Optional[str] = None


class UpdateProjectRequest(BaseModel):
    """Request body for updating project metadata"""
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    jira_board_id: Optional[str] = None
    jira_project_key: Optional[str] = None
    github_repo: Optional[str] = None
    github_branch: Optional[str] = None
    github_token: Optional[str] = None


class ProjectResponse(BaseModel):
    """Response for project details"""
    project_id: str
    username: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: str
    progress: int
    current_phase: str
    created_at: Optional[str] = None
    due_date: Optional[str] = None
    epic_count: int
    completed_epics: int
    jira_board_id: Optional[str] = None
    jira_project_key: Optional[str] = None
    github_repo: Optional[str] = None
    github_branch: Optional[str] = None
    last_error: Optional[str] = None
    planning_status: Optional[str] = None
    planning_hitl_token: Optional[str] = None
    epic_records: list = []


def _calculate_progress(state: SDLCStateDocument) -> int:
    """Calculate project progress percentage"""
    epics = state.epic_records or []

    if not epics:
        # If no epics, base progress on status
        status_progress = {
            "INITIALIZED": 0,
            "PIPELINE_LAUNCHED": 10,
            "JIRA_ANALYZED": 20,
            "CODE_GENERATION_IN_PROGRESS": 50,
            "READY_FOR_REVIEW": 75,
            "APPROVAL_RECEIVED_DEPLOYING": 90,
            "APPLICATION_DEPLOYED": 100,
            "COMPLETED": 100,
            "COMPLETED_WITH_ERRORS": 100,
            "FAILED": 0,
            "CANCELLED": 0
        }
        return status_progress.get(state.status, 0)
    
    # Calculate based on epic completion
    completed = sum(1 for e in epics if e.status == "COMPLETED")
    total = len(epics)
    return int((completed / total * 100)) if total > 0 else 0


def _derive_phase(status: str) -> str:
    """Map pipeline status to SDLC phase"""
    phase_mapping = {
        "INITIALIZED": "Requirements Analysis",
        "PIPELINE_LAUNCHED": "Requirements Analysis",
        "JIRA_FETCHING": "Requirements Analysis",
        "JIRA_LOADED": "Requirements Analysis",
        "JIRA_FETCHED_AWAITING_SELECTION": "Requirements Analysis",
        "TICKETS_SELECTED": "Requirements Analysis",
        "JIRA_ANALYZED": "Planning",
        "PLANNING": "Planning",
        "PLANNING_APPROVED": "Planning",
        "CODE_GENERATION_IN_PROGRESS": "Development",
        "READY_FOR_REVIEW": "Testing",
        "APPROVAL_RECEIVED_DEPLOYING": "Deployment",
        "APPLICATION_DEPLOYED": "Deployment",
        "COMPLETED": "Deployment",
        "COMPLETED_WITH_ERRORS": "Deployment",
        "FAILED": "Failed",
        "CANCELLED": "Cancelled"
    }
    return phase_mapping.get(status, "Requirements Analysis")


def _derive_phase_smart(state: SDLCStateDocument) -> str:
    """Derive phase from both status and epic_records so a stale status field can't mislead."""
    epics = state.epic_records or []
    active_statuses = {"IMPLEMENTING", "AWAITING_APPROVAL"}
    if any(e.status in active_statuses for e in epics):
        return "Development"
    if epics and all(e.status == "COMPLETED" for e in epics):
        if state.status in ("COMPLETED", "APPLICATION_DEPLOYED", "APPROVAL_RECEIVED_DEPLOYING"):
            return "Deployment"
        return "Testing"
    if any(e.status == "COMPLETED" for e in epics):
        return "Development"
    return _derive_phase(state.status)


def _state_to_response(state: SDLCStateDocument) -> ProjectResponse:
    """Convert SDLCStateDocument to ProjectResponse"""
    completed_epics = sum(1 for e in state.epic_records if e.status == "COMPLETED")

    return ProjectResponse(
        project_id=state.project_id,
        username=state.username,
        title=state.project_title or state.project_id,
        description=state.project_description,
        status=state.status,
        progress=_calculate_progress(state),
        current_phase=_derive_phase_smart(state),
        created_at=state.project_created_at,
        due_date=state.project_due_date,
        epic_count=len(state.epic_records),
        completed_epics=completed_epics,
        jira_board_id=state.jira_board_id,
        jira_project_key=state.jira_project_key,
        github_repo=state.github_repo,
        github_branch=state.github_branch,
        last_error=state.last_error,
        planning_status=state.planning_status,
        planning_hitl_token=state.planning_hitl_token,
        epic_records=[e.model_dump() for e in state.epic_records]
    )


# API Endpoints

@router.get("/projects", response_model=List[ProjectResponse])
async def list_projects(username: str):
    """
    List all projects for a user.
    Scans S3 to find all project state files.
    Note: username parameter is kept for future filtering, but currently returns all projects.
    """
    projects = state_manager.list_projects(username)
    print(f"Found {len(projects)} projects")
    return [_state_to_response(p) for p in projects]


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, username: str):
    """
    Get a single project by ID.
    Returns full project details including epic records.
    """
    state = state_manager.get_state(username, project_id)
    
    # Check if project exists (has been created)
    if not state.project_title and state.status == "INITIALIZED":
        raise HTTPException(status_code=404, detail="Project not found")
    
    return _state_to_response(state)


@router.post("/projects", response_model=ProjectResponse)
async def create_project(request: CreateProjectRequest):
    """
    Create a new project.
    Initializes SDLCStateDocument in S3.
    """
    # Check if project already exists
    existing_state = state_manager.get_state(request.username, request.project_id)
    if existing_state.project_title:
        raise HTTPException(
            status_code=409,
            detail=f"Project {request.project_id} already exists"
        )
    
    # Create new state document
    state = SDLCStateDocument(
        username=request.username,
        project_id=request.project_id,
        project_title=request.title,
        project_description=request.description,
        project_created_at=datetime.now(timezone.utc).isoformat(),
        project_due_date=request.due_date,
        jira_board_id=request.jira_board_id,
        jira_project_key=request.jira_project_key,
        github_repo=request.github_repo,
        github_branch=request.github_branch,
        github_token=request.github_token,
        status="INITIALIZED"
    )
    
    state_manager.update_state(state)
    # print(f"Created new project: {state} for user: {state.username}")
    return _state_to_response(state)


@router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, username: str, request: UpdateProjectRequest):
    """
    Update project metadata.
    Does not affect pipeline state or epic records.
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Update only provided fields
    if request.title is not None:
        state.project_title = request.title
    if request.description is not None:
        state.project_description = request.description
    if request.due_date is not None:
        state.project_due_date = request.due_date
    if request.jira_board_id is not None:
        state.jira_board_id = request.jira_board_id
    if request.jira_project_key is not None:
        state.jira_project_key = request.jira_project_key
    if request.github_repo is not None:
        state.github_repo = request.github_repo
    if request.github_branch is not None:
        state.github_branch = request.github_branch
    if request.github_token is not None:
        state.github_token = request.github_token
    
    state_manager.update_state(state)
    
    # print(f"Updated project state: {state_manager}")
    
    return _state_to_response(state)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, username: str):
    """
    Delete a project.
    Removes the state document from S3.
    """
    state = state_manager.get_state(username, project_id)
    
    if not state.project_title:
        raise HTTPException(status_code=404, detail="Project not found")
    
    state_manager.delete_state(username, project_id)
    
    return {"message": f"Project {project_id} deleted successfully"}
