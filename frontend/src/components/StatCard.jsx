import './StatCard.css';

const StatCard = ({ icon, title, value, subtitle, iconBg, iconColor }) => {
  return (
    <div className="stat-card">
      <div className="stat-content">
        <h3 className="stat-title">{title}</h3>
        <div className="stat-value">{value}</div>
        {subtitle && <div className="stat-subtitle">{subtitle}</div>}
      </div>
      <div className="stat-icon" style={{ backgroundColor: iconBg, color: iconColor }}>
        {icon}
      </div>
    </div>
  );
};

export default StatCard;
