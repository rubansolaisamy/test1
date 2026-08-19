"""
Minimal Jira service stub — provides only the two methods needed by the orchestrator
(transition_issue, add_comment). The full service with ticket creation is ported
as part of the Jira implementation work.
"""
import logging
from requests.auth import HTTPBasicAuth
import requests

from app.core.config import settings

logger = logging.getLogger(__name__)


class JiraIssueService:
    def __init__(self):
        self.base_url = settings.JIRA_BASE_URL.rstrip("/")
        self.auth = HTTPBasicAuth(settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def transition_issue(self, issue_key: str, transition_name: str) -> bool:
        """Transition a Jira issue to the named status (e.g. 'Done')."""
        try:
            # Fetch available transitions
            resp = requests.get(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
                auth=self.auth,
                headers=self.headers,
                timeout=15,
            )
            resp.raise_for_status()
            transitions = resp.json().get("transitions", [])
            target = next(
                (t for t in transitions if t["name"].lower() == transition_name.lower()),
                None,
            )
            if not target:
                logger.warning("Transition '%s' not found for %s", transition_name, issue_key)
                return False

            resp = requests.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
                auth=self.auth,
                headers=self.headers,
                json={"transition": {"id": target["id"]}},
                timeout=15,
            )
            resp.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("Failed to transition %s: %s", issue_key, exc)
            return False

    def add_comment(self, issue_key: str, body: str) -> bool:
        """Add a plain-text comment to a Jira issue."""
        try:
            payload = {
                "body": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": body}],
                        }
                    ],
                }
            }
            resp = requests.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/comment",
                auth=self.auth,
                headers=self.headers,
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("Failed to add comment to %s: %s", issue_key, exc)
            return False
