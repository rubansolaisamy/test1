import asyncio
import time
from typing import AsyncGenerator, Optional

import httpx
from better_profanity import profanity as _profanity_filter

from app.core.config import settings

_profanity_filter.load_censor_words()


def _sanitize(text: str) -> str:
    """Censor any words that would be rejected by the OpenHands content filter."""
    return _profanity_filter.censor(text)


class OpenHandsError(Exception):
    pass


class OpenHandsClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self._base = (base_url or settings.OPENHANDS_BASE_URL).rstrip("/")
        key = api_key or settings.OPENHANDS_API_KEY
        self._headers = {"Authorization": f"Bearer {key}"} if key else {}
        self._http = httpx.AsyncClient(timeout=60.0)

    async def configure(
        self,
        github_token: str | None = None,
        llm_model: str | None = None,
        git_user_name: str | None = None,
        git_user_email: str | None = None,
    ) -> None:
        """Push LLM model, git identity and GitHub token into OpenHands.

        Per-pipeline CodegenSettings values take priority over .env defaults.
        """
        effective_model = llm_model or settings.OPENHANDS_LLM_MODEL
        effective_name = git_user_name or settings.OPENHANDS_GIT_USER_NAME
        effective_email = git_user_email or settings.OPENHANDS_GIT_USER_EMAIL

        settings_body: dict = {}
        if effective_model:
            settings_body["llm_model"] = effective_model
        if settings.OPENHANDS_LLM_API_KEY:
            settings_body["llm_api_key"] = settings.OPENHANDS_LLM_API_KEY
        if effective_name:
            settings_body["git_user_name"] = effective_name
        if effective_email:
            settings_body["git_user_email"] = effective_email

        if settings_body:
            resp = await self._http.post(
                f"{self._base}/api/v1/settings",
                json=settings_body,
                headers=self._headers,
            )
            if not resp.is_success:
                raise OpenHandsError(f"configure settings failed: {resp.status_code} — {resp.text}")

        if github_token:
            resp = await self._http.post(
                f"{self._base}/api/v1/secrets/git-providers",
                json={"provider_tokens": {"github": {"token": github_token, "host": "github.com"}}},
                headers=self._headers,
            )
            if not resp.is_success:
                raise OpenHandsError(f"configure github token failed: {resp.status_code} — {resp.text}")

    async def execute_task(
        self,
        spec: str,
        repo: str,
        branch: str,
        callback_url: str | None = None,
        llm_model: str | None = None,
    ) -> str:
        """POST /api/v1/tasks/execute — starts conversation with PHASE_EXECUTION_SUFFIX injected.

        Returns start task_id. Poll wait_for_ready() to get the conversation_id.
        The spec_content prompt gets the quality-gate system suffix and structured
        JSON completion block appended automatically by OpenHands.
        """
        if repo.startswith("https://"):
            repo = repo.rstrip("/").split("github.com/")[-1]

        body: dict = {
            "spec_content": _sanitize(spec),
            "selected_repository": repo,
            "selected_branch": branch,
        }
        if callback_url:
            body["callback_url"] = callback_url
        if llm_model:
            body["llm_model"] = llm_model

        resp = await self._http.post(
            f"{self._base}/api/v1/tasks/execute",
            json=body,
            headers=self._headers,
        )
        if not resp.is_success:
            raise OpenHandsError(f"execute_task failed: {resp.status_code} — {resp.text}")
        data = resp.json()
        return data["task_id"]

    async def start_conversation(
        self,
        message: str,
        repo: str,
        branch: str,
        github_token: str | None = None,
        agent_type: str | None = None,
    ) -> str:
        """POST /api/v1/app-conversations — returns start task_id."""
        # Normalise repo to "owner/repo" format (strip https://github.com/ prefix if present)
        if repo.startswith("https://"):
            repo = repo.rstrip("/").split("github.com/")[-1]

        body: dict = {
            "initial_message": {
                "role": "user",
                "content": [{"type": "text", "text": _sanitize(message)}],
                "run": True,
            },
            "selected_repository": repo,
            "selected_branch": branch,
        }
        if agent_type:
            body["agent_type"] = agent_type
        last_exc: Exception | None = None
        for attempt, delay in enumerate([0, 2, 4, 8]):
            if delay:
                await asyncio.sleep(delay)
            try:
                resp = await self._http.post(
                    f"{self._base}/api/v1/app-conversations",
                    json=body,
                    headers=self._headers,
                )
                if not resp.is_success:
                    raise OpenHandsError(
                        f"start_conversation failed: {resp.status_code} — {resp.text}"
                    )
                data = resp.json()
                return data["id"]
            except OpenHandsError:
                raise
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_exc = exc
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
                    raise OpenHandsError(
                        f"start_conversation failed: {exc} — {exc.response.text}"
                    ) from exc
        raise OpenHandsError(f"start_conversation failed after retries: {last_exc}") from last_exc

    async def wait_for_ready(
        self,
        task_id: str,
        timeout: int | None = None,
    ) -> dict:
        """Poll start-tasks until READY or ERROR. Returns conversation metadata dict."""
        timeout = timeout or settings.OPENHANDS_START_TASK_TIMEOUT_SECONDS
        deadline = time.monotonic() + timeout
        terminal_ok = {"READY"}
        terminal_err = {"ERROR"}
        while time.monotonic() < deadline:
            resp = await self._http.get(
                f"{self._base}/api/v1/app-conversations/start-tasks",
                params={"ids": task_id},
                headers=self._headers,
            )
            resp.raise_for_status()
            results = resp.json()  # returns a plain array
            if results:
                item = results[0]
                if item is None:
                    await asyncio.sleep(settings.OPENHANDS_POLL_INTERVAL_SECONDS)
                    continue
                status = item.get("status", "")
                if status in terminal_ok:
                    return {
                        "app_conversation_id": item.get("app_conversation_id"),
                        "agent_server_url": item.get("agent_server_url"),
                        "sandbox_id": item.get("sandbox_id"),
                    }
                if status in terminal_err:
                    raise OpenHandsError(
                        f"start task {task_id} reached ERROR: {item.get('detail')}"
                    )
            await asyncio.sleep(settings.OPENHANDS_POLL_INTERVAL_SECONDS)
        raise OpenHandsError(
            f"start task {task_id} did not reach READY within {timeout}s"
        )

    async def get_conversation_status(self, conversation_id: str) -> str:
        """Return the current status string for a conversation (e.g. RUNNING, STOPPED, ERROR)."""
        resp = await self._http.get(
            f"{self._base}/api/v1/app-conversations/{conversation_id}",
            headers=self._headers,
        )
        resp.raise_for_status()
        return resp.json().get("status", "UNKNOWN")

    async def stream_events(
        self,
        conversation_id: str,
        timeout: int | None = None,
    ) -> AsyncGenerator[Optional[dict], None]:
        """
        Cursor-based poll of conversation events.
        Yields event dicts as they arrive, or None as a heartbeat every 30s.
        Stops on action=="finish" or after timeout seconds.
        """
        timeout = timeout or settings.OPENHANDS_CONVERSATION_TIMEOUT_SECONDS
        deadline = time.monotonic() + timeout
        page_id: str | None = None
        last_yield_time = time.monotonic()
        HEARTBEAT_INTERVAL = 30

        while time.monotonic() < deadline:
            params: dict = {"sort_order": "TIMESTAMP", "limit": 50}
            if page_id:
                params["page_id"] = page_id

            resp = await self._http.get(
                f"{self._base}/api/v1/conversation/{conversation_id}/events/search",
                params=params,
                headers=self._headers,
            )
            resp.raise_for_status()
            data = resp.json()
            items = data.get("items", [])
            next_page = data.get("next_page_id")

            if items:
                for item in items:
                    yield item
                    last_yield_time = time.monotonic()
                    kind = item.get("kind", "")
                    # Agent called the finish tool
                    if kind == "ActionEvent":
                        action = item.get("action") or {}
                        if action.get("kind") == "FinishAction":
                            return
                    # Conversation reached a terminal state
                    if kind == "ConversationStateUpdateEvent":
                        if item.get("key") == "status" and item.get("value") in ("STOPPED", "ERROR"):
                            return
                if next_page:
                    page_id = next_page
                    continue  # more pages — fetch immediately

            # No new events — emit heartbeat if needed, then wait
            if time.monotonic() - last_yield_time >= HEARTBEAT_INTERVAL:
                yield None
                last_yield_time = time.monotonic()

            await asyncio.sleep(settings.OPENHANDS_POLL_INTERVAL_SECONDS)

    async def send_message(self, conversation_id: str, text: str) -> None:
        """POST /api/v1/conversations/{id}/pending-messages"""
        resp = await self._http.post(
            f"{self._base}/api/v1/conversations/{conversation_id}/pending-messages",
            json={"content": text},
            headers=self._headers,
        )
        resp.raise_for_status()

    async def health_check(self, timeout: float = 10.0) -> None:
        """Verify OpenHands is reachable. Raises OpenHandsError if not."""
        try:
            resp = await self._http.get(
                f"{self._base}/health",
                headers=self._headers,
                timeout=timeout,
            )
            if not resp.is_success:
                raise OpenHandsError(
                    f"OpenHands health check failed: HTTP {resp.status_code}"
                )
        except httpx.RequestError as exc:
            raise OpenHandsError(
                f"OpenHands unreachable at {self._base}: {exc}"
            ) from exc

    async def close(self) -> None:
        await self._http.aclose()
