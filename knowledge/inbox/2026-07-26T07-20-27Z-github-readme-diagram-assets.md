---
type: Inbox
title: Session 2026-07-26 - GitHub README diagram assets
description: Replaced client-dependent README Mermaid rendering with local pre-rendered PNG assets
resource: ../../README.md
tags: [pi-extensions, readme, mermaid, github, diagrams, compatibility]
timestamp: 2026-07-26T07:20:27Z
session_id: 019f9295-1ced-7201-8bb5-b1f2464161e4
commit_sha: pending
branch: master
issue_refs: []
epic_refs: []
---

# What Was Done

- Replaced all nine Mermaid fences in the root README with descriptive references to repository-local PNG assets.
- Preserved each diagram's original Mermaid definition byte-for-byte in a same-named `.mmd` source file under `docs/diagrams/`.
- Added pinned local regeneration instructions and generated the PNGs with Mermaid CLI 11.16.0.
- Verified every source, image, README reference, and scoped diff without altering the checkout's existing unrelated work.

# Decisions Made

- Use PNGs as the README display format because some native GitHub clients show Mermaid fences as ordinary source code instead of invoking Mermaid.
- Keep the Mermaid definitions as the maintainable source of truth outside the root README.
- Use only repository-local assets and local rendering tooling; do not depend on an external diagram rendering service.
- Preserve the diagrams' existing content and layout rather than redesigning them for this compatibility fix.

# What Was Deprecated

- Mermaid code fences are no longer the primary rendering path for diagrams in the root README.
- Mermaid itself is not deprecated; the `.mmd` files remain the editable diagram sources.

# Lessons Learned

- Valid Mermaid syntax and successful rendering with GitHub's current Mermaid version do not guarantee that every GitHub client invokes the Mermaid renderer.
- Pre-rendered local images provide a client-independent fallback while same-named source files keep updates reproducible.
- PNG rasterization can vary with browser and font metrics even when the Mermaid CLI version and rendering options are pinned.

# Current State

- The root README contains nine local PNG diagram references with descriptive alt text and no Mermaid fences.
- `docs/diagrams/` contains exactly nine `.mmd` sources, nine matching PNGs, and regeneration guidance.
- All PNGs passed integrity and visual checks; every README path resolves locally.
- Native GitHub app behavior remains to be confirmed by the user after the commit is published.
