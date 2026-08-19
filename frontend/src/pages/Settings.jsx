import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MdSettings, 
  MdCheckCircle, 
  MdError, 
  MdArrowBack,
  MdRefresh,
  MdVerifiedUser,
  MdCode
} from 'react-icons/md';
import { 
  getUserConfig, 
  saveUserConfig, 
  updateUserConfig, 
  testJiraConnection, 
  testGitHubConnection 
} from '../services/api';

const Settings = () => {
  const navigate = useNavigate();
  const username = localStorage.getItem('username');

  const [activeTab, setActiveTab] = useState('jira');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configExists, setConfigExists] = useState(false);
  const [testingJira, setTestingJira] = useState(false);
  const [testingGitHub, setTestingGitHub] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState(null);
  const [githubTestResult, setGitHubTestResult] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);

  const [formData, setFormData] = useState({
    jira_base_url: '',
    jira_email: '',
    jira_api_token: '',
    github_token: '',
    github_username: '',
    github_default_branch: 'main',
  });

  const colors = {
    primary: '#3b82f6',
    primaryDark: '#2563eb',
    primaryLight: '#eff6ff',
    primaryBorder: '#bfdbfe',
    success: '#10b981',
    successLight: '#d1fae5',
    error: '#ef4444',
    errorLight: '#fee2e2',
    textMain: '#111827',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    bgLight: '#f9fafb',
    jiraBlue: '#0052CC',
    jiraBlueLight: '#E6F0FF',
    githubDark: '#24292e',
    githubLight: '#F6F8FA',
  };

  useEffect(() => {
    if (!username) {
      navigate('/login');
      return;
    }
    loadConfiguration();
  }, [username, navigate]);

  const loadConfiguration = async () => {
    try {
      setIsLoading(true);
      const config = await getUserConfig(username);
      if (config) {
        setConfigExists(true);
        setFormData({
          jira_base_url: config.jira_base_url || '',
          jira_email: config.jira_email || '',
          jira_api_token: '',
          github_token: '',
          github_username: config.github_username || '',
          github_default_branch: config.github_default_branch || 'main',
        });
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setSaveMessage(null);
  };

  const handleTestJira = async () => {
    if (!formData.jira_base_url || !formData.jira_email || !formData.jira_api_token) {
      setJiraTestResult({ success: false, message: 'Please fill in all Jira fields first' });
      return;
    }

    setTestingJira(true);
    setJiraTestResult(null);
    try {
      const result = await testJiraConnection(username, {
        jira_base_url: formData.jira_base_url,
        jira_email: formData.jira_email,
        jira_api_token: formData.jira_api_token,
      });
      setJiraTestResult(result);
    } catch (error) {
      setJiraTestResult({ success: false, message: error.message });
    } finally {
      setTestingJira(false);
    }
  };

  const handleTestGitHub = async () => {
    if (!formData.github_token) {
      setGitHubTestResult({ success: false, message: 'Please provide a GitHub token first' });
      return;
    }

    setTestingGitHub(true);
    setGitHubTestResult(null);
    try {
      const result = await testGitHubConnection(username, {
        github_token: formData.github_token,
      });
      setGitHubTestResult(result);
    } catch (error) {
      setGitHubTestResult({ success: false, message: error.message });
    } finally {
      setTestingGitHub(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const configData = {
        jira_base_url: formData.jira_base_url,
        jira_email: formData.jira_email,
        jira_api_token: formData.jira_api_token || undefined,
        github_token: formData.github_token || undefined,
        github_username: formData.github_username || null,
        github_default_branch: formData.github_default_branch || 'main',
      };

      if (configExists) {
        await updateUserConfig(username, configData);
      } else {
        await saveUserConfig(username, configData);
        setConfigExists(true);
      }

      setSaveMessage({ success: true, text: 'Configuration saved successfully!' });
    } catch (error) {
      setSaveMessage({ success: false, text: error.message || 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    border: `1px solid ${colors.border}`,
    fontSize: '0.95rem',
    backgroundColor: 'white',
    color: colors.textMain,
    transition: 'all 0.2s',
  };

  const labelStyle = {
    fontWeight: '600',
    color: '#4b5563',
    fontSize: '0.875rem',
    marginBottom: '0.5rem',
    display: 'block',
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}>
        <div style={{ textAlign: 'center' }}>
          <MdRefresh size={48} color={colors.primary} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: '1rem', color: colors.textMuted }}>Loading configuration...</p>
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
        padding: '2rem 2.5rem',
        borderRadius: '16px',
        marginBottom: '2rem',
        boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.3)',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '600',
            marginBottom: '1rem',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'}
        >
          <MdArrowBack size={18} /> Back to Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <MdSettings size={40} color="white" />
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: '700', color: 'white', margin: 0 }}>
              Settings
            </h1>
            <p style={{ fontSize: '1rem', color: 'rgba(255, 255, 255, 0.9)', margin: '0.5rem 0 0 0' }}>
              Configure your Jira and GitHub integrations
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '2rem',
      }}>
        <button
          onClick={() => setActiveTab('jira')}
          style={{
            flex: 1,
            padding: '1rem 1.5rem',
            backgroundColor: activeTab === 'jira' ? colors.jiraBlueLight : 'white',
            color: activeTab === 'jira' ? colors.jiraBlue : colors.textMuted,
            border: `2px solid ${activeTab === 'jira' ? colors.jiraBlue : colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '1rem',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
          }}
        >
          <MdVerifiedUser size={24} /> Jira Configuration
        </button>
        <button
          onClick={() => setActiveTab('github')}
          style={{
            flex: 1,
            padding: '1rem 1.5rem',
            backgroundColor: activeTab === 'github' ? colors.githubLight : 'white',
            color: activeTab === 'github' ? colors.githubDark : colors.textMuted,
            border: `2px solid ${activeTab === 'github' ? colors.githubDark : colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '1rem',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
          }}
        >
          <MdCode size={24} /> GitHub Configuration
        </button>
      </div>

      {/* Content */}
      <div style={{
        backgroundColor: 'white',
        padding: '2.5rem',
        borderRadius: '16px',
        border: `1px solid ${colors.border}`,
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
      }}>
        {activeTab === 'jira' ? (
          <>
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: colors.textMain,
                marginBottom: '0.5rem',
              }}>
                Jira Integration
              </h3>
              <p style={{ fontSize: '0.9rem', color: colors.textMuted, margin: 0 }}>
                Connect to your Jira instance to sync projects and tasks
              </p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Jira Base URL <span style={{ color: colors.error }}>*</span></label>
              <input
                type="text"
                name="jira_base_url"
                value={formData.jira_base_url}
                onChange={handleChange}
                placeholder="https://your-domain.atlassian.net"
                style={inputStyle}
              />
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                Your Atlassian cloud URL
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Email Address <span style={{ color: colors.error }}>*</span></label>
              <input
                type="email"
                name="jira_email"
                value={formData.jira_email}
                onChange={handleChange}
                placeholder="your.email@company.com"
                style={inputStyle}
              />
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                Email address associated with your Jira account
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>API Token <span style={{ color: colors.error }}>*</span></label>
              <input
                type="password"
                name="jira_api_token"
                value={formData.jira_api_token}
                onChange={handleChange}
                placeholder={configExists ? "Enter new token to update" : "Enter your Jira API token"}
                style={inputStyle}
              />
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                Generate from{' '}
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: colors.primary, fontWeight: '600' }}
                >
                  Atlassian Account Settings
                </a>
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              paddingTop: '1.5rem',
              borderTop: `1px solid ${colors.border}`,
            }}>
              <button
                onClick={handleTestJira}
                disabled={testingJira}
                style={{
                  flex: 1,
                  padding: '0.75rem 1.5rem',
                  backgroundColor: testingJira ? colors.bgLight : colors.jiraBlue,
                  color: testingJira ? colors.textMuted : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: testingJira ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s',
                }}
              >
                {testingJira ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {jiraTestResult && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem 1.25rem',
                borderRadius: '8px',
                backgroundColor: jiraTestResult.success ? colors.successLight : colors.errorLight,
                border: `1px solid ${jiraTestResult.success ? colors.success : colors.error}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}>
                {jiraTestResult.success ? (
                  <MdCheckCircle size={24} color={colors.success} />
                ) : (
                  <MdError size={24} color={colors.error} />
                )}
                <span style={{
                  color: jiraTestResult.success ? colors.success : colors.error,
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>
                  {jiraTestResult.message}
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: colors.textMain,
                marginBottom: '0.5rem',
              }}>
                GitHub Integration
              </h3>
              <p style={{ fontSize: '0.9rem', color: colors.textMuted, margin: 0 }}>
                Connect to GitHub to manage repositories and code
              </p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>GitHub Token <span style={{ color: colors.error }}>*</span></label>
              <input
                type="password"
                name="github_token"
                value={formData.github_token}
                onChange={handleChange}
                placeholder={configExists ? "Enter new token to update" : "ghp_..."}
                style={inputStyle}
              />
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                Generate from{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: colors.primary, fontWeight: '600' }}
                >
                  GitHub Settings
                </a>
                <br />
                Required scopes: <code style={{ backgroundColor: colors.bgLight, padding: '0.1rem 0.3rem', borderRadius: '3px' }}>repo</code>, <code style={{ backgroundColor: colors.bgLight, padding: '0.1rem 0.3rem', borderRadius: '3px' }}>admin:org</code>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>GitHub Username (Optional)</label>
              <input
                type="text"
                name="github_username"
                value={formData.github_username}
                onChange={handleChange}
                placeholder="Your GitHub username"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Default Branch</label>
              <input
                type="text"
                name="github_default_branch"
                value={formData.github_default_branch}
                onChange={handleChange}
                placeholder="main"
                style={inputStyle}
              />
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                Default branch name for new repositories
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              paddingTop: '1.5rem',
              borderTop: `1px solid ${colors.border}`,
            }}>
              <button
                onClick={handleTestGitHub}
                disabled={testingGitHub}
                style={{
                  flex: 1,
                  padding: '0.75rem 1.5rem',
                  backgroundColor: testingGitHub ? colors.bgLight : colors.githubDark,
                  color: testingGitHub ? colors.textMuted : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: testingGitHub ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s',
                }}
              >
                {testingGitHub ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {githubTestResult && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem 1.25rem',
                borderRadius: '8px',
                backgroundColor: githubTestResult.success ? colors.successLight : colors.errorLight,
                border: `1px solid ${githubTestResult.success ? colors.success : colors.error}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}>
                {githubTestResult.success ? (
                  <MdCheckCircle size={24} color={colors.success} />
                ) : (
                  <MdError size={24} color={colors.error} />
                )}
                <span style={{
                  color: githubTestResult.success ? colors.success : colors.error,
                  fontWeight: '600',
                  fontSize: '0.95rem',
                }}>
                  {githubTestResult.message}
                </span>
              </div>
            )}
          </>
        )}

        {/* Save Message */}
        {saveMessage && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem 1.25rem',
            borderRadius: '8px',
            backgroundColor: saveMessage.success ? colors.successLight : colors.errorLight,
            border: `1px solid ${saveMessage.success ? colors.success : colors.error}`,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            {saveMessage.success ? (
              <MdCheckCircle size={24} color={colors.success} />
            ) : (
              <MdError size={24} color={colors.error} />
            )}
            <span style={{
              color: saveMessage.success ? colors.success : colors.error,
              fontWeight: '600',
              fontSize: '0.95rem',
            }}>
              {saveMessage.text}
            </span>
          </div>
        )}

        {/* Save Button */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: '2rem',
          paddingTop: '1.5rem',
          borderTop: `1px solid ${colors.border}`,
        }}>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: isSaving ? colors.textMuted : colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => !isSaving && (e.currentTarget.style.backgroundColor = colors.primaryDark)}
            onMouseOut={(e) => !isSaving && (e.currentTarget.style.backgroundColor = colors.primary)}
          >
            {isSaving ? 'Saving...' : 'Save Configuration'} <MdCheckCircle size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
