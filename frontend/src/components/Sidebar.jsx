import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MdDashboard, MdWork, MdTimeline, MdLogout, MdSettings, MdBarChart } from 'react-icons/md';
import './Sidebar.css';

const Sidebar = () => {
  const location  = useLocation();
  const navigate  = useNavigate();
  const currentUsername = localStorage.getItem('username') || 'Guest';

  const getInitials = (name) => {
    const parts = name.trim().split(' ');
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  };

  const handleLogout = () => {
    localStorage.removeItem('username');
    navigate('/login');
  };

  const menuItems = [
    { path: '/',         icon: <MdDashboard />, label: 'Dashboard' },
    { path: '/projects', icon: <MdWork />,      label: 'Projects'  },
    { path: '/reports',  icon: <MdBarChart />,  label: 'Reports'   },
  ];

  // Detect if we're inside a specific project (not on /new or /edit)
  const projectMatch = location.pathname.match(/\/projects\/(?!new|edit)([^/]+)/);
  const activeProjectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon"><MdTimeline /></div>
          <span className="logo-text">SDLC Manager</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.label}
              to={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          );
        })}

        {/* Project context section — shown only when inside a project */}
        {activeProjectId && (
          <>
            <div style={{
              fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase',
              letterSpacing: '0.08em', color: '#9ca3af', padding: '1.25rem 1rem 0.4rem',
            }}>
              Current Project
            </div>
            {[
              { sub: '',        label: 'Overview' },
              { sub: '',        label: 'Board',   hash: '#board'  },
              { sub: '',        label: 'Review',  hash: '#review' },
            ].map(({ label, hash = '' }) => {
              const to = `/projects/${activeProjectId}${hash}`;
              const isActive = location.pathname === `/projects/${activeProjectId}`;
              return (
                <Link
                  key={label}
                  to={to}
                  className={`nav-item nav-item-sub ${isActive && !hash ? 'active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}
                >
                  <span className="nav-icon" style={{ opacity: 0 }}>·</span>
                  <span className="nav-label">{label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          
          {/* Left section: Avatar and User Details */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="user-avatar">{getInitials(currentUsername)}</div>
            <div className="user-info">
              <div className="user-name">{currentUsername}</div>
              <div className="user-role">Developer</div>
            </div>
          </div>

          {/* Right section: Action Button Divs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            
            <Link
              to="/settings"
              title="Settings"
              style={{ 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '8px',
                background: 'transparent', border: 'none', textDecoration: 'none',
                color: location.pathname.startsWith('/settings') ? '#1f2937' : '#9ca3af',
                backgroundColor: location.pathname.startsWith('/settings') ? '#e5e7eb' : 'transparent',
                transition: 'all 0.2s ease-in-out'
              }}
              onMouseOver={e => { 
                e.currentTarget.style.color = '#1f2937'; 
                e.currentTarget.style.backgroundColor = '#e5e7eb'; 
              }}
              onMouseOut={e => { 
                e.currentTarget.style.color = location.pathname.startsWith('/settings') ? '#1f2937' : '#9ca3af'; 
                e.currentTarget.style.backgroundColor = location.pathname.startsWith('/settings') ? '#e5e7eb' : 'transparent'; 
              }}
            >
              <MdSettings size={18} />
            </Link>

            <button
              onClick={handleLogout}
              title="Logout"
              style={{ 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '8px',
                background: 'transparent', border: 'none', color: '#9ca3af', 
                cursor: 'pointer', transition: 'all 0.2s ease-in-out' 
              }}
              onMouseOver={e => { 
                e.currentTarget.style.color = '#ef4444'; 
                e.currentTarget.style.backgroundColor = '#fee2e2'; 
              }}
              onMouseOut={e => { 
                e.currentTarget.style.color = '#9ca3af'; 
                e.currentTarget.style.backgroundColor = 'transparent'; 
              }}
            >
              <MdLogout size={18} />
            </button>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;