import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api import router as pipeline_router
from app.api import sse as sse_router
from app.api import projects, tasks
from app.api import user_config_routes
from app.core.config import settings
from app.api import reports
from app.graph.services.pipeline_runner import launch_pipeline
from app.graph.services.state_manager import StateManager
from app.services.user_config_service import UserConfigService

app = FastAPI(
    title="SDLC Orchestrator",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Stage 2 — Orchestration pipeline
app.include_router(pipeline_router.router, prefix=settings.API_V1_STR, tags=["Orchestration"])
app.include_router(sse_router.router,      prefix=settings.API_V1_STR, tags=["Orchestration"])

# Reports
app.include_router(reports.router, prefix="/api/v1")

# CRUD APIs for frontend
app.include_router(projects.router, prefix=settings.API_V1_STR, tags=["Projects"])
app.include_router(tasks.router, prefix=settings.API_V1_STR, tags=["Tasks"])

app.include_router(user_config_routes.router, prefix="/api/v1", tags=[])


class PipelineStartRequest(BaseModel):
    project_id: str
    username: str


_state_manager = StateManager()


@app.post(f"{settings.API_V1_STR}/pipeline/start", tags=["Orchestration"])
async def start_pipeline(request: PipelineStartRequest):
    sm = StateManager()
    state_doc = _state_manager.get_state(request.username, request.project_id)

    # Guard: tickets must exist OR a jira_project_key is set (fetched live in jira_node)
    if not state_doc.raw_jira_tickets and not state_doc.jira_project_key:
        raise HTTPException(
            status_code=422,
            detail="No JIRA tickets found for this project. Complete the JIRA sync step first."
        )

    # Guard: GitHub config must be set (written by /pipeline/configure before this call)
    if not state_doc.github_token:
        try:
            config_service = UserConfigService()
            creds = config_service.get_decrypted_credentials(request.username)
            state_doc.github_token = creds["github_token"]
            sm.update_state(state_doc)
        except Exception as e:
            raise HTTPException(
                status_code=422, 
                detail=f"GitHub token not found in user config. Please configure in Settings. Error: {str(e)}"
            )

    if state_doc.status == "INITIALIZED":
        state_doc.status = "PIPELINE_LAUNCHED"
        _state_manager.update_state(state_doc)

    launched = launch_pipeline(request.username, request.project_id)
    return {
        "message": "Pipeline initiated successfully" if launched else "Pipeline already running",
        "project_id": request.project_id,
        "status": state_doc.status,
    }


@app.get("/")
def root():
    return {"message": "SDLC Orchestrator is running"}
