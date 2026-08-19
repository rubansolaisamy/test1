import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MdCheckCircle, MdAccessTime, MdRadioButtonUnchecked, MdArrowForward, MdTrendingUp, MdWarning, MdRateReview } from 'react-icons/md';
import ProgressBar from '../components/ProgressBar';
import { getProjectById, processGate, respondToHitl, resumePipeline } from '../services/api';
import './Phases.css';

const SDLC_PHASES_ORDER = [
  "Requirements Analysis",
  "Planning",
  "Development",
  "Testing",
  "Deployment"
];

const phaseDescriptions = {
  "Requirements Analysis": "Gather and document all functional and non-functional requirements from Jira tickets.",
  "Planning": "Define architecture, frameworks, directories, and generate PLAN.md blueprint.",
  "Development": "Implement features, write code, integrate components, and run CI repair loops.",
  "Testing": "Pipeline paused for human-in-the-loop (HITL) manual code review and test validation.",
  "Deployment": "Merge codebase, build Docker container, map ports, and deploy application."
};

const Phases = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false); // Tracks button loading states
  const [liveActivity, setLiveActivity] = useState({ epicId: null, epicTitle: null, message: null, ciStatus: null });

  // Function to load/reload project data
  const fetchProject = async () => {
    try {
      const username = localStorage.getItem('username');
      if (!username) throw new Error("Authentication required.");
      const data = await getProjectById(username, id);
      setProject(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchProject().finally(() => setIsLoading(false));
  }, [id]);

  useEffect(() => {
    const username = localStorage.getItem('username');
    if (!username) return;

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
    const sseUrl = `${API_BASE_URL}/api/v1/pipeline/status/${id}?username=${encodeURIComponent(username)}`;
    const eventSource = new EventSource(sseUrl);

    const handleSseEvent = () => {
      // Whenever the backend emits an event, refresh our data automatically!
      fetchProject();
    };

    eventSource.addEventListener("state_update",           handleSseEvent);
    eventSource.addEventListener("pipeline_paused",        handleSseEvent);
    eventSource.addEventListener("EPIC_AWAITING_APPROVAL", handleSseEvent);
    eventSource.addEventListener("EPIC_COMPLETED",         handleSseEvent);
    eventSource.addEventListener("EPIC_FAILED",            handleSseEvent);
    eventSource.addEventListener("EPIC_APPROVED",          handleSseEvent);
    eventSource.addEventListener("PIPELINE_COMPLETED",     handleSseEvent);
    eventSource.addEventListener("PIPELINE_FAILED",        handleSseEvent);
    eventSource.addEventListener("CODE_GENERATION_STARTED",handleSseEvent);
    eventSource.onmessage = handleSseEvent;

    eventSource.addEventListener("EPIC_STARTED", (e) => {
      try { const d = JSON.parse(e.data); setLiveActivity(prev => ({ ...prev, epicId: d.epic_id, epicTitle: d.epic_title, message: 'Starting implementation...' })); } catch {}
    });
    eventSource.addEventListener("EPIC_AGENT_MESSAGE", (e) => {
      try { const d = JSON.parse(e.data); setLiveActivity(prev => ({ ...prev, epicId: d.epic_id, message: (d.message || '').slice(0, 150) })); } catch {}
    });
    eventSource.addEventListener("EPIC_CI_CHECKING", (e) => {
      try { setLiveActivity(prev => ({ ...prev, ciStatus: 'checking' })); } catch {}
    });
    eventSource.addEventListener("EPIC_CI_PASSED", (e) => {
      try { setLiveActivity(prev => ({ ...prev, ciStatus: 'passed' })); } catch {}
    });

    return () => eventSource.close();
  }, [id]);

  // Uses secure HITL tokens ---
  const handleHitlAction = async (token, actionString) => {
    try {
      setIsProcessing(true);
      const username = localStorage.getItem('username');
      await respondToHitl(username, id, token, actionString);
      // Wait a moment for backend to process, then refresh UI
      await new Promise(res => setTimeout(res, 1000));
      await fetchProject();
    } catch (error) {
      alert(`Approval Failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderApprovalBanner = () => {
    if (!project) return null;
    const rawStatus = project.rawStatus?.toUpperCase() || '';
    
    // 1. Needs Tickets Banner
    if (rawStatus === 'JIRA_FETCHED_AWAITING_SELECTION') {
      return (
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '1rem 1.5rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdWarning size={24} color="#d97706" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#92400e', fontWeight: '700', fontSize: '1rem' }}>Action Required: Select Tickets</p>
              <p style={{ margin: 0, color: '#b45309', fontSize: '0.875rem' }}>Review and select Jira tickets to proceed to Planning.</p>
            </div>
          </div>
          <button 
            onClick={() => navigate(`/projects/${project.id}/select-tickets`)} 
            style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
          >
            Select Tickets
          </button>
        </div>
      );
    }

    // 2a. Plan approved — pipeline needs to be resumed to start code generation
    const epicRecords = project.epic_records || [];
    const anyEpicActive = epicRecords.some(e =>
      ['IMPLEMENTING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED'].includes(e.status)
    );
    if (project.planningStatus === 'APPROVED' && !anyEpicActive && !['CODE_GENERATION_IN_PROGRESS', 'READY_FOR_REVIEW', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'APPLICATION_DEPLOYED'].includes(project.rawStatus?.toUpperCase())) {
      return (
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1rem 1.5rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdCheckCircle size={24} color="#10b981" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#166534', fontWeight: '700', fontSize: '1rem' }}>Plan Approved — Ready for Code Generation</p>
              <p style={{ margin: 0, color: '#15803d', fontSize: '0.875rem' }}>The architecture plan has been approved. Start code generation to begin implementing the epics.</p>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                setIsProcessing(true);
                const username = localStorage.getItem('username');
                await resumePipeline(username, id);
                await new Promise(res => setTimeout(res, 1500));
                await fetchProject();
              } catch (err) {
                alert(`Failed to start: ${err.message}`);
              } finally {
                setIsProcessing(false);
              }
            }}
            disabled={isProcessing}
            style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}
          >
            {isProcessing ? 'Starting...' : 'Start Code Generation'}
          </button>
        </div>
      );
    }

    // 2b. Planning Phase Approval Banner
    if (project.planningStatus === 'AWAITING_APPROVAL' && project.planToken) {
      return (
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fdf4ff', border: '1px solid #fbcfe8', padding: '1rem 1.5rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdCheckCircle size={24} color="#d946ef" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#86198f', fontWeight: '700', fontSize: '1rem' }}>Architecture Plan Ready</p>
              <p style={{ margin: 0, color: '#a21caf', fontSize: '0.875rem' }}>The AI has mapped the project structure. Approve it to begin code generation.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => navigate(`/projects/${id}/review`)}
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem', backgroundColor: 'white', color: '#86198f', border: '1px solid #f0abfc', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <MdRateReview size={15} /> Review
            </button>
            <button
              onClick={() => handleHitlAction(project.planToken, 'approve')}
              disabled={isProcessing}
              style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', backgroundColor: '#d946ef', color: 'white', border: 'none', borderRadius: '6px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: '600' }}
            >
              {isProcessing ? 'Processing...' : 'Approve Plan'}
            </button>
          </div>
        </div>
      );
    }
    
    // 3. Epic Code Approval Banner
    if (project.epicToken) {
      return (
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1rem 1.5rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <MdCheckCircle size={24} color="#10b981" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ margin: '0 0 0.25rem 0', color: '#166534', fontWeight: '700', fontSize: '1rem' }}>Code Review Required</p>
              <p style={{ margin: 0, color: '#15803d', fontSize: '0.875rem' }}>The AI has finished implementing an Epic. Review the Pull Request.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button 
              onClick={() => handleHitlAction(project.epicToken, 'reject')} 
              disabled={isProcessing} 
              style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', backgroundColor: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '6px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: '600' }}
            >
              Reject
            </button>
            <button 
              onClick={() => handleHitlAction(project.epicToken, 'approve')} 
              disabled={isProcessing} 
              style={{ padding: '0.5rem 1.5rem', fontSize: '0.875rem', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontWeight: '600' }}
            >
              {isProcessing ? 'Approving...' : 'Merge & Continue'}
            </button>
          </div>
        </div>
      );
    }
    return null;
  };

  const generateDynamicPhases = () => {
    if (!project) return [];
    const currentPhase = project.currentPhase;
    const currentIndex = SDLC_PHASES_ORDER.indexOf(currentPhase);
    const isErrorState = currentPhase === 'Failed' || currentPhase === 'Cancelled';
    const effectiveIndex = isErrorState ? 99 : currentIndex;

    return SDLC_PHASES_ORDER.map((phaseName, index) => {
      let status = 'pending';
      let progress = 0;
      if (index < effectiveIndex) { status = 'completed'; progress = 100; } 
      else if (index === effectiveIndex) { status = 'active'; progress = project.progress; }

      return {
        id: index + 1,
        name: phaseName,
        status: isErrorState && index === currentIndex ? 'failed' : status,
        description: phaseDescriptions[phaseName],
        progress: progress,
        statusLabel: status === 'active' ? 'In Progress' : status === 'completed' ? 'Done' : 'Waiting',
        tasks: { completed: progress === 100 ? 1 : 0, total: 1 } 
      };
    });
  };

  const dynamicPhases = generateDynamicPhases();
  const phaseCounts = {
    completed: dynamicPhases.filter(p => p.status === 'completed').length,
    active: dynamicPhases.filter(p => p.status === 'active').length,
    pending: dynamicPhases.filter(p => p.status === 'pending').length
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <MdCheckCircle className="phase-status-icon completed" style={{color: '#10b981'}} />;
      case 'active': return <MdAccessTime className="phase-status-icon active" style={{color: '#3b82f6'}} />;
      case 'failed': return <MdCheckCircle className="phase-status-icon failed" style={{color: '#ef4444'}} />;
      default: return <MdRadioButtonUnchecked className="phase-status-icon pending" style={{color: '#9ca3af'}} />;
    }
  };

  if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading project phases...</div>;
  if (error) return <div style={{ padding: '2rem', color: 'red', textAlign: 'center' }}>Error: {error}</div>;

  return (
    <div className="phases-page" style={{ padding: '2rem' }}>
      <div className="phases-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <button onClick={() => navigate('/projects')} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', marginBottom: '0.5rem', padding: 0, fontWeight: '500' }}>
            &larr; Back to Projects
          </button>
          <h1 style={{ margin: 0 }}>{project.title}: Phase Tracker</h1>
          <p className="phases-subtitle" style={{ color: '#6b7280' }}>Track the SDLC progression for this project.</p>
        </div>
        <button
          onClick={() => navigate(`/projects/${id}/tasks`)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '7px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem', color: '#374151', height: 'fit-content' }}
        >
          <MdArrowForward size={15} /> Board
        </button>
      </div>

      {/* Summary Cards */}
      <div className="phase-summary-cards" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <div className="summary-card completed-card" style={{ flex: 1, padding: '1.5rem', borderRadius: '8px', border: '1px solid #d1fae5', backgroundColor: '#ecfdf5', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <MdCheckCircle size={32} color="#10b981" />
          <div><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#065f46' }}>{phaseCounts.completed}</div><div style={{ color: '#059669' }}>Completed</div></div>
        </div>
        <div className="summary-card active-card" style={{ flex: 1, padding: '1.5rem', borderRadius: '8px', border: '1px solid #dbeafe', backgroundColor: '#eff6ff', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <MdAccessTime size={32} color="#3b82f6" />
          <div><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e40af' }}>{phaseCounts.active}</div><div style={{ color: '#2563eb' }}>Active</div></div>
        </div>
        <div className="summary-card pending-card" style={{ flex: 1, padding: '1.5rem', borderRadius: '8px', border: '1px solid #f3f4f6', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <MdRadioButtonUnchecked size={32} color="#9ca3af" />
          <div><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#374151' }}>{phaseCounts.pending}</div><div style={{ color: '#6b7280' }}>Pending</div></div>
        </div>
      </div>

      {/* Overall Progress */}
      <div className="overall-progress-section" style={{ marginBottom: '2rem' }}>
        <div className="overall-progress-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Overall Progress</h2>
          <span style={{ fontWeight: 'bold' }}>{project.progress}% Complete</span>
        </div>
        <ProgressBar progress={project.progress} height="12px" color="#111827" />
      </div>

      {/* DYNAMIC APPROVAL BANNER APPEARS HERE */}
      {renderApprovalBanner()}

      {/* Vertical Phase List */}
      <div className="phases-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {dynamicPhases.map((phase) => (
          <div key={phase.id} className={`phase-card ${phase.status}`} style={{ border: phase.status === 'active' ? '2px solid #3b82f6' : '1px solid #e5e7eb', borderRadius: '12px', padding: '1.5rem', display: 'flex', gap: '1.5rem', backgroundColor: 'white', opacity: phase.status === 'pending' ? 0.6 : 1 }}>
            
            <div className="phase-icon-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {getStatusIcon(phase.status)}
            </div>

            <div className="phase-content" style={{ flexGrow: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Step {phase.id}: {phase.name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {(phase.name === 'Planning' || phase.name === 'Development') && (phase.status === 'active' || phase.status === 'completed') && (
                    <button
                      onClick={() => navigate(`/projects/${id}/review`)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.75rem', fontSize: '0.75rem', backgroundColor: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
                    >
                      <MdRateReview size={13} /> Review
                    </button>
                  )}
                  <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '99px', backgroundColor: phase.status === 'active' ? '#dbeafe' : phase.status === 'completed' ? '#d1fae5' : '#f3f4f6', color: phase.status === 'active' ? '#1e40af' : phase.status === 'completed' ? '#065f46' : '#4b5563', textTransform: 'uppercase', fontWeight: 'bold' }}>
                    {phase.statusLabel}
                  </span>
                </div>
              </div>
              <p style={{ color: '#6b7280', margin: '0 0 1rem 0', fontSize: '0.875rem' }}>{phase.description}</p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flexGrow: 1 }}><ProgressBar progress={phase.progress} color={phase.status === 'completed' ? '#10b981' : '#3b82f6'} height="6px"/></div>
                <span style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{phase.progress}%</span>
              </div>

              {phase.name === 'Development' && phase.status === 'active' && liveActivity.epicId && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                    <span className="pulse-dot-blue" />
                    <span style={{ fontWeight: '600', fontSize: '0.8rem', color: '#1e40af' }}>
                      {liveActivity.epicId}: {liveActivity.epicTitle}
                    </span>
                    {liveActivity.ciStatus === 'checking' && <span style={{ fontSize: '0.7rem', backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: '999px', fontWeight: '600' }}>CI RUNNING</span>}
                    {liveActivity.ciStatus === 'passed' && <span style={{ fontSize: '0.7rem', backgroundColor: '#d1fae5', color: '#065f46', padding: '1px 8px', borderRadius: '999px', fontWeight: '600' }}>CI PASSED</span>}
                  </div>
                  {liveActivity.message && (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#3b82f6', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {liveActivity.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Phases;