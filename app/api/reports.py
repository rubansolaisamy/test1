import json
import time
import logging
import redis
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel

from app.graph.services.reports_service import ReportsService

logger = logging.getLogger(__name__)
router = APIRouter()
reports_service = ReportsService()



# --- Pydantic Models ---
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
    active_projects: int
    completed_projects: int
    failed_projects: int
    weekly_project_delta: int
    total_epics: int
    total_stories: int
    total_tasks: int
    completed_epics: int
    failed_epics: int
    completion_rate: float
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
    assigned_to: str
    execution_mode: str = "AI"
    started_at: str = ""
    completed_at: str = ""
    error_message: str = ""

class StoryDetailNode(BaseModel):
    id: str
    title: str
    status: str
    assigned_to: str
    execution_mode: str = "AI"
    started_at: str = ""
    completed_at: str = ""
    error_message: str = ""
    pr_url: str = ""
    pr_number: Optional[int] = None
    pr_additions: int = 0
    pr_deletions: int = 0
    pr_changed_files: int = 0
    tasks: List[TaskDetailNode] = []

class EpicDetailRow(BaseModel):
    epic_id: str
    title: str
    status: str
    assigned_to: str
    failure_reason: str
    failed_at: str = ""
    execution_mode: str = "AI"
    started_at: str = ""
    completed_at: str = ""
    error_message: str = ""
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
    ci_rounds_distribution: List[CIRoundDistribution] = []
    full_team_list: List[str] = [] 

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
    current_user_role: str = "developer"


def fetch_and_cache_data(username: str, project_id: Optional[str]):
    cache_key = f"reports_all:{username}:{project_id or 'all'}"
    timestamp_key = f"reports_time:{username}:{project_id or 'all'}"
    
    logger.info(f"Background Task: Fetching fresh S3 data for {username}...")
    try:
        # 1. Fetch the slow S3 data
        full_data = reports_service.generate_full_report(username, project_id)
        
        # 2. Serialize to JSON
        if isinstance(full_data, dict):
            json_data = json.dumps(full_data)
        else:
            json_data = full_data.model_dump_json()
            
        # 3. Try to update the cache, but don't crash if Redis is down
        try:
            redis_client.setex(cache_key, CACHE_TTL_SECONDS, json_data)
            redis_client.setex(timestamp_key, CACHE_TTL_SECONDS, str(int(time.time())))
            logger.info(f"Background Task: Successfully updated cache for {username}.")
        except redis.exceptions.ConnectionError:
            logger.warning(f"Redis connection failed while saving cache for {username}. Data fetched but not cached.")
            
        return full_data
        
    except Exception as e:
        logger.error(f"Background Task Failed for {username}: {str(e)}")


# --- Endpoint ---
@router.get("/reports/all", response_model=FullReportResponse)
def get_all_reports(
    background_tasks: BackgroundTasks, 
    username: str = Query(...), 
    project_id: Optional[str] = Query(None)
):
    cache_key = f"reports_all:{username}:{project_id or 'all'}"
    timestamp_key = f"reports_time:{username}:{project_id or 'all'}"

    try:
        # Try to read from Redis
        try:
            cached_data = redis_client.get(cache_key)
            last_updated = redis_client.get(timestamp_key)
        except redis.exceptions.ConnectionError:
            # REDIS IS DOWN: Fallback to direct S3 call immediately
            logger.warning("Redis is offline! Bypassing cache and hitting S3 directly.")
            return reports_service.generate_full_report(username, project_id)
        
        
        ## IMPORTANT: For now, we are bypassing the cache and hitting S3 directly.
        # return reports_service.generate_full_report(username, project_id) # remove this line if you want to enable caching again
        # Note: The below caching logic is commented out for now. If you want to enable caching, uncomment the code below and remove the direct S3 call above.
    
        if cached_data:
            logger.info(f"Cache HIT for {username}. Returning instantly.")
            
            current_time = int(time.time())
            last_updated_time = int(last_updated) if last_updated else 0
            
            if (current_time - last_updated_time) > REFRESH_INTERVAL_SECONDS:
                logger.info(f"Cache for {username} is older than 1 hour. Triggering background refresh.")
                background_tasks.add_task(fetch_and_cache_data, username, project_id)
                
            return json.loads(cached_data)

        # Cache MISS
        logger.info(f"Cache MISS for {username}. Fetching from S3 (Will take ~15s)...")
        data = fetch_and_cache_data(username, project_id)
        return data

    except Exception as e:
        logger.error(f"[ReportController] Execution Failure: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to compile dashboard data.")
