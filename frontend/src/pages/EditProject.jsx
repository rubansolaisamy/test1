import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getProjectById, updateProject } from '../services/api';

const EditProject = () => {
  const { id } = useParams(); // Grabs the project ID from the URL
  const navigate = useNavigate();
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    due_date: '',
    jira_board_id: '',
    jira_project_key: '',
    github_repo: '',
    github_branch: '',
    github_token: ''
  });

  // Fetch existing project data on load
  useEffect(() => {
    const fetchProject = async () => {
      try {
        const username = localStorage.getItem('username');
        if (!username) throw new Error("Authentication required.");

        const project = await getProjectById(username, id);
        
        // Pre-fill the form with the fetched data
        setFormData({
          title: project.title || '',
          description: project.description === 'No description provided.' ? '' : project.description,
          due_date: project.dueDate === 'TBD' ? '' : project.dueDate,
          jira_board_id: project.jira_board_id || '',
          jira_project_key: project.jira_project_key || '',
          github_repo: project.github_repo || '',
          github_branch: project.github_branch || '',
          github_token: project.github_token || ''
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const currentUsername = localStorage.getItem('username');
    if (!currentUsername) return;

    try {
      setIsSaving(true);
      await updateProject(currentUsername, id, formData);
      navigate('/projects'); // Send back to dashboard on success
    } catch (err) {
      setError(err.message);
      setIsSaving(false);
    }
  };

  const inputStyle = { width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', marginTop: '0.25rem' };
  const labelStyle = { fontWeight: '500', color: '#374151', fontSize: '0.875rem' };

  if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading project details...</div>;

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827' }}>Edit Project</h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>Update metadata for {id}</p>
      </div>

      {error && (
        <div style={{ backgroundColor: '#fee2e2', borderLeft: '4px solid #ef4444', padding: '1rem', marginBottom: '2rem', borderRadius: '4px' }}>
          <p style={{ color: '#b91c1c', margin: 0 }}><strong>Error:</strong> {error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.5rem', backgroundColor: '#ffffff', padding: '2rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        
        <div>
          <label style={labelStyle}>Project Title <span style={{ color: '#ef4444' }}>*</span></label>
          <input required name="title" value={formData.title} onChange={handleChange} style={inputStyle} disabled={isSaving} />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea name="description" value={formData.description} onChange={handleChange} style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }} disabled={isSaving} />
        </div>

        <div>
          <label style={labelStyle}>Target Due Date</label>
          <input type="date" name="due_date" value={formData.due_date} onChange={handleChange} style={{ ...inputStyle, width: 'auto' }} disabled={isSaving} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '1rem 0' }} />
        <h3 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>Integrations</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div>
            <label style={labelStyle}>Jira Board ID</label>
            <input name="jira_board_id" value={formData.jira_board_id} onChange={handleChange} style={inputStyle} disabled={isSaving} />
          </div>
          <div>
            <label style={labelStyle}>Jira Project Key</label>
            <input name="jira_project_key" value={formData.jira_project_key} onChange={handleChange} style={inputStyle} disabled={isSaving} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
          <div>
            <label style={labelStyle}>GitHub Repo</label>
            <input name="github_repo" value={formData.github_repo} onChange={handleChange} style={inputStyle} disabled={isSaving} />
          </div>
          <div>
            <label style={labelStyle}>Default Branch</label>
            <input name="github_branch" value={formData.github_branch} onChange={handleChange} style={inputStyle} disabled={isSaving} />
          </div>
          <div>
            <label style={labelStyle}>GitHub Token</label>
            <input type="password" name="github_token" value={formData.github_token} onChange={handleChange} style={inputStyle} placeholder="Leave blank to keep existing" disabled={isSaving} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
          <button type="button" onClick={() => navigate('/projects')} disabled={isSaving} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
            Cancel
          </button>
          <button type="submit" disabled={isSaving} style={{ padding: '0.75rem 1.5rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: '500' }}>
            {isSaving ? 'Saving Changes...' : 'Update Project'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditProject;