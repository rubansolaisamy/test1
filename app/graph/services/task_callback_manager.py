"""Async event registry for structured task-completion callbacks from OpenHands.

OpenHands POSTs a JSON completion report to /pipeline/task-callback/{project_id}/{epic_index}
when PhaseCompletionCallbackProcessor fires. This module bridges that HTTP callback to the
orchestrator coroutine waiting inside the event-streaming loop.

Token format: "{project_id}/{epic_index}"
"""
import asyncio
from typing import Dict, Optional

_results: Dict[str, dict] = {}
_events: Dict[str, asyncio.Event] = {}


def register(token: str) -> asyncio.Event:
    """Create an event for this token. Returns the event the orchestrator can await."""
    ev = asyncio.Event()
    _events[token] = ev
    return ev


def resolve(token: str, result: dict) -> None:
    """Store callback result and signal any waiting coroutine."""
    _results[token] = result
    if token in _events:
        _events[token].set()


def get_result(token: str) -> Optional[dict]:
    return _results.get(token)


def cleanup(token: str) -> None:
    _results.pop(token, None)
    _events.pop(token, None)
