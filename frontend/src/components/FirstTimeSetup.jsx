import { useState } from 'react';
import { MdClose, MdArrowForward, MdArrowBack, MdCheckCircle, MdSettings } from 'react-icons/md';
import { saveUserConfig, testJiraConnection, testGitHubConnection } from '../services/api';

const FirstTimeSetup = ({ username, onComplete }) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
    success: '#10b981',
    error: '#ef4444',
    textMain: '#111827',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    bgLight: '#f9fafb',
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setErrorMessage('');
  };

  const validateStep = async () => {
    setErrorMessage('');

    if (step === 1) {
      // Skip validation for welcome screen
      return true;
    }

    if (step === 2) {
      // Validate Jira fields
      if (!formData.jira_base_url || !formData.jira_email || !formData.jira_api_token) {
        setErrorMessage('Please fill in all Jira fields');
        return false;
      }
      
      // Test Jira connection
      setIsSubmitting(true);
      const result = await testJiraConnection(username, {
        jira_base_url: formData.jira_base_url,
        jira_email: formData.jira_email,
        jira_api_token: formData.jira_api_token,
      });
      setIsSubmitting(false);

      if (!result.success) {
        setErrorMessage(`Jira connection failed: ${result.message}`);
        return false;
      }
      return true;
    }

    if (step === 3) {
      // Validate GitHub fields
      if (!formData.github_token) {
        setErrorMessage('Please provide a GitHub token');
        return false;
      }

      // Test GitHub connection
      setIsSubmitting(true);
      const result = await testGitHubConnection(username, {
        github_token: formData.github_token,
      });
      setIsSubmitting(false);

      if (!result.success) {
        setErrorMessage(`GitHub connection failed: ${result.message}`);
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = async () => {
    const isValid = await validateStep();
    if (isValid && step < 4) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setErrorMessage('');
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const configData = {
        jira_base_url: formData.jira_base_url,
        jira_email: formData.jira_email,
        jira_api_token: formData.jira_api_token,
        github_token: formData.github_token,
        github_username: formData.github_username || null,
        github_default_branch: formData.github_default_branch || 'main',
      };

      await saveUserConfig(username, configData);
      onComplete();
    } catch (error) {
      setErrorMessage(error.message || 'Failed to save configuration');
    } finally {
      setIsSubmitting(false);
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
    boxSizing: 'border-box',
  };

  const labelStyle = {
    fontWeight: '600',
    color: '#4b5563',
    fontSize: '0.875rem',
    marginBottom: '0.5rem',
    display: 'block',
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <MdSettings size={28} color={colors.primary} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: colors.textMain, margin: 0 }}>
              First-Time Setup
            </h2>
          </div>
          <div style={{ fontSize: '0.9rem', color: colors.textMuted, fontWeight: '600' }}>
            Step {step} of 4
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ padding: '0 2rem', paddingTop: '1rem' }}>
          <div style={{
            height: '4px',
            backgroundColor: colors.bgLight,
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(step / 4) * 100}%`,
              backgroundColor: colors.primary,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '2rem' }}>
          {/* Step 1: Welcome */}
          {step === 1 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: colors.bgLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem',
              }}>
                <MdSettings size={40} color={colors.primary} />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '1rem', color: colors.textMain }}>
                Welcome to SDLC Orchestrator!
              </h3>
              <p style={{ fontSize: '1rem', color: colors.textMuted, lineHeight: '1.6', marginBottom: '1.5rem' }}>
                Before you can create projects, we need to configure your integrations with Jira and GitHub.
                This is a one-time setup that will save you time later.
              </p>
              <div style={{
                backgroundColor: colors.bgLight,
                padding: '1rem',
                borderRadius: '8px',
                textAlign: 'left',
              }}>
                <p style={{ fontSize: '0.9rem', color: colors.textMain, margin: 0 }}>
                  <strong>What you'll need:</strong>
                </p>
                <ul style={{ fontSize: '0.9rem', color: colors.textMuted, margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
                  <li>Jira instance URL and API token</li>
                  <li>GitHub personal access token</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 2: Jira Configuration */}
          {step === 2 && (
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem', color: colors.textMain }}>
                Configure Jira Integration
              </h3>

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
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={labelStyle}>API Token <span style={{ color: colors.error }}>*</span></label>
                <input
                  type="password"
                  name="jira_api_token"
                  value={formData.jira_api_token}
                  onChange={handleChange}
                  placeholder="Enter your Jira API token"
                  style={inputStyle}
                />
                <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                  Generate from{' '}
                  <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary }}>
                    Atlassian Account Settings
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: GitHub Configuration */}
          {step === 3 && (
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem', color: colors.textMain }}>
                Configure GitHub Integration
              </h3>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={labelStyle}>GitHub Token <span style={{ color: colors.error }}>*</span></label>
                <input
                  type="password"
                  name="github_token"
                  value={formData.github_token}
                  onChange={handleChange}
                  placeholder="ghp_..."
                  style={inputStyle}
                />
                <div style={{ fontSize: '0.8rem', color: colors.textMuted, marginTop: '0.5rem' }}>
                  Generate from{' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" style={{ color: colors.primary }}>
                    GitHub Settings
                  </a>
                  <br />
                  Required scopes: <code style={{ backgroundColor: colors.bgLight, padding: '0.1rem 0.3rem', borderRadius: '3px' }}>repo</code>, <code style={{ backgroundColor: colors.bgLight, padding: '0.1rem 0.3rem', borderRadius: '3px' }}>admin:org</code>
                </div>
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
              </div>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#d1fae5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem',
              }}>
                <MdCheckCircle size={40} color={colors.success} />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '1rem', color: colors.textMain }}>
                All Set!
              </h3>
              <p style={{ fontSize: '1rem', color: colors.textMuted, lineHeight: '1.6', marginBottom: '1.5rem' }}>
                Your configuration has been validated and is ready to be saved.
                You can update these settings anytime from the Settings page.
              </p>
              <div style={{
                backgroundColor: colors.bgLight,
                padding: '1rem',
                borderRadius: '8px',
                textAlign: 'left',
              }}>
                <p style={{ fontSize: '0.9rem', color: colors.textMain, margin: '0 0 0.5rem 0', fontWeight: '600' }}>
                  Configuration Summary:
                </p>
                <ul style={{ fontSize: '0.9rem', color: colors.textMuted, margin: 0, paddingLeft: '1.25rem' }}>
                  <li>Jira: {formData.jira_base_url}</li>
                  <li>GitHub: Connected as {formData.github_username || 'User'}</li>
                </ul>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#fee2e2',
              border: `1px solid ${colors.error}`,
              color: colors.error,
              fontSize: '0.9rem',
            }}>
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1.5rem 2rem',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button
            onClick={handleBack}
            disabled={step === 1 || isSubmitting}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: 'white',
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              cursor: (step === 1 || isSubmitting) ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: (step === 1 || isSubmitting) ? 0.5 : 1,
            }}
          >
            <MdArrowBack size={18} /> Back
          </button>

          {step < 4 ? (
            <button
              onClick={handleNext}
              disabled={isSubmitting}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: isSubmitting ? '#93c5fd' : colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {isSubmitting ? 'Validating...' : 'Next'} <MdArrowForward size={18} />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={isSubmitting}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: isSubmitting ? '#93c5fd' : colors.success,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {isSubmitting ? 'Saving...' : 'Complete Setup'} <MdCheckCircle size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FirstTimeSetup;
