import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdAccessTime, MdError,
  MdArrowBack, MdRefresh, MdWarning, MdOpenInNew, MdCallMerge,
  MdCode, MdSchedule, MdRateReview, MdPending
} from 'react-icons/md';
import {
  getProjectById, getPipelineState, respondToHitl, resumePipeline
} from '../services/api';
import './ProjectPage.css';

const API_BASE_URL  = import.meta.env.VITE_API_BASE_URL;
const JIRA_BASE_URL = import.meta.env.VITE_JIRA_BASE_URL || 'https://randstaddigital-team-jtpx49im.atlassian.net';

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASES = ['Requirements Analysis', 'Planning', 'Development', 'Testing', 'Deployment'];

const PHASE_FROM_STATUS = {
  INITIALIZED: 'Requirements Analysis', PIPELINE_LAUNCHED: 'Requirements Analysis',
  JIRA_FETCHING: 'Requirements Analysis', JIRA_LOADED: 'Requirements Analysis',
  JIRA_FETCHED_AWAITING_SELECTION: 'Requirements Analysis', TICKETS_SELECTED: 'Requirements Analysis',
  JIRA_ANALYZED: 'Planning', PLANNING: 'Planning', PLANNING_APPROVED: 'Planning',
  CODE_GENERATION_IN_PROGRESS: 'Development', READY_FOR_REVIEW: 'Testing',
  APPROVAL_RECEIVED_DEPLOYING: 'Deployment', APPLICATION_DEPLOYED: 'Deployment',
  COMPLETED: 'Deployment', COMPLETED_WITH_ERRORS: 'Deployment',
  FAILED: 'Failed', CANCELLED: 'Cancelled',
};

const EPIC_CFG = {
  COMPLETED:         { label: 'Done',        color: '#10b981', bg: '#d1fae5', border: '#6ee7b7' },
  AWAITING_APPROVAL: { label: 'In Review',   color: '#f59e0b', bg: '#fef3c7', border: '#fcd34d' },
  IMPLEMENTING:      { label: 'In Progress', color: '#6366f1', bg: '#eef2ff', border: '#a5b4fc' },
  FAILED:            { label: 'Failed',      color: '#ef4444', bg: '#fee2e2', border: '#fca5a5' },
  PENDING:           { label: 'To Do',       color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
};

const KANBAN_COLS = [
  { key: 'PENDING',           label: 'To Do',       statuses: ['PENDING'] },
  { key: 'IMPLEMENTING',      label: 'In Progress', statuses: ['IMPLEMENTING'] },
  { key: 'AWAITING_APPROVAL', label: 'In Review',   statuses: ['AWAITING_APPROVAL'] },
  { key: 'COMPLETED',         label: 'Done',        statuses: ['COMPLETED', 'FAILED'] },
];

function jiraHref(id) { return `${JIRA_BASE_URL}/browse/${id}`; }

// ─── Small shared components ──────────────────────────────────────────────────

function EpicStatusPill({ status }) {
  const c = EPIC_CFG[status] || EPIC_CFG.PENDING;
  return (
    <span className="pp-pill" style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}>
      {status === 'IMPLEMENTING' && <span className="pp-pulse-dot" style={{ background: c.color }} />}
      {c.label}
    </span>
  );
}

function PhaseBar({ currentPhase, progress }) {
  const idx = PHASES.indexOf(currentPhase);
  return (
    <div className="pp-phase-bar">
      {PHASES.map((p, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <div key={p} className={`pp-phase-step ${done ? 'done' : active ? 'active' : 'pending'}`}>
            <div className="pp-phase-circle">
              {done ? <MdCheckCircle size={16} /> : active ? <MdAccessTime size={16} /> : <MdRadioButtonUnchecked size={16} />}
            </div>
            <span className="pp-phase-label">{p}</span>
            {i < PHASES.length - 1 && <div className={`pp-phase-line ${done ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function PlanMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = []; let buf = [], lt = null;
  const flush = () => {
    if (!buf.length) return;
    const Tag = lt === 'ol' ? 'ol' : 'ul';
    out.push(<Tag key={out.length} style={{ margin:'0.25rem 0 0.25rem 1.1rem', paddingLeft:'0.3rem' }}>
      {buf.map((item,i) => <li key={i} style={{ marginBottom:'0.1rem', fontSize:'0.85rem', color:'#374151' }}>{ri(item)}</li>)}
    </Tag>);
    buf = []; lt = null;
  };
  const ri = str => str.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p,i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2,-2)}</strong>;
    if (p.startsWith('`')  && p.endsWith('`'))  return <code key={i} style={{ background:'#f3f4f6', padding:'1px 5px', borderRadius:'3px', fontFamily:'monospace', fontSize:'0.82em' }}>{p.slice(1,-1)}</code>;
    return p;
  });
  lines.forEach((line, i) => {
    const h1=line.match(/^#\s+(.*)/), h2=line.match(/^##\s+(.*)/), h3=line.match(/^###\s+(.*)/);
    const ul=line.match(/^[-*]\s+(.*)/), ol=line.match(/^\d+\.\s+(.*)/);
    if (h1) { flush(); out.push(<h2 key={i} style={{ margin:'1rem 0 0.3rem', fontSize:'1rem', fontWeight:'700', color:'#111827', borderBottom:'2px solid #f3f4f6', paddingBottom:'0.25rem' }}>{h1[1]}</h2>); return; }
    if (h2) { flush(); out.push(<h3 key={i} style={{ margin:'0.75rem 0 0.2rem', fontSize:'0.9rem', fontWeight:'700', color:'#1f2937' }}>{h2[1]}</h3>); return; }
    if (h3) { flush(); out.push(<h4 key={i} style={{ margin:'0.5rem 0 0.15rem', fontSize:'0.84rem', fontWeight:'700', color:'#374151' }}>{h3[1]}</h4>); return; }
    if (ul) { if (lt!=='ul'){flush();lt='ul';} buf.push(ul[1]); return; }
    if (ol) { if (lt!=='ol'){flush();lt='ol';} buf.push(ol[1]); return; }
    flush();
    if (!line.trim()) { out.push(<div key={i} style={{ height:'0.35rem' }}/>); return; }
    out.push(<p key={i} style={{ margin:'0.1rem 0', fontSize:'0.85rem', lineHeight:'1.6', color:'#374151' }}>{ri(line)}</p>);
  });
  flush();
  return <div style={{ maxHeight:'400px', overflowY:'auto', paddingRight:'4px' }}>{out}</div>;
}

function OverviewTab({ project, pstate, liveActivity, onAction, isActing, setIsActing, onGoToReview }) {
  const navigate = useNavigate();
  const { id } = useParams();
  if (!project) return null;

  const rawStatus   = (project.rawStatus || '').toUpperCase();
  const epicRecords = project.epic_records || [];
  const anyEpicActive = epicRecords.some(e => ['IMPLEMENTING','AWAITING_APPROVAL','COMPLETED','FAILED'].includes(e.status));

  const deriveCurrentPhase = () => {
    if (epicRecords.some(e => ['IMPLEMENTING','AWAITING_APPROVAL'].includes(e.status))) return 'Development';
    if (epicRecords.length > 0 && epicRecords.every(e => e.status === 'COMPLETED'))
      return ['COMPLETED','APPLICATION_DEPLOYED','APPROVAL_RECEIVED_DEPLOYING'].includes(rawStatus) ? 'Deployment' : 'Testing';
    if (epicRecords.some(e => e.status === 'COMPLETED')) return 'Development';
    // If Jira is already configured but pipeline not started, skip to Planning
    if (rawStatus === 'INITIALIZED' && pstate?.jira_project_key) return 'Planning';
    return PHASE_FROM_STATUS[rawStatus] || 'Requirements Analysis';
  };
  const currentPhase = deriveCurrentPhase();

  const handleHitl = async (token, action) => {
    try {
      setIsActing(true);
      await respondToHitl(localStorage.getItem('username'), id, token, action);
      await new Promise(r => setTimeout(r, 800));
      onAction();
    } catch (err) { alert(`Failed: ${err.message}`); }
    finally { setIsActing(false); }
  };

  const completed = epicRecords.filter(e => e.status === 'COMPLETED').length;
  const failed    = epicRecords.filter(e => e.status === 'FAILED').length;
  const total     = epicRecords.length;

  // Find the epic needing attention
  const awaitingEpic     = epicRecords.find(e => e.status === 'AWAITING_APPROVAL');
  const implementingEpic = epicRecords.find(e => e.status === 'IMPLEMENTING');
  const planningStatus   = pstate?.planning_status || project.planningStatus;

  // Summary text from implementation_summary
  const getTestSummary = (record) => {
    if (!record) return null;
    const s = record.implementation_summary || '';
    const m = s.match(/(\d+)\s+passed/);
    const f = s.match(/(\d+)\s+failed/i);
    const passed = m ? parseInt(m[1]) : record.tests_passed;
    const failedN = s ? (f ? parseInt(f[1]) : 0) : record.tests_failed;
    if (passed == null) return null;
    return failedN > 0 ? `${passed} passed · ${failedN} failed` : `${passed} tests passed`;
  };

  const renderActionCard = () => {
    if (rawStatus === 'JIRA_FETCHED_AWAITING_SELECTION') return (
      <div className="pp-action-card amber">
        <div className="pp-action-header"><MdWarning size={18}/> Action Required</div>
        <div className="pp-action-title">Select Jira tickets to continue</div>
        <div className="pp-action-desc">Choose which tickets from <strong>{pstate?.jira_project_key || 'Jira'}</strong> to include before planning begins.</div>
        <div className="pp-action-btns">
          <button className="pp-btn amber" onClick={() => navigate(`/projects/${id}/select-tickets`)}>Select Tickets</button>
        </div>
      </div>
    );

    if (!anyEpicActive && planningStatus === 'APPROVED') return (
      <div className="pp-action-card green">
        <div className="pp-action-header"><MdCheckCircle size={18}/> Ready</div>
        <div className="pp-action-title">Architecture plan approved</div>
        <div className="pp-action-desc">PLAN.md has been committed to the repository. Start code generation to begin implementing all {total} epics.</div>
        <div className="pp-action-btns">
          <button className="pp-btn green" disabled={isActing} onClick={async () => {
            try { setIsActing(true); await resumePipeline(localStorage.getItem('username'), id); await new Promise(r=>setTimeout(r,1200)); onAction(); }
            catch(err){ alert(err.message); } finally{ setIsActing(false); }
          }}>{isActing ? 'Starting…' : 'Start Code Generation'}</button>
        </div>
      </div>
    );

    if (planningStatus === 'AWAITING_APPROVAL' && project.planToken) return (
      <div className="pp-action-card purple">
        <div className="pp-action-header"><MdRateReview size={18}/> Approval Required</div>
        <div className="pp-action-title">Architecture plan ready for review</div>
        <div className="pp-action-desc">The AI has written PLAN.md — the blueprint defining the tech stack, directory structure, API contracts and epic sequence. Review it before code generation begins.</div>
        <div className="pp-action-btns">
          {pstate?.planning_conversation_url && (
            <a href={pstate.planning_conversation_url} target="_blank" rel="noopener noreferrer" className="pp-btn outline">View Session</a>
          )}
          <button className="pp-btn purple" disabled={isActing} onClick={() => handleHitl(project.planToken, 'approve')}>
            {isActing ? 'Processing…' : 'Approve Plan'}
          </button>
        </div>
      </div>
    );

    if (implementingEpic && !liveActivity.epicId) return (
      <div className="pp-action-card amber">
        <div className="pp-action-header"><MdWarning size={18}/> Pipeline Stopped</div>
        <div className="pp-action-title">{implementingEpic.epic_id}: {implementingEpic.epic_title}</div>
        <div className="pp-action-desc">This epic was being implemented but the pipeline task stopped (server restart). Click resume to continue from where it left off.</div>
        <div className="pp-action-btns">
          <button className="pp-btn amber" disabled={isActing} onClick={async () => {
            try { setIsActing(true); await resumePipeline(localStorage.getItem('username'), id); await new Promise(r=>setTimeout(r,1500)); onAction(); }
            catch(err){ alert(err.message); } finally{ setIsActing(false); }
          }}>{isActing ? 'Resuming…' : 'Resume Pipeline'}</button>
        </div>
      </div>
    );

    if (awaitingEpic) {
      const tests = getTestSummary(awaitingEpic);
      return (
        <div className="pp-action-card teal">
          <div className="pp-action-header"><MdCheckCircle size={18}/> Code Review Required</div>
          <div className="pp-action-title">{awaitingEpic.epic_id}: {awaitingEpic.epic_title}</div>
          <div className="pp-action-meta">
            {tests && <span className="pp-action-chip green">✓ {tests}</span>}
            {awaitingEpic.pr_url && (
              <a href={awaitingEpic.pr_url} target="_blank" rel="noopener noreferrer" className="pp-action-chip link">
                <MdCallMerge size={12}/> View Pull Request
              </a>
            )}
            {awaitingEpic.branch_name && <span className="pp-action-chip">branch: {awaitingEpic.branch_name}</span>}
          </div>
          <div className="pp-action-desc">
            Review the pull request for this epic. Approving will merge it into the main branch and continue to the next epic. Rejecting will re-run the implementation with your feedback.
          </div>
          <div className="pp-action-btns">
            {awaitingEpic.pr_url && (
              <a href={awaitingEpic.pr_url} target="_blank" rel="noopener noreferrer" className="pp-btn outline">Open PR ↗</a>
            )}
            <button className="pp-btn outline" style={{ color:'#ef4444', borderColor:'#fca5a5' }} disabled={isActing}
              onClick={() => handleHitl(awaitingEpic.hitl_token, 'reject')}>Reject</button>
            <button className="pp-btn teal" disabled={isActing}
              onClick={() => handleHitl(awaitingEpic.hitl_token, 'approve')}>
              {isActing ? 'Processing…' : 'Merge & Continue →'}
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const EPIC_DOT = {
    COMPLETED:         { color: '#10b981', label: 'Done'        },
    AWAITING_APPROVAL: { color: '#f59e0b', label: 'In Review'   },
    IMPLEMENTING:      { color: '#6366f1', label: 'In Progress' },
    FAILED:            { color: '#ef4444', label: 'Failed'      },
    PENDING:           { color: '#d1d5db', label: 'Pending'     },
  };

  return (
    <div className="pp-overview">

      {/* Project info */}
      <div className="pp-info-grid">
        <div className="pp-info-card">
          <div className="pp-info-label">Description</div>
          <div className="pp-info-value">{project.description || <span style={{color:'#9ca3af'}}>No description</span>}</div>
        </div>
        <div className="pp-info-card">
          <div className="pp-info-label">Jira Project</div>
          <div className="pp-info-value">
            {pstate?.jira_project_key
              ? <a href={`${JIRA_BASE_URL}/jira/software/projects/${pstate.jira_project_key}/boards`} target="_blank" rel="noopener noreferrer" className="pp-info-link">
                  {pstate.jira_project_key} <MdOpenInNew size={12}/>
                </a>
              : <span style={{color:'#9ca3af'}}>—</span>}
          </div>
        </div>
        <div className="pp-info-card">
          <div className="pp-info-label">Repository</div>
          <div className="pp-info-value">
            {pstate?.github_repo
              ? <a href={`https://github.com/${pstate.github_repo}`} target="_blank" rel="noopener noreferrer" className="pp-info-link">
                  {pstate.github_repo} <MdOpenInNew size={12}/>
                </a>
              : <span style={{color:'#9ca3af'}}>Not configured</span>}
          </div>
        </div>
        <div className="pp-info-card">
          <div className="pp-info-label">Due Date</div>
          <div className="pp-info-value">{project.dueDate && project.dueDate !== 'TBD' ? project.dueDate : <span style={{color:'#9ca3af'}}>—</span>}</div>
        </div>
      </div>

      {/* Epic progress strip */}
      {total > 0 && (
        <div className="pp-card">
          <div className="pp-card-title-row">
            <span className="pp-card-title">Implementation Progress</span>
            <span className="pp-card-subtitle">{completed}/{total} epics · {project.progress || 0}% complete</span>
          </div>
          <div className="pp-progress-wrap" style={{ marginBottom: '1rem' }}>
            <div className="pp-progress-track">
              <div className="pp-progress-fill" style={{ width: `${project.progress || 0}%` }} />
            </div>
            <span className="pp-progress-pct">{project.progress || 0}%</span>
          </div>
          <div className="pp-epic-dots">
            {epicRecords.map((e, i) => {
              const cfg = EPIC_DOT[e.status] || EPIC_DOT.PENDING;
              return (
                <div
                  key={e.epic_id || i}
                  className="pp-epic-dot-item"
                  onClick={() => onGoToReview && onGoToReview(e.epic_id)}
                  title={`${e.epic_id}: ${e.epic_title} — ${cfg.label}`}
                >
                  <span className={`pp-epic-dot-circle ${e.status === 'IMPLEMENTING' ? 'pulse' : ''}`}
                    style={{ background: cfg.color }} />
                  <span className="pp-epic-dot-id">{e.epic_id}</span>
                  <span className="pp-epic-dot-title">{e.epic_title}</span>
                  <span className="pp-epic-dot-status" style={{ color: cfg.color }}>{cfg.label}</span>
                </div>
              );
            })}
          </div>
          {(failed > 0 || completed < total) && (
            <div className="pp-epic-counts">
              {completed > 0 && <span style={{color:'#10b981'}}>✓ {completed} done</span>}
              {epicRecords.filter(e=>e.status==='AWAITING_APPROVAL').length > 0 && <span style={{color:'#f59e0b'}}>⚡ {epicRecords.filter(e=>e.status==='AWAITING_APPROVAL').length} in review</span>}
              {epicRecords.filter(e=>e.status==='IMPLEMENTING').length > 0 && <span style={{color:'#6366f1'}}>● implementing</span>}
              {failed > 0 && <span style={{color:'#ef4444'}}>✗ {failed} failed</span>}
            </div>
          )}
        </div>
      )}

      {/* Phase stepper */}
      <div className="pp-card">
        <div className="pp-card-title">SDLC Phase</div>
        <PhaseBar currentPhase={currentPhase} progress={project.progress} />
      </div>

      {/* Action card */}
      {renderActionCard()}

      {/* Live activity */}
      {liveActivity.epicId && (
        <div className="pp-live-card">
          <span className="pp-live-dot" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pp-live-title">{liveActivity.epicId} — {liveActivity.epicTitle}</div>
            {liveActivity.message && <div className="pp-live-msg">{liveActivity.message}</div>}
          </div>
          {liveActivity.ciStatus === 'checking' && <span className="pp-ci-chip amber">CI Running</span>}
          {liveActivity.ciStatus === 'passed'   && <span className="pp-ci-chip green">CI Passed</span>}
        </div>
      )}

      {/* PLAN.md — rendered as markdown */}
      {pstate?.plan_md_content && (
        <div className="pp-card">
          <div className="pp-card-title-row">
            <span className="pp-card-title">Architecture Plan</span>
            {pstate.planning_conversation_url && (
              <a href={pstate.planning_conversation_url} target="_blank" rel="noopener noreferrer" className="pp-info-link" style={{fontSize:'0.78rem'}}>
                View session <MdOpenInNew size={11}/>
              </a>
            )}
          </div>
          <div className="pp-plan-rendered">
            <PlanMarkdown text={pstate.plan_md_content} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Board tab (Epic Kanban) ──────────────────────────────────────────────────

function BoardTab({ pstate, liveMessages, onCardClick }) {
  if (!pstate) return <div className="pp-empty">Pipeline data not available yet.</div>;

  const epics  = pstate.epic_records || [];
  const chunks = pstate.chunked_epics || [];

  if (epics.length === 0) return (
    <div className="pp-empty">No epics loaded yet. They appear once the pipeline starts.</div>
  );

  return (
    <div className="pp-kanban">
      {KANBAN_COLS.map(col => {
        const colEpics = epics.filter(e => col.statuses.includes(e.status));
        const cfg = EPIC_CFG[col.key] || EPIC_CFG.PENDING;
        return (
          <div key={col.key} className="pp-kanban-col">
            <div className="pp-kanban-header">
              <span className="pp-kanban-title" style={{ color: cfg.color }}>{col.label}</span>
              <span className="pp-kanban-count" style={{ background: cfg.bg, color: cfg.color }}>{colEpics.length}</span>
            </div>
            <div className="pp-kanban-cards">
              {colEpics.map((record, i) => {
                const chunk   = chunks.find(c => c.epic?.id === record.epic_id) || {};
                const stories = chunk.stories || [];
                const live    = liveMessages[record.epic_id];
                const cfg2    = EPIC_CFG[record.status] || EPIC_CFG.PENDING;
                const summaryText = record.implementation_summary || '';
                const passMatch   = summaryText.match(/(\d+)\s+passed/);
                const displayPassed = passMatch ? parseInt(passMatch[1]) : record.tests_passed;

                return (
                  <div key={record.epic_id || i} className="pp-kanban-card"
                    style={{ borderTop: `3px solid ${cfg2.color}`, cursor: onCardClick ? 'pointer' : 'default' }}
                    onClick={() => onCardClick && onCardClick(record.epic_id)}>
                    <div className="pp-kcard-header">
                      <span className="pp-kcard-id">{record.epic_id}</span>
                      <EpicStatusPill status={record.status} />
                    </div>
                    <div className="pp-kcard-title">{record.epic_title}</div>

                    {/* Live message */}
                    {record.status === 'IMPLEMENTING' && live && (
                      <div className="pp-kcard-live">
                        <span className="pp-pulse-dot-sm" />
                        <span>{live.slice(0, 80)}</span>
                      </div>
                    )}

                    {/* Stories mini-list */}
                    {stories.length > 0 && (
                      <div className="pp-kcard-stories">
                        {stories.slice(0, 4).map((s, si) => {
                          const story = s.story || s;
                          const sid   = story.id || '';
                          const stitle = (story.title || '').slice(0, 40);
                          const done  = ['COMPLETED','AWAITING_APPROVAL'].includes(record.status);
                          return (
                            <div key={sid || si} className={`pp-kcard-story ${done ? 'done' : ''}`}>
                              {done
                                ? <MdCheckCircle size={11} style={{ color: '#10b981', flexShrink: 0 }} />
                                : <MdRadioButtonUnchecked size={11} style={{ color: '#d1d5db', flexShrink: 0 }} />
                              }
                              <span>{sid && <code className="pp-kcard-story-id">{sid}</code>} {stitle}</span>
                              {sid && (
                                <a href={jiraHref(sid)} target="_blank" rel="noopener noreferrer" className="pp-kcard-jira-link" onClick={e => e.stopPropagation()} title="Open in Jira">
                                  <MdOpenInNew size={10} />
                                </a>
                              )}
                            </div>
                          );
                        })}
                        {stories.length > 4 && (
                          <span className="pp-kcard-more">+{stories.length - 4} more stories</span>
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="pp-kcard-footer">
                      {displayPassed != null && (
                        <span className="pp-kcard-tests">✓ {displayPassed} passed</span>
                      )}
                      <div className="pp-kcard-links">
                        {chunk.epic?.id && (
                          <a href={jiraHref(chunk.epic.id)} target="_blank" rel="noopener noreferrer" className="pp-kcard-link">
                            <MdOpenInNew size={11} /> Jira
                          </a>
                        )}
                        {record.pr_url && (
                          <a href={record.pr_url} target="_blank" rel="noopener noreferrer" className="pp-kcard-link pr">
                            <MdCallMerge size={11} /> PR
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {colEpics.length === 0 && (
                <div className="pp-kanban-empty">No epics here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Review tab ───────────────────────────────────────────────────────────────

function MarkdownRenderer({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let buf = [], listType = null;
  const flush = () => {
    if (!buf.length) return;
    const Tag = listType === 'ol' ? 'ol' : 'ul';
    out.push(<Tag key={out.length} style={{ margin: '0.3rem 0 0.3rem 1.1rem', paddingLeft: '0.4rem' }}>
      {buf.map((item, i) => <li key={i} style={{ marginBottom: '0.15rem', fontSize: '0.84rem' }}>{ri(item)}</li>)}
    </Tag>);
    buf = []; listType = null;
  };
  const ri = str => str.split(/(\*\*[^*]+\*\*)/).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2,-2)}</strong> : p
  );
  lines.forEach((line, i) => {
    const h2 = line.match(/^##\s+(.*)/); const h3 = line.match(/^###\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/); const ol = line.match(/^\d+\.\s+(.*)/);
    if (h3) { flush(); out.push(<h4 key={i} style={{ margin:'0.5rem 0 0.15rem', fontSize:'0.87rem', fontWeight:'700', color:'#1f2937' }}>{h3[1]}</h4>); return; }
    if (h2) { flush(); out.push(<h3 key={i} style={{ margin:'0.7rem 0 0.2rem', fontSize:'0.93rem', fontWeight:'700', color:'#111827', borderBottom:'1px solid #f3f4f6', paddingBottom:'0.2rem' }}>{h2[1]}</h3>); return; }
    if (ul) { if (listType !== 'ul') { flush(); listType = 'ul'; } buf.push(ul[1]); return; }
    if (ol) { if (listType !== 'ol') { flush(); listType = 'ol'; } buf.push(ol[1]); return; }
    flush();
    if (!line.trim()) { out.push(<div key={i} style={{ height:'0.3rem' }} />); return; }
    out.push(<p key={i} style={{ margin:'0.15rem 0', fontSize:'0.84rem', lineHeight:'1.55', color:'#374151' }}>{ri(line)}</p>);
  });
  flush();
  return <>{out}</>;
}

function isRealTestOutput(t) {
  return t && /passed|failed|PASSED|FAILED|ERROR|pytest|jest|vitest|\.py::/i.test(t);
}

function ReviewTab({ pstate, projectId, onAction }) {
  const [actingToken, setActingToken] = useState(null);

  if (!pstate) return <div className="pp-empty">Pipeline data not available yet.</div>;

  const epics = pstate.epic_records || [];
  const chunks = pstate.chunked_epics || [];

  const handleHitl = async (token, action) => {
    try {
      setActingToken(token + action);
      const username = localStorage.getItem('username');
      await respondToHitl(username, projectId, token, action);
      onAction();
    } catch (err) { alert(`Failed: ${err.message}`); }
    finally { setActingToken(null); }
  };

  return (
    <div className="pp-review">
      {/* Planning section */}
      {pstate.planning_status && pstate.planning_status !== 'PENDING' && (
        <div className="pp-review-section">
          <div className="pp-review-heading">Architecture Plan</div>
          <div className={`pp-review-plan ${['COMPLETED','APPROVED'].includes(pstate.planning_status) ? 'done' : ''}`}>
            <div className="pp-review-plan-row">
              {['COMPLETED','APPROVED'].includes(pstate.planning_status)
                ? <MdCheckCircle size={18} color="#10b981" />
                : <MdAccessTime size={18} color="#f59e0b" />
              }
              <span className="pp-review-plan-title">PLAN.md</span>
              <span className="pp-pill" style={{ color: ['COMPLETED','APPROVED'].includes(pstate.planning_status) ? '#10b981' : '#f59e0b', background: ['COMPLETED','APPROVED'].includes(pstate.planning_status) ? '#d1fae5' : '#fef3c7', border: 'none' }}>
                {pstate.planning_status}
              </span>
              {pstate.planning_conversation_url && (
                <a href={pstate.planning_conversation_url} target="_blank" rel="noopener noreferrer" className="pp-review-link">
                  <MdCode size={13} /> View Session
                </a>
              )}
            </div>
            {pstate.plan_md_content && (
              <details style={{ marginTop: '0.75rem' }}>
                <summary style={{ fontSize: '0.78rem', color: '#6b7280', cursor: 'pointer' }}>Preview PLAN.md</summary>
                <pre className="pp-code-block">{pstate.plan_md_content.slice(0,1200)}{pstate.plan_md_content.length > 1200 ? '\n…' : ''}</pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Epics */}
      <div className="pp-review-section">
        <div className="pp-review-heading">Epics &amp; Implementation</div>
        {epics.length === 0 && <div className="pp-empty">No epics yet.</div>}
        {epics.map((record, i) => {
          const chunk = chunks.find(c => c.epic?.id === record.epic_id) || chunks[i] || {};
          const stories = chunk.stories || [];
          const cfg = EPIC_CFG[record.status] || EPIC_CFG.PENDING;
          const summaryText = record.implementation_summary || '';
          const passMatch = summaryText.match(/(\d+)\s+passed/);
          const failMatch = summaryText.match(/(\d+)\s+failed/i);
          const displayPassed = passMatch ? parseInt(passMatch[1]) : record.tests_passed;
          const displayFailed = summaryText ? (failMatch ? parseInt(failMatch[1]) : 0) : record.tests_failed;
          const testsTotal = (displayPassed||0) + (displayFailed||0);
          const passWidth  = testsTotal > 0 ? Math.round(((displayPassed||0)/testsTotal)*100) : (displayPassed != null ? 100 : 0);
          const isAwaiting = record.status === 'AWAITING_APPROVAL' && record.hitl_token;

          return (
            <details key={record.epic_id || i} className="pp-epic-details" open={['AWAITING_APPROVAL','IMPLEMENTING','FAILED'].includes(record.status)}>
              <summary className="pp-epic-summary" style={{ borderLeft: `4px solid ${cfg.color}` }}>
                <div className="pp-epic-summary-left">
                  <span className="pp-epic-key">{record.epic_id}</span>
                  <span className="pp-epic-title-text">{record.epic_title}</span>
                  <EpicStatusPill status={record.status} />
                  {displayPassed != null && <span className="pp-pill" style={{ color:'#065f46', background:'#d1fae5', border:'none', fontSize:'0.68rem' }}>✓ {displayPassed} passed</span>}
                  {displayFailed > 0 && <span className="pp-pill" style={{ color:'#991b1b', background:'#fee2e2', border:'none', fontSize:'0.68rem' }}>{displayFailed} failed</span>}
                </div>
                <div className="pp-epic-summary-right" onClick={e => e.stopPropagation()}>
                  {isAwaiting && <>
                    <button className="pp-btn-sm outline" disabled={!!actingToken} onClick={() => handleHitl(record.hitl_token,'reject')}>Reject</button>
                    <button className="pp-btn-sm green"   disabled={!!actingToken} onClick={() => handleHitl(record.hitl_token,'approve')}>
                      <MdCallMerge size={12} /> {actingToken === record.hitl_token+'approve' ? '…' : 'Merge'}
                    </button>
                  </>}
                  {record.pr_url && <a href={record.pr_url} target="_blank" rel="noopener noreferrer" className="pp-btn-sm indigo"><MdCallMerge size={12} /> PR</a>}
                  {record.conversation_url && <a href={record.conversation_url} target="_blank" rel="noopener noreferrer" className="pp-btn-sm outline"><MdCode size={12} /> Session</a>}
                </div>
              </summary>

              <div className="pp-epic-body">
                {/* Stories */}
                {stories.length > 0 && (
                  <div className="pp-epic-stories">
                    {stories.map((s, si) => {
                      const story = s.story || s;
                      const sid   = story.id || '';
                      const stitle = story.title || '';
                      const tasks  = s.tasks || [];
                      const done   = ['COMPLETED','AWAITING_APPROVAL'].includes(record.status);
                      return (
                        <div key={sid||si} className="pp-story-row">
                          {done ? <MdCheckCircle size={13} style={{ color:'#10b981', flexShrink:0 }} />
                                 : record.status==='IMPLEMENTING' ? <span className="pp-pulse-dot-sm" />
                                 : <MdRadioButtonUnchecked size={13} style={{ color:'#d1d5db', flexShrink:0 }} />}
                          <span className="pp-story-id">{sid}</span>
                          <span className="pp-story-title">{stitle}</span>
                          <span className="pp-story-tasks-count">{tasks.length > 0 ? `${tasks.length} tasks` : ''}</span>
                          {sid && <a href={jiraHref(sid)} target="_blank" rel="noopener noreferrer" className="pp-jira-link"><MdOpenInNew size={11}/> Jira</a>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* What was built */}
                {summaryText && (
                  <div className="pp-what-built">
                    <div className="pp-what-built-label">What was built</div>
                    <MarkdownRenderer text={summaryText} />
                  </div>
                )}

                {/* Test bar */}
                {displayPassed != null && (
                  <div className="pp-test-panel">
                    <div className="pp-test-track"><div className="pp-test-fill" style={{ width:`${passWidth}%` }} /></div>
                    <div className="pp-test-counts">
                      <span style={{ color:'#065f46', fontWeight:600 }}>{displayPassed} passed</span>
                      {displayFailed > 0 && <span style={{ color:'#991b1b', fontWeight:600 }}>{displayFailed} failed</span>}
                    </div>
                    {record.test_output && isRealTestOutput(record.test_output) && (
                      <details style={{ marginTop:'0.4rem' }}>
                        <summary style={{ fontSize:'0.73rem', color:'#6b7280', cursor:'pointer' }}>View test output</summary>
                        <pre className="pp-code-block" style={{ maxHeight:'220px' }}>{record.test_output}</pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Branch / error */}
                {record.branch_name && (
                  <div style={{ fontSize:'0.77rem', color:'#9ca3af', marginTop:'0.5rem', display:'flex', alignItems:'center', gap:'4px' }}>
                    <MdCode size={13}/> Branch: <code style={{ color:'#6366f1', background:'#eef2ff', padding:'1px 5px', borderRadius:'3px' }}>{record.branch_name}</code>
                  </div>
                )}
                {(record.error_message || record.merge_error) && (
                  <details style={{ marginTop:'0.75rem' }}>
                    <summary style={{ fontSize:'0.75rem', color:'#ef4444', cursor:'pointer' }}>Show error</summary>
                    <pre className="pp-code-block" style={{ color:'#f38ba8' }}>{record.error_message || record.merge_error}</pre>
                  </details>
                )}
              </div>
            </details>
          );
        })}
      </div>

      {pstate.last_error && (
        <div className="pp-review-section">
          <div className="pp-review-heading" style={{ color:'#ef4444' }}>Last Pipeline Error</div>
          <pre className="pp-code-block" style={{ color:'#f38ba8' }}>{pstate.last_error}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Configuration tab ────────────────────────────────────────────────────────

function ConfigTab({ project, pstate, projectId, onAction }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!pstate) return;
    setForm({
      github_repo:       pstate.github_repo       || '',
      github_branch:     pstate.github_branch      || 'main',
      github_token:      '',
      jira_project_key:  pstate.jira_project_key   || '',
      jira_board_id:     pstate.jira_board_id      || '',
      hitl_enabled:      pstate.hitl_enabled        ?? true,
      openhands_url:     pstate.openhands_url       || '',
    });
  }, [pstate]);

  const save = async () => {
    try {
      setSaving(true);
      const username = localStorage.getItem('username');
      const body = { ...form };
      if (!body.github_token) delete body.github_token;
      await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001'}/api/v1/pipeline/configure/${projectId}?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEditing(false);
      setShowToken(false);
      onAction();
    } catch (err) { alert(`Save failed: ${err.message}`); }
    finally { setSaving(false); }
  };

  if (!pstate || !form) return <div className="pp-empty">Loading configuration…</div>;

  const Field = ({ label, value, masked }) => (
    <div className="pp-config-row">
      <span className="pp-config-label">{label}</span>
      <span className="pp-config-value">{masked ? '••••••••' : (value || <span style={{color:'#9ca3af'}}>—</span>)}</span>
    </div>
  );

  if (!editing) return (
    <div className="pp-config">
      <div className="pp-config-section">
        <div className="pp-config-section-title">GitHub</div>
        <Field label="Repository"   value={pstate.github_repo} />
        <Field label="Branch"       value={pstate.github_branch || 'main'} />
        <Field label="Token"        value={pstate.github_token} masked={!!pstate.github_token && pstate.github_token !== '***'} />
      </div>
      <div className="pp-config-section">
        <div className="pp-config-section-title">Jira</div>
        <Field label="Project Key"  value={pstate.jira_project_key} />
        <Field label="Board ID"     value={pstate.jira_board_id} />
      </div>
      <div className="pp-config-section">
        <div className="pp-config-section-title">Pipeline</div>
        <Field label="HITL Enabled" value={pstate.hitl_enabled ? 'Yes' : 'No'} />
        <Field label="OpenHands URL" value={pstate.openhands_url} />
      </div>
      <div style={{marginTop:'1rem'}}>
        <button className="pp-btn indigo" onClick={() => setEditing(true)}>Edit Configuration</button>
      </div>
    </div>
  );

  const inp = (key, type='text') => (
    <input
      type={type}
      className="pp-config-input"
      value={form[key]}
      onChange={e => setForm(f => ({ ...f, [key]: type === 'checkbox' ? e.target.checked : e.target.value }))}
      checked={type === 'checkbox' ? form[key] : undefined}
    />
  );

  return (
    <div className="pp-config">
      <div className="pp-config-section">
        <div className="pp-config-section-title">GitHub</div>
        <div className="pp-config-row"><span className="pp-config-label">Repository</span>{inp('github_repo')}</div>
        <div className="pp-config-row"><span className="pp-config-label">Branch</span>{inp('github_branch')}</div>
        <div className="pp-config-row">
          <span className="pp-config-label">Token</span>
          <div style={{display:'flex',gap:'6px',flex:1}}>
            <input type={showToken ? 'text' : 'password'} className="pp-config-input" placeholder="Leave blank to keep existing"
              value={form.github_token} onChange={e => setForm(f => ({...f, github_token: e.target.value}))} />
            <button className="pp-btn outline" style={{padding:'4px 8px',fontSize:'0.75rem'}} onClick={() => setShowToken(s=>!s)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
      <div className="pp-config-section">
        <div className="pp-config-section-title">Jira</div>
        <div className="pp-config-row"><span className="pp-config-label">Project Key</span>{inp('jira_project_key')}</div>
        <div className="pp-config-row"><span className="pp-config-label">Board ID</span>{inp('jira_board_id')}</div>
      </div>
      <div className="pp-config-section">
        <div className="pp-config-section-title">Pipeline</div>
        <div className="pp-config-row">
          <span className="pp-config-label">HITL Enabled</span>
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'0.85rem'}}>
            {inp('hitl_enabled','checkbox')} Require approval between epics
          </label>
        </div>
        <div className="pp-config-row"><span className="pp-config-label">OpenHands URL</span>{inp('openhands_url')}</div>
      </div>
      <div style={{display:'flex',gap:'8px',marginTop:'1rem'}}>
        <button className="pp-btn outline" onClick={() => { setEditing(false); setShowToken(false); }}>Cancel</button>
        <button className="pp-btn indigo" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview'       },
  { key: 'board',    label: 'Board'          },
  { key: 'review',   label: 'Review'         },
  { key: 'config',   label: 'Configuration'  },
];

const ProjectPage = () => {
  const { id }   = useParams();
  const navigate = useNavigate();
  const [tab, setTab]             = useState('overview');
  const [project, setProject]     = useState(null);
  const [pstate, setPstate]       = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing]   = useState(false);
  const [liveActivity, setLiveActivity] = useState({ epicId: null, epicTitle: null, message: null, ciStatus: null });
  const [liveMessages, setLiveMessages] = useState({});
  const sseRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const username = localStorage.getItem('username');
      if (!username) { navigate('/login'); return; }
      const [proj, ps] = await Promise.all([
        getProjectById(username, id),
        getPipelineState(username, id).catch(() => null),
      ]);
      setProject(proj);
      setPstate(ps);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const username = localStorage.getItem('username');
    if (!username) return;
    const es = new EventSource(`${API_BASE_URL}/api/v1/pipeline/status/${id}?username=${encodeURIComponent(username)}`);
    sseRef.current = es;

    const RELOAD_TYPES = new Set([
      'state_update','PIPELINE_STATE_CATCHUP',
      'EPIC_AWAITING_APPROVAL','EPIC_COMPLETED','EPIC_FAILED',
      'EPIC_APPROVED','EPIC_REJECTED','EPIC_MERGE_FAILED',
      'PIPELINE_COMPLETED','PIPELINE_FAILED','PIPELINE_PAUSED',
      'CODE_GENERATION_STARTED','PLANNING_APPROVED','PLANNING_REJECTED',
    ]);

    // Single handler — works whether backend sends named or unnamed events
    const handle = (e) => {
      try {
        const d = JSON.parse(e.data);
        const type = d.type;

        if (RELOAD_TYPES.has(type)) { load(); return; }

        if (type === 'EPIC_AGENT_MESSAGE') {
          setLiveMessages(p => ({ ...p, [d.epic_id]: (d.message || '').slice(0, 200) }));
          setLiveActivity(p => ({ ...p, epicId: d.epic_id, message: (d.message || '').slice(0, 150) }));
          return;
        }
        if (type === 'EPIC_STARTED') {
          setLiveActivity(p => ({ ...p, epicId: d.epic_id, epicTitle: d.epic_title, message: 'Starting implementation…' }));
          setLiveMessages(p => ({ ...p, [d.epic_id]: 'Starting implementation…' }));
          return;
        }
        if (type === 'EPIC_CI_CHECKING') { setLiveActivity(p => ({ ...p, ciStatus: 'checking' })); return; }
        if (type === 'EPIC_CI_PASSED')   { setLiveActivity(p => ({ ...p, ciStatus: 'passed' })); return; }
      } catch {}
    };

    // Listen on both named events (new backend) and generic message (catch-up / old backend)
    es.onmessage = handle;
    RELOAD_TYPES.forEach(ev => es.addEventListener(ev, handle));
    ['EPIC_AGENT_MESSAGE','EPIC_STARTED','EPIC_CI_CHECKING','EPIC_CI_PASSED'].forEach(ev => es.addEventListener(ev, handle));

    return () => { es.close(); sseRef.current = null; };
  }, [id, load]);

  if (isLoading) return (
    <div className="pp-page"><div className="pp-loading">Loading project…</div></div>
  );

  const title = project?.title || pstate?.project_title || id;

  return (
    <div className="pp-page">
      {/* Header */}
      <div className="pp-header">
        <button className="pp-back" onClick={() => navigate('/projects')}>
          <MdArrowBack size={15} /> Projects
        </button>
        <div className="pp-header-row">
          <div className="pp-header-left">
            <h1 className="pp-title">{title}</h1>
            {project && (
              <span className="pp-status-chip"
                style={{ color: project.statusColor, background: `${project.statusColor}18` }}>
                {project.status}
              </span>
            )}
          </div>
          <button className="pp-refresh" onClick={load}><MdRefresh size={15} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="pp-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`pp-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pp-body">
        {tab === 'overview' && (
          <OverviewTab
            project={project}
            pstate={pstate}
            liveActivity={liveActivity}
            onAction={load}
            isActing={isActing}
            setIsActing={setIsActing}
            onGoToReview={(epicId) => setTab('review')}
          />
        )}
        {tab === 'board' && (
          <BoardTab
            pstate={pstate}
            liveMessages={liveMessages}
            onCardClick={() => setTab('review')}
          />
        )}
        {tab === 'review' && (
          <ReviewTab pstate={pstate} projectId={id} onAction={load} />
        )}
        {tab === 'config' && (
          <ConfigTab project={project} pstate={pstate} projectId={id} onAction={load} />
        )}
      </div>
    </div>
  );
};

export default ProjectPage;
