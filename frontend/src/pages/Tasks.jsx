import { useState } from 'react';
import { MdAdd, MdSearch } from 'react-icons/md';
import TaskCard from '../components/TaskCard';
import { tasks } from '../data/mockData';
import './Tasks.css';

const Tasks = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  const filterTasks = (status) => {
    return tasks.filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          task.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = status === 'all' || task.status === status;
      const matchesFilter = activeFilter === 'all' || task.status === activeFilter;
      return matchesSearch && matchesStatus && (status === 'all' ? matchesFilter : true);
    });
  };

  const backlogTasks = filterTasks('backlog');
  const inProgressTasks = filterTasks('in-progress');
  const reviewTasks = filterTasks('review');
  const completedTasks = filterTasks('completed');

  const handleResumeTask = (task) => {
    alert(`Resuming task: ${task.title}`);
  };

  const handleNewTask = () => {
    alert('Create new task functionality');
  };

  return (
    <div className="tasks-page">
      <div className="tasks-header">
        <div>
          <h1>Tasks</h1>
          <p className="tasks-subtitle">Manage and track all project tasks across teams</p>
        </div>
        <button className="new-task-btn" onClick={handleNewTask}>
          <MdAdd />
          New Task
        </button>
      </div>

      <div className="tasks-controls">
        <div className="search-bar">
          <MdSearch className="search-icon" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-tabs">
          <button
            className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All
          </button>
          <button
            className={`filter-tab ${activeFilter === 'backlog' ? 'active' : ''}`}
            onClick={() => setActiveFilter('backlog')}
          >
            Backlog
          </button>
          <button
            className={`filter-tab ${activeFilter === 'in-progress' ? 'active' : ''}`}
            onClick={() => setActiveFilter('in-progress')}
          >
            In Progress
          </button>
          <button
            className={`filter-tab ${activeFilter === 'review' ? 'active' : ''}`}
            onClick={() => setActiveFilter('review')}
          >
            Review
          </button>
          <button
            className={`filter-tab ${activeFilter === 'completed' ? 'active' : ''}`}
            onClick={() => setActiveFilter('completed')}
          >
            Completed
          </button>
        </div>
      </div>

      <div className="kanban-stats">
        <div className="stat-card">
          <div className="stat-number">{backlogTasks.length}</div>
          <div className="stat-label">Backlog</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: '#3b82f6' }}>{inProgressTasks.length}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: '#a855f7' }}>{reviewTasks.length}</div>
          <div className="stat-label">In Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: '#10b981' }}>{completedTasks.length}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      <div className="kanban-board">
        <div className="kanban-column">
          <div className="column-header">
            <h3 className="column-title">Backlog</h3>
            <span className="column-count">({backlogTasks.length})</span>
          </div>
          <div className="column-content">
            {backlogTasks.map(task => (
              <TaskCard key={task.id} task={task} onResume={handleResumeTask} />
            ))}
            {backlogTasks.length === 0 && (
              <div className="empty-column">No tasks in backlog</div>
            )}
          </div>
        </div>

        <div className="kanban-column">
          <div className="column-header">
            <h3 className="column-title">In Progress</h3>
            <span className="column-count">({inProgressTasks.length})</span>
          </div>
          <div className="column-content">
            {inProgressTasks.map(task => (
              <TaskCard key={task.id} task={task} onResume={handleResumeTask} />
            ))}
            {inProgressTasks.length === 0 && (
              <div className="empty-column">No tasks in progress</div>
            )}
          </div>
        </div>

        <div className="kanban-column">
          <div className="column-header">
            <h3 className="column-title">In Review</h3>
            <span className="column-count">({reviewTasks.length})</span>
          </div>
          <div className="column-content">
            {reviewTasks.map(task => (
              <TaskCard key={task.id} task={task} onResume={handleResumeTask} />
            ))}
            {reviewTasks.length === 0 && (
              <div className="empty-column">No tasks in review</div>
            )}
          </div>
        </div>

        <div className="kanban-column">
          <div className="column-header">
            <h3 className="column-title">Completed</h3>
            <span className="column-count">({completedTasks.length})</span>
          </div>
          <div className="column-content">
            {completedTasks.map(task => (
              <TaskCard key={task.id} task={task} onResume={handleResumeTask} />
            ))}
            {completedTasks.length === 0 && (
              <div className="empty-column">No completed tasks</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tasks;
