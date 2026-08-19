import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdAccessTime, MdError,
  MdOpenInNew, MdArrowBack, MdRefresh, MdCode, MdChat,
  MdCallMerge, MdPending, MdSchedule, MdExpandMore, MdChevronRight
} from 'react-icons/md';
import { getPipelineState, respondToHitl } from '../services/api';
import './ProjectReview.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const EPIC_STATUS_CONFIG = {
  COMPLETED:         { label: 'Completed',   color: '#10b981', bg: '#d1fae5', icon: MdCheckCircle },
  AWAITING_APPROVAL: { label: 'Review',      color: '#f59e0b', bg: '#fef3c7', icon: MdAccessTime },
  IMPLEMENTING:      { label: 'In Progress', color: '#3b82f6', bg: '#dbeafe', icon: MdAccessTime },
  FAILED:            { label: 'Failed',      color: '#ef4444', bg: '#fee2e2', icon: MdError },
  PENDING:           { label: 'Pending',     color: '#9ca3af', bg: '#f3f4f6', icon: MdPending },
};

function StatusBadge({ status }) {
  const cfg = EPIC_STATUS_CONFIG[status] || EPIC_STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className="status-badge" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={13} />
      {cfg.label}
    </span>
  );
}

function PlanningCard({ state }) {
  if (!state.planning_status || state.planning_status === 'PENDING') return null;
  const isDone = state.planning_status === 'COMPLETED' || state.planning_status === 'APPROVED';
  const isWaiting = state.planning_status === 'AWAITING_APPROVAL';
  const isFailed = state.planning_status === 'FAILED';

  return (
    <div className={`plan-card ${isDone ? 'done' : isWaiting ? 'waiting' : isFailed ? 'failed' : 'active'}`}>
      <div className="plan-card-header">
        <div className="plan-card-title">
          {isDone ? <MdCheckCircle size={20} color="#10b981" /> : isWaiting ? <MdAccessTime size={20} color="#f59e0b" /> : <MdAccessTime size={20} color="#3b82f6" />}
          <span>Architecture Plan (PLAN.md)</span>
          <StatusBadge status={isDone ? 'COMPLETED' : isWaiting ? 'AWAITING_APPROVAL' : 'IMPLEMENTING'} />
        </div>
        {state.planning_conversation_url && (
          <a href={state.planning_conversation_url} target="_blank" rel="noopener noreferrer" className="link-btn outline-btn">
            <MdChat size={14} /> View Session
          </a>
        )}
      </div>
      {state.plan_md_content && (
        <details className="plan-preview">
          <summary>Preview PLAN.md</summary>
          <pre>{state.plan_md_content.slice(0, 1200)}{state.plan_md_content.length > 1200 ? '\n…' : ''}</pre>
        </details>
      )}
    </div>
  );
}

function MarkdownRenderer({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];
  let listType = null;

  const flushList = () => {
    if (!listBuffer.length) return;
    const Tag = listType === 'ol' ? 'ol' : 'ul';
    elements.push(
      <Tag key={elements.length} style={{ margin: '0.4rem 0 0.4rem 1.2rem', paddingLeft: '0.5rem' }}>
        {listBuffer.map((item, i) => <li key={i} style={{ marginBottom: '0.2rem' }}>{renderInline(item)}</li>)}
      </Tag>
    );
    listBuffer = [];
    listType = null;
  };

  const renderInline = (str) => {
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={i}>{p.slice(2, -2)}</strong>
        : p
    );
  };

  lines.forEach((line, i) => {
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h4 = line.match(/^####\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+\.\s+(.*)/);

    if (h4) { flushList(); elements.push(<h5 key={i} style={{ margin: '0.6rem 0 0.2rem', fontSize: '0.82rem', fontWeight: '700', color: '#374151' }}>{h4[1]}</h5>); return; }
    if (h3) { flushList(); elements.push(<h4 key={i} style={{ margin: '0.75rem 0 0.2rem', fontSize: '0.88rem', fontWeight: '700', color: '#1f2937' }}>{h3[1]}</h4>); return; }
    if (h2) { flushList(); elements.push(<h3 key={i} style={{ margin: '0.9rem 0 0.3rem', fontSize: '0.95rem', fontWeight: '700', color: '#111827', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.2rem' }}>{h2[1]}</h3>); return; }
    if (ul) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listBuffer.push(ul[1]); return; }
    if (ol) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listBuffer.push(ol[1]); return; }
    flushList();
    if (line.trim() === '') { elements.push(<div key={i} style={{ height: '0.4rem' }} />); return; }
    elements.push(<p key={i} style={{ margin: '0.2rem 0', fontSize: '0.85rem', lineHeight: '1.55', color: '#166534' }}>{renderInline(line)}</p>);
  });
  flushList();
  return <>{elements}</>;
}

function isRealTestOutput(text) {
  if (!text) return false;
  return /passed|failed|error|PASSED|FAILED|ERROR|pytest|jest|vitest|test suite|test run|\.py::\|spec\b/i.test(text);
}

function StoriesSection({ record, stories, liveMessage }) {
  const status = record.status;

  if (!stories || stories.length === 0) return null;

  return (
    <div className="stories-section">
      <div className="stories-label">Stories</div>
      {stories.map((item, idx) => {
        // item can be {story: {id, title}, tasks: [...]} or {id, title} (from SSE fallback)
        const story = item.story || item;
        const tasks = item.tasks || [];
        const storyId = story.id || story.key || '';
        const storyTitle = story.title || story.summary || '';

        let rowClass = 'story-row';
        let icon = null;

        if (status === 'COMPLETED') {
          rowClass += ' done';
          icon = <MdCheckCircle size={14} className="story-icon" style={{ color: '#10b981' }} />;
        } else if (status === 'IMPLEMENTING') {
          rowClass += ' live';
          icon = <span className="pulse-dot story-icon" />;
        } else if (status === 'AWAITING_APPROVAL') {
          rowClass += '';
          icon = <MdSchedule size={14} className="story-icon" style={{ color: '#f59e0b' }} />;
        } else {
          rowClass += ' dim';
          icon = <MdRadioButtonUnchecked size={14} className="story-icon" style={{ color: '#d1d5db' }} />;
        }

        return (
          <div key={storyId || idx}>
            <div className={rowClass}>
              {icon}
              <span>{storyId && <strong style={{ marginRight: '4px', fontFamily: 'monospace', fontSize: '0.78rem' }}>{storyId}</strong>}{storyTitle}</span>
            </div>
            {tasks.length > 0 && (
              <div className="story-tasks">
                {tasks.map((task, ti) => {
                  const taskId = task.id || '';
                  const taskTitle = task.title || '';
                  return (
                    <div key={taskId || ti} className="task-row">
                      <MdRadioButtonUnchecked size={11} style={{ color: '#d1d5db', flexShrink: 0 }} />
                      <span>{taskId && <span style={{ fontFamily: 'monospace', fontSize: '0.73rem', marginRight: '4px' }}>{taskId}</span>}{taskTitle}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {status === 'IMPLEMENTING' && liveMessage && (
        <div className="live-feed">
          <span className="pulse-dot" style={{ flexShrink: 0, marginTop: '3px' }} />
          <span className="live-feed-msg">{liveMessage}</span>
        </div>
      )}
    </div>
  );
}

function EpicCard({ record, chunkedEpic, liveMessage, sseStories, projectId, onAction }) {
  const defaultOpen = ['AWAITING_APPROVAL', 'IMPLEMENTING', 'FAILED'].includes(record.status);
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const cfg = EPIC_STATUS_CONFIG[record.status] || EPIC_STATUS_CONFIG.PENDING;
  const hasPR = Boolean(record.pr_url);
  const hasSession = Boolean(record.conversation_url);
  const hasError = Boolean(record.error_message || record.merge_error);
  const isAwaiting = record.status === 'AWAITING_APPROVAL' && record.hitl_token;

  const handleHitl = async (action) => {
    if (!record.hitl_token) return;
    try {
      setIsActing(true);
      const username = localStorage.getItem('username');
      await respondToHitl(username, projectId, record.hitl_token, action);
      if (onAction) onAction();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  // Resolve stories: prefer chunked data, fall back to SSE stories
  const rawStories = chunkedEpic?.stories || sseStories || [];

  // Derive authoritative test counts from implementation_summary when available.
  // Stored record.tests_failed can be stale (captured from an intermediate failing run
  // that the agent subsequently fixed). The summary reflects the final state.
  const summaryText = record.implementation_summary || '';
  const summaryPassMatch = summaryText.match(/(\d+)\s+passed/);
  const summaryFailMatch = summaryText.match(/(\d+)\s+failed/i);
  const displayPassed = summaryPassMatch ? parseInt(summaryPassMatch[1]) : record.tests_passed;
  // If summary exists but has no "failed" count → final run had 0 failures
  const displayFailed = summaryText
    ? (summaryFailMatch ? parseInt(summaryFailMatch[1]) : 0)
    : record.tests_failed;

  const testsTotal = (displayPassed || 0) + (displayFailed || 0);
  const passWidth = testsTotal > 0 ? Math.round(((displayPassed || 0) / testsTotal) * 100) : 100;
  const hasTests = displayPassed != null;

  // CI chip color
  const ciColor = () => {
    if (!record.ci_status) return null;
    const s = record.ci_status.toLowerCase();
    if (s === 'passing') return 'passing';
    if (s === 'checking') return 'checking';
    if (s === 'fixing') return 'fixing';
    return 'failed';
  };

  return (
    <div className={`epic-card ${record.status.toLowerCase()}`}>
      {/* Header row */}
      <div className="epic-card-main" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
        <div className="epic-card-left">
          <span className="epic-id">{record.epic_id}</span>
          <div className="epic-info">
            <span className="epic-title">{record.epic_title}</span>
            <div className="epic-meta">
              <StatusBadge status={record.status} />
              {record.completed_at && (
                <span className="meta-chip">
                  Completed {new Date(record.completed_at).toLocaleDateString()}
                </span>
              )}
              {displayPassed != null && (
                <span className="meta-chip green">{displayPassed} passed</span>
              )}
              {displayFailed > 0 && (
                <span className="meta-chip red">{displayFailed} failed</span>
              )}
              {record.retry_count > 0 && (
                <span className="meta-chip amber">{record.retry_count} retr{record.retry_count === 1 ? 'y' : 'ies'}</span>
              )}
              {record.ci_status && (
                <span className={`ci-chip ${ciColor()}`}>{record.ci_status}</span>
              )}
            </div>
          </div>
        </div>

        <div className="epic-card-actions" onClick={e => e.stopPropagation()}>
          {hasPR && (
            <a href={record.pr_url} target="_blank" rel="noopener noreferrer" className="link-btn pr-btn" style={{ background: '#4f46e5' }}>
              <MdCallMerge size={14} /> View PR
            </a>
          )}
          {hasSession && (
            <a href={record.conversation_url} target="_blank" rel="noopener noreferrer" className="link-btn outline-btn">
              <MdCode size={14} /> View Session
            </a>
          )}
          {isAwaiting && (
            <>
              <button
                className="link-btn"
                disabled={isActing}
                onClick={() => handleHitl('reject')}
                style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5', opacity: isActing ? 0.6 : 1 }}
              >
                Reject
              </button>
              <button
                className="link-btn"
                disabled={isActing}
                onClick={() => handleHitl('approve')}
                style={{ background: '#10b981', color: 'white', opacity: isActing ? 0.6 : 1 }}
              >
                <MdCallMerge size={14} /> {isActing ? 'Processing...' : 'Merge & Continue'}
              </button>
            </>
          )}
          {hasError && (
            <button className="link-btn error-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              <MdError size={14} /> {expanded ? 'Hide' : 'Show'} Error
            </button>
          )}
        </div>
        <span style={{ color: '#9ca3af', marginLeft: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {collapsed ? <MdChevronRight size={20} /> : <MdExpandMore size={20} />}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Stories section */}
          <StoriesSection
            record={record}
            stories={rawStories}
            liveMessage={liveMessage}
          />

          {/* Implementation summary */}
          {record.implementation_summary && (
            <div className="impl-summary">
              <div className="impl-summary-label">What was built:</div>
              <div className="impl-summary-text">
                <MarkdownRenderer text={record.implementation_summary} />
              </div>
            </div>
          )}

          {/* Test results panel */}
          {hasTests && (
            <div className="test-panel">
              <div className="test-bar-wrap">
                <div className="test-bar-pass" style={{ width: `${passWidth}%` }} />
              </div>
              <div className="test-counts">
                <span className="pass">{displayPassed || 0} passed</span>
                {displayFailed > 0 && <span className="fail">{displayFailed} failed</span>}
              </div>
              {record.test_output && isRealTestOutput(record.test_output) && (
                <div className="test-output">
                  <details>
                    <summary>View test output</summary>
                    <pre>{record.test_output}</pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* Branch chip */}
          {record.branch_name && (
            <div className="epic-branch">
              <MdCode size={13} /> Branch: <code>{record.branch_name}</code>
            </div>
          )}

          {/* Error expandable */}
          {expanded && hasError && (
            <div className="epic-error-detail">
              <strong>Error:</strong>
              <pre>{record.error_message || record.merge_error}</pre>
              {record.ci_failure_summary && (
                <>
                  <strong>CI:</strong>
                  <pre>{record.ci_failure_summary}</pre>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ProjectReview = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [liveMessages, setLiveMessages] = useState({});     // epicId → latest message string
  const [epicStories, setEpicStories] = useState({});       // epicId → [{id, title}]
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

  // SSE connection
  useEffect(() => {
    const username = localStorage.getItem('username');
    if (!username) return;

    const sseUrl = `${API_BASE_URL}/api/v1/pipeline/status/${id}?username=${encodeURIComponent(username)}`;
    const es = new EventSource(sseUrl);
    sseRef.current = es;

    es.addEventListener('EPIC_AGENT_MESSAGE', (e) => {
      try {
        const d = JSON.parse(e.data);
        setLiveMessages(prev => ({ ...prev, [d.epic_id]: d.message || '' }));
      } catch {}
    });

    es.addEventListener('EPIC_STARTED', (e) => {
      try {
        const d = JSON.parse(e.data);
        // Clear old live message for this epic on restart
        setLiveMessages(prev => ({ ...prev, [d.epic_id]: '' }));
      } catch {}
    });

    es.addEventListener('EPIC_STORIES', (e) => {
      try {
        const d = JSON.parse(e.data);
        setEpicStories(prev => ({ ...prev, [d.epic_id]: d.stories || [] }));
      } catch {}
    });

    // Reload full state whenever anything meaningful changes
    const reload = () => loadState();
    es.addEventListener('state_update',          reload);
    es.addEventListener('EPIC_AWAITING_APPROVAL', reload);
    es.addEventListener('EPIC_COMPLETED',         reload);
    es.addEventListener('EPIC_FAILED',            reload);
    es.addEventListener('EPIC_APPROVED',          reload);
    es.addEventListener('EPIC_REJECTED',          reload);
    es.addEventListener('PIPELINE_COMPLETED',     reload);
    es.addEventListener('PIPELINE_FAILED',        reload);
    es.addEventListener('PIPELINE_PAUSED',        reload);
    es.addEventListener('CODE_GENERATION_STARTED',reload);

    return () => { es.close(); sseRef.current = null; };
  }, [id]);

  if (isLoading) return <div className="review-page"><div className="review-loading">Loading review...</div></div>;
  if (error) return <div className="review-page"><div className="review-error">Error: {error}</div></div>;
  if (!state) return null;

  const epics = state.epic_records || [];
  const counts = {
    total: epics.length,
    completed: epics.filter(e => e.status === 'COMPLETED').length,
    inProgress: epics.filter(e => e.status === 'IMPLEMENTING').length,
    awaiting: epics.filter(e => e.status === 'AWAITING_APPROVAL').length,
    failed: epics.filter(e => e.status === 'FAILED').length,
    pending: epics.filter(e => e.status === 'PENDING').length,
  };
  const prs = epics.filter(e => e.pr_url).length;
  const overallPct = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  return (
    <div className="review-page">
      <div className="review-header">
        <button className="back-btn" onClick={() => navigate(`/projects/${id}/phases`)}>
          <MdArrowBack size={16} /> Back to Phases
        </button>
        <div className="review-title-row">
          <h1>Implementation Review</h1>
          <button className="refresh-btn" onClick={loadState}><MdRefresh size={16} /> Refresh</button>
        </div>
        <p className="review-subtitle">
          {state.project_title} · {state.jira_project_key ? `Jira: ${state.jira_project_key}` : ''} · Status: <strong>{state.status?.toLowerCase().replace(/_/g, ' ')}</strong>
        </p>
      </div>

      {/* Stats */}
      <div className="review-stats">
        <div className="stat-card">
          <div className="stat-num">{counts.total}</div>
          <div className="stat-label">Total Epics</div>
        </div>
        <div className="stat-card green">
          <div className="stat-num">{counts.completed}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-num">{counts.inProgress + counts.awaiting}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card red">
          <div className="stat-num">{counts.failed}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-num">{prs}</div>
          <div className="stat-label">PRs Raised</div>
        </div>
        <div className="stat-card progress-card">
          <div className="stat-num">{overallPct}%</div>
          <div className="stat-label">Complete</div>
          <div className="mini-bar"><div className="mini-bar-fill" style={{ width: `${overallPct}%` }} /></div>
        </div>
      </div>

      {/* Planning section */}
      <section className="review-section">
        <h2 className="section-heading">Planning Phase</h2>
        <PlanningCard state={state} />
        {!state.planning_status || state.planning_status === 'PENDING' ? (
          <div className="empty-state">Planning has not started yet.</div>
        ) : null}
      </section>

      {/* Epics section */}
      <section className="review-section">
        <h2 className="section-heading">Epics &amp; Implementation</h2>
        {epics.length === 0 ? (
          <div className="empty-state">No epics have been queued yet.</div>
        ) : (
          <div className="epics-list">
            {epics.map((record, i) => {
              const chunkedEntry = (state.chunked_epics || []).find(
                c => c.epic?.id === record.epic_id
              );
              return (
                <EpicCard
                  key={record.epic_id || i}
                  record={record}
                  chunkedEpic={chunkedEntry}
                  liveMessage={liveMessages[record.epic_id] || null}
                  sseStories={epicStories[record.epic_id] || null}
                  projectId={id}
                  onAction={loadState}
                />
              );
            })}
          </div>
        )}
      </section>

      {state.last_error && (
        <section className="review-section">
          <h2 className="section-heading" style={{ color: '#ef4444' }}>Last Pipeline Error</h2>
          <div className="pipeline-error-box"><pre>{state.last_error}</pre></div>
        </section>
      )}
    </div>
  );
};

export default ProjectReview;
