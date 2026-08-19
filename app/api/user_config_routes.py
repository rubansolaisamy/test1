from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.graph.state import UserConfiguration
from app.graph.services.state_manager import StateManager
from app.services.user_config_service import UserConfigService
from app.services.jira_service import JiraService
from app.services.github_service import GitHubService

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter()


def _mask_token(token: str) -> str:
    """Mask sensitive token for display (show first 4 and last 4 characters)."""
    if not token or len(token) < 8:
        return "****"
    return f"{token[:4]}...{token[-4:]}"


class UserConfigRequest(BaseModel):
    """Request model for creating/updating user configuration."""
    jira_base_url: str
    jira_email: str
    jira_api_token: str
    github_token: str
    github_username: Optional[str] = None
    github_default_branch: str = "main"


class CreateRepoRequest(BaseModel):
    """Request model for creating a GitHub repository."""
    name: str
    description: str = ""
    private: bool = True
    org_name: Optional[str] = None
    auto_init: bool = True


# ---------------------------------------------------------------------------
# User Configuration Endpoints
# ---------------------------------------------------------------------------

@router.get("/users/{username}/config", tags=["User Configuration"])
async def get_user_configuration(username: str):
    """Get user configuration (Jira and GitHub credentials)."""
    try:
        config_service = UserConfigService()
        config = config_service.get_user_config(username)

        if not config:
            raise HTTPException(status_code=404, detail="User configuration not found")

        # Return config with masked tokens for security
        config_dict = config.model_dump()
        config_dict["jira_api_token"] = _mask_token(config.jira_api_token)
        config_dict["github_token"] = _mask_token(config.github_token)

        return config_dict

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve configuration: {str(e)}")


@router.get("/users/{username}/config/exists", tags=["User Configuration"])
async def check_user_config_exists(username: str):
    """Check if user has configuration set up."""
    try:
        config_service = UserConfigService()
        exists = config_service.config_exists(username)
        return {"exists": exists, "username": username}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check configuration: {str(e)}")


@router.post("/users/{username}/config", tags=["User Configuration"])
async def create_user_configuration(username: str, body: UserConfigRequest):
    """Create new user configuration."""
    try:
        # Test connections before saving
        jira_service = JiraService(body.jira_base_url, body.jira_email, body.jira_api_token)
        jira_success, jira_msg = jira_service.test_connection()
        if not jira_success:
            raise HTTPException(status_code=400, detail=f"Jira connection failed: {jira_msg}")

        github_service = GitHubService(body.github_token)
        github_success, github_msg = github_service.test_connection()
        if not github_success:
            raise HTTPException(status_code=400, detail=f"GitHub connection failed: {github_msg}")

        # Get GitHub username if not provided
        github_username = body.github_username
        if not github_username:
            user_data = github_service.get_authenticated_user()
            github_username = user_data.get("login")

        # Create configuration
        config = UserConfiguration(
            username=username,
            jira_base_url=body.jira_base_url,
            jira_email=body.jira_email,
            jira_api_token=body.jira_api_token,
            github_token=body.github_token,
            github_username=github_username,
            github_default_branch=body.github_default_branch,
        )

        config_service = UserConfigService()
        saved_config = config_service.save_user_config(config)

        # Return with masked tokens
        config_dict = saved_config.model_dump()
        config_dict["jira_api_token"] = _mask_token(saved_config.jira_api_token)
        config_dict["github_token"] = _mask_token(saved_config.github_token)

        return config_dict

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create configuration: {str(e)}")


@router.put("/users/{username}/config", tags=["User Configuration"])
async def update_user_configuration(username: str, body: UserConfigRequest):
    """Update existing user configuration."""
    try:
        # Test new connections
        jira_service = JiraService(body.jira_base_url, body.jira_email, body.jira_api_token)
        jira_success, jira_msg = jira_service.test_connection()
        if not jira_success:
            raise HTTPException(status_code=400, detail=f"Jira connection failed: {jira_msg}")

        github_service = GitHubService(body.github_token)
        github_success, github_msg = github_service.test_connection()
        if not github_success:
            raise HTTPException(status_code=400, detail=f"GitHub connection failed: {github_msg}")

        # Get GitHub username if not provided
        github_username = body.github_username
        if not github_username:
            user_data = github_service.get_authenticated_user()
            github_username = user_data.get("login")

        # Update configuration
        config_service = UserConfigService()
        updates = {
            "jira_base_url": body.jira_base_url,
            "jira_email": body.jira_email,
            "jira_api_token": body.jira_api_token,
            "github_token": body.github_token,
            "github_username": github_username,
            "github_default_branch": body.github_default_branch,
        }
        updated_config = config_service.update_user_config(username, updates)

        # Return with masked tokens
        config_dict = updated_config.model_dump()
        config_dict["jira_api_token"] = _mask_token(updated_config.jira_api_token)
        config_dict["github_token"] = _mask_token(updated_config.github_token)

        return config_dict

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}")


@router.delete("/users/{username}/config", tags=["User Configuration"])
async def delete_user_configuration(username: str):
    """Delete user configuration."""
    try:
        config_service = UserConfigService()
        config_service.delete_user_config(username)
        return {"message": f"Configuration deleted for user: {username}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete configuration: {str(e)}")


# ---------------------------------------------------------------------------
# Jira Integration Endpoints
# ---------------------------------------------------------------------------

@router.get("/users/{username}/jira/projects", tags=["Jira Integration"])
async def get_jira_projects(username: str):
    """
    Get all accessible Jira projects for the user.
    Enriches with analyzer metadata to show which projects were AI-generated.
    """
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        jira_service = JiraService(
            creds["jira_base_url"],
            creds["jira_email"],
            creds["jira_api_token"]
        )

        # Fetch projects from Jira API (source of truth)
        projects = jira_service.get_projects()

        # Fetch analyzer projects metadata from S3 (for enrichment)
        state_manager = StateManager()
        analyzer_projects = state_manager.list_analyzer_projects(username)

        # Create a lookup map: jira_project_key -> analyzer_project_name
        analyzer_map = {
            ap["jira_project_key"]: ap["project_name"]
            for ap in analyzer_projects
            if ap.get("jira_project_key")
        }

        # Enrich Jira projects with analyzer metadata
        for project in projects:
            project_key = project.get("key")
            if project_key in analyzer_map:
                project["is_ai_generated"] = True
                project["analyzer_project_name"] = analyzer_map[project_key]
            else:
                project["is_ai_generated"] = False

        return {"projects": projects}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch Jira projects: {str(e)}")


@router.get("/users/{username}/jira/projects/{project_key}", tags=["Jira Integration"])
async def get_jira_project_details(username: str, project_key: str):
    """Get details of a specific Jira project."""
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        jira_service = JiraService(
            creds["jira_base_url"],
            creds["jira_email"],
            creds["jira_api_token"]
        )

        project = jira_service.get_project_details(project_key)
        if not project:
            raise HTTPException(status_code=404, detail=f"Project '{project_key}' not found")

        return project

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch project details: {str(e)}")


@router.post("/users/{username}/jira/test", tags=["Jira Integration"])
async def test_jira_connection(username: str, body: dict):
    """Test Jira connection with provided credentials."""
    try:
        jira_service = JiraService(
            body.get("jira_base_url"),
            body.get("jira_email"),
            body.get("jira_api_token")
        )
        success, message = jira_service.test_connection()
        return {"success": success, "message": message}
    except Exception as e:
        return {"success": False, "message": f"Connection test failed: {str(e)}"}


# ---------------------------------------------------------------------------
# GitHub Integration Endpoints
# ---------------------------------------------------------------------------

@router.get("/users/{username}/github/repos", tags=["GitHub Integration"])
async def get_github_repos(username: str, org_name: Optional[str] = None):
    """Get GitHub repositories for the user (personal or organization)."""
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        github_service = GitHubService(creds["github_token"])

        if org_name:
            repos = github_service.get_org_repos(org_name)
        else:
            repos = github_service.get_user_repos(include_orgs=True)

        return {"repositories": repos}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch GitHub repositories: {str(e)}")


@router.get("/users/{username}/github/organizations", tags=["GitHub Integration"])
async def get_github_organizations(username: str):
    """Get all GitHub organizations the user belongs to."""
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        github_service = GitHubService(creds["github_token"])
        orgs = github_service.get_organizations()

        return {"organizations": orgs}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch organizations: {str(e)}")


@router.post("/users/{username}/github/repos", tags=["GitHub Integration"])
async def create_github_repo(username: str, body: CreateRepoRequest):
    """Create a new GitHub repository."""
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        github_service = GitHubService(creds["github_token"])
        repo = github_service.create_repo(
            name=body.name,
            description=body.description,
            private=body.private,
            org_name=body.org_name,
            auto_init=body.auto_init
        )

        return repo

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create repository: {str(e)}")


@router.get("/users/{username}/github/search", tags=["GitHub Integration"])
async def search_github_repos(username: str, query: str):
    """Search for GitHub repositories."""
    try:
        config_service = UserConfigService()
        creds = config_service.get_decrypted_credentials(username)

        github_service = GitHubService(creds["github_token"])
        repos = github_service.search_repos(query)

        return {"repositories": repos}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search repositories: {str(e)}")


@router.post("/users/{username}/github/test", tags=["GitHub Integration"])
async def test_github_connection(username: str, body: dict):
    """Test GitHub connection with provided token."""
    try:
        github_service = GitHubService(body.get("github_token"))
        success, message = github_service.test_connection()
        return {"success": success, "message": message}
    except Exception as e:
        return {"success": False, "message": f"Connection test failed: {str(e)}"}
