# pif agentic build flow (#158)

- date: 2026-08-30
- type: process
- tags: pi-extensions, pif, app-builder, runbook, build-loop
- status: current
- resource: skills/pif-app-builder/SKILL.md

## What was done

The conversational build flow exists as a runbook skill (`skills/pif-app-builder/SKILL.md`): brief → design pass (pif-app-designer, owner-approved, recipe is law) → `pif_app_init --template` → page/widget scaffolding through the analyzer gate with diagnostics round-tripping → owner walkthrough. Guardrails encoded: zero manual file editing, complexity ≤5 per piece, plan binds (changes go back through the design pass). No hub code was needed — the runbook orchestrates the #157 tools.

**Dry-run proof (the sprint fixture):** the sample app "Team Pulse" (2 pages, Mercury template) was generated purely by the tools against a real hub — `pif_app.init --template mercury` → `pif_app.page_add metrics` → list verified both pages installed/enabled — and committed at `features/mercury-sample/` with its design pass artifact (`pif_app/design.md`) produced before any widget. Zero manual edits.

## Decisions

- Runbook is a skill (not a droid): agents of any runtime can follow it; droids remain available for packaging later.
- Fixture excludes build artifacts (.dart_tool, pubspec.lock, .flutter-plugins*) via a fixture .gitignore; pub get regenerates on first analyze.
- The owner-approval gate on design.md is exercised in the live notes-app trial (#179); the fixture's design.md is committed as the pass's artifact.

## Lessons

- The #157 tool surface made #158 a pure-orchestration task — no hub code needed, exactly as the issue predicted ("prefer none").

## Current state

Sprint #153 remaining: #159 (export pipeline) → #160 verification.
