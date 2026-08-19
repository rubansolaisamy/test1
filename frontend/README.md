# SDLC Manager - Frontend

A comprehensive Software Development Lifecycle (SDLC) management interface built with React and Vite.

## Features

- **Dashboard**: Overview with statistics, charts, and project progress visualization
- **Projects**: Manage projects with search, filters, and resume functionality
- **Phases**: Track SDLC phases with progress indicators and current activities
- **Tasks**: Kanban board for task management across different stages
- **Team**: Team member management (placeholder)
- **Documentation**: Project documentation hub (placeholder)
- **Reports**: Analytics and reporting (placeholder)

## Tech Stack

- **React**: UI library
- **Vite**: Build tool and dev server
- **React Router**: Client-side routing
- **Recharts**: Data visualization
- **React Icons**: Icon library

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173/`

### Build for Production

```bash
npm run build
```

The production-ready files will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
frontend/
├── src/
│   ├── components/      # Reusable UI components
│   ├── pages/           # Page components
│   ├── data/            # Mock data
│   ├── assets/          # Static assets
│   ├── App.jsx          # Main app component with routing
│   └── main.jsx         # App entry point
├── public/              # Public assets
└── package.json
```

## Key Components

- **Sidebar**: Navigation menu with user profile
- **StatCard**: Reusable statistics display
- **ProgressBar**: Visual progress indicator
- **ProjectCard**: Project display with resume functionality
- **TaskCard**: Task display for Kanban board

## Features in Development

- Backend integration
- Multi-user support
- Real-time updates
- Advanced team management
