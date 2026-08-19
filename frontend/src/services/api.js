// src/services/api.js

// Safe environment variable parser with automatic fallback to prevent 'undefined' string injection
const resolveApiBaseUrl = () => {
  const viteMeta = import.meta.env;
  if (viteMeta) {
    if (viteMeta.VITE_API_BASE_URL) return viteMeta.VITE_API_BASE_URL.replace(/\/$/, "");
    if (viteMeta.VITE_API_URL) return viteMeta.VITE_API_URL.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8001";
};

const API_BASE_URL = resolveApiBaseUrl();

const runJsonRequest = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || `Request failed: ${response.status}`);
  }
  return response.json();
};

// ADAPTER: Translates BOTH REST data and raw SSE S3 data to match UI components safely
export const transformProjectData = (apiProject) => {
  const getStatusColor = (status) => {
    const s = status?.toUpperCase() || '';
    if (s.includes('DEPLOYED') || s === 'COMPLETED') return '#10b981';
    if (s.includes('FAILED') || s.includes('CANCELLED') || s.includes('ERROR')) return '#ef4444';
    if (s === 'IN_REVIEW' || s.includes('TESTING') || s.includes('REVIEW') || s.includes('WAITING')) return '#f59e0b';
    if (s.includes('PLANNING')) return '#a855f7';
    return '#3b82f6';
  };

  // Helper: Calculate progress if the raw SSE stream doesn't provide it
  const calculateProgress = (status) => {
    if (apiProject.progress !== undefined && apiProject.progress !== null) {
      return apiProject.progress; 
    }
    const s = status?.toUpperCase() || '';
    const statusProgress = {
      "INITIALIZED": 0, "PIPELINE_LAUNCHED": 10, "JIRA_ANALYZED": 20,
      "CODE_GENERATION_IN_PROGRESS": 50, "READY_FOR_REVIEW": 75,
      "APPROVAL_RECEIVED_DEPLOYING": 90, "APPLICATION_DEPLOYED": 100,
      "COMPLETED": 100, "COMPLETED_WITH_ERRORS": 100, "FAILED": 0, "CANCELLED": 0
    };
    return statusProgress[s] || 0;
  };

  // Helper: Derive phase if the raw SSE stream doesn't provide it
  const derivePhase = (status) => {
    // Epic-record state takes priority over the stale top-level status field
    const epics = apiProject.epic_records || [];
    if (epics.some(e => e.status === 'IMPLEMENTING' || e.status === 'AWAITING_APPROVAL')) {
      return 'Development';
    }
    if (epics.length > 0 && epics.every(e => e.status === 'COMPLETED')) {
      const s = status?.toUpperCase() || '';
      return (s === 'COMPLETED' || s === 'APPLICATION_DEPLOYED' || s === 'APPROVAL_RECEIVED_DEPLOYING')
        ? 'Deployment' : 'Testing';
    }
    if (epics.some(e => e.status === 'COMPLETED')) return 'Development';
    if (apiProject.current_phase) return apiProject.current_phase;
    const s = status?.toUpperCase() || '';
    const phaseMapping = {
      "INITIALIZED": "Requirements Analysis",
      "PIPELINE_LAUNCHED": "Requirements Analysis",
      "JIRA_FETCHING": "Requirements Analysis",
      "JIRA_LOADED": "Requirements Analysis",
      "JIRA_FETCHED_AWAITING_SELECTION": "Requirements Analysis",
      "TICKETS_SELECTED": "Requirements Analysis",
      "IN_REVIEW": "Development",
      "JIRA_ANALYZED": "Planning",
      "PLANNING": "Planning",
      "PLANNING_APPROVED": "Planning",
      "CODE_GENERATION_IN_PROGRESS": "Development",
      "READY_FOR_REVIEW": "Testing",
      "APPROVAL_RECEIVED_DEPLOYING": "Deployment",
      "APPLICATION_DEPLOYED": "Deployment",
      "COMPLETED": "Deployment",
      "COMPLETED_WITH_ERRORS": "Deployment",
      "FAILED": "Failed",
      "CANCELLED": "Cancelled"
    };
    return phaseMapping[s] || "Requirements Analysis";
  };

  // Derive a smarter display status from epic_records when available
  const deriveDisplayStatus = (baseStatus, epics) => {
    if (!epics || !epics.length) return baseStatus;
    if (epics.some(e => e.status === 'AWAITING_APPROVAL')) return 'IN_REVIEW';
    if (epics.some(e => e.status === 'IMPLEMENTING'))      return 'CODE_GENERATION_IN_PROGRESS';
    if (epics.every(e => e.status === 'COMPLETED'))        return 'COMPLETED';
    if (epics.every(e => ['COMPLETED','FAILED'].includes(e.status))) return 'COMPLETED_WITH_ERRORS';
    return baseStatus;
  };

  const rawStatus = deriveDisplayStatus(apiProject.status || 'INITIALIZED', apiProject.epic_records);
  
  // Find active HITL tokens if the pipeline is paused!
  const planToken = apiProject.planning_hitl_token;
  const activeEpic = (apiProject.epic_records || []).find(e => e.status === 'AWAITING_APPROVAL');
  const epicToken = activeEpic ? activeEpic.hitl_token : null;

  return {
    ...apiProject, // <--- 1. ADD THIS LINE AT THE TOP!
    id: apiProject.project_id || Math.random().toString(), 
    title: apiProject.title || apiProject.project_title || apiProject.project_id || 'Untitled Project',
    description: apiProject.description || apiProject.project_description || 'No description provided.',
    status: rawStatus.toLowerCase().replace(/_/g, ' '),
    progress: calculateProgress(rawStatus),
    currentPhase: derivePhase(rawStatus),
    dueDate: apiProject.due_date || apiProject.project_due_date || 'TBD',
    memberCount: 1, 
    members: [apiProject.username ? apiProject.username.substring(0, 2).toUpperCase() : 'U'], 
    statusColor: getStatusColor(rawStatus),
    rawStatus: rawStatus,
    planningStatus: apiProject.planning_status,
    planToken: planToken,
    epicToken: epicToken,
    epic_records: apiProject.epic_records || [] // <--- 2. ADD THIS LINE AT THE BOTTOM!
  };
};

// GET: Full pipeline state (includes conversation URLs, epic details)
export const getPipelineState = async (username, projectId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/pipeline/state/${projectId}?username=${encodeURIComponent(username)}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch pipeline state: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getPipelineState]:", error);
    throw error;
  }
};

// GET: Fetch all projects
export const getProjects = async (username) => {
  if (!username) throw new Error("Authentication required.");
  const url = `${API_BASE_URL}/api/v1/projects?username=${encodeURIComponent(username)}`;
  const rawData = await runJsonRequest(url, { headers: { 'Accept': 'application/json' } });
  return rawData.map(transformProjectData); 
};

// POST: Setup Endpoint (Initialize in S3)
export const createProject = async (projectData) => {
  const url = `${API_BASE_URL}/api/v1/projects`;
  return await runJsonRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(projectData)
  });
};

// POST: Resume pipeline after planning approval
export const resumePipeline = async (username, projectId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/pipeline/resume/${projectId}?username=${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Failed to resume pipeline (Status: ${response.status})`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Error [resumePipeline]:", error);
    throw error;
  }
};

// POST: Engine Endpoint (Start Orchestration)
export const startPipeline = async (username, projectId) => {
  const url = `${API_BASE_URL}/api/v1/pipeline/start`;
  return await runJsonRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username, project_id: projectId })
  });
};

export const respondToHitl = async (username, projectId, token, action) => {
  const url = `${API_BASE_URL}/api/v1/pipeline/hitl/${projectId}/${token}/${action}?username=${encodeURIComponent(username)}`;
  return await runJsonRequest(url, { method: 'POST', headers: { 'Accept': 'application/json' } });
};

// POST: Gate Endpoint (Handle User Approvals)
export const processGate = async (username, projectId, action, feedback = "Approved via UI") => {
  const url = `${API_BASE_URL}/api/v1/pipeline/gate`;
  return await runJsonRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username, project_id: projectId, action, feedback })
  });
};

// GET: Fetch a single project by ID
export const getProjectById = async (username, projectId) => {
  const url = `${API_BASE_URL}/api/v1/projects/${projectId}?username=${encodeURIComponent(username)}`;
  const rawData = await runJsonRequest(url, { headers: { 'Accept': 'application/json' } });
  return transformProjectData(rawData);
};

// PUT: Update project metadata
export const updateProject = async (username, projectId, updateData) => {
  const url = `${API_BASE_URL}/api/v1/projects/${projectId}?username=${encodeURIComponent(username)}`;
  const rawData = await runJsonRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(updateData)
  });
  return transformProjectData(rawData);
};

// DELETE: Remove project from S3
export const deleteProject = async (username, projectId) => {
  const url = `${API_BASE_URL}/api/v1/projects/${projectId}?username=${encodeURIComponent(username)}`;
  return await runJsonRequest(url, { method: 'DELETE', headers: { 'Accept': 'application/json' } });
};

// GET: Fetch all tasks for a specific project
export const getProjectTasks = async (username, projectId, refresh = false) => {
  const url = `${API_BASE_URL}/api/v1/projects/${projectId}/tasks?username=${encodeURIComponent(username)}&refresh=${refresh}`;
  return await runJsonRequest(url, { headers: { 'Accept': 'application/json' } });
};

// PUT: Update just the status of a task
export const updateTaskStatus = async (username, projectId, taskId, statusData) => {
  const url = `${API_BASE_URL}/api/v1/projects/${projectId}/tasks/${taskId}/status?username=${encodeURIComponent(username)}`;
  return await runJsonRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(statusData)
  });
};

// GET: Fetch project data from Intelligent Requirement Analyzer
export const getAnalyzerProjects = async (username) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/pipeline/analyzer?username=${encodeURIComponent(username)}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch analyzer projects`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getAnalyzerProjects]:", error);
    throw error;
  }
};// User Configuration API
// ---------------------------------------------------------------------------

export const getUserConfig = async (username) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/config`, {
      headers: { 'Accept': 'application/json' }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to fetch user configuration`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getUserConfig]:", error);
    throw error;
  }
};

export const checkUserConfigExists = async (username) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/config/exists`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to check config existence`);
    return await response.json();
  } catch (error) {
    console.error("API Error [checkUserConfigExists]:", error);
    throw error;
  }
};

export const saveUserConfig = async (username, configData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(configData)
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Failed to save configuration`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Error [saveUserConfig]:", error);
    throw error;
  }
};

export const updateUserConfig = async (username, configData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(configData)
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Failed to update configuration`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Error [updateUserConfig]:", error);
    throw error;
  }
};

export const testJiraConnection = async (username, jiraData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/jira/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(jiraData)
    });
    return await response.json();
  } catch (error) {
    console.error("API Error [testJiraConnection]:", error);
    return { success: false, message: error.message };
  }
};

export const testGitHubConnection = async (username, githubData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(githubData)
    });
    return await response.json();
  } catch (error) {
    console.error("API Error [testGitHubConnection]:", error);
    return { success: false, message: error.message };
  }
};

// ---------------------------------------------------------------------------
// Jira Integration API
// ---------------------------------------------------------------------------

export const getJiraProjects = async (username) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/jira/projects`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch Jira projects`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getJiraProjects]:", error);
    throw error;
  }
};

export const getJiraProjectDetails = async (username, projectKey) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/jira/projects/${projectKey}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch project details`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getJiraProjectDetails]:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// GitHub Integration API
// ---------------------------------------------------------------------------

export const getGitHubRepos = async (username, orgName = null) => {
  try {
    const url = orgName 
      ? `${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/repos?org_name=${encodeURIComponent(orgName)}`
      : `${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/repos`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch GitHub repositories`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getGitHubRepos]:", error);
    throw error;
  }
};

export const getGitHubOrganizations = async (username) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/organizations`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to fetch GitHub organizations`);
    return await response.json();
  } catch (error) {
    console.error("API Error [getGitHubOrganizations]:", error);
    throw error;
  }
};

export const createGitHubRepo = async (username, repoData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(repoData)
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Failed to create repository`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Error [createGitHubRepo]:", error);
    throw error;
  }
};

export const searchGitHubRepos = async (username, query) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/github/search?query=${encodeURIComponent(query)}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`Failed to search repositories`);
    return await response.json();
  } catch (error) {
    console.error("API Error [searchGitHubRepos]:", error);
    throw error;
  }
};