import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ProgressBar from './ProgressBar'; 
import { transformProjectData, processGate, deleteProject, getProjectById } from '../services/api';
import {
  MdMoreVert,
  MdEdit,
  MdDelete,
  MdArrowForward,
  MdWarning,
  MdCheckCircle,
  MdRateReview
} from 'react-icons/md';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const ProjectCard = ({ project: initialProject, onResume, onUpdate, onDelete }) => {
  const navigate = useNavigate();
  const [project, setProject] = useState(initialProject);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const [showConfirm, setShowConfirm] = useState(false); 
  const [isDeleting, setIsDeleting] = useState(false); 
  
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (project.status === 'completed' || project.status.includes('deployed') || project.status.includes('failed')) return;

    const username = localStorage.getItem('username');
    if (!username) return;  

    const sseUrl = `${API_BASE_URL}/api/v1/pipeline/status/${project.id}?username=${encodeURIComponent(username)}`;
    const eventSource = new EventSource(sseUrl);

    const handleSseEvent = async (event) => {
      try {
        const username = localStorage.getItem('username');
        if (!username) return;

        // 1. Ignore the partial SSE event data. Just fetch the 100% accurate truth!
        const freshProject = await getProjectById(username, project.id);
        
        // 2. Safely update the Card UI and the parent Grid UI
        setProject(freshProject);
        if (onUpdate) {
            onUpdate(freshProject);
        }
      } catch (err) {
        console.error("Error fetching fresh state for project", project.id, ":", err);
      }
    };

    eventSource.addEventListener("state_update", handleSseEvent);
    eventSource.addEventListener("pipeline_paused", handleSseEvent);
    eventSource.addEventListener("pipeline_completed", handleSseEvent);
    eventSource.onmessage = handleSseEvent;

    eventSource.onerror = (error) => {
      if (eventSource.readyState === EventSource.CLOSED) eventSource.close(); 
    };

    return () => eventSource.close();
  }, [project.id]);

  const handleGateAction = async (actionString) => {
    const username = localStorage.getItem('username');
    try {
      setIsProcessing(true);
      await processGate(username, project.id, actionString);
    } catch (error) {
      alert(`Approval Failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEdit = () => {
    navigate(`/projects/edit/${project.id}`);
  };

  const handleDeleteClick = () => {
    setIsMenuOpen(false);
    setShowConfirm(true); 
  };

  const cancelDelete = () => {
    setShowConfirm(false); 
  };

  const confirmDelete = async () => {
    setShowConfirm(false);
    setIsDeleting(true); 

    const username = localStorage.getItem('username');
    try {
      await deleteProject(username, project.id);
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (onDelete) onDelete(project.id, project.title); 
    } catch (error) {
      alert(`Failed to delete project: ${error.message}`);
      setIsDeleting(false); 
    }
  };

  // --- PREMIUM ALERT FOOTER ---
  const renderGateAlert = () => {
    const rawStatus = project.rawStatus?.toUpperCase() || '';
    
    // UPDATED: Now checks for both JIRA_ANALYZED and JIRA_FETCHED_AWAITING_SELECTION
    if (rawStatus === 'JIRA_ANALYZED' || rawStatus === 'JIRA_FETCHED_AWAITING_SELECTION') {
      return (
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '1rem', borderRadius: '8px', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdWarning size={20} color="#d97706" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#92400e', fontWeight: '700', fontSize: '0.875rem' }}>Action Required</p>
              <p style={{ margin: 0, color: '#b45309', fontSize: '0.875rem' }}>Review and select Jira tickets to proceed.</p>
            </div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/select-tickets`); }} 
            disabled={isProcessing || isDeleting || showConfirm} 
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: (isProcessing || isDeleting || showConfirm) ? 'not-allowed' : 'pointer', fontWeight: '600', whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
          >
            {isProcessing ? 'Processing...' : 'Select Tickets'}
          </button>
        </div>
      );
    }
    
    if (rawStatus === 'READY_FOR_REVIEW') {
      return (
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1rem', borderRadius: '8px', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdCheckCircle size={20} color="#10b981" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#166534', fontWeight: '700', fontSize: '0.875rem' }}>Code Generated</p>
              <p style={{ margin: 0, color: '#15803d', fontSize: '0.875rem' }}>Pipeline is ready for final approval.</p>
            </div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); handleGateAction('approve_code'); }} 
            disabled={isProcessing || isDeleting || showConfirm} 
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: (isProcessing || isDeleting || showConfirm) ? 'not-allowed' : 'pointer', fontWeight: '600', whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
          >
            {isProcessing ? 'Processing...' : 'Approve Code'}
          </button>
        </div>
      );
    }
    
    return null;
  };

  return (
    <div 
      className="project-card" 
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{ 
        border: '1px solid #e5e7eb', 
        borderRadius: '12px', 
        padding: '1.5rem', 
        backgroundColor: 'white', 
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)', 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        position: 'relative', 
        overflow: 'hidden',
        cursor: 'pointer', // Makes it look clickable
        transition: 'transform 0.2s, box-shadow 0.2s'
      }}
      onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)'; }}
      onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.05)'; }}
    >
      
      {/* Delete Overlays */}
      {showConfirm && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', inset: 0, zIndex: 30, backgroundColor: 'rgba(255, 255, 255, 0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', textAlign: 'center' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#111827', fontSize: '1.125rem' }}>Delete this project?</h4>
          <p style={{ margin: '0 0 1.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>This cannot be undone.</p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={(e) => { e.stopPropagation(); cancelDelete(); }} style={{ padding: '0.5rem 1rem', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>Cancel</button>
            <button onClick={(e) => { e.stopPropagation(); confirmDelete(); }} style={{ padding: '0.5rem 1rem', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>Delete</button>
          </div>
        </div>
      )}

      {isDeleting && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, backgroundColor: 'rgba(255, 255, 255, 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#ef4444', fontSize: '1.125rem' }}>
          Deleting...
        </div>
      )}

      {/* HEADER: Sleek split layout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem' }}>
        
        {/* Left: Title + Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', color: '#111827', lineHeight: '1.2' }}>
            {project.title}
          </h3>
          <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', backgroundColor: `${project.statusColor}15`, color: project.statusColor, borderRadius: '9999px', fontWeight: '600', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
            {project.status}
          </span>
        </div>
        
        {/* Right: Outline View Tasks Button + Menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}
            disabled={isDeleting || showConfirm}
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.75rem', fontSize: '0.8125rem', backgroundColor: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: '6px', cursor: (isDeleting || showConfirm) ? 'not-allowed' : 'pointer', fontWeight: '600', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e0e7ff'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#eef2ff'}
          >
            <MdRateReview size={14} /> Review
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}
            disabled={isDeleting || showConfirm}
            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.75rem', fontSize: '0.8125rem', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: (isDeleting || showConfirm) ? 'not-allowed' : 'pointer', fontWeight: '500', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
          >
            Board <MdArrowForward size={14} />
          </button>

          <div ref={menuRef} style={{ position: 'relative' }}>
            <button onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseOver={(e) => e.currentTarget.style.color = '#4b5563'} onMouseOut={(e) => e.currentTarget.style.color = '#9ca3af'}>
              <MdMoreVert size={20} />
            </button>
            
            {isMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '100%', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', zIndex: 10, minWidth: '120px', overflow: 'hidden' }}>
                <button onClick={(e) => { e.stopPropagation(); handleEdit(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', background: 'none', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer', color: '#374151', textAlign: 'left', fontSize: '0.875rem' }}>
                  <MdEdit size={16}/> Edit
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', textAlign: 'left', fontSize: '0.875rem' }}>
                  <MdDelete size={16}/> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* CARD BODY */}
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem', flexGrow: 1, lineHeight: '1.5' }}>
        {project.description}
      </p>
      
      {/* PROGRESS SECTION */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          <span style={{ color: '#4b5563', fontWeight: '500' }}>Phase: <strong style={{ color: '#111827' }}>{project.currentPhase}</strong></span>
          <span style={{ fontWeight: '700', color: '#111827' }}>{project.progress}%</span>
        </div>
        <ProgressBar progress={project.progress} color={project.statusColor} />
      </div>

      {/* DYNAMIC ALERT BANNER (Bottom of Card) */}
      <div onClick={(e) => e.stopPropagation()}>
         {renderGateAlert()}
      </div>

    </div>
  );
};

export default ProjectCard;