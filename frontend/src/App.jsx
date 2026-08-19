import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import CreateProject from './pages/CreateProject';
import EditProject from './pages/EditProject';
import Login from './pages/Login';
import TicketSelection from './pages/TicketSelection';
import ProjectPage from './pages/ProjectPage';
import Settings from './pages/Settings';
import Reports from './pages/Reports';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/edit/:id" element={<EditProject />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/projects/:projectId/select-tickets" element={<TicketSelection />} />

          {/* Merged project page */}
          <Route path="/projects/:id" element={<ProjectPage />} />

          {/* Keep old deep-link routes working — redirect into the new page */}
          <Route path="/projects/:id/phases" element={<Navigate to="../:id" replace />} />
          <Route path="/projects/:id/tasks"  element={<Navigate to="../:id" replace />} />
          <Route path="/projects/:id/review" element={<Navigate to="../:id" replace />} />
          
          {/* Settings */}
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
