# SDLC Orchestrator — Stage 2 Backend

The orchestration layer that takes a set of JIRA tickets and autonomously implements them as code. It drives [OpenHands](https://github.com/All-Hands-AI/OpenHands) (an AI coding agent) epic-by-epic, streams real-time progress over SSE, and gates each epic behind a human-in-the-loop approval step before merging.

---

## How it works

```
JIRA tickets (pre-loaded)
        │
        ▼
  ┌─────────────┐
  │  jira_node  │  Groups tickets into epics; builds structured specs
  └──────┬──────┘
         │
         ▼
  ┌──────────────┐
  │ planning_node│  OpenHands writes PLAN.md (architecture, contracts,
  │              │  dir layout, test strategy) → HITL gate → approved
  └──────┬───────┘
         │
         ▼
  ┌──────────────────┐
  │ orchestrator_node│  For each epic:
  │                  │  1. Start OpenHands task (execute_task V1 API)
  │                  │  2. Stream events — parse test results, PR URL
  │                  │  3. Stuck-agent detection (5 min → 10 min → fail)
  │                  │  4. HITL gate — wait for human approve/reject
  │                  │  5. On approve → COMPLETED; on reject → retry
  └──────────────────┘
         │
         ▼
   PR per epic on GitHub
```

Everything the orchestrator does is pushed to connected clients in real time via SSE (`GET /api/v1/pipeline/status/{project_id}`).

---

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| Entry point | `main.py` | FastAPI app, CORS, route registration |
| Config | `app/core/config.py` | All settings via pydantic-settings + `.env` |
| REST API | `app/api/router.py` | Pipeline lifecycle, HITL, cancel, reset |
| SSE | `app/api/sse.py` | Push-based event stream, catch-up on reconnect |
| Pipeline launcher | `app/graph/services/pipeline_runner.py` | `launch_pipeline()` — asyncio.create_task with dedup guard |
| State | `app/graph/services/state_manager.py` | Read/write `SDLCStateDocument` to S3 |
| HITL registry | `app/graph/services/hitl_manager.py` | asyncio.Event per token; S3 as fallback on restart |
| Callback bridge | `app/graph/services/task_callback_manager.py` | Bridges OpenHands HTTP callback → waiting coroutine |
| State model | `app/graph/state.py` | `SDLCStateDocument`, `EpicImplementationRecord`, `CodegenSettings` |
| Workflow | `app/graph/workflow.py` | `run_pipeline()` — health check → jira_node → planning_node → orchestrator_node |
| Jira node | `app/graph/nodes/jira_node.py` | Groups raw tickets into epics; builds OpenHands prompt per epic |
| Planning node | `app/graph/nodes/planning_node.py` | OpenHands writes PLAN.md; HITL gate; resume-safe |
| Orchestrator node | `app/graph/nodes/orchestrator.py` | Multi-epic loop, stuck detection, retry, HITL |
| OpenHands client | `app/services/openhands_client.py` | HTTP client for OpenHands V1 API |

---

## REST API

All routes are prefixed with `/api/v1`.

### Pipeline lifecycle

| Method | Path | Description |
|---|---|---|
| `POST` | `/pipeline/start` | Start or resume the pipeline for a project |
| `POST` | `/pipeline/configure/{project_id}` | Set GitHub repo/token, HITL flag, LLM model |
| `GET` | `/pipeline/configure/{project_id}` | Read current configuration |
| `GET` | `/pipeline/state/{project_id}` | Full state snapshot (token redacted) |
| `POST` | `/pipeline/{project_id}/cancel` | Cancel a running pipeline |
| `POST` | `/pipeline/{project_id}/reset` | Reset to INITIALIZED (preserves config + tickets) |

### HITL (Human-in-the-Loop)

| Method | Path | Description |
|---|---|---|
| `GET` | `/pipeline/hitl/{project_id}/{token}` | Get gate details (PR URL, summary, test results) |
| `POST` | `/pipeline/hitl/{project_id}/{token}/approve` | Approve — marks epic COMPLETED, pipeline continues |
| `POST` | `/pipeline/hitl/{project_id}/{token}/reject` | Reject — optionally pass `{"feedback": "..."}` in body |

### Real-time events

| Method | Path | Description |
|---|---|---|
| `GET` | `/pipeline/status/{project_id}` | SSE stream — push events + 30s keepalive |

### Internal (called by OpenHands)

| Method | Path | Description |
|---|---|---|
| `POST` | `/pipeline/task-callback/{project_id}/{epic_index}` | Receives structured completion report from OpenHands |

---

## SSE Event Reference

Connect to `GET /api/v1/pipeline/status/{project_id}` to receive these events:

| Event type | When | Key fields |
|---|---|---|
| `PIPELINE_STATE_CATCHUP` | Immediately on connect (if pipeline is running) | `pipeline_status`, `epic_records`, `planning_hitl_token` |
| `JIRA_LOADED` | Tickets grouped into epics | `epic_count`, `total_stories`, `total_tasks` |
| `PLANNING_STARTED` | OpenHands planning conversation started | `conversation_url` |
| `PLANNING_IN_PROGRESS` | Planning heartbeat | `latest_message` |
| `PLANNING_COMPLETED` | PLAN.md written and pushed | `plan_summary`, `conversation_url` |
| `PLANNING_AWAITING_APPROVAL` | HITL gate open | `hitl_token`, `plan_summary` |
| `PLANNING_APPROVED` | Gate approved | — |
| `PLANNING_REJECTED` | Gate rejected | — |
| `EPIC_STARTED` | Epic implementation beginning | `epic_id`, `epic_title`, `epic_index`, `total_epics` |
| `EPIC_CONVERSATION_READY` | OpenHands conversation live | `epic_id`, `conversation_url` |
| `EPIC_IN_PROGRESS` | Heartbeat while agent is working | `epic_id`, `elapsed_seconds` |
| `EPIC_GUIDANCE_SENT` | Stuck-agent nudge sent (stage 1 or 2) | `epic_id`, `stage` |
| `EPIC_AGENT_MESSAGE` | Agent sent a text message | `epic_id`, `message` |
| `EPIC_AWAITING_APPROVAL` | HITL gate open | `epic_id`, `hitl_token`, `pr_url`, `tests_passed`, `tests_failed` |
| `EPIC_APPROVED` | Gate approved | `epic_id` |
| `EPIC_REJECTED` | Gate rejected | `epic_id` |
| `EPIC_COMPLETED` | Epic done | `epic_id`, `pr_url` |
| `EPIC_FAILED` | Epic failed (will retry if count < max) | `epic_id`, `error` |
| `PIPELINE_PAUSED` | Epic failed, retries remaining, waiting for re-launch | `epic_id`, `retry_count`, `max_retries` |
| `PIPELINE_COMPLETED` | All epics done | `completed_epics`, `failed_epics` |
| `PIPELINE_FAILED` | Unrecoverable error | `error` |

---

## Pipeline States

```
INITIALIZED → PIPELINE_LAUNCHED → PLANNING → [COMPLETED | COMPLETED_WITH_ERRORS | FAILED | RETRY_PENDING]
```

Epic states: `PENDING → IMPLEMENTING → AWAITING_APPROVAL → COMPLETED | FAILED`

`RETRY_PENDING` means an epic failed with retries still available — call `/pipeline/start` again to resume.

---

## Running locally

### Prerequisites

- Python 3.10+
- OpenHands running at `http://localhost:3000` (see [OpenHands docs](https://github.com/All-Hands-AI/OpenHands))
- AWS credentials with S3 read/write access to the state bucket

### Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and fill in the environment file
cp .env.example .env
# Edit .env — at minimum set AWS creds and OPENHANDS_LLM_MODEL

# 3. Start the server
uvicorn main:app --reload --port 8001
```

### Minimal `.env` for local testing

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
SDLC_STATE_BUCKET=sdlc-pipeline-states
OPENHANDS_BASE_URL=http://localhost:3000
OPENHANDS_LLM_MODEL=bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0
SDLC_ORCHESTRATOR_BASE_URL=http://host.docker.internal:8001
```

### Start a pipeline (example flow)

```bash
# 1. Configure the pipeline for a project
curl -X POST http://localhost:8001/api/v1/pipeline/configure/my-project \
  -H "Content-Type: application/json" \
  -d '{
    "github_repo": "org/repo",
    "github_branch": "feature/ai-build",
    "github_token": "ghp_...",
    "hitl_enabled": true
  }'

# 2. Watch the SSE stream in a separate terminal
curl -N http://localhost:8001/api/v1/pipeline/status/my-project

# 3. Start the pipeline (tickets must already be in S3 state)
curl -X POST http://localhost:8001/api/v1/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"project_id": "my-project"}'

# 4. When PLANNING_AWAITING_APPROVAL fires, approve it
curl -X POST http://localhost:8001/api/v1/pipeline/hitl/my-project/<token>/approve

# 5. When EPIC_AWAITING_APPROVAL fires, approve each epic
curl -X POST http://localhost:8001/api/v1/pipeline/hitl/my-project/<token>/approve

# Reject with feedback (epic will retry on next launch)
curl -X POST http://localhost:8001/api/v1/pipeline/hitl/my-project/<token>/reject \
  -H "Content-Type: application/json" \
  -d '{"feedback": "Missing error handling on the /notes endpoint"}'
```

---

## What's not implemented yet

| Item | Notes |
|---|---|
| **Jira sync endpoint** | `POST /jira/sync/{project_id}` — fetch tickets from a real Jira board. Currently tickets must be pre-loaded into S3 state (done by Stage 1). |
| **Project list/CRUD** | No `GET /projects` or `DELETE /projects/{id}` yet. |
| **Frontend** | Ruban + Nandan own the frontend. SSE endpoint and HITL token URLs are stable. |

---

## Frontend integration notes 

The SSE URL and HITL flow **changed substantially** from the old `main` branch. Here's what to update:

| Old | New |
|---|---|
| `GET /api/sse/stream/{username}/{project_id}` | `GET /api/v1/pipeline/status/{project_id}` — no username |
| `POST /api/pipeline/start` body: `{username, project_id}` | body: `{project_id}` only |
| `POST /api/pipeline/gate` with `action: "approve_code"` | `POST /api/v1/pipeline/hitl/{project_id}/{token}/approve` |
| SSE event `state_update` / `pipeline_paused` | Rich typed events — see SSE Event Reference table above |

On connect, the SSE stream immediately sends a `PIPELINE_STATE_CATCHUP` event with the current full state — use this to restore UI state on page load or reconnect without a separate REST call.

The `hitl_token` arrives in `PLANNING_AWAITING_APPROVAL` and `EPIC_AWAITING_APPROVAL` events. Pass it to the approve/reject endpoints. Token details (PR URL, test results, implementation summary) are available via `GET /api/v1/pipeline/hitl/{project_id}/{token}`.
