# app/graph/services/reports_service.py
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from app.graph.services.state_manager import StateManager

logger = logging.getLogger(__name__)

CORE_PHASES = [
    "Requirements Analysis",
    "Planning",
    "Design",
    "Development",
    "Testing",
    "Deployment"
]

PHASE_COLORS = {
    "Requirements Analysis": "#f43f5e",
    "Planning": "#10b981",
    "Design": "#f59e0b",
    "Development": "#3b82f6",
    "Testing": "#8b5cf6",
    "Deployment": "#06b6d4",
    "Uncategorized": "#94a3b8"
}

class ReportsService:
    def __init__(self):
        self.state_manager = StateManager()

    def _create_phase_stat(self, name: str, count: int, tasks: list = None) -> Dict[str, Any]:
        return {
            "name": name, 
            "value": count, 
            "color": PHASE_COLORS.get(name, PHASE_COLORS["Uncategorized"]),
            "tasks": tasks or []
        }

    def _get_biweekly_sprint_label(self, date_str: Optional[str]) -> Optional[tuple]:
        if not date_str: return None
        try:
            clean_str = date_str.replace("Z", "").split(".")[0]
            dt = datetime.fromisoformat(clean_str)
            year, week, _ = dt.isocalendar()
            biweek_group = ((week - 1) // 2) * 2 + 1
            return (year, biweek_group, f"Sprint {biweek_group}-{biweek_group+1}, {year}")
        except (ValueError, TypeError):
            return None

    def _determine_intelligent_analyzer_phase(self, item: Any) -> str:
        title = ""
        if hasattr(item, 'epic_title'):
            title = getattr(item, 'epic_title', '') or ''
        elif hasattr(item, 'story_title'):
            title = getattr(item, 'story_title', '') or ''
        elif isinstance(item, dict):
            title = item.get('summary', '') or item.get('title', '') or ''
            
        title = str(title).lower()
        if "phase 1" in title or "requirements" in title or "analysis" in title: return "Requirements Analysis"
        elif "phase 2" in title or "planning" in title: return "Planning"
        elif "phase 3" in title or "design" in title: return "Design"
        elif "phase 4" in title or "development" in title or "implementation" in title or "code" in title: return "Development"
        elif "phase 5" in title or "testing" in title or "qa" in title or "test" in title: return "Testing"
        elif "phase 6" in title or "deployment" in title or "release" in title: return "Deployment"
        return "Development" 

    def _get_failure_reason(self, record: Any) -> str:
        if getattr(record, "status", "") != "FAILED": return "None"
        cat = getattr(record, "failure_category", None)
        if cat:
            val = getattr(cat, "value", str(cat)) 
            if val and val != "UNKNOWN": return str(val)
        err = str(getattr(record, 'error_message', '') or '').lower()
        ci_err = str(getattr(record, 'ci_failure_summary', '') or '').lower()
        combined = err + " " + ci_err
        if "timeout" in combined: return "TIMEOUT"
        if "lint" in combined or "ruff" in combined or "flake8" in combined: return "LINT_FAILURE"
        if "test" in combined or "fail" in combined or "assertion" in combined: return "TEST_REGRESSION"
        if "sandbox" in combined or "docker" in combined or "port" in combined: return "INFRA_ERROR"
        if "reject" in combined: return "HITL_REJECTED"
        return "UNKNOWN_ERROR"

    def _map_step_history(self, record: Any, proj_created: str) -> List[Dict[str, str]]:
        history = getattr(record, "status_history", [])
        steps = []
        status_map = {
            "PENDING": "Jira Ticket Parsed",
            "IMPLEMENTING": "OpenHands Agent Implementation",
            "CHECKING": "CI Pipeline (Checking)",
            "FIXING": "CI Pipeline (Fixing)",
            "AWAITING_APPROVAL": "Awaiting Manager Approval",
            "COMPLETED": "Merged & Completed",
            "FAILED": "Pipeline Halted"
        }
        if history:
            for entry in history:
                raw_status = entry.get("status", "") if isinstance(entry, dict) else getattr(entry, "status", "")
                ts = entry.get("timestamp", "Unknown") if isinstance(entry, dict) else getattr(entry, "timestamp", "Unknown")
                step_name = status_map.get(raw_status, raw_status)
                ui_status = "Failed" if raw_status in ["FAILED", "REJECTED"] else ("Pending" if raw_status == "AWAITING_APPROVAL" else "Completed")
                steps.append({"step": str(step_name), "timestamp": str(ts), "status": ui_status})
        else:
            steps.append({"step": "Jira Ticket Parsed", "timestamp": str(proj_created or "Unknown"), "status": "Completed"})
            started = getattr(record, "started_at", None)
            if started: steps.append({"step": "OpenHands Agent Implementation", "timestamp": str(started), "status": "Completed"})
            ci_status = getattr(record, "ci_status", None)
            if ci_status: steps.append({"step": f"CI Pipeline ({ci_status})", "timestamp": str(getattr(record, "completed_at", started) or "Unknown"), "status": "Completed" if ci_status == "PASSING" else "Failed"})
            completed = getattr(record, "completed_at", None)
            status = getattr(record, "status", "PENDING")
            if status == "COMPLETED": steps.append({"step": "Merged & Completed", "timestamp": str(completed or "Unknown"), "status": "Completed"})
            elif status == "FAILED": steps.append({"step": "Pipeline Halted", "timestamp": str(completed or "Unknown"), "status": "Failed"})
            elif status == "AWAITING_APPROVAL": steps.append({"step": "Awaiting Manager Approval", "timestamp": "Now", "status": "Pending"})
        return steps

    def _parse_jira_status_to_metrics(self, ticket: dict) -> str:
        status_str = str(ticket.get("status", "") or ticket.get("state", "")).upper()
        if status_str in ["DONE", "COMPLETE", "COMPLETED", "RESOLVED", "CLOSED", "SUCCESS", "APPLICATION_DEPLOYED"]:
            return "COMPLETED"
        if status_str in ["FAILED", "BLOCKED", "HALTED", "FAIL"]:
            return "FAILED"
        return "PENDING"

    def aggregate_summary_kpis(self, username: str, project_id: Optional[str] = None, preloaded_projects=None) -> Dict[str, Any]:
        all_projects = preloaded_projects if preloaded_projects is not None else self.state_manager.list_projects(username)
        if project_id:
            all_projects = [p for p in all_projects if getattr(p, 'project_id', None) == project_id]

        t_tasks, c_tasks, f_tasks = 0, 0, 0
        t_passed, t_failed, ci_fixes = 0, 0, 0
        
        phase_counts = {phase: 0 for phase in CORE_PHASES}
        phase_task_lists = {phase: [] for phase in CORE_PHASES}
        
        ci_groups = {"0 Tries": [], "1 Loop": [], "2 Loops": [], "3 Loops": [], "4+ Loops": []}

        for p in all_projects:
            proj_name = str(getattr(p, 'project_title', None) or getattr(p, 'name', 'Untitled Project'))
            epics = getattr(p, 'epic_records', []) or []
            raw_tickets = getattr(p, 'raw_jira_tickets', []) or []

            if not epics and raw_tickets:
                for tk in raw_tickets:
                    t_tasks += 1
                    metric_status = self._parse_jira_status_to_metrics(tk)
                    if metric_status == "COMPLETED": c_tasks += 1
                    elif metric_status == "FAILED": f_tasks += 1
                    phase = self._determine_intelligent_analyzer_phase(tk)
                    phase_counts[phase] += 1
                    phase_task_lists[phase].append({
                        "id": str(tk.get("key") or tk.get("id") or "TASK"),
                        "title": str(tk.get("summary") or tk.get("title") or "Untitled Task"),
                        "project": proj_name, "attempts": 0, "reason": "Backlog", "status": metric_status
                    })
                continue

            for epic in epics:
                stories = getattr(epic, 'story_records', []) or []
                
                # Fallback to Epic level fields if Story array is empty
                items_to_scan = stories if len(stories) > 0 else [epic]

                for item in items_to_scan:
                    t_tasks += 1
                    metric_status = str(getattr(item, "status", "PENDING")).upper()
                    
                    if metric_status == "COMPLETED": c_tasks += 1
                    elif metric_status == "FAILED": f_tasks += 1
                    
                    t_passed += getattr(item, "tests_passed", None) or 0
                    t_failed += getattr(item, "tests_failed", None) or 0
                    fixes = getattr(item, "ci_fix_attempts", 0) or 0
                    ci_fixes += fixes

                    t_id = str(getattr(item, "story_id", None) or getattr(item, "epic_id", "Unknown"))
                    t_title = str(getattr(item, "story_title", None) or getattr(item, "epic_title", "Unknown"))
                    reason_text = getattr(item, "ci_failure_summary", None) or getattr(item, "error_message", None) or "None"

                    task_meta = {
                        "id": t_id, "title": t_title, "project": proj_name,
                        "attempts": fixes, "reason": reason_text, "status": metric_status
                    }

                    if fixes == 0: ci_groups["0 Tries"].append(task_meta)
                    elif fixes == 1: ci_groups["1 Loop"].append(task_meta)
                    elif fixes == 2: ci_groups["2 Loops"].append(task_meta)
                    elif fixes == 3: ci_groups["3 Loops"].append(task_meta)
                    else: ci_groups["4+ Loops"].append(task_meta)

                    phase = self._determine_intelligent_analyzer_phase(item)
                    phase_counts[phase] = phase_counts.get(phase, 0) + 1
                    phase_task_lists[phase].append(task_meta)

        total_tests = t_passed + t_failed
        
        ci_distribution = [
            {"rounds": "0 try", "count": len(ci_groups["0 Tries"]), "tasks": ci_groups["0 Tries"], "color": "#10b981"},
            {"rounds": "1 loop", "count": len(ci_groups["1 Loop"]), "tasks": ci_groups["1 Loop"], "color": "#3b82f6"},
            {"rounds": "2 loops", "count": len(ci_groups["2 Loops"]), "tasks": ci_groups["2 Loops"], "color": "#f59e0b"},
            {"rounds": "3 loops", "count": len(ci_groups["3 Loops"]), "tasks": ci_groups["3 Loops"], "color": "#a855f7"},
            {"rounds": "4+ loops", "count": len(ci_groups["4+ Loops"]), "tasks": ci_groups["4+ Loops"], "color": "#ef4444"}
        ]

        return {
            "summary": {
                "total_projects": len(all_projects),
                "total_tasks": t_tasks,
                "completed_tasks": c_tasks,
                "failed_tasks": f_tasks,
                "completion_rate": round((c_tasks / t_tasks * 100), 2) if t_tasks > 0 else 0.0,
                "weekly_project_delta": f"+0 this week",
                "phase_stats": [self._create_phase_stat(p, phase_counts[p], phase_task_lists[p]) for p in CORE_PHASES],
                "ci_rounds_distribution": ci_distribution
            },
            "quality_data": {
                "test_pass_rate": round((t_passed / total_tests * 100), 1) if total_tests > 0 else 0.0,
                "total_ci_fixes": ci_fixes,
                "total_tests_run": total_tests
            }
        }

    def aggregate_team_stats(self, username: str, preloaded_projects=None) -> List[Dict[str, Any]]:
        projects = preloaded_projects if preloaded_projects is not None else self.state_manager.list_projects(username)
        team_stats = {}
        for p in projects:
            assignee = str((getattr(p, 'assignee_user', None) or {}).get('name') or getattr(p, 'username', None) or "Unassigned")
            proj_date = getattr(p, 'project_created_at', None)

            if assignee not in team_stats:
                team_stats[assignee] = {"name": assignee, "completed": 0, "pending": 0, "failed": 0, "total": 0, "phase_counts": {ph: 0 for ph in CORE_PHASES}, "raw_sprints": {}}
            
            epics = getattr(p, 'epic_records', []) or []
            raw_tickets = getattr(p, 'raw_jira_tickets', []) or []
            
            if not epics:
                for tk in raw_tickets:
                    team_stats[assignee]["total"] += 1
                    status = self._parse_jira_status_to_metrics(tk)
                    if status == "COMPLETED": team_stats[assignee]["completed"] += 1
                    elif status == "FAILED": team_stats[assignee]["failed"] += 1
                    else: team_stats[assignee]["pending"] += 1
                continue

            for epic in epics:
                stories = getattr(epic, 'story_records', []) or []
                items_to_scan = stories if len(stories) > 0 else [epic]

                for item in items_to_scan:
                    team_stats[assignee]["total"] += 1
                    metric_status = str(getattr(item, "status", "PENDING")).upper()
                    
                    if metric_status == "COMPLETED": team_stats[assignee]["completed"] += 1
                    elif metric_status == "FAILED": team_stats[assignee]["failed"] += 1
                    else: team_stats[assignee]["pending"] += 1

                    phase = self._determine_intelligent_analyzer_phase(item)
                    if phase in team_stats[assignee]["phase_counts"]:
                        team_stats[assignee]["phase_counts"][phase] += 1

                    date = getattr(item, "completed_at", None) or proj_date
                    meta = self._get_biweekly_sprint_label(date)
                    if meta:
                        key = (meta[0], meta[1], meta[2])
                        if key not in team_stats[assignee]["raw_sprints"]:
                            team_stats[assignee]["raw_sprints"][key] = {"total": 0, "completed": 0, "failed": 0}
                        team_stats[assignee]["raw_sprints"][key]["total"] += 1
                        if metric_status == "COMPLETED": team_stats[assignee]["raw_sprints"][key]["completed"] += 1
                        elif metric_status == "FAILED": team_stats[assignee]["raw_sprints"][key]["failed"] += 1

        for member in team_stats.values():
            member['success_rate'] = round((member['completed'] / member['total'] * 100), 1) if member['total'] > 0 else 0.0
            p_dict = member.pop("phase_counts", {})
            member['phase_breakdown'] = [self._create_phase_stat(x, p_dict.get(x, 0)) for x in CORE_PHASES]
            
            raw_sprints = member.pop("raw_sprints", {})
            timeline = []
            if raw_sprints:
                sorted_keys = sorted(raw_sprints.keys(), key=lambda k: (k[0], k[1]))
                prev_comp, prev_rate = 0, 0.0
                for key in sorted_keys:
                    tot = raw_sprints[key]["total"]
                    comp = raw_sprints[key]["completed"]
                    failed = raw_sprints[key]["failed"]
                    pending = tot - comp - failed
                    rate = round((comp / tot * 100), 1) if tot > 0 else 0.0
                    timeline.append({
                        "month": str(key[2]), "total": tot, "completed": comp, "behind": pending, 
                        "completion_rate": rate, "prev_week_completed": prev_comp, "prev_week_rate": prev_rate
                    })
                    prev_comp, prev_rate = comp, rate
            member['biweekly_sprints'] = timeline

        return sorted(list(team_stats.values()), key=lambda x: x['completed'], reverse=True)

    def aggregate_project_summaries(self, username: str, project_id: Optional[str] = None, preloaded_projects=None) -> List[Dict[str, Any]]:
        projects = preloaded_projects if preloaded_projects is not None else self.state_manager.list_projects(username)
        if project_id: projects = [p for p in projects if getattr(p, 'project_id', None) == project_id]
        
        summaries = []
        for p in projects:
            epics = getattr(p, 'epic_records', []) or []
            raw_tickets = getattr(p, 'raw_jira_tickets', []) or []
            
            selected_ids = getattr(p, 'selected_ticket_ids', []) or []
            implementation_ids = getattr(p, 'implementation_ticket_ids', []) or []
            
            assignee = str((getattr(p, 'assignee_user', None) or {}).get('name') or getattr(p, 'username', None) or "Unassigned")
            proj_created = getattr(p, 'project_created_at', None)
            
            p_phase = {ph: 0 for ph in CORE_PHASES}
            total_completed, total_failed, total_pending = 0, 0, 0
            t_passed, t_failed, ci_fixes = 0, 0, 0 
            
            project_ci_groups = {"0 Tries": [], "1 Loop": [], "2 Loops": [], "3 Loops": [], "4+ Loops": []}

            for epic in epics:
                stories = getattr(epic, 'story_records', []) or []
                items_to_scan = stories if len(stories) > 0 else [epic]

                for item in items_to_scan:
                    phase = self._determine_intelligent_analyzer_phase(item)
                    m_status = str(getattr(item, "status", "PENDING")).upper()
                    
                    if phase in p_phase: p_phase[phase] += 1
                    if m_status == "COMPLETED": total_completed += 1
                    elif m_status == "FAILED": total_failed += 1
                    else: total_pending += 1

                    t_passed += getattr(item, "tests_passed", None) or 0
                    t_failed += getattr(item, "tests_failed", None) or 0
                    fixes = getattr(item, "ci_fix_attempts", 0) or 0
                    ci_fixes += fixes

                    t_id = str(getattr(item, "story_id", None) or getattr(item, "epic_id", "Unknown"))
                    t_title = str(getattr(item, "story_title", None) or getattr(item, "epic_title", "Unknown"))
                    reason_text = getattr(item, "ci_failure_summary", None) or getattr(item, "error_message", None) or "None"

                    proj_task_meta = {
                        "id": t_id, "title": t_title, "project": str(getattr(p, 'project_title', None) or p.project_id),
                        "attempts": fixes, "reason": reason_text, "status": m_status
                    }

                    if fixes == 0: project_ci_groups["0 Tries"].append(proj_task_meta)
                    elif fixes == 1: project_ci_groups["1 Loop"].append(proj_task_meta)
                    elif fixes == 2: project_ci_groups["2 Loops"].append(proj_task_meta)
                    elif fixes == 3: project_ci_groups["3 Loops"].append(proj_task_meta)
                    else: project_ci_groups["4+ Loops"].append(proj_task_meta)

            # Build Folder Tree Map Hierarchy targeting Epic Records -> Story Records
            tree_nodes = []
            for epic in epics:
                e_id = str(getattr(epic, "epic_id", "Unknown"))
                stories = getattr(epic, "story_records", []) or []
                
                story_nodes = []
                for s in stories:
                    s_id = str(s.story_id)
                    s_status = str(s.status).upper()
                    if s_id in implementation_ids and s_status == "PENDING": s_status = "IMPLEMENTING"
                    elif s_id in selected_ids and s_status == "PENDING": s_status = "SELECTED"

                    story_nodes.append({
                        "id": s_id,
                        "title": str(s.story_title),
                        "status": s_status,
                        "tasks": [{
                            "id": f"TSK-{s_id}",
                            "title": "Automated Code Synthesis Run",
                            "status": s_status
                        }]
                    })

                if not story_nodes:
                    epic_status = str(epic.status).upper()
                    story_nodes.append({
                        "id": f"STRY-{e_id}",
                        "title": "Default Epic Process Strategy Requirements Canvas",
                        "status": epic_status,
                        "tasks": [{"id": f"TSK-{e_id}", "title": "Core Module Engine Pipeline", "status": epic_status}]
                    })

                tree_nodes.append({
                    "epic_id": e_id,
                    "title": str(epic.epic_title),
                    "status": str(epic.status).upper(),
                    "failure_reason": self._get_failure_reason(epic),
                    "steps": self._map_step_history(epic, proj_created or "Unknown"),
                    "stories": story_nodes
                })

            if not epics and raw_tickets:
                for tk in raw_tickets:
                    m_status = self._parse_jira_status_to_metrics(tk)
                    if m_status == "COMPLETED": total_completed += 1
                    elif m_status == "FAILED": total_failed += 1
                    else: total_pending += 1
                    phase = self._determine_intelligent_analyzer_phase(tk)
                    if phase in p_phase: p_phase[phase] += 1

                tree_nodes.append({
                    "epic_id": "JIRA-BOARD-SCOPE",
                    "title": "Ingested Jira Sprint Board Backlog Stream",
                    "status": "PENDING", "failure_reason": "None", "steps": [],
                    "stories": [{
                        "id": "STORY-LAYER", "title": "Board Requirements Canvas", "status": "PENDING",
                        "tasks": [{"id": str(tk.get("key") or tk.get("id") or "TASK"), "title": str(tk.get("summary") or "Requirement Node"), "status": self._parse_jira_status_to_metrics(tk)} for tk in raw_tickets]
                    }]
                })

            total_tasks_count = total_completed + total_pending + total_failed
            total_tests = t_passed + t_failed

            project_ci_distribution = [
                {"rounds": "0 try", "count": len(project_ci_groups["0 Tries"]), "tasks": project_ci_groups["0 Tries"], "color": "#10b981"},
                {"rounds": "1 loop", "count": len(project_ci_groups["1 Loop"]), "tasks": project_ci_groups["1 Loop"], "color": "#3b82f6"},
                {"rounds": "2 loops", "count": len(project_ci_groups["2 Loops"]), "tasks": project_ci_groups["2 Loops"], "color": "#f59e0b"},
                {"rounds": "3 loops", "count": len(project_ci_groups["3 Loops"]), "tasks": project_ci_groups["3 Loops"], "color": "#a855f7"},
                {"rounds": "4+ loops", "count": len(project_ci_groups["4+ Loops"]), "tasks": project_ci_groups["4+ Loops"], "color": "#ef4444"}
            ]

            summaries.append({
                "project_id": str(getattr(p, 'project_id', 'unknown_id')),
                "project_name": str(getattr(p, 'project_title', None) or getattr(p, 'name', 'Untitled Project')),
                "project_description": str(getattr(p, 'project_description', None) or 'No descriptive context overview configured for this active pipeline repository profile instance.'),
                "assignee": assignee,
                "created_at": str(p.project_created_at or "2026-01-01T00:00:00Z"), 
                "total_tasks": total_tasks_count,
                "epic_count": len(tree_nodes),  
                "completed_epics": total_completed,  
                "pending_epics": total_pending, 
                "completed": total_completed,
                "pending": total_pending,
                "failed": total_failed,
                "success_rate": round((total_completed / total_tasks_count * 100), 1) if total_tasks_count > 0 else 0.0,
                "phase_breakdown": [self._create_phase_stat(x, p_phase.get(x, 0)) for x in CORE_PHASES],
                "test_pass_rate": round((t_passed / total_tests * 100), 1) if total_tests > 0 else 0.0,
                "total_ci_fixes": ci_fixes,
                "total_tests_run": total_tests,
                "epics_detail": tree_nodes,
                "github_repo": str(getattr(p, "github_repo", "") or "Not Connected"),
                "github_branch": str(getattr(p, "github_branch", "main")),
                "selected_count": len(selected_ids),
                "implementation_count": len(implementation_ids),
                "ci_rounds_distribution": project_ci_distribution
            })
        
        return summaries

    def aggregate_biweekly_timeline(self, username: str, project_id: Optional[str] = None, preloaded_projects=None) -> List[Dict[str, Any]]:
        projects = preloaded_projects if preloaded_projects is not None else self.state_manager.list_projects(username)
        if project_id: projects = [p for p in projects if getattr(p, 'project_id', None) == project_id]

        raw_data = {}
        for p in projects:
            proj_date = getattr(p, 'project_created_at', None)
            epics = getattr(p, 'epic_records', []) or []
            raw_tickets = getattr(p, 'raw_jira_tickets', []) or []
            
            if not epics:
                for item in raw_tickets:
                    meta = self._get_biweekly_sprint_label(proj_date)
                    if meta:
                        key = (meta[0], meta[1], meta[2])
                        if key not in raw_data: raw_data[key] = {"total": 0, "completed": 0, "failed": 0}
                        raw_data[key]["total"] += 1
                        if self._parse_jira_status_to_metrics(item) == "COMPLETED": raw_data[key]["completed"] += 1
                continue

            for epic in epics:
                stories = getattr(epic, 'story_records', []) or []
                items_to_scan = stories if len(stories) > 0 else [epic]

                for item in items_to_scan:
                    date = getattr(item, "completed_at", None) or proj_date
                    meta = self._get_biweekly_sprint_label(date)
                    if meta:
                        key = (meta[0], meta[1], meta[2])
                        if key not in raw_data: raw_data[key] = {"total": 0, "completed": 0, "failed": 0}
                        raw_data[key]["total"] += 1
                        status = str(getattr(item, "status", "PENDING")).upper()
                        if status == "COMPLETED":
                            raw_data[key]["completed"] += 1
                        elif status == "FAILED":
                            raw_data[key]["failed"] += 1

        timeline = []
        if raw_data:
            sorted_keys = sorted(raw_data.keys(), key=lambda k: (k[0], k[1]))
            prev_comp, prev_rate, prev_tot = 0, 0.0, 0
            for key in sorted_keys:
                tot = raw_data[key]["total"]
                comp = raw_data[key]["completed"]
                failed = raw_data[key]["failed"]
                pending = tot - comp - failed
                rate = round((comp / tot * 100), 1) if tot > 0 else 0.0
                timeline.append({
                    "month": str(key[2]), "total": tot, "completed": comp, "behind": pending,
                    "completion_rate": rate, "prev_week_completed": prev_comp, "prev_week_rate": prev_rate,
                    "prev_week_total": prev_tot 
                })
                prev_comp, prev_rate, prev_tot = comp, rate, tot
        return timeline