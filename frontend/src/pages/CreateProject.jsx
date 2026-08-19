import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MdRocket, 
  MdArrowBack, 
  MdRefresh, 
  MdOpenInNew, 
  MdAutoAwesome, 
  MdSearch,
  MdSettings,
  MdSpaceDashboard,
  MdFactCheck,
  MdCode
} from 'react-icons/md';
import { 
  createProject, 
  startPipeline, 
  getUserConfig,
  getJiraProjects,
  getGitHubRepos,
  getGitHubOrganizations,
  createGitHubRepo
} from '../services/api';

const CreateProject = () => {
  const navigate = useNavigate();
  const username = localStorage.getItem('username');
  
  // Data Loading State
  const [userConfig, setUserConfig] = useState(null);
  const [jiraProjects, setJiraProjects] = useState([]);
  const [githubRepos, setGitHubRepos] = useState([]);
  const [githubOrgs, setGitHubOrgs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // GitHub Repository Mode
  const [repoMode, setRepoMode] = useState('existing');
  const [newRepoData, setNewRepoData] = useState({
    name: '',
    description: '',
    private: true,
    org_name: '', // Defaults to first org
  });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyAI, setShowOnlyAI] = useState(false);

  // Form State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const [formData, setFormData] = useState({
    project_id: '',
    title: '',
    description: '',
    due_date: '',
    jira_board_id: '',
    jira_project_key: '',
    github_repo: '',
    github_branch: 'main',
  });

  // Premium Design Tokens
  const colors = {
    primary: '#3b82f6',
    primaryDark: '#2563eb',
    primaryLight: '#eff6ff',
    primaryBorder: '#bfdbfe',
    success: '#10b981',
    error: '#ef4444',
    errorLight: '#fee2e2',
    textMain: '#111827',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    bgPage: '#f3f4f6',
    bgLight: '#f9fafb',
    aiPurple: '#8b5cf6',
    aiPurpleLight: '#f5f3ff',
  };

  // Load user data on mount
  useEffect(() => {
    if (!username) {
      navigate('/login');
      return;
    }
    loadUserData();
  }, [username, navigate]);

  const loadUserData = async () => {
    setLoadingData(true);
    setConfigError(null);
    try {
      const config = await getUserConfig(username);
      if (!config) {
        setConfigError('Please configure your Jira and GitHub settings first');
        setLoadingData(false);
        return;
      }
      setUserConfig(config);
      setFormData(prev => ({ ...prev, github_branch: config.github_default_branch || 'main' }));

      const [jiraData, reposData, orgsData] = await Promise.all([
        getJiraProjects(username),
        getGitHubRepos(username),
        getGitHubOrganizations(username)
      ]);

      setJiraProjects(jiraData.projects || []);
      setGitHubRepos(reposData.repositories || []);
      
      const orgs = orgsData.organizations || [];
      setGitHubOrgs(orgs);
      if (orgs.length > 0) {
        setNewRepoData(prev => ({ ...prev, org_name: orgs[0].login }));
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
      setConfigError('Failed to load configuration. Please check your settings.');
    } finally {
      setLoadingData(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const jiraData = await getJiraProjects(username);
      setJiraProjects(jiraData.projects || []);
    } catch (error) {
      console.error('Failed to refresh projects:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (validationErrors[name]) setValidationErrors(prev => ({ ...prev, [name]: null }));
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.project_id.trim()) errors.project_id = "Project ID is required.";
    if (/\s/.test(formData.project_id)) errors.project_id = "Project ID cannot contain spaces.";
    if (!formData.title.trim()) errors.title = "Project Title is required.";
    if (!formData.jira_project_key.trim()) errors.jira_project_key = "Jira Project is required.";
    
    if (repoMode === 'new' && !newRepoData.org_name) {
      errors.org_name = "Organization is required for enterprise repositories.";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
  e.preventDefault();
  setError(null);
  if (!validateForm()) return;

  const currentUsername = localStorage.getItem('username');
  if (!currentUsername) return navigate('/login');

  try {
    setIsLoading(true);

      if (repoMode === 'new') {
        if (!newRepoData.name) {
          setError('Please provide a repository name');
          setIsLoading(false);
          return;
        }
        const createdRepo = await createGitHubRepo(currentUsername, newRepoData);
        formData.github_repo = createdRepo.full_name;
      }
      
      await createProject({ ...formData, username: currentUsername });
      navigate(`/projects/${formData.project_id}/select-tickets`);
    } catch (err) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAnalyzer = () => {
    window.open('http://localhost:5174', '_blank');
  };

  const filteredProjects = jiraProjects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          project.key.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAIFilter = !showOnlyAI || project.is_ai_generated;
    return matchesSearch && matchesAIFilter;
  });

  const aiGeneratedProjects = filteredProjects.filter(p => p.is_ai_generated);
  const standardProjects = filteredProjects.filter(p => !p.is_ai_generated);

  const inputBaseStyle = {
    width: '100%',
    padding: '0.85rem 1rem',
    borderRadius: '10px',
    border: `1px solid ${colors.border}`,
    fontSize: '0.95rem',
    backgroundColor: 'white',
    color: colors.textMain,
    transition: 'all 0.2s ease-in-out',
  };

  const labelStyle = {
    fontWeight: '600',
    color: colors.textMain,
    fontSize: '0.875rem',
    marginBottom: '0.5rem',
    display: 'block',
  };

  return (
    <div style={{ backgroundColor: colors.bgPage, minHeight: '100vh', padding: '2rem 0' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 1.5rem' }}>
        
        {/* Header Section */}
        <div style={{
          background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
          padding: '2rem 2.5rem',
          borderRadius: '20px',
          marginBottom: '2rem',
          boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.4)',
        }}>
          <button
            onClick={() => navigate('/projects')}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 1rem', backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: 'white', border: 'none', borderRadius: '8px',
              cursor: 'pointer', fontSize: '0.9rem', fontWeight: '600',
              marginBottom: '1.25rem', transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'}
          >
            <MdArrowBack size={18} /> Back to Projects
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '12px' }}>
              <MdRocket size={32} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: '700', color: 'white', margin: 0, letterSpacing: '-0.02em' }}>
                Create New Project
              </h1>
              <p style={{ fontSize: '1.05rem', color: 'rgba(255, 255, 255, 0.9)', margin: '0.25rem 0 0 0' }}>
                Configure your workspace, link repositories, and launch the pipeline.
              </p>
            </div>
          </div>
        </div>

        {/* Settings Warning */}
        {configError && (
          <div style={{ padding: '1.25rem 1.5rem', marginBottom: '2rem', borderRadius: '12px', backgroundColor: colors.errorLight, border: `1px solid ${colors.error}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: colors.error, fontSize: '0.95rem', fontWeight: '600' }}>{configError}</span>
            <button onClick={() => navigate('/settings')} style={{ padding: '0.6rem 1.2rem', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MdSettings size={18} /> Settings
            </button>
          </div>
        )}

        {/* Main Floating Form */}
        <form onSubmit={handleSubmit} style={{
          backgroundColor: 'white',
          padding: '3rem',
          borderRadius: '24px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.01)',
          border: '1px solid rgba(229, 231, 235, 0.5)'
        }}>
          
          {/* Section 1: Project Details */}
          <div style={{ marginBottom: '3.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '0.5rem', backgroundColor: colors.primaryLight, borderRadius: '8px', border: `1px solid ${colors.primaryBorder}`, display: 'flex' }}>
                <MdSpaceDashboard size={20} color={colors.primaryDark} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, color: colors.textMain }}>Project Details</h3>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div>
                <label style={labelStyle}>Project ID <span style={{ color: colors.error }}>*</span></label>
                <input name="project_id" value={formData.project_id} onChange={handleChange} className="premium-input" style={inputBaseStyle} placeholder="e.g., CORE-1" disabled={isLoading} />
                {validationErrors.project_id && <div style={{ color: colors.error, fontSize: '0.8rem', marginTop: '0.4rem' }}>{validationErrors.project_id}</div>}
              </div>
              <div>
                <label style={labelStyle}>Project Title <span style={{ color: colors.error }}>*</span></label>
                <input name="title" value={formData.title} onChange={handleChange} className="premium-input" style={inputBaseStyle} placeholder="e.g., Core Banking API" disabled={isLoading} />
                {validationErrors.title && <div style={{ color: colors.error, fontSize: '0.8rem', marginTop: '0.4rem' }}>{validationErrors.title}</div>}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Description</label>
              <textarea name="description" value={formData.description} onChange={handleChange} className="premium-input" style={{ ...inputBaseStyle, minHeight: '100px', resize: 'vertical' }} placeholder="Briefly describe the goals of this project..." disabled={isLoading} />
            </div>

            <div>
              <label style={labelStyle}>Target Due Date</label>
              <input type="date" name="due_date" value={formData.due_date} onChange={handleChange} className="premium-input" style={{...inputBaseStyle, width: '50%'}} disabled={isLoading} />
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '3rem 0' }} />

          {/* Section 2: Jira Workspace */}
          <div style={{ marginBottom: '3.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '0.5rem', backgroundColor: '#e3fcef', borderRadius: '8px', border: '1px solid #b3f2ce', display: 'flex' }}>
                <MdFactCheck size={20} color="#059669" />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, color: colors.textMain }}>Jira Workspace</h3>
            </div>

            {/* Smart Search & Filter */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', alignItems: 'stretch' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <MdSearch size={22} color={colors.textMuted} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" placeholder="Search by name or key..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="premium-input" style={{ ...inputBaseStyle, paddingLeft: '3.25rem' }} disabled={loadingData} />
              </div>
              
              <button type="button" onClick={handleRefresh} disabled={refreshing || loadingData} style={{ padding: '0 1.25rem', backgroundColor: refreshing ? colors.bgLight : 'white', color: refreshing ? colors.textMuted : colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '10px', cursor: refreshing ? 'not-allowed' : 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s' }}>
                <MdRefresh size={20} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                Refresh
              </button>
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0 1.25rem', backgroundColor: showOnlyAI ? colors.aiPurpleLight : 'white', border: `1px solid ${showOnlyAI ? colors.aiPurple : colors.border}`, borderRadius: '10px', transition: 'all 0.2s', userSelect: 'none' }}>
                <input type="checkbox" checked={showOnlyAI} onChange={(e) => setShowOnlyAI(e.target.checked)} style={{ display: 'none' }} />
                <MdAutoAwesome size={18} color={showOnlyAI ? colors.aiPurple : colors.textMuted} />
                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: showOnlyAI ? colors.aiPurple : colors.textMain }}>
                  Analyzer Projects
                </span>
              </label>
            </div>

            {/* Fancy Dropdown */}
            <div style={{ marginBottom: '1.5rem' }}>
              <select
                name="jira_project_key" value={formData.jira_project_key}
                onChange={(e) => {
                  const selected = jiraProjects.find(p => p.key === e.target.value);
                  setFormData(prev => ({ ...prev, jira_project_key: e.target.value, title: selected && !prev.title ? selected.name : prev.title }));
                  if (validationErrors.jira_project_key) setValidationErrors(prev => ({ ...prev, jira_project_key: null }));
                }}
                className="premium-input"
                style={{
                  ...inputBaseStyle, cursor: 'pointer', appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
                  backgroundPosition: 'right 1rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '3rem',
                }}
                disabled={isLoading || loadingData}
              >
                <option value="">-- Select a Jira project to link --</option>
                {aiGeneratedProjects.length > 0 && (
                  <optgroup label="✨ Intelligent Requirement Analyzer Projects">
                    {aiGeneratedProjects.map(project => (
                      <option key={project.id} value={project.key}>
                        {project.name} ({project.key}) {project.analyzer_project_name ? `- ${project.analyzer_project_name}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {standardProjects.length > 0 && (
                  <optgroup label="🏢 Standard Jira Projects">
                    {standardProjects.map(project => (
                      <option key={project.id} value={project.key}>{project.name} ({project.key})</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {validationErrors.jira_project_key && <div style={{ color: colors.error, fontSize: '0.8rem', marginTop: '0.4rem' }}>{validationErrors.jira_project_key}</div>}
            </div>

            {/* AI Banner Box */}
            <div style={{ padding: '1.5rem', backgroundColor: colors.aiPurpleLight, border: `1px dashed #ddd6fe`, borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ padding: '0.75rem', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 2px 4px rgba(139, 92, 246, 0.1)' }}>
                  <MdAutoAwesome size={24} color={colors.aiPurple} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', fontWeight: '700', color: '#5b21b6', fontSize: '1rem' }}>Need a new project?</h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#6d28d9' }}>Use the Intelligent Requirement Analyzer to auto-generate one.</p>
                </div>
              </div>
              <button
                type="button" onClick={handleOpenAnalyzer}
                style={{ padding: '0.75rem 1.5rem', backgroundColor: colors.aiPurple, color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(139, 92, 246, 0.3)' }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#7c3aed'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = colors.aiPurple; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <MdAutoAwesome size={16} /> Open Analyzer <MdOpenInNew size={16} style={{ marginLeft: '0.25rem' }} />
              </button>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '3rem 0' }} />

          {/* Section 3: Source Control */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '0.5rem', backgroundColor: '#f3f4f6', borderRadius: '8px', border: `1px solid ${colors.border}`, display: 'flex' }}>
                <MdCode size={20} color="#4b5563" />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, color: colors.textMain }}>Source Control</h3>
            </div>

            {/* Apple-Style Segmented Control */}
            <div style={{ marginBottom: '2rem' }}>
              <label style={labelStyle}>Repository Strategy</label>
              <div style={{ display: 'flex', background: colors.bgPage, padding: '0.35rem', borderRadius: '12px', gap: '0.25rem', border: `1px solid ${colors.border}` }}>
                <div
                  onClick={() => setRepoMode('existing')}
                  style={{ flex: 1, textAlign: 'center', padding: '0.75rem', cursor: 'pointer', borderRadius: '8px', backgroundColor: repoMode === 'existing' ? 'white' : 'transparent', boxShadow: repoMode === 'existing' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', fontWeight: repoMode === 'existing' ? '600' : '500', color: repoMode === 'existing' ? colors.textMain : colors.textMuted, transition: 'all 0.2s' }}
                >
                  Use Existing Repository
                </div>
                <div
                  onClick={() => setRepoMode('new')}
                  style={{ flex: 1, textAlign: 'center', padding: '0.75rem', cursor: 'pointer', borderRadius: '8px', backgroundColor: repoMode === 'new' ? 'white' : 'transparent', boxShadow: repoMode === 'new' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', fontWeight: repoMode === 'new' ? '600' : '500', color: repoMode === 'new' ? colors.textMain : colors.textMuted, transition: 'all 0.2s' }}
                >
                  Create New Repository
                </div>
              </div>
            </div>

            {repoMode === 'existing' ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={labelStyle}>Select Repository</label>
                <select
                  name="github_repo" value={formData.github_repo} onChange={handleChange} className="premium-input"
                  style={{ ...inputBaseStyle, cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '3rem' }}
                  disabled={isLoading || loadingData}
                >
                  <option value="">-- Choose a codebase --</option>
                  {githubRepos.map(repo => (
                    <option key={repo.id} value={repo.full_name}>{repo.full_name} {repo.private ? '🔒' : ''}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ padding: '1.5rem', backgroundColor: colors.bgLight, borderRadius: '16px', border: `1px solid ${colors.border}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <div>
                    <label style={labelStyle}>Repository Name <span style={{ color: colors.error }}>*</span></label>
                    <input value={newRepoData.name} onChange={(e) => setNewRepoData(prev => ({...prev, name: e.target.value}))} placeholder="my-new-project" className="premium-input" style={inputBaseStyle} disabled={isLoading} />
                  </div>
                  <div>
                    <label style={labelStyle}>Organization <span style={{ color: colors.error }}>*</span></label>
                    <select
                      value={newRepoData.org_name} onChange={(e) => setNewRepoData(prev => ({...prev, org_name: e.target.value}))} className="premium-input"
                      style={{ ...inputBaseStyle, cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '3rem' }}
                      disabled={isLoading || loadingData || githubOrgs.length === 0}
                    >
                      {githubOrgs.length === 0 ? <option value="" disabled>No orgs found</option> : githubOrgs.map(org => (
                        <option key={org.login} value={org.login}>{org.login}</option>
                      ))}
                    </select>
                    {validationErrors.org_name && <div style={{ color: colors.error, fontSize: '0.8rem', marginTop: '0.4rem' }}>{validationErrors.org_name}</div>}
                  </div>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={labelStyle}>Description (Optional)</label>
                  <input value={newRepoData.description} onChange={(e) => setNewRepoData(prev => ({...prev, description: e.target.value}))} placeholder="Short description of the repository..." className="premium-input" style={inputBaseStyle} disabled={isLoading} />
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.75rem 1rem', backgroundColor: 'white', borderRadius: '10px', border: `1px solid ${colors.border}` }}>
                  <input type="checkbox" checked={newRepoData.private} onChange={(e) => setNewRepoData(prev => ({...prev, private: e.target.checked}))} disabled={isLoading} style={{ cursor: 'pointer' }} />
                  <span style={{ fontSize: '0.9rem', fontWeight: '600', color: colors.textMain }}>🔒 Private Repository (Recommended)</span>
                </label>
              </div>
            )}

            {/* Restored Default Branch Input */}
            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed #e5e7eb' }}>
              <label style={labelStyle}>Default Branch <span style={{ color: colors.error }}>*</span></label>
              <input
                name="github_branch"
                value={formData.github_branch}
                onChange={handleChange}
                className="premium-input"
                style={{ ...inputBaseStyle, width: '50%' }}
                placeholder="main"
                disabled={isLoading}
              />
              <p style={{ fontSize: '0.8rem', color: colors.textMuted, margin: '0.4rem 0 0 0' }}>
                The branch OpenHands will use as the base for new pull requests.
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div style={{ padding: '1rem 1.5rem', marginBottom: '2rem', borderRadius: '8px', backgroundColor: colors.errorLight, border: `1px solid ${colors.error}`, color: colors.error, fontSize: '0.95rem' }}>
              {error}
            </div>
          )}

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', paddingTop: '2.5rem', borderTop: `1px solid ${colors.border}`, marginTop: '3rem' }}>
            <button
              type="button" onClick={() => navigate('/projects')} disabled={isLoading}
              style={{ padding: '0.85rem 1.75rem', backgroundColor: 'white', color: colors.textMain, border: `1px solid ${colors.border}`, borderRadius: '12px', cursor: isLoading ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.95rem', transition: 'all 0.2s' }}
              onMouseOver={(e) => !isLoading && (e.currentTarget.style.backgroundColor = colors.bgLight)}
              onMouseOut={(e) => !isLoading && (e.currentTarget.style.backgroundColor = 'white')}
            >
              Cancel
            </button>
            <button
              type="submit" disabled={isLoading || loadingData || !!configError}
              style={{ padding: '0.85rem 2.5rem', backgroundColor: (isLoading || loadingData || configError) ? colors.textMuted : colors.primary, color: 'white', border: 'none', borderRadius: '12px', cursor: (isLoading || loadingData || configError) ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.4)' }}
              onMouseOver={(e) => !(isLoading || loadingData || configError) && (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseOut={(e) => !(isLoading || loadingData || configError) && (e.currentTarget.style.transform = 'translateY(0)')}
            >
              {isLoading ? 'Launching...' : 'Launch Project'} <MdRocket size={20} />
            </button>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .premium-input:focus {
          outline: none;
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15) !important;
        }
        select option { padding: 0.5rem; }
      `}</style>
    </div>
  );
};

export default CreateProject;