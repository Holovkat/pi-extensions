---
type: Inbox
title: Session 2026-07-25 - Global Pi agent model routing
description: Persisted the global Pi subagent fleet and Factory Droid Opus 5 planner routing
resource: ../../extensions/factory-droid-provider.ts
tags: [pi, subagents, models, factory, droid, planning]
timestamp: 2026-07-25T02:39:05Z
session_id: 019f96ff-4b7c-7d00-96d5-5635410ea64a
commit_sha: pending
branch: master
issue_refs: []
epic_refs: []
---

# What Was Done

- Audited the globally installed Pi subagents and grouped their effective model assignments.
- Migrated the analyst, context-building, research, orchestration, and senior-analysis roles from GPT-5.5 to GPT-5.6 Sol.
- Routed `delegate` to GPT-5.6 Terra at high thinking and retained `scout` on GPT-5.3 Codex Spark at medium thinking.
- Routed `planner` through the Factory Droid account using Claude Opus 5 at `xhigh`, with GPT-5.6 Sol at `xhigh` as the ordered fallback.
- Updated and enabled the Factory Droid provider bridge for Droid CLI 0.180.0, including Opus 5 model registration, extended thinking levels, and provider-failure normalization.
- Added the repo-managed `agents/pi-subagents/` fleet and documented global installation and model routing in the README.

# Decisions Made

- Planning uses Droid Claude Opus 5 as the primary model because planning benefits from the latest Opus reasoning through the existing Factory account.
- GPT-5.6 Sol is the planner fallback for quota, billing, authentication, timeout, and model/provider availability failures.
- One `thinking: xhigh` setting applies to both planner candidates.
- The Droid provider exposes only verified Opus 5 and Opus 5 Fast entries until dynamic model catalog discovery is implemented.
- Droid exec remains in its default read-only mode; Pi remains the mutation authority.

# What Was Deprecated

- GPT-5.5 pins for the migrated analysis and planning roles are superseded by GPT-5.6 Sol or Droid Opus 5 routing.
- The stale Factory bridge catalog and obsolete `glm-4.7` tool-discovery dependency are no longer used.
- Disabling Droid's entire tool catalog is no longer used because Droid CLI 0.180.0 rejects that invocation shape.

# Lessons Learned

- `/subagents-models` reports builtin mappings and can differ from user-scoped agent definitions that shadow builtins; `subagent get` is the reliable effective-agent check.
- Harness-specific model availability must be checked after CLI updates rather than inferred from Pi's provider catalog.
- Model fallback requires provider failures to contain retryable provider/model semantics; normalizing Droid process failures makes quota exhaustion reliably eligible for fallback.

# Current State

- The live global Pi planner successfully completed a smoke test through `factory-droid/claude-opus-5` at `xhigh`.
- Pi discovers both Factory Opus 5 variants and the GPT-5.6 Sol fallback.
- Global runtime files under `~/.pi/agent/` are active, and matching repo-managed sources now exist for versioned distribution.
- Other harnesses and other machines remain unchanged until their own configuration or synchronization step is performed.
