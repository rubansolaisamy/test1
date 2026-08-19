import './StaticPage.css';

const Team = () => {
  return (
    <div className="static-page">
      <h1>Team</h1>
      <p className="static-page-subtitle">Manage your team members and collaborators</p>
      <div className="static-content">
        <div className="placeholder-card">
          <div className="placeholder-icon">👥</div>
          <h2>Team Management</h2>
          <p>Team member management features will be available here.</p>
          <p>This includes adding members, assigning roles, and managing permissions.</p>
        </div>
      </div>
    </div>
  );
};

export default Team;
