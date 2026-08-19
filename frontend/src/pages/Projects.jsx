import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { MdAdd, MdSearch } from 'react-icons/md';
import ProjectCard from '../components/ProjectCard';
import { getProjects } from '../services/api';
import './Projects.css';

const Projects = () => {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); 
  const [toastMessage, setToastMessage] = useState(null); // State for the success popup

  useEffect(() => {
    const fetchRealProjects = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const currentUsername = localStorage.getItem('username'); 

        if (!currentUsername) {
          // Redirect to login if no username found
          navigate('/login');
          return;
        }

        const formattedData = await getProjects(currentUsername);
        
        // The Ghost Filter: Drop any old backend tests that don't have a real title or ID
        const validProjects = formattedData.filter(project => 
          project.title !== 'Untitled Project' && 
          project.id && 
          project.id !== 'undefined'
        );

        setProjects(validProjects); 

      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRealProjects();
  }, [navigate]); 

  // The Walkie-Talkie function! Updates the master list when the live stream fires on a card.
  const handleProjectUpdate = (updatedProject) => {
    setProjects(prevProjects => 
      prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p)
    );
  };

  // Remove deleted project from the UI and show toast
  const handleProjectDelete = (deletedProjectId, projectTitle) => {
    setProjects(prevProjects => prevProjects.filter(p => p.id !== deletedProjectId));
    
    // Show the success toast popup!
    setToastMessage(`Project "${projectTitle}" was successfully deleted.`);
    
    // Hide the toast automatically after 3.5 seconds
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Bulletproof Filtering Logic
  const filteredProjects = projects.filter(project => {
    const matchesSearch = (project.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (project.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const status = project.status?.toLowerCase() || '';
    const isFailed = status.includes('failed') || status.includes('cancelled') || status.includes('error');
    const isCompleted = status.includes('completed') || status.includes('deployed');
    const isActive = !isFailed && !isCompleted;

    const matchesFilter = activeFilter === 'all' || 
                          (activeFilter === 'active' && isActive) ||
                          (activeFilter === 'completed' && isCompleted) ||
                          (activeFilter === 'failed' && isFailed);

    return matchesSearch && matchesFilter;
  });

  // Exact Count Logic for the Top Stat Boxes
  const projectCounts = {
    total: projects.length,
    inProgress: projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      return !s.includes('testing') && !s.includes('review') && !s.includes('deployed') && !s.includes('completed') && !s.includes('failed') && !s.includes('cancelled') && !s.includes('error');
    }).length,
    completed: projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      return s.includes('completed') || s.includes('deployed');
    }).length,
    failed: projects.filter(p => {
      const s = p.status?.toLowerCase() || '';
      return s.includes('failed') || s.includes('cancelled') || s.includes('error');
    }).length
  };

  const handleResumeProject = (project) => {
    alert(`Resuming project: ${project.title}`);
  };

  const handleNewProject = () => {
    navigate('/projects/new'); 
  };

  if (isLoading) {
    return <div className="projects-page"><div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading your projects...</div></div>;
  }

  if (error) {
    return <div className="projects-page"><div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444', backgroundColor: '#fee2e2', borderRadius: '8px', margin: '2rem' }}><h3>Access Error</h3><p>{error}</p></div></div>;
  }

  return (
    <div className="projects-page">
      <div className="projects-header">
        <div>
          <h1>Projects</h1>
          <p className="projects-subtitle">Manage and monitor all your software development projects</p>
        </div>
        <button className="new-project-btn" onClick={handleNewProject}>
          <MdAdd />
          New Project
        </button>
      </div>

      <div className="projects-controls">
        <div className="search-bar">
          <MdSearch className="search-icon" />
          <input type="text" placeholder="Search projects..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>

        <div className="filter-tabs">
          <button className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>All Projects</button>
          <button className={`filter-tab ${activeFilter === 'active' ? 'active' : ''}`} onClick={() => setActiveFilter('active')}>Active</button>
          <button className={`filter-tab ${activeFilter === 'completed' ? 'active' : ''}`} onClick={() => setActiveFilter('completed')}>Completed</button>
          <button className={`filter-tab ${activeFilter === 'failed' ? 'active' : ''}`} onClick={() => setActiveFilter('failed')}>Failed / Cancelled</button>
        </div>
      </div>

      <div className="projects-grid">
        {filteredProjects.map(project => (
          <ProjectCard 
            key={project.id} 
            project={project} 
            onResume={handleResumeProject} 
            onUpdate={handleProjectUpdate} 
            onDelete={handleProjectDelete} 
          />
        ))}
      </div>

      {filteredProjects.length === 0 && (
        <div className="no-results">
          <p>{projects.length === 0 ? "No projects yet. Click \"New Project\" to get started." : "No projects match your search or filter."}</p>
        </div>
      )}

      <div className="projects-stats">
        <div className="stat-box"><div className="stat-number">{projectCounts.total}</div><div className="stat-label">Total Projects</div></div>
        <div className="stat-box"><div className="stat-number" style={{ color: '#3b82f6' }}>{projectCounts.inProgress}</div><div className="stat-label">In Progress</div></div>
        <div className="stat-box"><div className="stat-number" style={{ color: '#10b981' }}>{projectCounts.completed}</div><div className="stat-label">Completed</div></div>
        <div className="stat-box"><div className="stat-number" style={{ color: '#ef4444' }}>{projectCounts.failed}</div><div className="stat-label">Failed / Cancelled</div></div>
      </div>

      {/* THE TOAST NOTIFICATION POPUP */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#10b981', // Success green
          color: 'white',
          padding: '1rem 1.5rem',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          zIndex: 1000,
          fontWeight: '500',
          animation: 'fadein 0.3s'
        }}>
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default Projects;