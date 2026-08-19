import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MdExpandMore, MdChevronRight, MdCheckBox, MdCheckBoxOutlineBlank, MdIndeterminateCheckBox } from 'react-icons/md';
import './TicketSelection.css';
import { startPipeline } from '../services/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const TYPE_COLORS = {
  epic:  { bg: '#ede9fe', color: '#7c3aed', label: 'Epic' },
  story: { bg: '#dbeafe', color: '#1d4ed8', label: 'Story' },
  task:  { bg: '#d1fae5', color: '#065f46', label: 'Task' },
};

const PRIORITY_COLORS = {
  highest: '#ef4444', high: '#f97316', medium: '#f59e0b',
  low: '#3b82f6', lowest: '#9ca3af',
};

function buildHierarchy(tickets) {
  const epicsMap = {};
  const storiesMap = {};
  const orphanStories = [];
  const orphanTasks = [];

  tickets.forEach(t => {
    if (t.type === 'epic') epicsMap[t.id] = { ...t, stories: [] };
    else if (t.type === 'story') storiesMap[t.id] = { ...t, tasks: [] };
  });

  tickets.forEach(t => {
    if (t.type === 'task') {
      const parent = t.parent_id;
      if (parent && storiesMap[parent]) storiesMap[parent].tasks.push(t);
      else orphanTasks.push(t);
    }
  });

  Object.values(storiesMap).forEach(s => {
    const epicId = s.epic_link || s.parent_id;
    if (epicId && epicsMap[epicId]) epicsMap[epicId].stories.push(s);
    else orphanStories.push(s);
  });

  return { epics: Object.values(epicsMap), orphanStories, orphanTasks };
}

function getAllIds(ticket, storiesMap) {
  const ids = [ticket.id];
  if (ticket.type === 'epic') {
    (ticket.stories || []).forEach(s => {
      ids.push(s.id);
      (s.tasks || []).forEach(t => ids.push(t.id));
    });
  } else if (ticket.type === 'story') {
    (ticket.tasks || []).forEach(t => ids.push(t.id));
  }
  return ids;
}

function getEpicSelectionState(epic, selectedIds) {
  const allIds = getAllIds(epic);
  const selected = allIds.filter(id => selectedIds.has(id));
  if (selected.length === 0) return 'none';
  if (selected.length === allIds.length) return 'all';
  return 'partial';
}

function getStorySelectionState(story, selectedIds) {
  if (!story.tasks.length) return selectedIds.has(story.id) ? 'all' : 'none';
  const allIds = [story.id, ...story.tasks.map(t => t.id)];
  const selected = allIds.filter(id => selectedIds.has(id));
  if (selected.length === 0) return 'none';
  if (selected.length === allIds.length) return 'all';
  return 'partial';
}

function TypeBadge({ type }) {
  const cfg = TYPE_COLORS[type] || TYPE_COLORS.task;
  return (
    <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: cfg.bg, color: cfg.color, fontWeight: '700', letterSpacing: '0.03em', textTransform: 'uppercase', flexShrink: 0 }}>
      {cfg.label}
    </span>
  );
}

function SelectIcon({ state, onClick }) {
  const props = { size: 20, onClick, style: { cursor: 'pointer', flexShrink: 0 } };
  if (state === 'all') return <MdCheckBox {...props} color="#4f46e5" />;
  if (state === 'partial') return <MdIndeterminateCheckBox {...props} color="#4f46e5" />;
  return <MdCheckBoxOutlineBlank {...props} color="#9ca3af" />;
}

const TicketSelection = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [hierarchy, setHierarchy] = useState({ epics: [], orphanStories: [], orphanTasks: [] });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [implementationIds, setImplementationIds] = useState(new Set());  // NEW: Track what to actually implement
  const [expandedEpics, setExpandedEpics] = useState(new Set());
  const [expandedStories, setExpandedStories] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [quickStartMode, setQuickStartMode] = useState('custom');  // NEW: 'core' | 'all' | 'custom'

  useEffect(() => { fetchTickets(); }, [projectId]);

  const fetchTickets = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const username = localStorage.getItem('username');
      const response = await fetch(`${API_BASE_URL}/api/v1/pipeline/${projectId}/tickets?username=${encodeURIComponent(username)}`);
      if (!response.ok) throw new Error(`Failed to fetch tickets: ${response.status}`);
      const data = await response.json();
      const raw = data.tickets || [];
      setTickets(raw);
      const h = buildHierarchy(raw);
      setHierarchy(h);

      const preSelected = data.selected_ticket_ids?.length
        ? new Set(data.selected_ticket_ids)
        : new Set(raw.map(t => t.id));
      setSelectedIds(preSelected);

      // Expand all epics by default
      setExpandedEpics(new Set(h.epics.map(e => e.id)));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleEpicExpand = (id) => setExpandedEpics(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleStoryExpand = (id) => setExpandedStories(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleStory = (story, epic) => {
    const ids = [story.id, ...story.tasks.map(t => t.id)];
    const state = getStorySelectionState(story, selectedIds);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (state === 'all') {
        // Deselecting: remove story and tasks
        ids.forEach(id => next.delete(id));
        
        // Clean up epic if no other stories selected
        if (epic) {
          const otherSelectedStories = epic.stories.filter(s => 
            s.id !== story.id && next.has(s.id)
          );
          if (otherSelectedStories.length === 0) {
            next.delete(epic.id);
          }
        }
      } else {
        // Selecting: add story, tasks, and epic parent
        ids.forEach(id => next.add(id));
        if (epic) next.add(epic.id);
      }
      return next;
    });
    
    // Track implementation: story + all tasks
    setImplementationIds(prev => {
      const next = new Set(prev);
      const taskIds = story.tasks.map(t => t.id);
      if (state === 'all') {
        next.delete(story.id);
        taskIds.forEach(id => next.delete(id));
      } else {
        next.add(story.id);
        taskIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleEpic = (epic) => {
    const ids = getAllIds(epic);
    const state = getEpicSelectionState(epic, selectedIds);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (state === 'all') {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
    
    // Track implementation: epic + all stories + all tasks
    setImplementationIds(prev => {
      const next = new Set(prev);
      if (state === 'all') {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleTask = (task, story, epic) => {
    const taskId = task.id;
    setSelectedIds(prev => {
      const next = new Set(prev);
      
      if (!next.has(taskId)) {
        // Selecting task: add task + parents
        next.add(taskId);
        if (story) next.add(story.id);
        if (epic) next.add(epic.id);
      } else {
        // Deselecting task: remove task only
        next.delete(taskId);
        
        // Clean up parents if no other children selected
        if (story) {
          const otherSelectedTasks = story.tasks.filter(t => t.id !== taskId && next.has(t.id));
          if (otherSelectedTasks.length === 0) {
            next.delete(story.id);
            
            if (epic) {
              const otherSelectedStories = epic.stories.filter(s => 
                s.id !== story.id && next.has(s.id)
              );
              if (otherSelectedStories.length === 0) {
                next.delete(epic.id);
              }
            }
          }
        }
      }
      
      return next;
    });
    
    // Track implementation targets
    setImplementationIds(prev => {
      const next = new Set(prev);
      if (!prev.has(taskId)) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allIds = new Set(tickets.map(t => t.id));
    setSelectedIds(allIds);
    setImplementationIds(allIds);
  };
  
  const deselectAll = () => {
    setSelectedIds(new Set());
    setImplementationIds(new Set());
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) { alert('Please select at least one ticket'); return; }
    try {
      setIsSubmitting(true);
      const username = localStorage.getItem('username');

      // 1. Save the selected tickets (with implementation list)
      const response = await fetch(`${API_BASE_URL}/api/v1/pipeline/select-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          project_id: projectId, 
          selected_ticket_ids: [...selectedIds],
          implementation_ticket_ids: [...implementationIds]
        })
      });
      if (!response.ok) throw new Error(`Failed to select tickets: ${response.status}`);

      // 2. Wake up the AI agent
      await startPipeline(username, projectId);

      // 3. Go to the dashboard
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const ticketMatchesSearch = (t) =>
    !searchTerm ||
    t.key?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.summary?.toLowerCase().includes(searchTerm.toLowerCase());

  // Helper to get badge for ticket
  const getTicketBadge = (ticketId) => {
    if (implementationIds.has(ticketId)) {
      return <span className="badge badge-primary" style={{marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#4f46e5', color: 'white', fontSize: '0.75rem'}}>Will Implement</span>;
    } else if (selectedIds.has(ticketId)) {
      return <span className="badge badge-secondary" style={{marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#9ca3af', color: 'white', fontSize: '0.75rem'}}>Context Only</span>;
    }
    return null;
  };

  // Helper to format story points
  const formatStoryPoints = (sp) => {
    if (sp === null || sp === undefined) return 'N/A';
    return `${sp} SP`;
  };

  if (isLoading) return <div className="ticket-selection-container"><div className="loading">Loading tickets from Jira...</div></div>;
  if (error) return <div className="ticket-selection-container"><div className="error-box"><h3>Error Loading Tickets</h3><p>{error}</p><button onClick={() => navigate('/projects')}>Back to Projects</button></div></div>;

  const { epics, orphanStories, orphanTasks } = hierarchy;

  const renderTask = (task, story, epic) => {
    if (!ticketMatchesSearch(task)) return null;
    return (
      <div key={task.id} className="ticket-row task-row" onClick={() => toggleTask(task, story, epic)}>
        <SelectIcon state={selectedIds.has(task.id) ? 'all' : 'none'} onClick={(e) => { e.stopPropagation(); toggleTask(task, story, epic); }} />
        <span className="ticket-key">{task.key}</span>
        <TypeBadge type="task" />
        <span className="ticket-summary">{task.summary}</span>
        {getTicketBadge(task.id)}
        {task.story_points && <span style={{marginLeft: '8px', color: '#6b7280', fontSize: '0.85rem'}}>[{formatStoryPoints(task.story_points)}]</span>}
        {task.priority && <span className="ticket-priority" style={{ color: PRIORITY_COLORS[task.priority?.toLowerCase()] || '#9ca3af' }}>{task.priority}</span>}
      </div>
    );
  };

  const renderStory = (story, epic) => {
    const matchesSelf = ticketMatchesSearch(story);
    const matchingTasks = story.tasks.filter(ticketMatchesSearch);
    if (!matchesSelf && !matchingTasks.length) return null;

    const selState = getStorySelectionState(story, selectedIds);
    const isExpanded = expandedStories.has(story.id);
    const hasTasks = story.tasks.length > 0;

    return (
      <div key={story.id} className="story-block">
        <div className="ticket-row story-row" onClick={() => hasTasks && toggleStoryExpand(story.id)}>
          <span className="expand-toggle" onClick={(e) => { e.stopPropagation(); hasTasks && toggleStoryExpand(story.id); }}>
            {hasTasks ? (isExpanded ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />) : <span style={{ width: 16, display: 'inline-block' }} />}
          </span>
          <SelectIcon state={selState} onClick={(e) => { e.stopPropagation(); toggleStory(story, epic); }} />
          <span className="ticket-key">{story.key}</span>
          <TypeBadge type="story" />
          <span className="ticket-summary">{story.summary}</span>
          {getTicketBadge(story.id)}
          {story.story_points && <span style={{marginLeft: '8px', color: '#6b7280', fontSize: '0.85rem'}}>[{formatStoryPoints(story.story_points)}]</span>}
          {hasTasks && <span className="child-count">{story.tasks.length} task{story.tasks.length !== 1 ? 's' : ''}</span>}
        </div>
        {isExpanded && hasTasks && (
          <div className="tasks-indent">
            {(matchingTasks.length ? matchingTasks : story.tasks).map(task => renderTask(task, story, epic))}
          </div>
        )}
      </div>
    );
  };

  const renderEpic = (epic) => {
    const matchesSelf = ticketMatchesSearch(epic);
    const matchingStories = epic.stories.filter(s =>
      ticketMatchesSearch(s) || s.tasks.some(ticketMatchesSearch)
    );
    if (!matchesSelf && !matchingStories.length) return null;

    const selState = getEpicSelectionState(epic, selectedIds);
    const isExpanded = expandedEpics.has(epic.id);
    const hasChildren = epic.stories.length > 0;
    const totalTasks = epic.stories.reduce((n, s) => n + s.tasks.length, 0);

    return (
      <div key={epic.id} className="epic-block">
        <div className="ticket-row epic-row" onClick={() => hasChildren && toggleEpicExpand(epic.id)}>
          <span className="expand-toggle" onClick={(e) => { e.stopPropagation(); hasChildren && toggleEpicExpand(epic.id); }}>
            {hasChildren ? (isExpanded ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />) : <span style={{ width: 18, display: 'inline-block' }} />}
          </span>
          <SelectIcon state={selState} onClick={(e) => { e.stopPropagation(); toggleEpic(epic); }} />
          <span className="ticket-key">{epic.key}</span>
          <TypeBadge type="epic" />
          <span className="ticket-summary">{epic.summary}</span>
          {getTicketBadge(epic.id)}
          {epic.story_points && <span style={{marginLeft: '8px', color: '#6b7280', fontSize: '0.85rem', fontWeight: 'bold'}}>[{formatStoryPoints(epic.story_points)}]</span>}
          {hasChildren && <span className="child-count">{epic.stories.length} stor{epic.stories.length !== 1 ? 'ies' : 'y'}{totalTasks > 0 ? `, ${totalTasks} tasks` : ''}</span>}
        </div>
        {isExpanded && hasChildren && (
          <div className="stories-indent">
            {(matchingStories.length ? matchingStories : epic.stories).map(story => renderStory(story, epic))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ticket-selection-container">
      <div className="ticket-selection-header">
        <h1>Select Tickets to Implement</h1>
        <p>Choose which Jira tickets to include in this iteration. Selecting an Epic selects all its stories and tasks.</p>
      </div>

      <div className="ticket-selection-controls">
        <div className="search-box">
          <input type="text" placeholder="Search tickets..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="selection-buttons">
          <button onClick={selectAll} className="btn-secondary">Select All</button>
          <button onClick={deselectAll} className="btn-secondary">Deselect All</button>
        </div>
      </div>

      <div className="selection-summary">
        <span>{selectedIds.size} of {tickets.length} tickets selected</span>
        <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>
          {epics.length} epic{epics.length !== 1 ? 's' : ''} · {tickets.filter(t => t.type === 'story').length} stories · {tickets.filter(t => t.type === 'task').length} tasks
        </span>
        <span style={{ color: '#4f46e5', fontSize: '0.85rem', fontWeight: '500', marginLeft: '16px' }}>
          {(() => {
            const selectedTickets = tickets.filter(t => selectedIds.has(t.id));
            const totalSP = selectedTickets.reduce((sum, t) => {
              const sp = t.story_points;
              return sum + (typeof sp === 'number' ? sp : 0);
            }, 0);
            const hasNA = selectedTickets.some(t => t.story_points === null || t.story_points === undefined);
            return `Total: ${totalSP} SP${hasNA ? ' (some tickets have N/A)' : ''}`;
          })()}
        </span>
      </div>

      <div className="tickets-list">
        {epics.length === 0 && orphanStories.length === 0 && orphanTasks.length === 0 ? (
          <div className="no-tickets">{searchTerm ? 'No tickets match your search' : 'No tickets available'}</div>
        ) : (
          <>
            {epics.map(renderEpic)}
            {orphanStories.length > 0 && (
              <div className="orphan-section">
                <div className="orphan-label">Stories without Epic</div>
                {orphanStories.map(story => renderStory(story, null))}
              </div>
            )}
            {orphanTasks.length > 0 && (
              <div className="orphan-section">
                <div className="orphan-label">Tasks without Story</div>
                {orphanTasks.map(task => renderTask(task, null, null))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="ticket-selection-footer">
        <button onClick={() => navigate('/projects')} className="btn-cancel" disabled={isSubmitting}>Cancel</button>
        <button onClick={handleSubmit} className="btn-submit" disabled={isSubmitting || selectedIds.size === 0}>
          {isSubmitting ? 'Processing...' : `Continue with ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
};

export default TicketSelection;
