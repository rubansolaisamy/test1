# Two-List Selection Implementation Summary

## Overview
Implemented a context-aware ticket selection system that supports both greenfield (complete epic) and brownfield (granular task) workflows.

## Key Features

### 1. Two-List Architecture
- **Selected Tickets List**: All tickets (includes parents for context)
- **Implementation Tickets List**: Only tasks to actually code
- Planning phase receives full context
- Code generation only implements marked tasks

### 2. Smart Auto-Selection
When user clicks a **task checkbox**:
- Task is added to both lists (selected + implementation)
- Parent story is auto-added to selected list only (context)
- Parent epic is auto-added to selected list only (context)

When user clicks a **story checkbox**:
- Story + all tasks added to both lists

When user clicks an **epic checkbox**:
- Epic + all stories + all tasks added to both lists

### 3. Visual Indicators

#### Badges
- **"Will Implement" (blue)**: Ticket user explicitly selected for coding
- **"Context Only" (gray)**: Parent ticket auto-added for planning context

#### Story Points
- Displayed next to each ticket: `[5 SP]` or `[N/A]`
- Extracted from Jira's `story_points` field
- Gracefully handles missing values (shows N/A)
- Total story points shown in summary: `Total: 12 SP`
- Notes if some tickets have N/A values

### 4. Planning Phase Enhancements
Planning prompt now shows tickets with markers:
```
## EPIC: EPIC-1 - User Authentication

### STORY: STORY-1 - Login
**Immediate Implementation:**
- [TASK-1] Create login API ⭐ PHASE 1 - IMPLEMENT NOW
- [TASK-2] Add JWT tokens ⭐ PHASE 1 - IMPLEMENT NOW

**Future Work:**
- [TASK-3] Password validation 📅 PHASE 2+ - FUTURE WORK
```

This ensures PLAN.md describes the complete feature architecture, even if implementing incrementally.

### 5. Code Generation Filtering
The code generation prompt:
- Includes only implementation tasks in "Stories to Implement" section
- Notes if it's a Phase 1 implementation
- PR title shows task IDs: `EPIC-1: User Auth (Phase 1 - TASK-1, TASK-2)`

### 6. Backwards Compatibility
- `implementation_ticket_ids` is optional in API
- Defaults to all selected tickets if not provided
- Existing workflows continue to work unchanged

## Technical Changes

### Backend

#### 1. State Model (`app/graph/state.py`)
```python
selected_ticket_ids: List[str] = Field(default_factory=list)
implementation_ticket_ids: List[str] = Field(default_factory=list)  # NEW
```

#### 2. API Router (`app/api/router.py`)
- Updated `SelectTicketsRequest` to accept both lists
- Modified `/pipeline/select-tickets` to store both lists
- Added `_for_implementation` flag to tickets
- Added `story_points` to `/pipeline/{project_id}/tickets` response

#### 3. Planning Node (`app/graph/nodes/planning_node.py`)
- New `_format_epics_with_markers()` function
- Updated prompt to show implementation markers
- Receives `implementation_ticket_ids` from state

#### 4. Code Generation (`app/graph/nodes/jira_node.py`)
- Updated `build_epic_task_spec()` to filter tasks by implementation_ids
- Added phase note to prompt
- PR title includes task IDs if partial implementation

#### 5. Orchestrator (`app/graph/nodes/orchestrator.py`)
- Passes `implementation_ticket_ids` to `build_epic_task_spec()`

### Frontend

#### 1. State Management (`frontend/src/pages/TicketSelection.jsx`)
```javascript
const [selectedIds, setSelectedIds] = useState(new Set());
const [implementationIds, setImplementationIds] = useState(new Set());  // NEW
```

#### 2. Toggle Functions
- `toggleTask()`: Auto-selects parents, updates both sets
- `toggleStory()`: Updates both sets, cleans up parents
- `toggleEpic()`: Updates both sets
- Parent context passed through render functions

#### 3. Visual Updates
- New badge helper: `getTicketBadge(ticketId)`
- Story points display: `formatStoryPoints(sp)`
- Updated all render functions to show badges and story points
- Selection summary shows total story points

#### 4. API Integration
- `handleSubmit()` sends both `selected_ticket_ids` and `implementation_ticket_ids`

## User Workflows

### Greenfield (Complete Epic)
1. User clicks Epic checkbox
2. All tickets selected + marked as "Will Implement"
3. Planning sees full epic → Creates comprehensive PLAN.md
4. Code gen implements all tasks → Creates 1 PR
5. **Result**: Complete feature in one go

### Brownfield (Incremental Tasks)
1. User clicks Task-1, Task-2 checkboxes
2. Tasks marked "Will Implement", parents marked "Context Only"
3. Planning sees full epic → Creates phased PLAN.md
4. Code gen implements only Task-1, Task-2 → Creates PR for Phase 1
5. Later, user selects Task-3 → Same PLAN.md, Phase 2 PR
6. **Result**: Small PRs, consistent architecture

## Testing Checklist

### Backend
- [ ] Start backend server
- [ ] Create new project
- [ ] Fetch Jira tickets
- [ ] Verify story points appear in response
- [ ] Select mix of tasks/stories/epics
- [ ] Verify both lists saved in state
- [ ] Check planning prompt has markers
- [ ] Verify code gen prompt filters tasks

### Frontend
- [ ] Open ticket selection page
- [ ] Click individual task → Verify parents auto-checked with gray badge
- [ ] Click story → Verify all tasks + story have blue badge
- [ ] Click epic → Verify everything has blue badge
- [ ] Verify story points display (handle N/A gracefully)
- [ ] Check total story points in summary
- [ ] Submit and verify both lists sent to API

### Integration
- [ ] Full greenfield flow: Select complete epic
- [ ] Verify PLAN.md describes full epic
- [ ] Verify all tasks implemented
- [ ] Full brownfield flow: Select 2 tasks from different stories
- [ ] Verify PLAN.md shows all tasks with phase markers
- [ ] Verify only 2 tasks implemented
- [ ] Verify PR title includes task IDs

## Known Limitations

1. **Quick Start Presets**: Not implemented in this version (decided to skip for simplicity)
2. **Preview Modal**: Not implemented (user decided not needed)
3. **Epic Dependencies**: Not implemented (user decided not needed)

## Future Enhancements

### If Story Points Available (Later)
Could add Quick Start presets:
- Sort epics by story points
- "Core Features" = smallest 50%
- "All Features" = everything
- Skip if most epics lack story points

## Commit
Branch: `feature/bug-fixes`
Commit: `412212d` - "feat: add two-list selection with context tracking and story points"

## Next Steps
1. Test the implementation with real Jira data
2. Verify story points field mapping from Jira
3. Test both greenfield and brownfield workflows
4. Gather user feedback on badge clarity
5. Consider adding Quick Start presets if story points are consistently available
