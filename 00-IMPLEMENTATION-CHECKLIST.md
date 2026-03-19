# Pi Builder Implementation Checklist

Source of truth epic: [GitHub issue #72](https://github.com/Holovkat/pi-extensions/issues/72)

## Current Read of the Repo

- `extensions/dev-pipeline.ts` exists and is still the primary execution engine.
- `extensions/req-qa.ts` exists and is still the primary planning engine.
- `extensions/pi-builder.ts` does not exist yet on `master`.
- The repo does not currently contain the referenced epic docs:
  - `docs/pi-dev-build-prd.md`
  - `docs/pi-dev-production-line-whitepaper.md`
- The architecture documented in `README.md` is still centered on `pi-req` and `pi-dev`.
- Recovered implementation evidence exists on PR [#71](https://github.com/Holovkat/pi-extensions/pull/71): `feat: add pi-builder task-first execution flow`.

## Priority Order

### Phase 0 — Recover the Spec Surface
- [ ] Restore or recreate the missing spec docs:
  - [ ] `docs/pi-dev-build-prd.md`
  - [ ] `docs/pi-dev-production-line-whitepaper.md`
- [ ] Regenerate a clean task breakdown under Epic #72 so execution work can be tracked at task level again.
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

## Recovered GitHub Issue Tree

- [ ] [#72 Epic: Build pi-builder execution engine](https://github.com/Holovkat/pi-extensions/issues/72)
  - [ ] [#73 Sprint 1: pi-builder intake and task packet runtime](https://github.com/Holovkat/pi-extensions/issues/73)
    - [ ] [#74 Task: create pi-builder extension entrypoint](https://github.com/Holovkat/pi-extensions/issues/74)
    - [ ] [#75 Task: implement runtime task-packet reconstruction](https://github.com/Holovkat/pi-extensions/issues/75)
    - [ ] [#76 Task: enforce execution-readiness checks at intake](https://github.com/Holovkat/pi-extensions/issues/76)
  - [ ] [#77 Sprint 2: pi-builder warm builder continuity and change snapshots](https://github.com/Holovkat/pi-extensions/issues/77)
    - [ ] [#78 Task: implement task-local warm builder continuity](https://github.com/Holovkat/pi-extensions/issues/78)
    - [ ] [#79 Task: emit narrow change snapshots](https://github.com/Holovkat/pi-extensions/issues/79)
    - [ ] [#80 Task: implement correction-packet injection](https://github.com/Holovkat/pi-extensions/issues/80)
  - [ ] [#81 Sprint 3: pi-builder diff review and targeted testing](https://github.com/Holovkat/pi-extensions/issues/81)
    - [ ] [#82 Task: implement diff-reviewer lane](https://github.com/Holovkat/pi-extensions/issues/82)
    - [ ] [#83 Task: implement layered targeted testing](https://github.com/Holovkat/pi-extensions/issues/83)
    - [ ] [#84 Task: define promotion-gate handoff behavior](https://github.com/Holovkat/pi-extensions/issues/84)
  - [ ] [#85 Sprint 4: pi-builder tracker sync and line-stop handling](https://github.com/Holovkat/pi-extensions/issues/85)
    - [ ] [#86 Task: implement tracker-sync GitHub write-backs](https://github.com/Holovkat/pi-extensions/issues/86)
    - [ ] [#87 Task: implement line-stop and replanning handoff](https://github.com/Holovkat/pi-extensions/issues/87)
    - [ ] [#88 Task: expose builder runtime lane and readiness visibility](https://github.com/Holovkat/pi-extensions/issues/88)
  - [ ] [#89 Sprint 5: pi-builder end-to-end pilots and UAT-ready validation](https://github.com/Holovkat/pi-extensions/issues/89)
    - [ ] [#90 Task: pilot greenfield end-to-end flow](https://github.com/Holovkat/pi-extensions/issues/90)
    - [ ] [#91 Task: pilot enhancement end-to-end flow](https://github.com/Holovkat/pi-extensions/issues/91)
    - [ ] [#92 Task: pilot bugfix root-cause-to-regression flow](https://github.com/Holovkat/pi-extensions/issues/92)
