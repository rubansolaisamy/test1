import './StaticPage.css';

const Documentation = () => {
  return (
    <div className="static-page">
      <h1>Documentation</h1>
      <p className="static-page-subtitle">Access project documentation and resources</p>
      <div className="static-content">
        <div className="placeholder-card">
          <div className="placeholder-icon">📚</div>
          <h2>Project Documentation</h2>
          <p>Comprehensive project documentation will be available here.</p>
          <p>This includes technical specifications, API docs, and user guides.</p>
        </div>
      </div>
    </div>
  );
};

export default Documentation;
