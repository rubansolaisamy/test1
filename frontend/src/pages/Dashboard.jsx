import React, { useState, useEffect } from 'react';
import { MdWork, MdCheckCircle, MdPeople, MdTimeline, MdClose } from 'react-icons/md';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import StatCard from '../components/StatCard';
import ProgressBar from '../components/ProgressBar';
import './Dashboard.css';
import { fetchDashboardData } from '../api/client';

const FIXED_CORE_PHASES = [
  "Requirements Analysis",
  "Planning",
  "Design",
  "Development",
  "Testing",
  "Deployment"
];

const getPhaseClassifier = (title = '') => {
  const t = title.toLowerCase();
  if (t.includes('phase 1') || t.includes('requirement')) return 'Requirements Analysis';
  if (t.includes('phase 2') || t.includes('planning')) return 'Planning';
  if (t.includes('phase 3') || t.includes('design')) return 'Design';
  if (t.includes('phase 4') || t.includes('development') || t.includes('implement')) return 'Development';
  if (t.includes('phase 5') || t.includes('test') || t.includes('qa')) return 'Testing';
  if (t.includes('phase 6') || t.includes('deploy') || t.includes('release')) return 'Deployment';
  return 'Development'; 
};

const PHASE_COLORS = {
  "Requirements Analysis": "#f43f5e",
  "Planning": "#10b981",
  "Design": "#f59e0b",
  "Development": "#3b82f6",
  "Testing": "#8b5cf6",
  "Deployment": "#06b6d4"
};

const Dashboard = () => {
  const [liveData, setLiveData] = useState({ projects: [] });
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(null);

  useEffect(() => {
    const getLiveStats = async () => {
      try {
        const currentUsername = localStorage.getItem('username');
        const data = await fetchDashboardData(currentUsername); 
        setLiveData(data || { projects: [] });
      } catch (error) {
        console.error("Dashboard Fetch Error:", error);
      } finally {
        setLoading(false);
      }
    };
    getLiveStats();
  }, []);

  const routeToReport = (projectId) => {
    window.location.href = `/reports?projectId=${projectId}&tab=project`;
  };

  const rawProjects = liveData.projects || [];
  
  const processedProjects = rawProjects.map(p => {
    const epics = p.epic_records || [];
    const rawTickets = p.raw_jira_tickets || [];
    const items = epics.length > 0 ? epics : rawTickets;

    const completed = p.completed !== undefined ? p.completed : items.filter(e => {
      const s = String(e.status || '').toUpperCase();
      return s === 'COMPLETED' || s === 'DONE' || s === 'RESOLVED';
    }).length;

    const failed = p.failed !== undefined ? p.failed : items.filter(e => String(e.status || '').toUpperCase() === 'FAILED').length;
    const total = p.total_tasks !== undefined ? p.total_tasks : items.length;
    const pending = p.pending !== undefined ? p.pending : Math.max(0, total - completed - failed);

    return {
      project_id: p.project_id,
      project_name: p.project_title || p.name || p.project_id || 'Untitled Project',
      status: p.status || 'ACTIVE',
      current_phase: p.current_phase || 'Development',
      success_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      epic_count: total,
      completed_epics: completed,
      pending_epics: pending,
      assignee: p.assignee_user?.name || p.username || 'Unassigned',
      raw: p
    };
  });

  const activeProjectsCount = processedProjects.filter(p => p.status !== 'COMPLETED').length;
  const totalEpics = processedProjects.reduce((acc, p) => acc + p.epic_count, 0);
  const completedEpics = processedProjects.reduce((acc, p) => acc + p.completed_epics, 0);

  const phaseMap = {};
  FIXED_CORE_PHASES.forEach(phase => {
    phaseMap[phase] = { name: phase, value: 0, tasks: [], color: PHASE_COLORS[phase] };
  });

  let allLiveTasks = [];

  processedProjects.forEach(p => {
    const epics = p.raw.epic_records || [];
    const rawTickets = p.raw.raw_jira_tickets || [];
    
    if (epics.length > 0) {
      epics.forEach(ep => {
        const stories = ep.story_records || [];
        const targetedItems = stories.length > 0 ? stories : [ep];
        
        targetedItems.forEach(item => {
          const title = item.story_title || item.epic_title || 'Untitled Node';
          const tId = item.story_id || item.epic_id || 'TASK';
          const phase = getPhaseClassifier(title);
          const statusStr = item.status || 'PENDING';
          
          phaseMap[phase].value += 1;
          phaseMap[phase].tasks.push({ id: tId, title, project: p.project_name, status: statusStr });
          allLiveTasks.push({ id: tId + Math.random(), jira_key: tId, title, phase, assignee: p.assignee, status: statusStr, status_color: statusStr === 'COMPLETED' || statusStr === 'DONE' ? '#10b981' : statusStr === 'FAILED' ? '#ef4444' : '#3b82f6' });
        });
      });
    } else {
      rawTickets.forEach(tk => {
        const title = tk.summary || tk.title || 'Untitled Task';
        const tId = tk.key || tk.id || 'TASK';
        const phase = getPhaseClassifier(title);
        const statusStr = tk.status || 'PENDING';
        
        phaseMap[phase].value += 1;
        phaseMap[phase].tasks.push({ id: tId, title, project: p.project_name, status: statusStr });
        allLiveTasks.push({ id: tId + Math.random(), jira_key: tId, title, phase, assignee: p.assignee, status: statusStr, status_color: '#3b82f6' });
      });
    }
  });

  const tasksByPhaseData = FIXED_CORE_PHASES.map(phaseName => phaseMap[phaseName]);
  const displayProjects = processedProjects.slice(0, 10);
  const displayTasks = allLiveTasks.sort((a, b) => a.status === 'PENDING' ? -1 : 1).slice(0, 10);

  const groupPhaseTasksByProject = (tasks = []) => {
    const grouped = {};
    tasks.forEach(t => {
      if (!grouped[t.project]) grouped[t.project] = [];
      grouped[t.project].push(t);
    });
    return grouped;
  };

  if (loading) {
    return (
      <div className="dashboard-loading-container">
        <div className="dashboard-loading-card">
          <div className="loading-spinner"></div>
          <h2>Initializing Workspace...</h2>
          <p>Syncing live telemetry from Jira & S3</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p className="dashboard-subtitle">Operational overview of your software development lifecycle</p>
      </div>

      <div className="stats-grid">
        <StatCard icon={<MdWork />} title="Active Projects" value={activeProjectsCount} subtitle="Live from Jira" iconBg="#dbeafe" iconColor="#3b82f6" />
        <StatCard icon={<MdCheckCircle />} title="Total Epics" value={totalEpics} subtitle={`${completedEpics} completed out of ${totalEpics} total epics`} iconBg="#d1fae5" iconColor="#10b981" />
        <StatCard icon={<MdPeople />} title="Team Members" value={liveData.team?.length || 0} subtitle="Active Contributors" iconBg="#ede9fe" iconColor="#a855f7" />
        {/* FIXED: out of scope variable reference resolved safely below */}
        <StatCard icon={<MdTimeline />} title="Pipeline State" value={displayProjects[0]?.current_phase || "Standby"} subtitle="Latest Project Status" iconBg="#fed7aa" iconColor="#f97316" />
      </div>

      <div className="charts-row">
        <div className="chart-container">
          <h2 className="chart-title">Scope vs Delivery (Top 10 Projects)</h2>
          <p style={{fontSize: '12px', color: '#64748b', marginBottom: '10px'}}>Click a bar to view detailed report</p>
          <ResponsiveContainer width="100%" height={300}>
            {displayProjects.length > 0 ? (
              <BarChart data={displayProjects} margin={{ bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="project_name" tick={{fontSize: 11}} angle={-25} textAnchor="end" interval={0} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} />
                <Legend verticalAlign="top" height={36} />
                <Bar name="Completed" dataKey="completed_epics" fill="#10b981" stackId="a" maxBarSize={40} onClick={(data) => routeToReport(data.project_id)} style={{cursor: 'pointer'}} />
                <Bar name="Pending" dataKey="pending_epics" fill="#cbd5e1" radius={[4, 4, 0, 0]} stackId="a" maxBarSize={40} onClick={(data) => routeToReport(data.project_id)} style={{cursor: 'pointer'}} />
              </BarChart>
            ) : <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'#94a3b8'}}>No projects available.</div>}
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2 className="chart-title">Tasks by Phase</h2>
          <p style={{fontSize: '12px', color: '#64748b', marginBottom: '10px'}}>Click any bar phase to review underlying metrics</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tasksByPhaseData} margin={{ bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{fontSize: 11}} angle={-25} textAnchor="end" interval={0} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={45} onClick={(data) => { if (data.value > 0) setSelectedPhase(data); }} style={{cursor: 'pointer'}}>
                {tasksByPhaseData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={entry.value === 0 ? 0.15 : 1} stroke={entry.color} strokeWidth={entry.value === 0 ? 1 : 0} strokeDasharray={entry.value === 0 ? "3 3" : "0"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="dashboard-content-row">
         <div className="active-projects-section">
           <h2 className="section-title">Active Pipelines (Top 10)</h2>
           <div className="active-projects-list">
             {displayProjects.length > 0 ? displayProjects.map((project) => {
               let barColor = "#3b82f6";
               if (project.status === 'FAILED') barColor = "#ef4444";
               if (project.status === 'COMPLETED' || project.success_rate === 100) barColor = "#10b981";
               
               return (
                 <div key={project.project_id} className="project-item clickable-hover" onClick={() => routeToReport(project.project_id)}>
                   <div className="project-item-header">
                     <h3 className="project-item-title">{project.project_name}</h3>
                     <span style={{ color: barColor, fontWeight: 'bold' }}>{project.success_rate === 100 ? 'COMPLETED' : project.status}</span>
                   </div>
                   <p className="project-item-phase">Current Phase: {project.current_phase}</p>
                   <ProgressBar progress={project.success_rate} color={barColor} />
                 </div>
               );
             }) : <div className="empty-state">No active projects found.</div>}
           </div>
        </div>

        <div className="recent-tasks-section">
          <h2 className="section-title">Live Jira Tasks (Top 10)</h2>
          <div className="tasks-list">
            {displayTasks.length > 0 ? displayTasks.map((task) => (
                <div key={task.id} className="task-item clickable-hover" onClick={() => setSelectedTask(task)}>
                  <div className="task-item-info">
                    <div className="task-title-row">
                      <span className="jira-badge">{task.jira_key}</span>
                      <h4 className="task-item-title">{task.title}</h4>
                    </div>
                    <p className="task-item-meta">
                      {task.phase} • <strong>{task.assignee}</strong>
                    </p>
                  </div>
                  <span className="task-status-badge" style={{ backgroundColor: `${task.status_color}15`, color: task.status_color, border: `1px solid ${task.status_color}40` }}>
                    {task.status.toUpperCase()}
                  </span>
                </div>
              )) : <div className="empty-state">No live tasks available.</div>}
          </div>
        </div>
      </div>

      {selectedTask && (
        <div className="dashboard-modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="dashboard-modal-content" onClick={e => e.stopPropagation()}>
             <div className="modal-header">
               <h2>{selectedTask.jira_key}: {selectedTask.title}</h2>
               <button onClick={() => setSelectedTask(null)}><MdClose size={24} /></button>
             </div>
             <div className="modal-body">
               <p><strong>Assignee:</strong> {selectedTask.assignee}</p>
               <p><strong>Current Phase:</strong> {selectedTask.phase}</p>
               <p><strong>Status:</strong> <span style={{color: selectedTask.status_color, fontWeight:'bold'}}>{selectedTask.status}</span></p>
               <hr style={{margin: '15px 0', borderColor: '#e2e8f0'}}/>
               <p><strong>Details:</strong> Synchronized live from workspace target variables.</p>
             </div>
          </div>
        </div>
      )}

      {selectedPhase && (
        <div className="dashboard-modal-overlay" onClick={() => setSelectedPhase(null)}>
          <div className="dashboard-modal-content large" onClick={e => e.stopPropagation()}>
             <div className="modal-header">
               <h2>Phase Portfolio Scope: {selectedPhase.name}</h2>
               <button onClick={() => setSelectedPhase(null)}><MdClose size={24} /></button>
             </div>
             <div className="modal-body scrollable" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                <p style={{marginBottom: '20px', color: '#64748b', fontSize: '14px'}}>
                  Detailed structural overview of all active projects, epics, and subtasks tracked inside the <strong>{selectedPhase.name}</strong> gate layer.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {Object.entries(groupPhaseTasksByProject(selectedPhase.tasks)).map(([projectName, projectTasks]) => (
                    <div key={projectName} style={{ background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 12px 0', borderBottom: '2px solid #cbd5e1', paddingBottom: '6px' }}>
                        📂 Project: {projectName}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {projectTasks.map((task, idx) => (
                          <div key={idx} style={{ background: '#fff', padding: '12px', borderRadius: '6px', border: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span className="jira-badge" style={{ marginRight: '8px' }}>{task.id}</span>
                              <span style={{ fontSize: '13.5px', color: '#334155', fontWeight: '500' }}>{task.title}</span>
                            </div>
                            <span className={`status-badge ${task.status.toLowerCase()}`} style={{ fontSize: '11px', padding: '3px 8px', fontWeight: 'bold', borderRadius: '12px' }}>{task.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;