# pif tracker detail sheet — inline editing, images, attachments, attributes (#189)

- date: 2026-08-30
- type: component
- tags: pi-extensions, pif, tracker, detail-sheet, ux
- status: current
- resource: pif/lib/widgets/tracker_board/tracker_board.dart

## What was done

The ticket detail sheet was rebuilt into a chrome-free surface per the owner brief: **one X** (dirty state prompts "Save changes?" — Yes saves+closes, No discards; the redundant cancel button is gone; the bottom Save stays); **inline title editing** (borderless field, bold in edit mode, cursor at tap point — no field look); **`Title`/`Body (Markdown)` chrome removed** — the body is the page; **pill tabs** Body | Attachments | Attributes; **inline images** (`![image|N](src)` — width lives in the markdown, drag handle rewrites it in place, position preserved across save/reload; local files + http URLs); **attachments pane** listing body-referenced assets (local vs link); **attributes pane** in macOS Reminders style — Date/Time/Urgent toggles with pickers, Tags add/remove (hub syncs them as GitHub labels via a new protected label diff), Flag, Priority, parent-epic List context.

## Decisions

- Truth split: GitHub keeps title/body/labels/state; attributes GitHub cannot store (dates, time, urgent, flag, priority) persist in the tracker's local storage per ticket and never silently disappear. Tags map to labels; `status:*` and type labels are mechanical and preserved by `plannedLabelChange`.
- View mode renders the LIVE body text, so an image resize in the preview is real content; dirty is computed against baselines rebased on each successful save.
- Newlines are preserved exactly (multiline editor, round-trip verified); the editor fills the entire remaining panel — no fixed-height scroll box.

## Lessons

- Late-final reassignment threw inside the op handler, leaving edit mode stuck with the error surfacing after test completion — mutable dirty baselines fixed it.
- Blanket text replacement over code mangles identifiers (hit again on the test taps); anchors must be verified against current file state after any sweep.
- `Path.replace` doesn't exist (it's str semantics via read/write) — scripted multi-hunk edits should assert-and-report per hunk to avoid losing hunks mid-script.

## Current state

Node 27/27 (label diff tests), dart analyze clean, flutter 64/64 (6 new sheet tests: dirty-X both paths, newline round-trip + panel fill, pill panes, image insert markdown, tags→labels). #189 → Review. Next: #157 app model.
