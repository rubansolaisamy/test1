export const user = {
  id: 1,
  name: "John Doe",
  role: "Admin",
  initials: "JD"
};

export const projects = [
  {
    id: 1,
    title: "E-commerce Platform Redesign",
    description: "Complete redesign and modernization of the existing e-commerce platform",
    status: "in progress",
    progress: 65,
    currentPhase: "Development",
    dueDate: "Jun 30, 2026",
    memberCount: 4,
    members: ["JD", "MC", "ER"],
    statusColor: "#3b82f6"
  },
  {
    id: 2,
    title: "Mobile Banking App",
    description: "New mobile banking application with advanced security features",
    status: "testing",
    progress: 85,
    currentPhase: "Testing",
    dueDate: "Apr 15, 2026",
    memberCount: 4,
    members: ["MC", "ER", "LT"],
    statusColor: "#f59e0b"
  },
  {
    id: 3,
    title: "CRM System Integration",
    description: "Integration of new CRM system with existing tools and workflows",
    status: "planning",
    progress: 20,
    currentPhase: "Requirements Analysis",
    dueDate: "Sep 30, 2026",
    memberCount: 3,
    members: ["SI", "DK", "LT"],
    statusColor: "#a855f7"
  },
  {
    id: 4,
    title: "AI Analytics Dashboard",
    description: "Machine learning powered analytics dashboard for business intelligence",
    status: "in progress",
    progress: 45,
    currentPhase: "Design",
    dueDate: "Jul 31, 2026",
    memberCount: 4,
    members: ["ER", "JW", "RA"],
    statusColor: "#3b82f6"
  }
];

export const tasks = [
  {
    id: 1,
    title: "Design database schema",
    description: "Create comprehensive database schema for the new system...",
    phase: "Design",
    assignee: "Sarah Johnson",
    status: "completed",
    priority: "high",
    dueDate: "Feb 15",
    project: "E-commerce Platform Redesign",
    statusDot: "#10b981"
  },
  {
    id: 2,
    title: "Implement user authentication",
    description: "Set up OAuth 2.0 and JWT-based authentication system with ema...",
    phase: "Development",
    assignee: "Michael Chen",
    status: "in-progress",
    priority: "critical",
    dueDate: "Mar 30",
    project: "E-commerce Platform Redesign",
    statusDot: "#ef4444"
  },
  {
    id: 3,
    title: "Create UI mockups",
    description: "Design high-fidelity mockups for all major screens including...",
    phase: "Design",
    assignee: "Emily Rodriguez",
    status: "review",
    priority: "high",
    dueDate: "Mar 20",
    project: "AI Analytics Dashboard",
    statusDot: "#f97316"
  },
  {
    id: 4,
    title: "Write API documentation",
    description: "Document all REST API endpoints with examples, request/respons...",
    phase: "Development",
    assignee: "David Kim",
    status: "backlog",
    priority: "medium",
    dueDate: "Apr 10",
    project: "E-commerce Platform Redesign",
    statusDot: "#eab308"
  },
  {
    id: 5,
    title: "Security penetration testing",
    description: "Comprehensive security testing including penetration testing...",
    phase: "Testing",
    assignee: "Lisa Thompson",
    status: "in-progress",
    priority: "critical",
    dueDate: "May 05",
    project: "Mobile Banking App",
    statusDot: "#ef4444"
  },
  {
    id: 6,
    title: "Setup CI/CD pipeline",
    description: "Configure automated testing and deployment pipeline",
    phase: "Development",
    assignee: "John Doe",
    status: "in-progress",
    priority: "high",
    dueDate: "Mar 25",
    project: "AI Analytics Dashboard",
    statusDot: "#f97316"
  },
  {
    id: 7,
    title: "User acceptance testing",
    description: "Conduct UAT with stakeholders",
    phase: "Testing",
    assignee: "Sarah Johnson",
    status: "in-progress",
    priority: "high",
    dueDate: "Apr 20",
    project: "Mobile Banking App",
    statusDot: "#f97316"
  },
  {
    id: 8,
    title: "Performance optimization",
    description: "Optimize database queries and API response times",
    phase: "Development",
    assignee: "Michael Chen",
    status: "completed",
    priority: "medium",
    dueDate: "Mar 10",
    project: "E-commerce Platform Redesign",
    statusDot: "#10b981"
  }
];

export const phases = [
  {
    id: 1,
    name: "Requirements Analysis",
    description: "Analyze requirements and generate user stories with AI assistance",
    status: "completed",
    progress: 100,
    tasks: { completed: 8, total: 8 },
    statusLabel: "On track",
    activities: []
  },
  {
    id: 2,
    name: "Planning",
    description: "Define project scope, objectives, resources, and create initial project plan with timeline and budget",
    status: "completed",
    progress: 100,
    tasks: { completed: 6, total: 6 },
    statusLabel: "On track",
    activities: []
  },
  {
    id: 3,
    name: "Design",
    description: "Create system architecture, database schema, UI/UX designs, and technical specifications",
    status: "active",
    progress: 75,
    tasks: { completed: 12, total: 16 },
    statusLabel: "On track",
    activities: [
      "Finalizing UI/UX wireframes",
      "Creating database schema designs",
      "Developing technical specifications"
    ]
  },
  {
    id: 4,
    name: "Testing",
    description: "Perform unit, integration, and user acceptance testing",
    status: "active",
    progress: 45,
    tasks: { completed: 8, total: 18 },
    statusLabel: "On track",
    activities: [
      "Running automated test suites",
      "Performing security penetration testing",
      "User acceptance testing with stakeholders"
    ]
  },
  {
    id: 5,
    name: "Deployment",
    description: "Deploy to production environment and monitor rollout",
    status: "pending",
    progress: 0,
    tasks: { completed: 0, total: 6 },
    statusLabel: "Not started",
    activities: []
  }
];

export const projectProgressData = [
  { month: "Jan", progress: 45 },
  { month: "Feb", progress: 58 },
  { month: "Mar", progress: 68 },
  { month: "Apr", progress: 75 },
  { month: "May", progress: 85 }
];

export const tasksByPhaseData = [
  { phase: "Requirements", count: 32 },
  { phase: "Planning", count: 28 },
  { phase: "Design", count: 24 },
  { phase: "Development", count: 18 },
  { phase: "Testing", count: 12 },
  { phase: "Deployment", count: 6 }
];

export const projectStatusData = [
  { name: "Planning", value: 1, color: "#3b82f6" },
  { name: "In Progress", value: 2, color: "#10b981" },
  { name: "Testing", value: 1, color: "#f59e0b" }
];

export const stats = {
  activeProjects: {
    count: 2,
    change: "+2 this month",
    changeType: "positive"
  },
  completedTasks: {
    count: 2,
    change: "+12 this week",
    changeType: "positive"
  },
  activeTeamMembers: {
    count: 7,
    total: 8,
    changeType: "neutral"
  },
  activePhases: {
    count: 2,
    total: 5,
    changeType: "neutral"
  }
};
