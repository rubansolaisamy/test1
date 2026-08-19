import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdAccessTime, MdError,
  MdOpenInNew, MdArrowBack, MdCallMerge, MdRefresh, MdCode
} from 'react-icons/md';
import { getPipelineState } from '../services/api';
import './ProjectTasks.css';

const API_BASE_URL    = import.meta.env.VITE_API_BASE_URL;
const JIRA_BASE_URL   = import.meta.env.VITE_JIRA_BASE_URL || 'https://randstaddigital-team-jtpx49im.atlassian.net';

// ─── Status helpers ──────────────────────────────────────────────────────────

const EPIC_STATUS = {
  COMPLETED:         { label: 'Completed',   color: '#10b981', bg: '#d1fae5', border: '#a7f3d0' },
  AWAITING_APPROVAL: { label: 'In Review',   color: '#f59e0b', bg: '#fef3c7', border: '#fde68a' },
  IMPLEMENTING:      { label: 'In Progress', color: '#3b82f6', bg: '#dbeafe', border: '#bfdbfe' },
  FAILED:            { label: 'Failed',      color: '#ef4444', bg: '#fee2e2', border: '#fecaca' },
  PENDING:           { label: 'Pending',     color: '#9ca3af', bg: '#f3f4f6', border: '#e5e7eb' },
};

// Derive story/task status from the parent epic's status
function deriveItemStatus(epicStatus, index, total) {
  if (epicStatus === 'COMPLETED') return 'done';
  if (epicStatus === 'AWAITING_APPROVAL') return 'done';
  if (epicStatus === 'IMPLEMENTING') return index === 0 ? 'active' : 'pending';
  return 'pending';
}

function StatusDot({ epicStatus }) {
  const cfg = EPIC_STATUS[epicStatus] || EPIC_STATUS.PENDING;
  return (
    <span
      className={epicStatus === 'IMPLEMENTING' ? 'status-dot pulse' : 'status-dot'}
      style={{ background: cfg.color }}
    />
  );
}

function EpicBadge({ status }) {
  const cfg = EPIC_STATUS[status] || EPIC_STATUS.PENDING;
  return (
    <span className="epic-badge" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      {status === 'IMPLEMENTING' && <span className="badge-dot" style={{ background: cfg.color }} />}
      {cfg.label}
    </span>
  );
}

function jiraUrl(ticketId) {
  return `${JIRA_BASE_URL}/browse/${ticketId}`;
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task, epicStatus }) {
  const id    = task.id || '';
  const title = task.title || task.summary || '';
  const isDone = ['COMPLETED', 'AWAITING_APPROVAL'].includes(epicStatus);

  return (
    <div className={`task-row ${isDone ? 'done' : epicStatus === 'IMPLEMENTING' ? 'active' : 'pending'}`}>
      <span className="task-connector" />
      {isDone
        ? <MdCheckCircle size={13} style={{ color: '#10b981', flexShrink: 0 }} />
        : <MdRadioButtonUnchecked size={13} style={{ color: '#d1d5db', flexShrink: 0 }} />
      }
      <span className="task-id">{id}</span>
      <span className="task-title">{title}</span>
      {id && (
        <a href={jiraUrl(id)} target="_blank" rel="noopener noreferrer" className="jira-link" title="View in Jira">
          <MdOpenInNew size={12} />
        </a>
      )}
    </div>
  );
}

// ─── Story row ───────────────────────────────────────────────────────────────

function StoryRow({ storyData, epicStatus, storyIndex, totalStories }) {
  const [open, setOpen] = useState(epicStatus !== 'PENDING');
  const story  = storyData.story || storyData;
  const tasks  = storyData.tasks || [];
  const id     = story.id || story.key || '';
  const title  = story.title || story.summary || '';
  const isDone = ['COMPLETED', 'AWAITING_APPROVAL'].includes(epicStatus);

  return (
    <div className="story-block">
      <div
        className={`story-row ${isDone ? 'done' : epicStatus === 'IMPLEMENTING' ? 'active' : 'pending'}`}
        onClick={() => tasks.length > 0 && setOpen(o => !o)}
        style={{ cursor: tasks.length > 0 ? 'pointer' : 'default' }}
      >
        {isDone
          ? <MdCheckCircle size={15} style={{ color: '#10b981', flexShrink: 0 }} />
          : epicStatus === 'IMPLEMENTING'
            ? <span className="pulse-dot-sm" />
            : <MdRadioButtonUnchecked size={15} style={{ color: '#d1d5db', flexShrink: 0 }} />
        }
        <span className="story-id">{id}</span>
        <span className="story-title">{title}</span>
        {tasks.length > 0 && (
          <span className="task-count">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        )}
        {id && (
          <a href={jiraUrl(id)} target="_blank" rel="noopener noreferrer" className="jira-link" title="View in Jira" onClick={e => e.stopPropagation()}>
            <MdOpenInNew size={12} /> Jira
          </a>
        )}
      </div>
      {open && tasks.length > 0 && (
        <div className="tasks-list">
          {tasks.map((t, ti) => (
            <TaskRow key={t.id || ti} task={t} epicStatus={epicStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Epic section ─────────────────────────────────────────────────────────────

function EpicSection({ chunk, record, liveMessage }) {
  const [collapsed, setCollapsed] = useState(record.status === 'PENDING');
  const epic    = chunk?.epic || {};
  const stories = chunk?.stories || [];
  const epicId  = record.epic_id;
  const cfg     = EPIC_STATUS[record.status] || EPIC_STATUS.PENDING;

  return (
    <div
      className="epic-section"
      style={{ borderLeft: `4px solid ${cfg.color}`, opacity: record.status === 'PENDING' ? 0.65 : 1 }}
    >
      {/* Epic header */}
      <div className="epic-header" onClick={() => setCollapsed(c => !c)}>
        <div className="epic-header-left">
          <StatusDot epicStatus={record.status} />
          <span className="epic-key">{epicId}</span>
          <span className="epic-name">{record.epic_title}</span>
          <EpicBadge status={record.status} />
        </div>
        <div className="epic-header-right" onClick={e => e.stopPropagation()}>
          {record.pr_url && (
            <a href={record.pr_url} target="_blank" rel="noopener noreferrer" className="epic-action-btn pr">
              <MdCallMerge size={13} /> PR
            </a>
          )}
          {epic.id && (
            <a href={jiraUrl(epic.id)} target="_blank" rel="noopener noreferrer" className="epic-action-btn jira">
              <MdOpenInNew size={13} /> Jira
            </a>
          )}
          <span className="epic-collapse-toggle">{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {/* Live activity strip */}
      {!collapsed && record.status === 'IMPLEMENTING' && liveMessage && (
        <div className="live-strip">
          <span className="live-strip-dot" />
          <span className="live-strip-msg">{liveMessage}</span>
        </div>
      )}

      {/* Stories */}
      {!collapsed && stories.length > 0 && (
        <div className="stories-list">
          {stories.map((s, si) => (
            <StoryRow
              key={s.story?.id || si}
              storyData={s}
              epicStatus={record.status}
              storyIndex={si}
              totalStories={stories.length}
            />
          ))}
        </div>
      )}

      {!collapsed && stories.length === 0 && (
        <p className="no-stories">No stories loaded for this epic.</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const ProjectTasks = () => {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const [state, setState] = useState(null);
  const [liveMessages, setLiveMessages] = useState({});
  const [isLoading, setIsLoading]       = useState(true);
  const [error, setError]               = useState(null);
  const sseRef = useRef(null);

  const loadState = async () => {
    try {
      const username = localStorage.getItem('username');
      if (!username) { navigate('/login'); return; }
      const data = await getPipelineState(username, id);
      setState(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadState(); }, [id]);

  useEffect(() => {
    const username = localStorage.getItem('username');
    if (!username) return;
    const es = new EventSource(`${API_BASE_URL}/api/v1/pipeline/status/${id}?username=${encodeURIComponent(username)}`);
    sseRef.current = es;

    es.addEventListener('EPIC_AGENT_MESSAGE', e => {
      try { const d = JSON.parse(e.data); setLiveMessages(p => ({ ...p, [d.epic_id]: d.message || '' })); } catch {}
    });
    es.addEventListener('EPIC_STARTED', e => {
      try { const d = JSON.parse(e.data); setLiveMessages(p => ({ ...p, [d.epic_id]: 'Starting implementation…' })); } catch {}
    });

    const reload = () => loadState();
    ['EPIC_AWAITING_APPROVAL','EPIC_COMPLETED','EPIC_FAILED','EPIC_APPROVED','EPIC_REJECTED',
     'PIPELINE_COMPLETED','PIPELINE_FAILED','PIPELINE_PAUSED','CODE_GENERATION_STARTED','state_update'
    ].forEach(ev => es.addEventListener(ev, reload));

    return () => { es.close(); sseRef.current = null; };
  }, [id]);

  if (isLoading) return <div className="board-page"><div className="board-loading">Loading board…</div></div>;
  if (error)     return <div className="board-page"><div className="board-error">Error: {error}</div></div>;
  if (!state)    return null;

  const epics   = state.epic_records || [];
  const chunks  = state.chunked_epics || [];
  const completed = epics.filter(e => e.status === 'COMPLETED').length;
  const total     = epics.length;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const active    = epics.find(e => e.status === 'IMPLEMENTING');
  const awaiting  = epics.filter(e => e.status === 'AWAITING_APPROVAL').length;

  return (
    <div className="board-page">
      {/* Header */}
      <div className="board-header">
        <button className="board-back-btn" onClick={() => navigate(`/projects/${id}/phases`)}>
          <MdArrowBack size={15} /> Back to Phases
        </button>
        <div className="board-title-row">
          <div>
            <h1 className="board-title">{state.project_title || id} — Implementation Board</h1>
            <p className="board-sub">
              {state.jira_project_key && <span>Jira: <strong>{state.jira_project_key}</strong> · </span>}
              {completed}/{total} epics complete
              {awaiting > 0 && <span className="awaiting-chip"> · {awaiting} awaiting review</span>}
            </p>
          </div>
          <button className="board-refresh-btn" onClick={loadState}><MdRefresh size={15} /> Refresh</button>
        </div>

        {/* Overall progress bar */}
        {total > 0 && (
          <div className="board-progress-wrap">
            <div className="board-progress-bar">
              <div className="board-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="board-progress-pct">{pct}%</span>
          </div>
        )}

        {/* Active epic banner */}
        {active && (
          <div className="active-banner">
            <span className="active-banner-dot" />
            <span>Currently implementing: <strong>{active.epic_id}</strong> — {active.epic_title}</span>
            {liveMessages[active.epic_id] && (
              <span className="active-banner-msg"> · {liveMessages[active.epic_id].slice(0, 100)}</span>
            )}
          </div>
        )}
      </div>

      {/* Epic sections */}
      <div className="board-body">
        {epics.length === 0 ? (
          <div className="board-empty">No epics loaded yet. Tickets will appear once the pipeline starts.</div>
        ) : (
          epics.map((record, i) => {
            const chunk = chunks.find(c => c.epic?.id === record.epic_id) || chunks[i];
            return (
              <EpicSection
                key={record.epic_id || i}
                chunk={chunk}
                record={record}
                liveMessage={liveMessages[record.epic_id] || null}
              />
            );
          })
        )}
      </div>
    </div>
  );
};

export default ProjectTasks;
