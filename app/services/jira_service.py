"""
Jira Service - Handles fetching Jira projects and boards for user configuration.
"""
import logging
from typing import List, Dict, Any, Optional
from requests.auth import HTTPBasicAuth
import requests

logger = logging.getLogger(__name__)


class JiraService:
    """Service for interacting with Jira API."""
    
    def __init__(self, base_url: str, email: str, api_token: str):
        """
        Initialize Jira service with credentials.
        
        Args:
            base_url: Jira instance base URL (e.g., https://your-domain.atlassian.net)
            email: User email for authentication
            api_token: Jira API token
        """
        self.base_url = base_url.rstrip("/")
        self.auth = HTTPBasicAuth(email, api_token)
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
    
    def test_connection(self) -> tuple[bool, str]:
        """
        Test the Jira connection with provided credentials.
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/myself",
                auth=self.auth,
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                user_data = response.json()
                return True, f"Connected successfully as {user_data.get('displayName', 'Unknown')}"
            elif response.status_code == 401:
                return False, "Authentication failed. Please check your email and API token."
            else:
                return False, f"Connection failed with status code: {response.status_code}"
                
        except requests.exceptions.Timeout:
            return False, "Connection timed out. Please check your Jira URL."
        except requests.exceptions.ConnectionError:
            return False, "Could not connect to Jira. Please check your base URL."
        except Exception as e:
            logger.error(f"Jira connection test failed: {e}")
            return False, f"Connection test failed: {str(e)}"
    
    def get_projects(self) -> List[Dict[str, Any]]:
        """
        Fetch all accessible Jira projects for the authenticated user.
        
        Returns:
            List of project dictionaries with id, key, name, and description
        """
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/project/search",
                auth=self.auth,
                headers=self.headers,
                params={"expand": "description,lead", "maxResults": 100},
                timeout=15
            )
            response.raise_for_status()
            
            projects_data = response.json()
            projects = []
            
            for project in projects_data.get("values", []):
                projects.append({
                    "id": project.get("id"),
                    "key": project.get("key"),
                    "name": project.get("name"),
                    "description": project.get("description", ""),
                    "project_type": project.get("projectTypeKey", ""),
                    "lead": project.get("lead", {}).get("displayName", ""),
                })
            
            logger.info(f"Retrieved {len(projects)} Jira projects")
            return projects
            
        except requests.exceptions.HTTPError as e:
            logger.error(f"Failed to fetch Jira projects: {e}")
            raise ValueError(f"Failed to fetch projects: {e.response.status_code}")
        except Exception as e:
            logger.error(f"Error fetching Jira projects: {e}")
            raise
    
    def get_project_details(self, project_key: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a specific Jira project.
        
        Args:
            project_key: Jira project key (e.g., "PHOE")
            
        Returns:
            Project details dictionary or None if not found
        """
        try:
            response = requests.get(
                f"{self.base_url}/rest/api/3/project/{project_key}",
                auth=self.auth,
                headers=self.headers,
                timeout=15
            )
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            project = response.json()
            
            return {
                "id": project.get("id"),
                "key": project.get("key"),
                "name": project.get("name"),
                "description": project.get("description", ""),
                "project_type": project.get("projectTypeKey", ""),
                "url": project.get("self", ""),
            }
            
        except Exception as e:
            logger.error(f"Error fetching project details for {project_key}: {e}")
            raise
    
    def get_boards(self, project_key: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Fetch Jira boards (optional: filter by project).
        
        Args:
            project_key: Optional project key to filter boards
            
        Returns:
            List of board dictionaries
        """
        try:
            params = {"maxResults": 50}
            if project_key:
                params["projectKeyOrId"] = project_key
            
            response = requests.get(
                f"{self.base_url}/rest/agile/1.0/board",
                auth=self.auth,
                headers=self.headers,
                params=params,
                timeout=15
            )
            response.raise_for_status()
            
            boards_data = response.json()
            boards = []
            
            for board in boards_data.get("values", []):
                boards.append({
                    "id": board.get("id"),
                    "name": board.get("name"),
                    "type": board.get("type"),
                    "project_key": board.get("location", {}).get("projectKey", ""),
                })
            
            logger.info(f"Retrieved {len(boards)} Jira boards")
            return boards
            
        except Exception as e:
            logger.error(f"Error fetching Jira boards: {e}")
            raise
