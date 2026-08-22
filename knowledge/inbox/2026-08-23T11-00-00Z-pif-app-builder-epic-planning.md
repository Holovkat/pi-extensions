---
type: Inbox
title: pif App-Builder Epic Planned — Applications Built on the pif Foundation
description: Planned and published Epic #152 (sprint #153, tasks #154-#160) turning pif from an IDE into the foundation agentic applications are built on — per-project widget sets, page/home model, agentic build flow, and standalone agentic app export
tags: [pi-extensions, pif, flutter, planning, epic, github, app-builder]
timestamp: 2026-08-23T11:00:00Z
generated_at: 2026-08-23T11:00:00Z
generated_by: planning-session
session_id: pending
commit_sha: []
branch: master
issue_refs: [152, 153, 154, 155, 156, 157, 158, 159, 160]
epic_refs: [152]
capture_tier: session
---

# What Was Done

Planned the next pif epic from Tony's product direction: pif stops being just an IDE and becomes the foundation applications are built on. Published Epic #152 → Sprint #153 → Tasks #154–#160 on GitHub in the repo's epic/sprint/task conventions. Closed #130 (global installable host environment) as superseded — its remaining scope (global catalog, per-project overlays, `pif init`) is absorbed by tasks #155 and #157.

## Product shape settled at planning

- A target project owns its app: a `pif_app/` tree with an `app.yaml` manifest and its own widgets, versioned in the project repo. Widget sources become layered: base → global catalog (`~/.pi/pif/catalog/`) → project overlay, with id shadowing and provenance through list/store/registry.
- Pages are widgets (`slot: page`); the home page is declared once in the app manifest. The shell gains an app runtime mode (page stage + navigation) with full IDE docking behind a dev toggle.
- The agentic build flow (brief → foundations → widget-extensions → pages) rides the existing dogfood-proven loop (create → write Dart → analyze gate → live reload) through child sessions.
- Export compiles a project into a standalone **agentic** application: AOT Flutter app bundling Node + pi + the pif hub, booting straight to its home page. **Owner decision: built apps always carry the agentic runtime; a pi-free export lane is explicitly not pursued.**

# Alignment Review (the QA pass that opened the epic)

Reused the two weeks of prior work as the foundation: install pipeline + analyze gate (#124/#132) is the widget engine; hub auth + scrubbed env (#134/#133) ships inside exported apps; standalone bundling + re-sign (#136) and app-owned pi lifecycle (#143/#144) are the export skeleton; session manager (#123) drives the build flow. Gaps found and scoped: no page/home concept (slots are docks only), widget source is global-not-per-project, the build script compiles only the stock IDE registry, and nothing orchestrates the loop at application scale. Formal audit + spec rewrite is task #154.

# Decisions Made

- Built apps bundle pi always (Tony's call, asked at planning); pi-free exports are a non-goal of this sprint.
- Pages are widgets under the unchanged contract — no second widget type; home lives in the app manifest, not the widget.
- Export uses a pinned registry (AOT freezes the widget set); installing new widgets into shipped apps stays deferred to the RFW lane.
- Bundled pi ships without dev models/API keys; first-run provisioning on the target machine; secrets scan is export acceptance.
- Largest recorded risk: the export template consuming shell core ("shell-as-package") — if it forces extracting a `pif_core` package, that is a line-stop and replan, not improvisation.
- Roadmap realigned on the tracker (follow-up pass): the spec's original Phase 2 → 3 order is superseded on epic #152's "Roadmap Realignment" section — layout presets and diff viewer recorded as already done; Phase 3 packaging pulled forward into #159; Phase 2 on-demand builds subsumed by #158; the remainder re-sequenced as deferred Sprint 2 (Ecosystem: remote git catalogs on #155's layered sources, per-widget settings, theming, file-explorer via the agentic flow) and Sprint 3 (Platform & sharing: coms/council sharing depending on epic #112, trust/signing, RFW lane for shipped AOT apps, multi-window). Task #154 owns writing this into the spec so spec and tracker tell one story; linkage comments left on #120 and #112.

# Lessons Learned

- gh issue create fails outside a git repo ("failed to run git") — create tracker issues from the repo cwd, not /tmp.
- The existing epic body format (#120) plus task format (#124) transfers cleanly to a product-shift epic; the Reference Index pattern keeps every task anchored to spec sections that task #154 will rewrite.

# Current State

- Epic #152, sprint #153, tasks #154–#160 open and cross-referenced; #130 closed as superseded; design spec header back-references the successor epic.
- Lanes: #154 first; then #155 (hub/TS) ∥ #156 (shell/Dart); #157 after #155; #158 after #156+#157; #159 after #156+#157; #160 last.
- Next action: run task #154 (QA alignment audit + app-builder model in the design spec) in a governed sprint workspace.
