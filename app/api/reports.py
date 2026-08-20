# app/api/reports.py
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.graph.services.reports_service import ReportsService

logger = logging.getLogger(__name__)
router = APIRouter()
reports_service = ReportsService()

# ==========================================
# PYDANTIC SERIALIZATION SCHEMAS
# ==========================================

class PhaseTask(BaseModel):
    id: str
    title: str
    project: str
    status: str

class PhaseStats(BaseModel):
    name: str
    value: int
    color: str
    tasks: List[PhaseTask] = []

class CIRoundDistribution(BaseModel):
    rounds: str
    count: int
    tasks: List[Dict[str, Any]] = []

class ReportSummary(BaseModel):
    total_projects: int
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    completion_rate: float
    weekly_project_delta: str
    phase_stats: List[PhaseStats] = [] 
    ci_rounds_distribution: List[CIRoundDistribution] = [] 

class TeamMemberStats(BaseModel):
    name: str
    completed: int
    pending: int
    failed: int
    total: int
    success_rate: float
    phase_breakdown: List[PhaseStats] = []
    biweekly_sprints: list = [] 

class QualityMetrics(BaseModel):
    test_pass_rate: float
    total_ci_fixes: int
    total_tests_run: int

class TaskStep(BaseModel):
    step: str
    timestamp: str
    status: str

class TaskDetailNode(BaseModel):
    id: str
    title: str
    status: str

class StoryDetailNode(BaseModel):
    id: str
    title: str
    status: str
    tasks: List[TaskDetailNode] = []

class EpicDetailRow(BaseModel):
    epic_id: str
    title: str
    status: str
    failure_reason: str
    steps: List[TaskStep] = []
    stories: List[StoryDetailNode] = [] 

class ProjectSummaryRow(BaseModel):
    project_id: str
    project_name: str
    project_description: str = ""
    assignee: str
    created_at: str = "" 
    total_tasks: int
    epic_count: int
    completed_epics: int
    pending_epics: int
    completed: int
    pending: int
    failed: int
    success_rate: float
    phase_breakdown: List[PhaseStats] = [] 
    test_pass_rate: float = 0.0
    total_ci_fixes: int = 0
    total_tests_run: int = 0
    epics_detail: List[EpicDetailRow] = [] 
    github_repo: str = ""
    github_branch: str = "main"
    selected_count: int = 0
    implementation_count: int = 0

class TimelineStat(BaseModel):
    month: str
    total: int
    completed: int
    behind: int
    completion_rate: float
    prev_week_completed: int
    prev_week_rate: float
    prev_week_total: int = 0 

class GlobalSummaryResponse(BaseModel):
    summary: ReportSummary
    quality_data: QualityMetrics

class FullReportResponse(BaseModel):
    summary: GlobalSummaryResponse
    team_workload: List[TeamMemberStats]
    project_breakdown: List[ProjectSummaryRow]
    delivery_trends: List[TimelineStat]

# ==========================================
# ENDPOINTS
# ==========================================

@router.get("/reports/all", response_model=FullReportResponse)
def get_all_reports(username: str = Query(...), project_id: Optional[str] = Query(None)):
    try:
        projects = reports_service.state_manager.list_projects(username)
        if project_id:
            projects = [p for p in projects if getattr(p, 'project_id', None) == project_id]
            
        summary_data = reports_service.aggregate_summary_kpis(username, project_id, preloaded_projects=projects)
        team_data = reports_service.aggregate_team_stats(username, preloaded_projects=projects)
        
        return {
            "summary": summary_data,
            "team_workload": team_data
        }
    except Exception as e:
        logger.error(f"[ReportController] Unified Schema Execution Failure: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to compile dashboard tracking models.")
