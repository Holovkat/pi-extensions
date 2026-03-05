# Fast Track Pipeline — Walkthrough

A step-by-step guide to running the fast track pipeline from a freshly generated PRD to a finished, UAT-approved project.

---

## Prerequisites

- PRD and implementation checklist generated via `pi-req` (`/req-qa`)
- GitHub issues published for all tasks
- `pi-dev` alias configured (see main README)
- tmux running (for dashboard and log panes)

---

## Step 1: Start the Pipeline

You've just finished requirements discovery. Your project has:

```
features/
├── PRD.md                        # Full product specification
└── 00-IMPLEMENTATION-CHECKLIST.md # Epics, tasks, GitHub issue links
```

GitHub has issues for every task, each with full acceptance criteria in the body.

Launch the dev pipeline:

```bash
pi-dev
```

Start the pipeline (fast track is the default mode):

```
/pipeline-start
```

The extension:
1. Parses the checklist — identifies all epics and tasks
2. Fetches full issue bodies from GitHub via `gh issue view` so agents get complete acceptance criteria, not just the 2-line checklist summaries
3. Shows you the plan:

```
Pipeline Plan (FAST TRACK)
─────────────
Checklist: 35 tasks across 9 epics (0 done)

Next: Epic 1: Foundation & Core Architecture
Tasks to build (7):
  - 1.1: HTML skeleton (#56)
  - 1.2: Game loop (#57)
  - 1.3: Game state machine (#58)
  - 1.4: Responsive canvas sizing (#59)
  - 1.5: Input handler (#60)
  - 1.6: Particle pool system (#61)
  - 1.7: 3-layer rendering pipeline (#62)

Build: gemini-3-pro-preview (entire epic at once)
Evaluate: claude-opus-4-6 (per-task scoring)
Fix: bailian/qwen3.5-plus (surgical subtask fixes, up to 5 depths)
UAT: Scenario generation → Playwright execution → approval gate
Compliance threshold: 95%
```

4. Asks you to confirm — select Yes
5. Creates the branch `feature/epic-1-foundation-core-architecture`

The pipeline starts immediately after confirmation.

---

## Step 2: Automatic Epic Execution

Each epic runs through four stages automatically. You can watch progress in the dashboard widget or open tmux log panes with `/pipeline-logs`.

### Stage 1: BUILD

A single model (Gemini 3 Pro) receives all tasks for the epic in one prompt. It reads the existing codebase, implements everything, and commits.

For the first epic, it builds from scratch. For subsequent epics, the prompt explicitly says: "EXTEND existing code, do NOT delete or rewrite working code from previous epics."

```
[FAST] BUILD: gemini-3-pro-preview building entire epic...
[FAST] BUILD complete (142s)
```

### Stage 2: EVALUATE

A stronger model (Opus 4.6) reads the code and scores each task independently against its acceptance criteria. It returns structured JSON:

```json
{
  "tasks": [
    { "id": "1.1", "score": 100, "passed": true, "issues": [], "summary": "All criteria met" },
    { "id": "1.2", "score": 88, "passed": false, "issues": ["dt clamp missing", "no gameTime tracking"], "summary": "Missing 2 requirements" },
    { "id": "1.3", "score": 100, "passed": true, "issues": [], "summary": "All 9 states implemented" }
  ]
}
```

Scoring rules are strict but fair — points are only deducted for real, verifiable issues against the acceptance criteria, not stylistic preferences.

```
[FAST] EVALUATE complete: 5/7 passed
  + 1.1: HTML skeleton 100%
  - 1.2: Game loop 88% — Missing 2 requirements
  + 1.3: Game state machine 100%
  + 1.4: Responsive canvas sizing 97%
  + 1.5: Input handler 96%
  - 1.6: Particle pool system 92% — Pool not pre-allocated
  + 1.7: 3-layer rendering pipeline 95%
```

### Stage 3: FIX (Subtask Decomposition)

Tasks below 95% get surgical fixes. The builder receives the specific issues list from the evaluator and makes targeted edits — not a full rewrite.

```
[FAST] 2 task(s) below 95%. Starting subtask decomposition...
[FAST] Subtask fix depth 1 for 1.2 (88%)...
[FAST] 1.2 fixed at depth 1: 97%
[FAST] Subtask fix depth 1 for 1.6 (92%)...
[FAST] 1.6 fixed at depth 1: 100%
```

If a fix doesn't bring the score above 95%, the evaluator identifies the remaining issues, and the builder tries again. This repeats up to 5 depths:

```
Depth 1: Fix "dt clamp missing" + "no gameTime tracking" → re-score → 92%
Depth 2: Fix "gameTime not reset on level change" → re-score → 97% ✓
```

Existing working code is always preserved. Fixes are additive or corrective, never destructive.

### Stage 4: UAT Scenario Generation

After compliance is resolved, the evaluator generates test scenarios for this epic. Each scenario becomes a GitHub issue under a UAT parent epic:

```
UAT Epic #101: "UAT Test Suite"                                    [uat]
  └── #102: "UAT: Canvas renders at correct resolution"            [uat-pending, epic-1]
  └── #103: "UAT: Game loop maintains 60 FPS"                     [uat-pending, epic-1]
  └── #104: "UAT: State machine transitions validated"             [uat-pending, epic-1]
```

Each issue body contains:

```markdown
## Test Scenario: Canvas renders at correct resolution

**Epic:** Epic 1: Foundation & Core Architecture
**Inputs:** Browser window, keyboard

### Steps
1. Navigate to localhost:8080
2. Check canvas element dimensions
3. Resize browser window
4. Verify canvas scales proportionally

### Expected Outcomes
1. Canvas is 448x576 logical pixels
2. devicePixelRatio is applied
3. Canvas resizes maintaining aspect ratio
4. No content clipping or distortion
```

Labels are created automatically: `uat`, `uat-pending`, `uat-pass`, `uat-fail`, `epic-N`.

### Checklist Update

Tasks that passed get checked off in the checklist and their GitHub issues are closed:

```
- [x] #56 - 1.1 HTML skeleton with inline CSS and canvas element
- [x] #57 - 1.2 Game loop with fixed-timestep accumulator
...
```

---

## Step 3: Auto-Chain Through All Epics

After Epic 1 completes, the pipeline:
1. Creates `feature/epic-2-procedural-maze-generation` branch (from current HEAD, so it has Epic 1's code)
2. Resets tmux panes
3. Pauses 3 seconds
4. Starts Epic 2 automatically

This continues through all epics. The dashboard widget shows live progress:

```
✓ Epic 1: Foundation & Core Architecture
✓ Epic 2: Procedural Maze Generation
✓ Epic 3: Player Mechanics
● Epic 4: Ghost AI [wave2-parallel]
  ✓ 4.1: Ghost entity class  98%
  ✓ 4.2: A* pathfinding  100%
  ● 4.3: Targeting behaviors  building
  ○ 4.4: Scatter/chase cycling
  ○ 4.5: Ghost movement
  ○ 4.6: Ghost rendering

Mode: Fast Track
```

If an epic fails (tasks can't reach 95% after 5 fix depths), the pipeline halts:

```
Pipeline halted: Epic 4: Ghost AI failed. Fix issues and run /pipeline-next to retry.
```

You can manually fix the code, then `/pipeline-next` to resume.

---

## Step 4: UAT Execution

Once every epic passes, the pipeline runs the full UAT suite:

1. **Server startup** — starts `python3 -m http.server 8080` if not already running
2. **Scenario execution** — for each UAT scenario issue:
   - Playwright navigates to the game
   - Executes each step (click, type, press key, wait)
   - Takes snapshots/screenshots to verify expected outcomes
   - Records pass/fail per step
3. **Results posting** — posts a comment on each scenario issue:

```markdown
## UAT Result: PASS

**Executed:** 2026-03-05T14:23:00Z

- Step 1: pass — Canvas element found at 448x576
- Step 2: pass — devicePixelRatio correctly applied
- Step 3: pass — Resize maintains aspect ratio
- Step 4: pass — No clipping detected
```

4. **Label updates** — `uat-pending` replaced with `uat-pass` or `uat-fail`

```
[UAT] Canvas renders at correct resolution: PASS
[UAT] Game loop maintains 60 FPS: PASS
[UAT] Ghost chase switches to scatter: FAIL
[UAT] Power pellet eat chain scoring: PASS
...
[UAT] Results: 18 passed, 2 failed out of 20
```

---

## Step 5: Approval Gate

The pipeline halts and waits for your decision. The dashboard flashes:

```
✓ Epic 1: Foundation & Core Architecture
✓ Epic 2: Procedural Maze Generation
✓ Epic 3: Player Mechanics
✓ Epic 4: Ghost AI
✓ Epic 5: Power Pellets & Frightened Mode
✓ Epic 6: Scoring, Progression & Themed Content
✓ Epic 7: Game Screens & UI
✓ Epic 8: Audio System
✓ Epic 9: Polish, Achievements & Sharing

⚠ AWAITING UAT APPROVAL — /pipeline-approve or /pipeline-reject
  UAT: 18 pass, 2 fail, 0 pending

Mode: Fast Track
```

At this point, you should:
- Review the UAT results in GitHub (each scenario issue has pass/fail comments)
- Open the game in your browser and test manually
- Check the 2 failed scenarios to understand what went wrong

### Option A: Approve

Everything looks good, or the failures are cosmetic and acceptable:

```
/pipeline-approve
```

This:
- Closes the UAT epic on GitHub
- Closes all passed scenario issues
- Shows confirmation:

```
UAT Approved
────────────
18/20 scenarios passed
UAT epic closed.

Run /pipeline-end to squash merge and push.
```

Then finish up:

```
/pipeline-end
```

This:
- Commits any final changes
- Squash merges to main/master
- Pushes to remote
- Cleans up feature branches

### Option B: Reject

The 2 failed scenarios are real bugs that need fixing:

```
/pipeline-reject
```

You're prompted for rejection notes:

```
Rejection Notes: Ghost AI doesn't reverse direction on scatter/chase mode switch.
Power pellet timer runs out too fast on level 3 — should be 6 seconds, shows ~3.
```

This:
- Posts rejection notes as comments on the failed scenario issues
- Resets failed scenarios to `uat-pending`
- Shows next steps:

```
UAT Rejected
────────────
Notes: Ghost AI doesn't reverse direction on scatter/chase mode switch...

2 failed scenario(s) updated with rejection notes.
Run /pipeline-next to re-build and re-test.
```

Run `/pipeline-next` to trigger a fix cycle. The builder reads the rejection notes from the issue comments, makes targeted fixes, and UAT re-runs only the previously failed scenarios. Back to the approval gate.

---

## Summary: What Happens at Each Command

| Command | What it does |
|---------|-------------|
| `/pipeline-start` | Parse checklist, fetch GitHub issues, show plan, create branch, start building |
| `/pipeline-reset` | Full reset — checkout main, delete branches, uncheck checklist, reopen issues |
| *(automatic)* | BUILD → EVALUATE → FIX → UAT scenarios → checklist update → next epic |
| *(automatic)* | After all epics: run UAT via Playwright, post results to GitHub |
| `/pipeline-approve` | Accept UAT, close GitHub epic |
| `/pipeline-reject` | Post rejection notes, reset failed scenarios |
| `/pipeline-next` | Re-run fixes for rejected scenarios |
| `/pipeline-end` | Squash merge to main, push, clean up |

## Typical Timeline

| Phase | Duration | Notes |
|-------|----------|-------|
| Build (per epic) | 2-4 min | Single model, all tasks at once |
| Evaluate | 1-2 min | Per-task scoring |
| Fix (per failed task, per depth) | 1-2 min | Surgical edit + re-score |
| UAT scenario generation (per epic) | 1-2 min | Runs after compliance |
| UAT execution (all scenarios) | 5-15 min | Playwright, depends on scenario count |
| Total for 9 epics + UAT | ~45-90 min | Compared to 2-4 hours in 3-Wave mode |

## Tips

- **Use `/pipeline-logs` or `/pipeline-watch dev`** to see what the builder is doing in real time
- **The dashboard widget** updates live — no need to run `/pipeline-status`
- **If the pipeline halts on an epic**, check the logs (`/pipeline-watch fast-build-N`) to see what went wrong
- **You can switch modes between epics** — use default for early epics, then switch to `--multiwave` for complex ones
- **UAT scenarios accumulate** — each epic adds its scenarios to the same UAT parent issue, so by the end you have a complete test suite
