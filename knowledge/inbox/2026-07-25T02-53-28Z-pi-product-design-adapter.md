---
type: Inbox
title: Session 2026-07-25 - Pi Product Design Adapter
description: Investigation and implementation of a Pi runtime adapter for OpenAI's Codex Product Design plugin
resource: https://github.com/Holovkat/agent-skill-distro/blob/main/targets/pi/skills/product-design/SKILL.md
tags: [pi, codex, product-design, skills, adapter, licensing]
timestamp: 2026-07-25T02:53:28Z
session_id: 019f9726-512e-7a7a-937e-5e65087909f9
commit_sha: 447dad193c8e21c86a8e51cb6a2d5dcd8f7633ef
branch: master
issue_refs: []
epic_refs: []
---

# What Was Done

Investigated the installed OpenAI Codex Product Design plugin and identified the locally attested release as `product-design` version `0.1.52`, remote plugin ID `Plugin_fa77aec24fc08191bc6e57f377126d76`. The bundle contains ten Agent Skills-shaped workflows, shared references, user-context scripts, and web/mobile prototype templates.

Implemented a Pi-specific `product-design` adapter in the canonical `agent-skill-distro` Pi target. The adapter dynamically resolves the newest valid installed Product Design version, loads the upstream router and focused skills in place, keeps Pi-owned saved context under `~/.pi/agent/state/plugins/product-design`, and maps Codex/ChatGPT-only browser, Image Gen, connector, preview, annotation, hosting, and handoff assumptions to accurate Pi behavior.

Added preflight resolver tests, documented the adapter in the skill distro README, refreshed the managed global Pi skill root, and verified that a fresh Pi RPC process discovers `/skill:product-design` from `~/.pi/agent/skills/product-design/SKILL.md`.

# Decisions Made

- Do not copy or vendor the OpenAI plugin bundle. Its manifest declares `Proprietary`, no separate license grant was present, and the root package is private.
- Use a thin runtime adapter that references the user's already installed Codex cache. This preserves provenance, avoids redistributing OpenAI prompts/templates/assets, and lets Codex continue to own plugin updates.
- Implement this as a Pi skill rather than a Pi extension. The reusable portion is instruction/workflow content; no custom Pi tool or lifecycle hook is required.
- Do not add the upstream `skills/` directory directly to Pi settings. Its generic names such as `index`, `research`, and `audit` risk collisions, and its unmodified instructions assume Codex/ChatGPT facilities Pi does not expose.
- Resolve plugin versions dynamically and reject malformed manifests rather than pinning the current `0.1.52` cache path.
- Keep Pi Product Design context separate from Codex context by default, while using upstream scripts' supported `--state-dir` override.

# What Was Deprecated

Directly copying the Product Design plugin into `pi-extensions`, exposing all upstream focused skills unchanged, or treating `.codex-plugin/plugin.json` as a Pi package manifest were rejected. Pi does not natively load Codex plugin manifests, and these approaches would introduce licensing, name-collision, update-drift, and runtime-compatibility risks.

# Lessons Learned

Pi supports the Agent Skills standard and can load skills from other harnesses, but a Codex plugin is a broader package contract than a skill directory. Product Design's Markdown workflows are structurally reusable, while its `@Product Design` UI, Image Gen, in-app browser, Sites, annotations, and hosting behavior require explicit capability mapping.

The plugin's own Python user-context scripts already support `--state-dir`, making state isolation straightforward. The React/Vite prototype templates can be used in place for local generated work, but their OpenAI Sites metadata is not evidence of a Pi preview or deployment.

# Current State

The adapter is installed and discoverable globally in Pi and is committed in `agent-skill-distro` as `e20e542cedc664c0ec90fcb19cc743329cc2d906`. Preflight resolves the local OpenAI plugin `0.1.52`, reports all ten focused upstream skills, and confirms the Pi state directory is writable or creatable. Eleven skill-distro unit tests pass, the skill audit reports zero errors, fresh Pi RPC discovery returns exactly one `skill:product-design` command, and an independent reviewer found no blocking issues.

Known limits remain: the current Pi session does not expose a built-in Image Gen equivalent, so strict three-image ideation and generated raster-asset workflows must report that capability gap unless another authenticated image-generation tool is available. Figma, Canva, Sites, Vercel, and similar connectors remain conditional on actual Pi MCP/skill/CLI availability. Live web verification of the OpenAI repository and release freshness was unavailable; `0.1.52` is locally attested rather than globally confirmed as latest.
