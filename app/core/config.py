from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "SDLC Orchestrator"

    # AWS
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    S3_BUCKET_NAME: str = ""
    SDLC_STATE_BUCKET: str = "sdlc-pipeline-states"
    IRA_BUCKET_NAME: str = "datapipeline-code-test"
    BEDROCK_API_KEY: str = ""

    # Jira
    JIRA_BASE_URL: str = ""
    JIRA_EMAIL: str = ""
    JIRA_API_TOKEN: str = ""
    JIRA_PROJECT_KEY: str = ""
    JIRA_STORY_POINTS_FIELD: str = "customfield_10016"
    JIRA_SPRINT_FIELD: Optional[str] = None
    JIRA_START_DATE_FIELD: Optional[str] = None
    JIRA_TEAM_FIELD: Optional[str] = None

    # OpenHands
    OPENHANDS_BASE_URL: str = "http://localhost:3000"
    OPENHANDS_API_KEY: str = ""
    OPENHANDS_LLM_MODEL: str = ""
    OPENHANDS_LLM_API_KEY: str = ""
    OPENHANDS_GIT_USER_NAME: str = "Randstad AI Studio"
    OPENHANDS_GIT_USER_EMAIL: str = "sdlc-ai@randstad.com"
    OPENHANDS_POLL_INTERVAL_SECONDS: int = 10
    OPENHANDS_START_TASK_TIMEOUT_SECONDS: int = 300
    OPENHANDS_CONVERSATION_TIMEOUT_SECONDS: int = 7200
    OPENHANDS_STUCK_TIMEOUT_SECONDS: int = 300

    # HITL
    HITL_APPROVAL_TIMEOUT_HOURS: int = 72

    # CI repair loop
    CI_POLL_INTERVAL_SECONDS: int = 30   # how often to poll check-runs
    CI_INITIAL_WAIT_SECONDS: int = 45    # wait after agent finishes before first CI poll

    # Callback URL base — must be reachable from inside the OpenHands container
    SDLC_ORCHESTRATOR_BASE_URL: str = "http://host.docker.internal:8001"

    # Encryption
    ENCRYPTION_KEY: str = "R8VSBJS-eymr_BUabkd_SBq4PjDCaPMa4GpKFlhrlZw="  # Required for encrypting sensitive user data

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")


settings = Settings()
