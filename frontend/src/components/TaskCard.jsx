import { MdFlag, MdCalendarToday, MdPerson, MdPlayArrow } from 'react-icons/md';
import './TaskCard.css';

const TaskCard = ({ task, onResume }) => {
  const priorityColors = {
    'critical': '#ef4444',
    'high': '#f97316',
    'medium': '#eab308',
    'low': '#6b7280'
  };

  const statusLabels = {
    'backlog': 'Backlog',
    'in-progress': 'In Progress',
    'review': 'Review',
    'completed': 'Completed'
  };

  return (
    <div className="task-card">
      <div className="task-card-header">
        <div className="task-dot" style={{ backgroundColor: task.statusDot }}></div>
        <h4 className="task-title">{task.title}</h4>
      </div>

      <p className="task-description">{task.description}</p>

      <div className="task-meta">
        <div className="task-meta-item">
          <MdFlag style={{ color: priorityColors[task.priority] }} />
          <span>{task.priority}</span>
        </div>
        <div className="task-meta-item">
          <MdCalendarToday />
          <span>{task.dueDate}</span>
        </div>
      </div>

      <div className="task-footer">
        <div className="task-assignee">
          <MdPerson />
          <span>{task.assignee}</span>
        </div>
      </div>

      <div className="task-project-tag">{task.project}</div>

      {task.status !== 'completed' && (
        <button className="resume-task-btn" onClick={() => onResume(task)}>
          <MdPlayArrow />
          Resume Task
        </button>
      )}
    </div>
  );
};

export default TaskCard;
