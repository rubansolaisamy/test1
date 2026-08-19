"""
GitHub Service - Handles GitHub repository operations (list, create, search).
Supports both personal and organization-level repositories for enterprise use.
"""
import logging
from typing import List, Dict, Any, Optional
import requests

logger = logging.getLogger(__name__)


class GitHubService:
    """Service for interacting with GitHub API."""
    
    def __init__(self, github_token: str):
        """
        Initialize GitHub service with authentication token.
        
        Args:
            github_token: GitHub personal access token
        """
        self.token = github_token
        self.headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json",
        }
        self.base_url = "https://api.github.com"
    
    def test_connection(self) -> tuple[bool, str]:
        """
        Test GitHub connection and get authenticated user information.
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            response = requests.get(
                f"{self.base_url}/user",
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code == 200:
                user_data = response.json()
                username = user_data.get("login", "Unknown")
                return True, f"Connected successfully as {username}"
            elif response.status_code == 401:
                return False, "Authentication failed. Please check your GitHub token."
            else:
                return False, f"Connection failed with status code: {response.status_code}"
                
        except requests.exceptions.Timeout:
            return False, "Connection timed out. Please check your network."
        except requests.exceptions.ConnectionError:
            return False, "Could not connect to GitHub API."
        except Exception as e:
            logger.error(f"GitHub connection test failed: {e}")
            return False, f"Connection test failed: {str(e)}"
    
    def get_authenticated_user(self) -> Dict[str, Any]:
        """
        Get authenticated user information.
        
        Returns:
            User information dictionary
        """
        try:
            response = requests.get(
                f"{self.base_url}/user",
                headers=self.headers,
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to get user info: {e}")
            raise
    
    def get_user_repos(self, include_orgs: bool = True, per_page: int = 100) -> List[Dict[str, Any]]:
        """
        Get all repositories accessible to the authenticated user.
        Includes personal and organization repositories.
        
        Args:
            include_orgs: Include organization repositories
            per_page: Number of results per page (max 100)
            
        Returns:
            List of repository dictionaries
        """
        repos = []
        
        try:
            # Get personal and member repositories
            page = 1
            while True:
                response = requests.get(
                    f"{self.base_url}/user/repos",
                    headers=self.headers,
                    params={
                        "visibility": "all",
                        "affiliation": "owner,collaborator,organization_member",
                        "per_page": per_page,
                        "page": page,
                        "sort": "updated",
                    },
                    timeout=15
                )
                response.raise_for_status()
                
                batch = response.json()
                if not batch:
                    break
                
                for repo in batch:
                    repos.append(self._format_repo(repo))
                
                # Check if there are more pages
                if len(batch) < per_page:
                    break
                page += 1
            
            logger.info(f"Retrieved {len(repos)} GitHub repositories")
            return repos
            
        except Exception as e:
            logger.error(f"Error fetching GitHub repos: {e}")
            raise
    
    def get_organizations(self) -> List[Dict[str, Any]]:
        """
        Get all organizations the authenticated user belongs to.
        
        Returns:
            List of organization dictionaries
        """
        try:
            response = requests.get(
                f"{self.base_url}/user/orgs",
                headers=self.headers,
                timeout=10
            )
            response.raise_for_status()
            
            orgs = []
            for org in response.json():
                orgs.append({
                    "login": org.get("login"),
                    "name": org.get("name", org.get("login")),
                    "description": org.get("description", ""),
                    "avatar_url": org.get("avatar_url"),
                })
            
            logger.info(f"Retrieved {len(orgs)} organizations")
            return orgs
            
        except Exception as e:
            logger.error(f"Error fetching organizations: {e}")
            raise
    
    def get_org_repos(self, org_name: str) -> List[Dict[str, Any]]:
        """
        Get all repositories for a specific organization.
        
        Args:
            org_name: Organization name/login
            
        Returns:
            List of repository dictionaries
        """
        repos = []
        
        try:
            page = 1
            while True:
                response = requests.get(
                    f"{self.base_url}/orgs/{org_name}/repos",
                    headers=self.headers,
                    params={"per_page": 100, "page": page},
                    timeout=15
                )
                response.raise_for_status()
                
                batch = response.json()
                if not batch:
                    break
                
                for repo in batch:
                    repos.append(self._format_repo(repo))
                
                if len(batch) < 100:
                    break
                page += 1
            
            logger.info(f"Retrieved {len(repos)} repos from org {org_name}")
            return repos
            
        except Exception as e:
            logger.error(f"Error fetching org repos for {org_name}: {e}")
            raise
    
    def create_repo(
        self, 
        name: str, 
        description: str = "", 
        private: bool = True,
        org_name: Optional[str] = None,
        auto_init: bool = True
    ) -> Dict[str, Any]:
        """
        Create a new GitHub repository (personal or organization).
        
        Args:
            name: Repository name
            description: Repository description
            private: Make repository private
            org_name: Organization name (if creating in org)
            auto_init: Initialize with README
            
        Returns:
            Created repository information
        """
        try:
            # Determine API endpoint
            if org_name:
                url = f"{self.base_url}/orgs/{org_name}/repos"
            else:
                url = f"{self.base_url}/user/repos"
            
            payload = {
                "name": name,
                "description": description,
                "private": private,
                "auto_init": auto_init,
            }
            
            response = requests.post(
                url,
                headers=self.headers,
                json=payload,
                timeout=15
            )
            response.raise_for_status()
            
            repo = response.json()
            logger.info(f"Created repository: {repo.get('full_name')}")
            return self._format_repo(repo)
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 422:
                raise ValueError(f"Repository '{name}' already exists or name is invalid")
            logger.error(f"Failed to create repository: {e}")
            raise
        except Exception as e:
            logger.error(f"Error creating repository: {e}")
            raise
    
    def search_repos(self, query: str, per_page: int = 30) -> List[Dict[str, Any]]:
        """
        Search for repositories accessible to the user.
        
        Args:
            query: Search query
            per_page: Number of results per page
            
        Returns:
            List of matching repositories
        """
        try:
            response = requests.get(
                f"{self.base_url}/search/repositories",
                headers=self.headers,
                params={"q": f"{query} user:@me", "per_page": per_page},
                timeout=15
            )
            response.raise_for_status()
            
            results = response.json()
            repos = [self._format_repo(repo) for repo in results.get("items", [])]
            
            logger.info(f"Found {len(repos)} repos matching '{query}'")
            return repos
            
        except Exception as e:
            logger.error(f"Error searching repos: {e}")
            raise
    
    def get_repo_details(self, owner: str, repo: str) -> Dict[str, Any]:
        """
        Get details of a specific repository.
        
        Args:
            owner: Repository owner (user or org)
            repo: Repository name
            
        Returns:
            Repository details
        """
        try:
            response = requests.get(
                f"{self.base_url}/repos/{owner}/{repo}",
                headers=self.headers,
                timeout=10
            )
            response.raise_for_status()
            
            return self._format_repo(response.json())
            
        except Exception as e:
            logger.error(f"Error fetching repo details for {owner}/{repo}: {e}")
            raise
    
    def _format_repo(self, repo: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format repository data into a consistent structure.
        
        Args:
            repo: Raw repository data from GitHub API
            
        Returns:
            Formatted repository dictionary
        """
        return {
            "id": repo.get("id"),
            "name": repo.get("name"),
            "full_name": repo.get("full_name"),
            "description": repo.get("description", ""),
            "private": repo.get("private", False),
            "html_url": repo.get("html_url"),
            "clone_url": repo.get("clone_url"),
            "default_branch": repo.get("default_branch", "main"),
            "owner": {
                "login": repo.get("owner", {}).get("login"),
                "type": repo.get("owner", {}).get("type"),  # "User" or "Organization"
            },
            "language": repo.get("language"),
            "created_at": repo.get("created_at"),
            "updated_at": repo.get("updated_at"),
            "pushed_at": repo.get("pushed_at"),
        }
