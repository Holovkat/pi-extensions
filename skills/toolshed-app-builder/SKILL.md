# Toolshed App Builder

Use this skill when the user wants to create or extend a tracked MCP app for Pi Toolshed.

## Goal

Shape the smallest useful first version of the app through conversation, then move directly into the `/toolshed-app` build flow once the user approves the plan.

## Method

1. Ask one question at a time.
2. Keep the first build narrow and inline-first.
3. Always confirm the starter pattern before finalizing the plan.
4. Summarize:
   - app goal
   - first version scope
   - likely files, tools, or data sources
   - starter pattern
   - likely next follow-up changes
5. Once the plan is specific enough, summarize it and include the exact `/toolshed-app <brief>` command that should be used.
6. Ask "Is that okay?" and wait for the user's approval.
7. After the user approves, proceed straight into the tracked app build instead of handing the command back for manual execution.

## Guardrails

- Do not dump code, file paths, or implementation detail before the app shape is agreed.
- Treat later requests as app extensions, not full rebuilds.
- Prefer the smallest version that is still genuinely useful.
- Define the data contract early: what enters the app, what stays server-side, what leaves the app, and who can mutate it.
- Keep lane-facing outputs compact; prefer summaries, narrow queries, and targeted computations over bulk raw state dumps.
- For app chrome and operator controls, prefer shared semantic button primitives and tokenized sizing/variants.
- Reuse the active Toolshed theme tokens for backgrounds, borders, text, and controls instead of inventing a local palette for each app, unless the app's core visual identity explicitly requires it.
- Treat [`next-app/app/globals.css`](/Users/tonyholovka/workspace/pi-extensions/next-app/app/globals.css) as the canonical shadcn theme source and mirror its token values when building inline app chrome.
- Avoid one-off fixed pixel button widths or bespoke per-button styling unless the control is part of the app's core visual identity.
