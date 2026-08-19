import './ProgressBar.css';

const ProgressBar = ({ progress, height = '8px', color = '#3b82f6', bgColor = '#e5e7eb' }) => {
  return (
    <div className="progress-bar-container" style={{ height, backgroundColor: bgColor }}>
      <div
        className="progress-bar-fill"
        style={{
          width: `${progress}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
};

export default ProgressBar;
