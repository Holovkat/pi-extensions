# Pi Builder Implementation Checklist

Source of truth epic: [GitHub issue #2](https://github.com/Holovkat/pi-extensions/issues/2)

## Current Read of the Repo

- `extensions/dev-pipeline.ts` exists and is still the primary execution engine.
- `extensions/req-qa.ts` exists and is still the primary planning engine.
- `extensions/pi-builder.ts` does not exist yet.
- The repo does not currently contain the referenced epic docs:
  - `docs/pi-dev-build-prd.md`
  - `docs/pi-dev-production-line-whitepaper.md`
- The architecture documented in `README.md` is still centered on `pi-req` and `pi-dev`.

## Priority Order

### Phase 0 — Recover the Spec Surface
- [ ] Restore or recreate the missing spec docs:
  - [ ] `docs/pi-dev-build-prd.md`
  - [ ] `docs/pi-dev-production-line-whitepaper.md`
- [ ] Regenerate a clean task breakdown under Epic #2 so execution work can be tracked at task level again.
- [ ] Align the local checklist and GitHub issue tree so future `/next-phase` runs have a valid task source.

### Phase 1 — Stand Up `pi-builder`
- [ ] Create `extensions/pi-builder.ts` as a separate execution extension alongside `extensions/dev-pipeline.ts`.
- [ ] Give `pi-builder` its own startup identity and command entrypoint without breaking existing `pi-dev` flows.
- [ ] Define the migration boundary between legacy `pi-dev` behavior and new `pi-builder` behavior.
- [ ] Ensure existing dashboard/control socket integration remains compatible.

### Phase 2 — Implement Task-First Intake
- [ ] Load execution context from blueprint-produced GitHub task state instead of epic-first execution.
- [ ] Reconstruct a runtime task packet from:
  - [ ] issue body
  - [ ] issue comments
  - [ ] checklist state
  - [ ] current repo diff/state
- [ ] Enforce execution-readiness checks before build starts.
- [ ] Reject tasks above complexity score `5/10` before execution begins.
- [ ] Refuse tasks with missing prerequisites and route them back to replanning.

### Phase 3 — Keep the Builder Warm
- [ ] Preserve task-local builder continuity across build, review-fix, and test-fix loops.
- [ ] Emit a narrow change snapshot after each builder pass.
- [ ] Include changed files, touched interfaces, and touched acceptance criteria in the snapshot.
- [ ] Support narrow correction-packet injection so small fixes do not require a cold restart.

### Phase 4 — Narrow Review and Testing
- [ ] Add a diff-scoped review lane focused on changed files and touched interfaces.
- [ ] Structure review findings so they are machine-usable and can be fed back into the warm builder.
- [ ] Implement layered targeted testing:
  - [ ] changed-file checks first
  - [ ] task acceptance checks next
  - [ ] selected regression coverage after that
- [ ] Reserve broad UAT for promotion gates instead of every local correction loop.
- [ ] Define explicit promotion-gate criteria for when work advances to UAT-ready.

### Phase 5 — Sync and Stop Correctly
- [ ] Write major builder transitions back to GitHub in a consistent format.
- [ ] Ensure restart context can be reconstructed from the issue thread alone.
- [ ] Implement clean line-stop behavior for:
  - [ ] missing prerequisites
  - [ ] execution overruns
  - [ ] planning-grain failures
- [ ] Route blocked or oversized work back to replanning with explicit reasons.
- [ ] Treat scope-drift events at `8/10` or higher as planning failures.
- [ ] Expose lane, score, prerequisite, and readiness visibility in builder runtime outputs.

### Phase 6 — Prove the Flow End to End
- [ ] Pilot a greenfield flow from blueprint planning to UAT-ready output.
- [ ] Pilot an enhancement flow from diff review through targeted testing and promotion.
- [ ] Pilot a bugfix flow from root-cause planning through targeted regression and closure.
- [ ] Record findings and feed them back into GitHub-backed task state.
- [ ] Document follow-up gaps discovered during pilots.

### Phase 7 — Update the Repo Surface
- [ ] Update `README.md` so the documented architecture reflects `pi-blueprint` → `pi-builder` rather than only `pi-req` → `pi-dev`.
- [ ] Document how operators should choose between legacy and new flows during migration.
- [ ] Add docs for builder task packets, readiness gates, review/testing lanes, and replanning triggers.

## Epic Definition of Done
- [ ] `pi-builder` exists as a separate extension alongside `pi-dev`.
- [ ] Execution begins only for blueprint tasks that are execution-ready and `<=5/10` complexity.
- [ ] Review and test run on changed surfaces first, with broader promotion gates later.
- [ ] GitHub issue/comment state is sufficient to reconstruct task context after restart.
- [ ] `8/10+` scope-drift events are treated as red-flag planning failures and route back to replanning.
