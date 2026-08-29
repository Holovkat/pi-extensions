# pif tracker epic drill-down and project-scoped boards (#188)

- date: 2026-08-30
- type: component
- tags: pi-extensions, pif, tracker, kanban, board-ux
- status: current
- resource: pif/lib/widgets/tracker_board/tracker_board.dart

## What was done

The tracker board gained a **scope model**. "All work" is the original board, untouched. A new "Epics" overview lists one content card per epic — `#NNN — Title` header, five-line body excerpt, per-column family counts — and tapping an epic drills into a **project-scoped board**: the epic pins as a header card above lanes containing only its sprints and tasks, with a breadcrumb back. Drags inside a scoped view write back to GitHub exactly like the All-work view. Purpose: epics read as their own project boards (the notes-app trial epic #179 shows only its family), per the owner's Kanban-isolation request.

## Decisions

- Hub sync (`extensions/pif-shared.ts`) computes two new card fields: `parent` (from body Reference Index `Epic:`/`Sprint:` references; a task binds to its sprint, else epic; ambiguity resolves to null, never a guess) and `excerpt` (markdown stripped, Reference Index skipped, first paragraphs capped at 240 chars). The widget stays a dumb renderer.
- The scoped epic renders as the pinned header card only — not duplicated as a lane card.
- "All work" cards keep the old anatomy byte-for-byte; the new card anatomy (macOS Reminders reference) lives in the overview and scoped views. Colours come from theme tokens only.

## Lessons

- ToggleButtons requires `children.length == isSelected.length` — a one-entry isSelected with two children throws during build (caught by tests as a board-wide exception).
- Test-first assertion correction: "back" returns to the Epics overview, which is itself scoped — unrelated work correctly stays invisible there.
- Shell cwd drift: run repo-root commands with explicit `cd` — a heredoc aimed at `knowledge/inbox/` from `pif/` silently failed while the commit succeeded.

## Current state

Node 26/26 (parent + excerpt tests), dart analyze clean, flutter 58/58 (5 new scope tests). #188 → Review on the board. Next: #189 detail sheet revamp, then #157 app model.
