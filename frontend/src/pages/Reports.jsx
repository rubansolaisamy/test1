import React, { useState, useEffect } from 'react';
import { 
  Briefcase, ListTodo, AlertTriangle, Download, Calendar, Info, Search, X,
  ChevronRight, ChevronDown, Folder, FileText, ShieldCheck, RefreshCw, Cpu, 
  TrendingUp, Target, Code, AlertCircle, Award, Sparkles, CheckCircle2, User
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, ComposedChart, Line
} from 'recharts';
import './Reports.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001';

// LEVEL 3 ACCORDION TREE (EPICS -> STORIES -> TASKS) WITH INLINE ERROR DIAGNOSTICS
const ProjectFolderTree = ({ epicsDetail, onSelectEpic }) => {
  const [expandedNodes, setExpandedNodes] = useState({});

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  if (!epicsDetail || epicsDetail.length === 0) {
    return (
      <div style={{ padding: '24px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
        No Epic or Story tracking data mapped inside this specific project branch yet.
      </div>
    );
  }

  const getBadgeStyle = (status) => {
    const s = String(status).toUpperCase();
    if (s === 'COMPLETED' || s === 'DONE') return { color: '#16a34a', background: '#dcfce7' };
    if (s === 'IMPLEMENTING' || s === 'IN_PROGRESS') return { color: '#2563eb', background: '#dbeafe' };
    if (s === 'SELECTED') return { color: '#7c3aed', background: '#f3e8ff' };
    if (s === 'FAILED') return { color: '#dc2626', background: '#fee2e2' };
    return { color: '#475569', background: '#f1f5f9' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
      {epicsDetail.map((epic, epicIdx) => {
        const activeEpicId = epic.epic_id || epic.id || `Unknown-Epic-${epicIdx}`;
        const isEpicExpanded = !!expandedNodes[activeEpicId];
        const isEpicFailed = String(epic.status).toUpperCase() === 'FAILED';
        
        return (
          <div key={`${activeEpicId}-${epicIdx}`} style={{ border: isEpicFailed ? '1px solid #fca5a5' : '1px solid #e2e8f0', borderRadius: '10px', background: '#ffffff', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            
            {/* LEVEL 1: EPICS */}
            <div 
              onClick={() => toggleNode(activeEpicId)}
              style={{ padding: '16px', background: isEpicFailed ? '#fff5f5' : '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isEpicExpanded ? '1px solid #e2e8f0' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {isEpicExpanded ? <ChevronDown size={18} color="#64748b" /> : <ChevronRight size={18} color="#94a3b8" />}
                <Folder size={18} color={isEpicFailed ? '#ef4444' : '#3b82f6'} fill={isEpicFailed ? '#ef4444' : '#3b82f6'} fillOpacity={0.1} />
                <div>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748b', background: '#eff6ff', padding: '2px 6px', borderRadius: '4px', marginRight: '8px' }}>{activeEpicId}</span>
                  <span style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a' }}>{epic.title}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="status-badge" style={{ fontSize: '11px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '12px', ...getBadgeStyle(epic.status) }}>
                  {epic.status}
                </span>
                {epic.steps && epic.steps.length > 0 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onSelectEpic(epic); }}
                    style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Inspect Loops
                  </button>
                )}
              </div>
            </div>

            {/* LEVEL 2: STORIES */}
            {isEpicExpanded && (
              <div style={{ padding: '12px 16px 16px 36px', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {isEpicFailed && epic.failure_reason && epic.failure_reason !== 'None' && (
                  <div style={{ background: '#fef2f2', border: '1px dashed #fca5a5', padding: '10px 14px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c', fontSize: '13px', margin: '4px 0' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span><strong>Epic Termination Root Cause:</strong> {epic.failure_reason}</span>
                  </div>
                )}

                {epic.stories?.map((story, storyIdx) => {
                  const activeStoryId = story.id || `Unknown-Story-${storyIdx}`;
                  const isStoryExpanded = !!expandedNodes[activeStoryId];
                  const isStoryFailed = String(story.status).toUpperCase() === 'FAILED' || isEpicFailed;
                  
                  return (
                    <div key={`${activeStoryId}-${storyIdx}`} style={{ border: isStoryFailed ? '1px solid #fee2e2' : '1px solid #f1f5f9', borderRadius: '8px', background: '#ffffff' }}>
                      <div 
                        onClick={() => toggleNode(activeStoryId)}
                        style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: isStoryFailed ? '#fffafb' : '#fafafa', borderBottom: isStoryExpanded ? '1px solid #f1f5f9' : 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isStoryExpanded ? <ChevronDown size={14} color="#64748b" /> : <ChevronRight size={14} color="#94a3b8" />}
                          <FileText size={16} color={isStoryFailed ? '#ef4444' : '#10b981'} />
                          <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569', background: '#f8fafc', padding: '1px 5px', borderRadius: '4px' }}>{activeStoryId}</span>
                          <span style={{ fontSize: '13.5px', fontWeight: '500', color: '#1e293b' }}>{story.title}</span>
                        </div>
                        <span className="status-badge" style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '8px', ...getBadgeStyle(story.status) }}>
                          {story.status}
                        </span>
                      </div>

                      {/* LEVEL 3: TASKS */}
                      {isStoryExpanded && (
                        <div style={{ padding: '10px 12px 12px 32px', display: 'flex', flexDirection: 'column', gap: '8px', background: '#fff' }}>
                          {story.tasks?.map((task, taskIdx) => {
                            const isTaskFailed = String(task.status).toUpperCase() === 'FAILED';
                            return (
                              <div key={`${task.id}-${taskIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: isTaskFailed ? '#fff5f5' : '#f8fafc', borderRadius: '6px', border: isTaskFailed ? '1px solid #fca5a5' : '1px solid #f1f5f9' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: task.status === 'COMPLETED' ? '#10b981' : (isTaskFailed ? '#ef4444' : '#8b5cf6') }}></div>
                                    <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>{task.id}</span>
                                    <span style={{ fontSize: '13px', color: '#334155' }}>{task.title}</span>
                                  </div>
                                  <span style={{ fontSize: '11px', fontWeight: '700', ...getBadgeStyle(task.status), padding: '2px 6px', borderRadius: '4px' }}>
                                    {task.status}
                                  </span>
                                </div>
                                {isTaskFailed && (
                                  <div style={{ marginLeft: '12px', fontSize: '11.5px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '4px', background: '#fff0f0', padding: '6px 10px', borderRadius: '4px', borderLeft: '3px solid #ef4444' }}>
                                    <Code size={12} />
                                    <span><strong>Pipeline Diagnostics:</strong> Automated assertion checks failed in target unit test suite execution loop.</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
};

const Reports = () => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState('executive'); 
  const [selectedProjectId, setSelectedProjectId] = useState('');
  
  const [activeModal, setActiveModal] = useState(null); 
  const [modalPage, setModalPage] = useState(1);
  const modalItemsPerPage = 5;

  const [teamPage, setTeamPage] = useState(1);
  const teamItemsPerPage = 5;

  const [drillDownEpic, setDrillDownEpic] = useState(null);
  const [selectedHealingTrack, setSelectedHealingTrack] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Selected dev profile state tracking inside the Team Balancing framework
  const [focusedTeamMember, setFocusedTeamMember] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projId = params.get('projectId');
    const tab = params.get('tab');
    if (projId) setSelectedProjectId(projId);
    if (tab) setActiveTab(tab);
  }, []);

  useEffect(() => {
    const fetchManagerData = async () => {
      setLoading(true); setError(null);
      const currentUsername = localStorage.getItem('username'); 
      if (!currentUsername) {
        setError("User session not found."); setLoading(false); return;
      }
      const url = `${API_BASE_URL}/api/v1/reports/all?username=${currentUsername}`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch reports data from API.");
        const data = await response.json();
        
        setReportData({
          summary: data.summary.summary,
          quality_data: data.summary.quality_data,
          team_data: data.team_workload,
          table_data: data.project_breakdown,
          timeline_data: data.delivery_trends
        });

        // Auto-initialize selected focus developer if metrics layer contains data
        if (data.team_workload && data.team_workload.length > 0) {
          setFocusedTeamMember(data.team_workload[0]);
        }
      } catch (err) { 
        setError(err.message); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchManagerData();
  }, []);

  if (error) {
    return (
      <div className="reports-container flex-center" style={{height:'70vh'}}>
        <div style={{background: '#fee2e2', color: '#dc2626', padding: '24px', borderRadius: '12px', border: '1px solid #fca5a5', maxWidth: '500px', textAlign:'center'}}>
          <AlertTriangle size={32} style={{marginBottom: '10px'}}/>
          <h3 style={{margin: '0 0 10px 0'}}>System Synchronization Error</h3>
          <p style={{fontSize: '14px'}}>{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !reportData) {
    return (
      <div className="reports-container flex-center" style={{height:'70vh', flexDirection: 'column'}}>
        <div style={{width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom:'20px'}}></div>
        <h2 style={{color: '#0f172a'}}>Compiling Executive Report...</h2>
      </div>
    );
  }

  const { summary = {}, table_data = [], team_data = [], timeline_data = [] } = reportData;
  const blockedProjects = table_data.filter(p => p.failed > 0);
  const pendingTasks = summary.total_tasks - (summary.completed_tasks || 0) - (summary.failed_tasks || 0);

  const handleBlockerClick = (projectId) => {
    setSelectedProjectId(projectId); setActiveTab('project');
  };

  const filteredMatrix = table_data
    .filter(p => p.project_name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); 

  const totalPages = Math.ceil(filteredMatrix.length / itemsPerPage) || 1;
  const paginatedMatrix = filteredMatrix.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const selectedProjectStats = selectedProjectId ? table_data.find(p => p.project_id === selectedProjectId) : null;

  const totalModalPages = Math.ceil(table_data.length / modalItemsPerPage) || 1;
  const paginatedModalData = table_data.slice((modalPage - 1) * modalItemsPerPage, modalPage * modalItemsPerPage);

  const totalTeamPages = Math.ceil(team_data.length / teamItemsPerPage) || 1;
  const paginatedTeamData = team_data.slice((teamPage - 1) * teamItemsPerPage, teamPage * teamItemsPerPage);

  let currentCompleted = 0, currentTotal = 0, prevCompleted = 0, prevTotal = 0;
  if (timeline_data.length > 0) {
    const latest = timeline_data[timeline_data.length - 1];
    currentCompleted = latest.completed || 0;
    currentTotal = latest.total || 0;
    if (timeline_data.length > 1) {
      const prev = timeline_data[timeline_data.length - 2];
      prevCompleted = prev.completed || 0;
      prevTotal = prev.total || 0;
    }
  }
  const sprintImprovement = currentCompleted - prevCompleted;
  const isPositive = sprintImprovement >= 0;

  const projectPieData = [
    { name: 'Completed', value: table_data.filter(p => p.success_rate === 100).length, color: '#10b981' },
    { name: 'Pending', value: table_data.filter(p => p.success_rate < 100 && p.failed === 0).length, color: '#8b5cf6' },
    { name: 'Failed', value: blockedProjects.length, color: '#ef4444' }
  ].filter(d => d.value > 0);

  const allocationPieData = selectedProjectStats ? [
    { name: 'Completed', value: selectedProjectStats.completed, color: '#10b981' },
    { name: 'Pending', value: selectedProjectStats.pending, color: '#8b5cf6' },
    { name: 'Failed', value: selectedProjectStats.failed, color: '#ef4444' }
  ].filter(d => d.value > 0) : [];

  // MOCK DATA DICTIONARY LINKED TO REPAIR LOG BRACKETS
  const selfHealingDistributionData = [
    { 
      rounds: "0 try", count: summary.completed_tasks > 0 ? summary.completed_tasks : 48, color: "#10b981",
      tasks: [
        { id: "PHOE-8", title: "Transform legacy field formats to modern data schema", project: "Phoenix Data Engine", attempts: 0, reason: "Passed First Try - Flawless Execution Flow", status: "COMPLETED" },
        { id: "PHOE-3", title: "Offline Functionality for Driver Companion Mobile App", project: "Mobile Companion Framework", attempts: 0, reason: "Passed First Try - Clean Integration Build", status: "COMPLETED" }
      ]
    },
    { 
      rounds: "1 loop", count: summary.failed_tasks > 0 ? Math.floor(summary.total_tasks * 0.15) : 18, color: "#3b82f6",
      tasks: [
        { id: "PHOE-32", title: "Implement field transformation logic for ACCT_NUM_PK", project: "Phoenix Core Ledger", attempts: 1, reason: "LINT_FAILURE: Missing spacing constraints on layout file. Resolved automatically by pre-commit script loop.", status: "COMPLETED" }
      ]
    },
    { 
      rounds: "2 loops", count: summary.failed_tasks > 0 ? Math.floor(summary.total_tasks * 0.08) : 9, color: "#f59e0b",
      tasks: [
        { id: "PHOE-33", title: "Implement BAL_AMT_Z to balance_current transformation logic", project: "Banking Hub Sync Container", attempts: 2, reason: "TEST_REGRESSION: Rounding variance on precision floats. Auto-resolved by code generation casting hooks.", status: "COMPLETED" }
      ]
    },
    { 
      rounds: "3 loops", count: summary.failed_tasks > 0 ? Math.floor(summary.total_tasks * 0.03) : 4, color: "#a855f7",
      tasks: [
        { id: "PHOE-34", title: "Implement LAST_TX_DT to ISO 8601 standardized conversion profile", project: "Audit Logger Hook", attempts: 3, reason: "TIMEOUT: Database pooling thread limits reached during test suites. Automated orchestrator configuration timeout scaling resolved.", status: "COMPLETED" }
      ]
    },
    { 
      rounds: "4+ loops", count: summary.failed_tasks > 0 ? summary.failed_tasks : 2, color: "#ef4444",
      tasks: [
        { id: "PHOE-35", title: "Implement CUST_RISK_FLG to risk_profile_json metadata mapping", project: "Secured Compliance Service", attempts: 5, reason: "FATAL COMPILATION ERROR: Underlying network mock package mismatch. Maximum loop repair threshold breached.", status: "FAILED" }
      ]
    }
  ];

  // FIXED: Dynamic fallback resolution maps complete diagnostic nodes down to Tab 3 chart objects safely
  const getProjectHealingDistribution = () => {
    const baseline = selectedProjectStats?.ci_rounds_distribution;
    if (baseline && baseline.some(d => d.count > 0)) {
      return baseline;
    }
    return [
      { rounds: "0 try", count: selectedProjectStats ? selectedProjectStats.completed : 4, color: "#10b981", tasks: selfHealingDistributionData[0].tasks },
      { rounds: "1 loop", count: selectedProjectStats ? Math.min(2, Math.floor(selectedProjectStats.pending * 0.3)) : 1, color: "#3b82f6", tasks: selfHealingDistributionData[1].tasks },
      { rounds: "2 loops", count: selectedProjectStats ? Math.min(1, Math.floor(selectedProjectStats.pending * 0.2)) : 0, color: "#f59e0b", tasks: selfHealingDistributionData[2].tasks },
      { rounds: "3 loops", count: selectedProjectStats ? 0 : 0, color: "#a855f7", tasks: selfHealingDistributionData[3].tasks },
      { rounds: "4+ loops", count: selectedProjectStats ? selectedProjectStats.failed : 1, color: "#ef4444", tasks: selfHealingDistributionData[4].tasks }
    ];
  };

  // Top Performer Calculation logic analyzes cumulative outputs across workspace bounds
  const portfolioTopPerformer = team_data.length > 0 ? team_data.sort((a,b) => b.completed - a.completed)[0] : null;

  return (
    <div className="reports-container">
      <header className="reports-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 20px 0' }}>
        <div>
          <h1>SDLC Intelligence Center</h1>
          <p className="subtitle">High-level portfolio management analytics and automated telemetry insights</p>
        </div>
        <button className="export-btn"><Download size={16} /> Export Report</button>
      </header>

      {/* STRATEGIC KPIS CARDS */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">Portfolio Scope</span>
            <div className="icon-wrapper blue-bg"><Briefcase size={18} className="blue-text" /></div>
          </div>
          <div className="metric-value">{summary.total_projects || 0} Projects</div>
          <div style={{ fontSize: '13px', color: '#10b981', fontWeight: '600', marginTop: '8px' }}>
            <TrendingUp size={14} style={{display: 'inline', marginRight:'4px'}}/> {summary.weekly_project_delta || '+0 this week'}
          </div>
        </div>
        
        <div className="metric-card clickable" onClick={() => { setModalPage(1); setActiveModal('tasks'); }}>
          <div className="metric-header">
            <span className="metric-title">Aggregated Task Load</span>
            <div className="icon-wrapper purple-bg"><ListTodo size={18} className="purple-text" /></div>
          </div>
          <div className="metric-value">{summary.total_tasks || 0}</div>
          <div style={{ display: 'flex', gap: '6px', fontSize: '13px', color: '#64748b', marginTop: '8px', fontWeight: '500' }}>
            <span style={{ color: '#10b981' }}>{summary.completed_tasks || 0} done</span>·
            <span style={{ color: '#8b5cf6' }}>{pendingTasks > 0 ? pendingTasks : 0} pending</span>·
            <span style={{ color: '#ef4444' }}>{summary.failed_tasks || 0} blocked</span>
          </div>
        </div>

        <div className="metric-card danger">
          <div className="metric-header">
            <span className="metric-title">Bottlenecks & Blockers</span>
            <div className="icon-wrapper red-bg"><AlertTriangle size={18} className="red-text" /></div>
          </div>
          <div className="metric-value">{summary.failed_tasks || 0}</div>
          {blockedProjects.length === 0 ? (
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>No active blockers</p>
          ) : (
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {blockedProjects.map((p, idx) => (
                <button 
                  key={`${p.project_id}-${idx}`} onClick={() => handleBlockerClick(p.project_id)}
                  style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', fontSize: '11px', padding: '4px 8px', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  <Target size={10} style={{display: 'inline'}}/> {p.project_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SUPER PRO GRADE NAVIGATION TABS MATRIX DESIGN */}
      <div className="tabs" style={{ display: 'flex', gap: '15px', margin: '0 0 30px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
        <button 
          className={`tab-btn`} 
          style={{ 
            padding: '10px 20px', borderRadius: '8px', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: activeTab === 'executive' ? 'linear-gradient(135deg, #1e293b, #334155)' : '#f8fafc',
            color: activeTab === 'executive' ? '#ffffff' : '#64748b',
            boxShadow: activeTab === 'executive' ? '0 4px 12px rgba(30, 41, 59, 0.25)' : 'none'
          }} 
          onClick={() => setActiveTab('executive')}
        >
          📈 Executive Overview
        </button>
        <button 
          className={`tab-btn`} 
          style={{ 
            padding: '10px 20px', borderRadius: '8px', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: activeTab === 'team' ? 'linear-gradient(135deg, #6d28d9, #5b21b6)' : '#f8fafc',
            color: activeTab === 'team' ? '#ffffff' : '#64748b',
            boxShadow: activeTab === 'team' ? '0 4px 12px rgba(109, 40, 217, 0.25)' : 'none'
          }} 
          onClick={() => setActiveTab('team')}
        >
          👥 Team Workload Balancing
        </button>
        <button 
          className={`tab-btn`} 
          style={{ 
            padding: '10px 20px', borderRadius: '8px', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: activeTab === 'project' ? 'linear-gradient(135deg, #b45309, #92400e)' : '#f8fafc',
            color: activeTab === 'project' ? '#ffffff' : '#64748b',
            boxShadow: activeTab === 'project' ? '0 4px 12px rgba(180, 83, 9, 0.25)' : 'none'
          }} 
          onClick={() => setActiveTab('project')}
        >
          🔍 Specific Project Drill-down
        </button>
      </div>

      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {activeTab === 'executive' && (
        <div className="tab-content fade-in">
          <div style={{ display: 'flex', gap: '24px', marginBottom: '30px' }}>
            <div className="chart-card" style={{ flex: 1.5 }}>
              <h3 style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>Sprint Delivery Velocity <span style={{fontSize:'12px', color:'#64748b', fontWeight:'normal'}}>Previous vs Current Sprints</span></h3>
              <div style={{ display: 'flex', gap: '20px', height: '280px' }}>
                <div style={{ flex: 1.5, height: '100%' }}>
                  {timeline_data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={timeline_data}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="completed" name="Completed Tasks" fill="#10b981" maxBarSize={40} />
                        <Bar dataKey="behind" name="Pending/Failed Tasks" fill="#f43f5e" maxBarSize={40} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'#94a3b8'}}>No sprint data established yet.</div>}
                </div>
                <div style={{ flex: 1.1, background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', fontWeight: '700' }}>Sprint over Sprint (SoS) Analysis</h4>
                  <div style={{ marginBottom: '14px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '2px' }}>Net Improvement</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '28px', fontWeight: 'bold', color: isPositive ? '#10b981' : '#ef4444', lineHeight: 1 }}>
                        {isPositive ? '+' : ''}{sprintImprovement}
                      </span>
                      <span style={{ fontSize: '12px', color: isPositive ? '#10b981' : '#ef4444', fontWeight: '600' }}>tasks</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '4px', borderBottom: '1px dashed #e2e8f0' }}>
                      <span style={{ color: '#475569' }}>Last Sprint:</span>
                      <strong style={{ color: '#0f172a' }}>{prevCompleted} / {prevTotal || '0'} done</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px' }}>
                      <span style={{ color: '#475569' }}>Current Sprint:</span>
                      <strong style={{ color: '#0f172a' }}>{currentCompleted} / {currentTotal || '0'} done</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #cbd5e1' }}>
                      <span style={{ color: '#64748b' }}>Time Remaining:</span>
                      <strong style={{ color: '#f59e0b' }}>4 Days Left</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Tasks Pending:</span>
                      <strong style={{ color: '#8b5cf6' }}>{(currentTotal - currentCompleted) > 0 ? (currentTotal - currentCompleted) : 0} tasks</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748b' }}>Completion Efficiency:</span>
                      <strong style={{ color: '#3b82f6' }}>{currentTotal > 0 ? ((currentCompleted / currentTotal) * 100).toFixed(1) : '0.0'}%</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="chart-card" style={{ flex: 1 }}>
               <h3>Global AI Self-Healing Engine Loops</h3>
               <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 12px 0' }}>Click any bar level to audit code-repair diagnostics</p>
               <div style={{ height: '240px' }}>
                 <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={selfHealingDistributionData} margin={{ left: -25, bottom: 5 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis dataKey="rounds" tick={{ fontSize: 11 }} />
                     <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                     <Tooltip cursor={{ fill: '#f8fafc' }} />
                     <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={35} onClick={(data) => setSelectedHealingTrack(data)} style={{ cursor: 'pointer' }}>
                       {selfHealingDistributionData.map((entry, i) => (
                         <Cell key={`cell-${i}`} fill={entry.color || '#3b82f6'} />
                       ))}
                     </Bar>
                   </BarChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="chart-card" style={{ flex: 1 }}>
               <h3>Global Project Health</h3>
               <div style={{ height: '240px', marginTop: '15px' }}>
                 {projectPieData.length > 0 ? (
                   <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                       <Pie data={projectPieData} innerRadius={55} outerRadius={85} paddingAngle={5} dataKey="value">
                         {projectPieData.map((e, i) => <Cell key={`cell-${i}`} fill={e.color} />)}
                       </Pie>
                       <Tooltip />
                       <Legend verticalAlign="bottom"/>
                     </PieChart>
                   </ResponsiveContainer>
                 ) : <div style={{display:'flex', height:'100%', alignItems:'center', justifyContent:'center', color:'#94a3b8'}}>No project data available.</div>}
               </div>
            </div>
          </div>

          <div className="chart-card">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
              <h3 style={{margin: 0}}>Matrix: All Active Projects & Status</h3>
              <div className="search-bar">
                <Search size={16} color="#64748b"/>
                <input type="text" placeholder="Search projects..." value={searchTerm} onChange={(e) => {setSearchTerm(e.target.value); setCurrentPage(1);}} />
              </div>
            </div>
            <table className="executive-table" style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px'}}>
              <thead>
                <tr style={{borderBottom: '2px solid #e2e8f0', color: '#64748b'}}>
                  <th style={{padding: '12px'}}>Date</th>
                  <th style={{padding: '12px'}}>Project Name</th>
                  <th style={{padding: '12px'}}>Assignee</th>
                  <th style={{padding: '12px'}}>Total Tasks</th>
                  <th style={{padding: '12px'}}>Completion</th>
                  <th style={{padding: '12px'}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredMatrix.length > 0 ? paginatedMatrix.map((p, idx) => (
                  <tr key={`${p.project_id}-${idx}`} style={{borderBottom: '1px solid #f1f5f9', cursor:'pointer'}} onClick={() => handleBlockerClick(p.project_id)} className="hover:shadow-md">
                    <td style={{padding: '16px 12px', color: '#64748b', fontSize: '12px'}}>{new Date(p.created_at).toLocaleDateString() !== "Invalid Date" ? new Date(p.created_at).toLocaleDateString() : 'N/A'}</td>
                    <td style={{padding: '16px 12px', fontWeight: 'bold', color: '#0f172a'}}>{p.project_name}</td>
                    <td style={{padding: '16px 12px'}}>{p.assignee}</td>
                    <td style={{padding: '16px 12px'}}>{p.total_tasks}</td>
                    <td style={{padding: '16px 12px'}}>
                       <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                         <div style={{width:'100px', height:'6px', background:'#e2e8f0', borderRadius:'10px'}}>
                           <div style={{width:`${p.success_rate}%`, height:'100%', background:'#10b981', borderRadius:'10px'}}></div>
                         </div>
                         <span style={{fontSize:'12px'}}>{p.success_rate}%</span>
                       </div>
                    </td>
                    <td style={{padding: '16px 12px'}}>
                      {p.failed > 0 ? <span style={{color: '#dc2626', background: '#fee2e2', padding: '4px 8px', borderRadius:'12px', fontWeight:'bold', fontSize:'11px'}}>BLOCKED</span> 
                       : p.success_rate === 100 && p.total_tasks > 0 ? <span style={{color: '#16a34a', background: '#dcfce7', padding: '4px 8px', borderRadius:'12px', fontWeight:'bold', fontSize:'11px'}}>COMPLETED</span> 
                       : <span style={{color: '#3b82f6', background: '#dbeafe', padding: '4px 8px', borderRadius:'12px', fontWeight:'bold', fontSize:'11px'}}>ON TRACK</span>}
                    </td>
                  </tr>
                )) : <tr><td colSpan="6" style={{padding: '20px', textAlign: 'center', color: '#64748b'}}>No active projects match your query.</td></tr>}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{display: 'flex', justifyContent: 'flex-end', gap: '15px', marginTop: '20px'}}>
                <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="export-btn">Prev</button>
                <span style={{fontSize: '13px', alignSelf:'center'}}>Page {currentPage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="export-btn">Next</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TEAM WORKLOAD BALANCING & ANALYSIS */}
      {activeTab === 'team' && (
         <div className="tab-content fade-in">
           {/* HIGH-FIDELITY HIGHLIGHT HEADER ROW */}
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              {portfolioTopPerformer && (
                <div style={{ background: 'linear-gradient(135deg, #6d28d9, #4c1d95)', color: '#ffffff', borderRadius: '12px', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 15px rgba(109, 40, 217, 0.25)' }}>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.2)', fontSize: '12px', fontWeight: '800', padding: '4px 10px', borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                      <Award size={14} /> Top Performer Spotlight
                    </span>
                    <h2 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: '800' }}>{portfolioTopPerformer.name}</h2>
                    <p style={{ margin: 0, opacity: 0.85, fontSize: '13.5px' }}>
                      Highest historical sprint output across the entire engineering portfolio layer.
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', background: 'rgba(255,255,255,0.1)', padding: '16px 20px', borderRadius: '10px', backdropFilter: 'blur(4px)' }}>
                     <span style={{ display: 'block', fontSize: '32px', fontWeight: '900', lineHeight: 1 }}>{portfolioTopPerformer.completed}</span>
                     <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', opacity: 0.8 }}>Tasks Cleared</span>
                  </div>
                </div>
              )}

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', justifycontent: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f5f3ff', color: '#6d28d9', fontSize: '11px', fontWeight: '800', padding: '4px 10px', borderRadius: '20px', textTransform: 'uppercase', marginBottom: '12px', width: 'fit-content' }}>
                  <Sparkles size={13} /> Portfolio Efficiency Profile
                </span>
                <p style={{ margin: '0 0 15px 0', color: '#475569', fontSize: '14px', lineHeight: 1.5 }}>
                  Select any active team member resource badge inside the selector engine dashboard column to render explicit week-over-week productivity metrics and task delta logs.
                </p>
                <div style={{ display: 'flex', gap: '20px', fontSize: '13px', borderTop: '1px dashed #cbd5e1', paddingTop: '12px' }}>
                   <div>Average Efficiency: <strong style={{ color: '#6d28d9' }}>{summary.completion_rate}%</strong></div>
                   <div>Active Collaborators: <strong>{team_data.length}</strong></div>
                </div>
              </div>
           </div>

           <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '24px', marginBottom: '24px' }}>
              {/* LEFT COLUMN: ACTIVE DEVELOPER badge TARGET LIST */}
              <div className="chart-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                 <h3 style={{ margin: '0 0 5px 0' }}>Select Resource Channel</h3>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: '310px' }}>
                   {paginatedTeamData.map(dev => (
                     <button 
                       key={dev.name} 
                       onClick={() => setFocusedTeamMember(dev)}
                       style={{ padding: '12px', background: focusedTeamMember?.name === dev.name ? '#f5f3ff' : '#f8fafc', border: `1px solid ${focusedTeamMember?.name === dev.name ? '#6d28d9' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', justifycontent: 'space-between', alignitems: 'center', fontWeight: 'bold', color: '#1e293b', textAlign: 'left', transition: 'all 0.2s' }}
                     >
                        <div style={{ display: 'flex', alignitems: 'center', gap: '8px' }}><User size={16} color={focusedTeamMember?.name === dev.name ? '#6d28d9' : '#64748b'} /> {dev.name}</div>
                        <span style={{ fontSize: '12px', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '12px' }}>{dev.completed} / {dev.total} Tasks</span>
                     </button>
                   ))}
                 </div>
                 {totalTeamPages > 1 && (
                    <div style={{ display: 'flex', justifycontent: 'flex-end', gap: '10px', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                       <button onClick={() => setTeamPage(p => Math.max(p - 1, 1))} disabled={teamPage === 1} style={{ padding: '4px 8px', fontSize: '12px', cursor: teamPage === 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
                       <span style={{ fontSize: '12px', alignSelf: 'center' }}>{teamPage} / {totalTeamPages}</span>
                       <button onClick={() => setTeamPage(p => Math.min(p + 1, totalTeamPages))} disabled={teamPage === totalTeamPages} style={{ padding: '4px 8px', fontSize: '12px', cursor: teamPage === totalTeamPages ? 'not-allowed' : 'pointer' }}>Next</button>
                    </div>
                 )}
              </div>

              {/* RIGHT COLUMN: REBUILT RESOURCE SPRINT TRACKER ANALYSIS BLOCK */}
              <div className="chart-card">
                 {focusedTeamMember ? (() => {
                    const sprints = focusedTeamMember.biweekly_sprints || [];
                    const latestNode = sprints[sprints.length - 1] || { completed: 0, total: 0, behind: 0, prev_week_completed: 0 };
                    const deltaValue = latestNode.completed - latestNode.prev_week_completed;
                    
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <h3 style={{ margin: '0 0 15px 0' }}>Bi-Weekly Sprint Analytics: {focusedTeamMember.name}</h3>
                        <div style={{ display: 'flex', gap: '20px', height: '240px', flexGrow: 1 }}>
                           <div style={{ flex: 1.5, height: '100%' }}>
                             {sprints.length > 0 ? (
                               <ResponsiveContainer width="100%" height="100%">
                                 <ComposedChart data={sprints}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                    <YAxis allowDecimals={false} />
                                    <Tooltip />
                                    <Legend />
                                    <Bar dataKey="completed" name="Completed Tasks" fill="#10b981" maxBarSize={30} />
                                    <Bar dataKey="behind" name="Behind Load" fill="#f43f5e" maxBarSize={30} />
                                 </ComposedChart>
                               </ResponsiveContainer>
                             ) : <div style={{ color: '#94a3b8', textAlign: 'center', paddingTop: '80px' }}>No sprint data generated yet.</div>}
                           </div>

                           <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', display: 'flex', flexDirection: 'column', justifycontent: 'center', fontSize: '12.5px' }}>
                              <span style={{ textTransform: 'uppercase', fontSize: '11px', color: '#64748b', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Resource Velocity Delta</span>
                              <div style={{ display: 'flex', alignitems: 'center', gap: '4px', marginBottom: '12px' }}>
                                 <span style={{ fontSize: '24px', fontWeight: '900', color: deltaValue >= 0 ? '#10b981' : '#ef4444' }}>{deltaValue >= 0 ? `+${deltaValue}` : deltaValue}</span>
                                 <span style={{ fontSize: '11px', fontWeight: '600' }}>vs Prior Cycle</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                 <div style={{ display: 'flex', justifycontent: 'space-between' }}><span>Sprint Completion Rate:</span><strong>{latestNode.completion_rate || 0}%</strong></div>
                                 <div style={{ display: 'flex', justifycontent: 'space-between' }}><span>Staged Backlog/Behind:</span><strong style={{ color: '#f43f5e' }}>{latestNode.behind || 0} tasks</strong></div>
                                 <div style={{ display: 'flex', justifycontent: 'space-between' }}><span>Total Load Allocated:</span><strong>{latestNode.total || 0} items</strong></div>
                              </div>
                           </div>
                        </div>
                      </div>
                    );
                 })() : <div style={{ color: '#94a3b8', textAlign: 'center', padding: '80px' }}>Select a developer to load telemetry logs.</div>}
              </div>
           </div>

           <div className="chart-card">
              <h3>Resource Task Load Distribution matrix</h3>
              <div style={{ height: '300px', marginTop: '20px' }}>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={team_data}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} />
                       <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                       <YAxis />
                       <Tooltip />
                       <Legend />
                       <Bar dataKey="completed" stackId="a" fill="#10b981" maxBarSize={40} />
                       <Bar dataKey="pending" stackId="a" fill="#8b5cf6" maxBarSize={40} />
                       <Bar dataKey="failed" stackId="a" fill="#ef4444" maxBarSize={40} />
                    </BarChart>
                 </ResponsiveContainer>
              </div>
           </div>
         </div>
      )}

      {activeTab === 'project' && (
         <div className="tab-content fade-in">
             <div className="chart-card" style={{ marginBottom: '25px' }}>
               <h3>Select a Project to Analyze</h3>
               <select 
                 value={selectedProjectId} 
                 onChange={(e) => setSelectedProjectId(e.target.value)}
                 style={{ width: '100%', maxWidth: '450px', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', cursor: 'pointer' }}
               >
                 <option value="" disabled>-- Choose a project --</option>
                 {table_data.map((proj, idx) => (
                   <option key={`${proj.project_id}-${idx}`} value={proj.project_id}>{proj.project_name}</option>
                 ))}
               </select>
             </div>

             {selectedProjectStats ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                   
                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', width: '100%' }}>
                     
                     <div className="pro-project-card">
                       <div className="pro-card-header">
                         <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Project Task Allocations</h4>
                         <span className="assignee-badge">{selectedProjectStats.assignee}</span>
                       </div>
                       <div className="pro-card-body">
                         <div className="mini-chart-container">
                           {allocationPieData.length > 0 ? (
                             <ResponsiveContainer width="100%" height="100%">
                               <PieChart>
                                 <Pie data={allocationPieData} innerRadius={30} outerRadius={45} paddingAngle={3} dataKey="value" stroke="none">
                                   {allocationPieData.map((entry, i) => <Cell key={`mini-${i}`} fill={entry.color} />)}
                                 </Pie>
                               </PieChart>
                             </ResponsiveContainer>
                           ) : (
                             <div className="empty-chart-ring">0 Tasks</div>
                           )}
                         </div>
                         <div className="pro-card-stats">
                           <div className="stat-line"><span className="dot bg-green"></span> Completed: <strong>{selectedProjectStats.completed}</strong></div>
                           <div className="stat-line"><span className="dot bg-yellow"></span> Pending: <strong>{selectedProjectStats.pending}</strong></div>
                           <div className="stat-line"><span className="dot bg-red"></span> Failed: <strong>{selectedProjectStats.failed}</strong></div>
                         </div>
                       </div>
                       <div className="pro-card-footer">
                         <div className="progress-track">
                           <div className="progress-fill" style={{ width: `${selectedProjectStats.success_rate}%`, backgroundColor: '#10b981' }}></div>
                         </div>
                         <span className="success-text">{selectedProjectStats.success_rate}% Success</span>
                       </div>
                     </div>

                     <div className="pro-project-card">
                       <div className="pro-card-header">
                         <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Task Distribution by Phase</h4>
                       </div>
                       <div className="pro-card-body">
                         {selectedProjectStats.phase_breakdown && selectedProjectStats.phase_breakdown.some(p => p.value > 0) ? (
                           <>
                             <div className="mini-chart-container">
                               <ResponsiveContainer width="100%" height="100%">
                                 <PieChart>
                                   <Pie data={selectedProjectStats.phase_breakdown} innerRadius={0} outerRadius={45} dataKey="value">
                                     {selectedProjectStats.phase_breakdown.map((entry, i) => <Cell key={`phase-${i}`} fill={entry.color} />)}
                                   </Pie>
                                 </PieChart>
                               </ResponsiveContainer>
                             </div>
                             <div className="pro-card-stats">
                               {selectedProjectStats.phase_breakdown.map((phase, i) => (
                                 <div key={i} className="stat-line">
                                   <span className="dot" style={{ backgroundColor: phase.color }}></span> {phase.name} <strong>{phase.value}</strong>
                                 </div>
                               ))}
                             </div>
                           </>
                         ) : (
                           <>
                             <div className="empty-chart-ring" style={{marginRight:'15px'}}>0 Nodes</div>
                             <div className="pro-card-stats">
                               {selectedProjectStats.phase_breakdown.map((phase, i) => (
                                 <div key={i} className="stat-line">
                                   <span className="dot" style={{ backgroundColor: phase.color }}></span> {phase.name} <strong>{phase.value}</strong>
                                 </div>
                               ))}
                             </div>
                           </>
                         )}
                       </div>
                     </div>

                     {/* REFACTORED AND INTEGRATED PROJECT SPECIFIC AI DEPLOYMENT REPAIR LOOP VIZ DATA COMPONENT CHIP PANEL CARD BOX */}
                     <div className="pro-project-card">
                       <div className="pro-card-header">
                         <h4 style={{ fontSize: '15px', fontWeight: '600', margin: 0 }}>Project Repair Diagnostics</h4>
                       </div>
                       <div style={{ height: '110px', marginTop: '5px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={getProjectHealingDistribution()} margin={{ left: -30, bottom: -5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="rounds" tick={{ fontSize: 9 }} interval={0} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 9 }} />
                              <Bar dataKey="count" radius={[2, 2, 0, 0]} onClick={(data) => { if (data.count > 0) setSelectedHealingTrack(data); }} style={{ cursor: 'pointer' }}>
                                {getProjectHealingDistribution().map((entry, i) => (
                                  <Cell key={`p-cell-${i}`} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                       </div>
                       <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: 'auto' }}>
                         <span style={{ color: '#64748b' }}>Active Branch Context:</span>
                         <span style={{ fontFamily: 'monospace', fontWeight: '700' }}>{selectedProjectStats.github_branch || 'main'}</span>
                       </div>
                     </div>

                     <div className="pro-project-card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', gridColumn: 'span 3' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                         <h4 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Timeline Context</h4>
                         <span style={{ fontSize: '12px', fontWeight: '800', color: '#3b82f6', background: '#dbeafe', padding: '3px 8px', borderRadius: '12px' }}>
                           Sprint 23-24, 2026
                         </span>
                       </div>
                       
                       <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', fontSize: '12.5px' }}>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                           <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                             <span style={{ color: '#64748b' }}>Target Repository:</span>
                             <span style={{ fontWeight: '600', color: '#0f172a', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedProjectStats.github_repo}>
                               {selectedProjectStats.github_repo || 'Unlinked'}
                             </span>
                           </div>
                           <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                             <span style={{ color: '#64748b' }}>Active Branch:</span>
                             <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#334155' }}>{selectedProjectStats.github_branch || 'main'}</span>
                           </div>
                         </div>
                         <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #f1f5f9', height: '90px', overflowY: 'auto' }}>
                           <span style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Project Description Overview</span>
                           <p style={{ fontSize: '13px', color: '#334155', margin: 0, lineHeight: '1.4' }}>
                             {selectedProjectStats.project_description || "No project description overview context summary uploaded for this repository profile branch loop config."}
                           </p>
                         </div>
                       </div>
                     </div>

                   </div>

                   <div style={{ width: '100%', background: '#ffffff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                     <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>Automation & CI Pipeline Engine Tracking</h4>
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                       <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                           <span style={{ fontSize: '13px', color: '#64748b' }}>Test Pass Ratio</span>
                           <ShieldCheck size={18} color="#10b981" />
                         </div>
                         <div style={{ fontSize: '24px', fontWeight: '700' }}>{selectedProjectStats.test_pass_rate || 0}%</div>
                       </div>
                       <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                           <span style={{ fontSize: '13px', color: '#64748b' }}>AI CI Self-Healing Fixes</span>
                           <RefreshCw size={18} color="#3b82f6" />
                         </div>
                         <div style={{ fontSize: '24px', fontWeight: '700' }}>{selectedProjectStats.total_ci_fixes || 0} rounds</div>
                       </div>
                       <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                           <span style={{ fontSize: '13px', color: '#64748b' }}>Total Test Cases Executed</span>
                           <Cpu size={18} color="#a855f7" />
                         </div>
                         <div style={{ fontSize: '24px', fontWeight: '700' }}>{selectedProjectStats.total_tests_run || 0} tests</div>
                       </div>
                     </div>
                   </div>

                   <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                     <h3 style={{ margin: '0 0 4px 0', fontSize: '17px', fontWeight: '700', color: '#0f172a' }}>Epic Execution Breakdown</h3>
                     <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '15px' }}>Expand nested tree loops to view requirements, stories, and atomic task parameters.</p>
                     <ProjectFolderTree 
                       epicsDetail={selectedProjectStats.epics_detail} 
                       onSelectEpic={(epic) => setDrillDownEpic(epic)} 
                     />
                   </div>

                </div>
             ) : (
                <div style={{ background: '#fff', padding: '40px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign:'center', color:'#64748b' }}>
                  Please select an active project inside the dropdown above to initialize portfolio telemetry blocks.
                </div>
             )}
         </div>
      )}

      {activeModal === 'tasks' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content fade-in" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveModal(null)}><X size={20} /></button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px 0' }}>
              <h2 style={{ color: '#0f172a', fontSize: '21px', margin: 0 }}>Aggregated Task Load Breakdown</h2>
              <span style={{ background: '#ede9fe', color: '#7c3aed', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                Total Load Profile: {summary.total_tasks || 0}
              </span>
            </div>
            <div style={{ height: '300px', margin: '20px 0 0 0' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paginatedModalData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="project_name" tick={{ fontSize: 10, fill: '#475569' }} interval={0} angle={-25} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} />
                  <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '10px' }} />
                  <Bar dataKey="completed" name="Completed" stackId="a" fill="#10b981" maxBarSize={40} />
                  <Bar dataKey="pending" name="Pending" stackId="a" fill="#8b5cf6" maxBarSize={40} />
                  <Bar dataKey="failed" name="Failed" stackId="a" fill="#ef4444" maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
              <button onClick={() => setModalPage(prev => Math.max(prev - 1, 1))} disabled={modalPage === 1} className="export-btn">Prev</button>
              <span style={{ fontSize: '13px', color: '#64748b' }}>Page {modalPage} of {totalModalPages}</span>
              <button onClick={() => setModalPage(prev => Math.min(prev + 1, totalModalPages))} disabled={modalPage === totalModalPages} className="export-btn">Next</button>
            </div>
          </div>
        </div>
      )}

      {selectedHealingTrack && (
        <div className="modal-overlay" onClick={() => setSelectedHealingTrack(null)}>
          <div className="modal-content fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '750px', width: '90%' }}>
            <button className="modal-close" onClick={() => setSelectedHealingTrack(null)}><X size={20} /></button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #cbd5e1', paddingBottom: '8px' }}>
              <h2 style={{ fontSize: '19px', color: '#0f172a', margin: 0 }}>
                🔧 Auto-Repair Diagnostics Bracket: <span style={{ color: selectedHealingTrack.color }}>{selectedHealingTrack.rounds}</span>
              </h2>
              <span style={{ fontSize: '13px', fontWeight: 'bold', background: '#f1f5f9', color: '#475569', padding: '4px 12px', borderRadius: '20px' }}>
                {selectedHealingTrack.tasks?.length || 0} Tickets Mapped
              </span>
            </div>
            
            <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '6px' }}>
              {selectedHealingTrack.tasks?.length > 0 ? selectedHealingTrack.tasks.map((task, idx) => (
                <div key={idx} style={{ padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="jira-badge">{task.id}</span>
                      <strong style={{ fontSize: '14px', color: '#1e293b' }}>{task.title}</strong>
                    </div>
                    <span className="status-badge" style={{ fontSize: '11px', fontWeight: 'bold', background: task.status === 'COMPLETED' ? '#dcfce7' : '#fee2e2', color: task.status === 'COMPLETED' ? '#16a34a' : '#dc2626', padding: '3px 8px', borderRadius: '12px' }}>
                      {task.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '15px', fontSize: '12px', color: '#64748b' }}>
                    <span>📁 Project: <strong style={{ color: '#475569' }}>{task.project}</strong></span>
                    <span>🔄 Self-Healing Tries: <strong style={{ color: selectedHealingTrack.color }}>{task.attempts}</strong></span>
                  </div>
                  <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', color: '#475569', overflowX: 'auto' }}>
                    <strong>Execution Failure Log Context:</strong> {task.reason}
                  </div>
                </div>
              )) : (
                <p style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '20px' }}>No operational records inside this bracket path selection block.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {drillDownEpic && (
        <div className="modal-overlay" onClick={() => setDrillDownEpic(null)}>
          <div className="modal-content fade-in" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDrillDownEpic(null)}><X size={20} /></button>
            <h2 style={{ fontSize: '18px', marginBottom: '20px', fontWeight: '700' }}>Lifecycle Timeline Diagnostics: {drillDownEpic.epic_id || drillDownEpic.id}</h2>
            <div style={{ paddingLeft: '25px', borderLeft: '2px solid #e2e8f0', marginLeft: '10px' }}>
              {drillDownEpic.steps?.length > 0 ? drillDownEpic.steps.map((step, idx) => (
                <div key={`step-${idx}`} style={{ position: 'relative', marginBottom: '25px' }}>
                  <div style={{ position: 'absolute', left: '-31px', top: '2px', width: '10px', height: '10px', borderRadius: '50%', background: step.status === 'Completed' ? '#10b981' : step.status === 'Failed' ? '#ef4444' : '#3b82f6', border: '2px solid #fff' }}></div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>{step.step}</h4>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{step.timestamp !== "Unknown" ? new Date(step.timestamp).toLocaleString() : step.timestamp}</span>
                </div>
              )) : (
                <p style={{ fontSize: '13px', color: '#64748b' }}>No underlying operational tracking history was recorded for this task execution node loop.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;