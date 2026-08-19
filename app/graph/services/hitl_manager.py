import asyncio
from typing import Dict, Set

_hitl_events: Dict[str, asyncio.Event] = {}
_running_pipelines: Set[str] = set()


def register_hitl(token: str) -> asyncio.Event:
    event = asyncio.Event()
    _hitl_events[token] = event
    return event


def resolve_hitl(token: str) -> None:
    event = _hitl_events.get(token)
    if event:
        event.set()
        _hitl_events.pop(token, None)


def is_pipeline_running(project_id: str) -> bool:
    return project_id in _running_pipelines


def mark_pipeline_running(project_id: str) -> None:
    _running_pipelines.add(project_id)


def mark_pipeline_done(project_id: str) -> None:
    _running_pipelines.discard(project_id)
