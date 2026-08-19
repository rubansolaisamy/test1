const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001'}/api/v1`;

export const fetchDashboardData = async (username) => {
  try {
    const projectsRes = await fetch(`${API_BASE_URL}/projects?username=${username}`);
    const projects = await projectsRes.json();

    let liveTasks = [];
    if (projects.length > 0) {
      const activeProjectId = projects[0].project_id;
      const tasksRes = await fetch(`${API_BASE_URL}/projects/${activeProjectId}/tasks?username=${username}`);
      liveTasks = await tasksRes.json();
    }

    return {
      projects: projects,
      tasks: liveTasks
    };
  } catch (error) {
    console.error("Fetch error:", error);
    return { projects: [], tasks: [] };
  }
};