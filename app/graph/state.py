from typing import TypedDict, List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field


class CodegenSettings(BaseModel):
    """User-configurable code-generation parameters stored per pipeline."""
    llm_model: Optional[str] = None                 # None → use OPENHANDS_LLM_MODEL env
    git_user_name: str = "Randstad AI Studio"
    git_user_email: str = "sdlc-ai@randstad.com"
    browser_allowed_domains: Optional[str] = None   # None → no restrictions
    conversation_timeout_minutes: int = 120          # 2 hr default per epic
    max_epic_retries: int = 3

    # CI repair loop settings
    max_ci_fix_attempts: int = 3        # max rounds of CI-failure → agent-fix → re-check
    ci_check_timeout_minutes: int = 15  # max time to wait for a CI run to complete


class EpicImplementationRecord(BaseModel):
    epic_index: int
    epic_id: str
    epic_title: str
    status: str = "PENDING"
    # PENDING | IMPLEMENTING | AWAITING_APPROVAL | COMPLETED | FAILED

    # OpenHands conversation tracking
    start_task_id: Optional[str] = None
    conversation_id: Optional[str] = None
    conversation_url: Optional[str] = None

    # Results
    pr_url: Optional[str] = None
    branch_name: Optional[str] = None
    implementation_summary: Optional[str] = None
    tests_passed: Optional[int] = None
    tests_failed: Optional[int] = None
    test_output: Optional[str] = None

    # HITL gate
    hitl_token: Optional[str] = None
    hitl_decision: Optional[str] = None    # "approved" | "rejected"
    hitl_feedback: Optional[str] = None

    # CI repair loop
    ci_status: Optional[str] = None       # CHECKING | FIXING | PASSING | FAILED
    ci_fix_attempts: int = 0
    ci_failure_summary: Optional[str] = None

    # Merge tracking
    merged_sha: Optional[str] = None
    merge_error: Optional[str] = None

    # Timestamps & retry
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0


class SDLCStateDocument(BaseModel):
    project_id: str
    status: str = "INITIALIZED"
    raw_jira_tickets: List[Dict[str, Any]] = Field(default_factory=list)
    chunked_epics: List[Dict[str, Any]] = Field(default_factory=list)
    current_chunk_index: int = 0

    # Project metadata
    username: Optional[str] = None
    project_title: Optional[str] = None
    project_description: Optional[str] = None
    project_created_at: Optional[str] = None
    project_due_date: Optional[str] = None
    jira_board_id: Optional[str] = None

    # Ticket selection (user can choose which tickets to implement)
    selected_ticket_ids: List[str] = Field(default_factory=list)
    implementation_ticket_ids: List[str] = Field(default_factory=list)  # Tasks to actually code (subset of selected)

    # Pipeline configuration (set via /pipeline/configure)
    github_repo: Optional[str] = None
    github_branch: str = "main"
    github_token: Optional[str] = None
    hitl_enabled: bool = True
    openhands_url: str = "http://localhost:3000"

    # Planning phase
    planning_conversation_id: Optional[str] = None
    planning_conversation_url: Optional[str] = None
    planning_status: str = "PENDING"
    # PENDING | IN_PROGRESS | COMPLETED | AWAITING_APPROVAL | APPROVED | FAILED
    plan_md_content: Optional[str] = None
    planning_hitl_token: Optional[str] = None
    planning_hitl_decision: Optional[str] = None

    # Epic implementation
    epic_records: List[EpicImplementationRecord] = Field(default_factory=list)

    # Delivery (Stage 4)
    delivery_url: Optional[str] = None
    delivery_container_id: Optional[str] = None
    delivery_status: Optional[str] = None  # BUILDING | RUNNING | STOPPED | FAILED

    # Env vars for delivery (operator-supplied runtime secrets)
    required_env_vars: List[str] = Field(default_factory=list)
    project_env_vars: Dict[str, str] = Field(default_factory=dict)

    # Jira key mapping (populated by Jira implementation, used by orchestrator post-merge sync)
    jira_key_map: Dict[str, str] = Field(default_factory=dict)
    jira_project_key: Optional[str] = None

    # Error tracking
    last_error: Optional[str] = None

    # User-configurable code-gen settings
    codegen_settings: CodegenSettings = Field(default_factory=CodegenSettings)


class UserConfiguration(BaseModel):
    """User-level configuration for Jira and GitHub credentials (stored encrypted in S3)."""
    username: str

    # Jira Configuration
    jira_base_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""  # Stored encrypted

    # GitHub Configuration
    github_token: str = ""  # Stored encrypted
    github_username: Optional[str] = None
    github_default_branch: str = "main"

    # Metadata
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# LangGraph active state
class GraphState(TypedDict):
    project_id: str
    state_doc: SDLCStateDocument
