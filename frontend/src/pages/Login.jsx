import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FirstTimeSetup from '../components/FirstTimeSetup';
import { checkUserConfigExists } from '../services/api';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [showFirstTimeSetup, setShowFirstTimeSetup] = useState(false);
  const [isCheckingConfig, setIsCheckingConfig] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    // Store username in localStorage
    localStorage.setItem('username', username.trim());
    
    // Check if user has configuration
    setIsCheckingConfig(true);
    try {
      const result = await checkUserConfigExists(username.trim());
      if (!result.exists) {
        // Show first-time setup wizard
        setShowFirstTimeSetup(true);
      } else {
        // Redirect to dashboard
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to check configuration:', error);
      // On error, proceed to first-time setup to allow user to create config
      setShowFirstTimeSetup(true);
    } finally {
      setIsCheckingConfig(false);
    }
  };

  const handleSetupComplete = () => {
    setShowFirstTimeSetup(false);
    navigate('/');
  };

  return (
    <>
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1>SDLC Orchestrator</h1>
            <p>Welcome back! Please enter your username to continue.</p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                placeholder="Enter your username"
                autoFocus
                disabled={isCheckingConfig}
              />
              {error && <span className="error-message">{error}</span>}
            </div>

            <button type="submit" className="login-button" disabled={isCheckingConfig}>
              {isCheckingConfig ? 'Please wait...' : 'Continue'}
            </button>

            <p className="login-info">
              Note: This is a development environment. No password required.
            </p>
          </form>
        </div>
      </div>

      {/* First-Time Setup Modal */}
      {showFirstTimeSetup && (
        <FirstTimeSetup username={username.trim()} onComplete={handleSetupComplete} />
      )}
    </>
  );
};

export default Login;
