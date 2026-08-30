---
name: pif-app-builder
description: >
  pif agentic build flow: take the owner's brief for a pif app and carry it
  all the way to a working application inside the pif shell — design pass
  (pif-app-designer), owner approval, pif_app_init (optionally --template
  mercury), then page/widget scaffolding through the analyzer gate, with
  compiler diagnostics round-tripping to the owner. Zero manual file
  editing at any point. Use when the owner gives a brief for a new pif app,
  or asks to build/extend an app declared by pif_app/app.yaml.
---

# pif App Builder (agentic build flow)

You are running the **build loop** of the pif app-builder. The design pass
(`pif-app-designer` skill) has already produced `pif_app/design.md` and the
owner approved it — that plan is law for everything below. If `design.md`
does not exist or was never approved, STOP and run the design pass first;
never improvise layout inside the build loop.

## Guardrails

1. **Zero manual file editing.** Every artifact is created by a pif tool
   (`pif_app_init`, `pif_app_page_add`, `pif_app_widget_add`,
   `pif_app_home_set`) or by the analyzer-gated install pipeline. If you
   find yourself wanting to hand-edit a generated file, stop and re-plan
   the piece instead.
2. **Complexity gate: ≤ 5 per piece.** One page or one widget per
   scaffolding call. A piece that needs "and" is two pieces. Add
   sophistication by composing more small pieces, not by growing one.
3. **Diagnostics round-trip.** Every `pif_app_*` call that installs code
   passes through the `dart analyze` gate. When it rejects, the compiler
   diagnostics come back to you — fix the piece at the tool level
   (re-scaffold, adjust) and retry. Never bypass the gate.
4. **The plan binds.** Pages, components, and token bindings come from
   `design.md`. If reality demands a change to the plan itself, stop,
   update `design.md`, and get the owner's approval again — then resume.

## Procedure

1. **Confirm the plan.** Read `pif_app/design.md`. Restate to the owner:
   pages (in order), the home page, components per page, and the storage
   decision. Wait for "go".
2. **Scaffold the app.**
   `pif_app_init` with `{ name: <app name>, template: <template id from the
   plan, e.g. mercury> }`. This writes `pif_app/app.yaml`, pins the
   template layers into `pif_app/template/`, scaffolds the Home page, and
   installs it through the analyzer gate. Report the init result.
3. **Add pages in plan order.** For each page after Home (in the order the
   plan declares): `pif_app_page_add` with `{ name, id }` (id = the plan's
   page id, snake_case). Each page installs through the gate; report any
   diagnostics and their resolution.
4. **Add widget-extensions.** For each widget-extension in the plan:
   `pif_app_widget_add` with `{ name, id, slot }`. Then flesh out each
   piece: re-enter the piece with the owner (or a child session with a
   scoped brief: the page's job, its components from the template kit, its
   token bindings) and iterate on the generated `.dart` through
   `pif_widget_create` / `pif_widget_install` — small pieces, gate every
   round, diagnostics round-trip visibly.
5. **Confirm the home page.** `pif_app_home_set` if the plan's home differs
   from the scaffold; otherwise confirm `pif_app_list` shows every plan
   page installed and enabled.
6. **Hand the app to the owner.** The shell boots the app's home page
   (app mode). Walk the owner through the pages. Anything the owner wants
   changed goes through the loop again as new small pieces — or back to
   the design pass if it changes the plan.
7. **Record the run.** Transcripts of the brief → build → owner walkthrough
   are the run's evidence. Note anything the flow made awkward; that is
   next-sprint input, not a manual-edit invitation.

## Child sessions

For pieces worth parallel attention, dispatch a child session with a
scoped brief: one piece, its plan section, the template kit, and the exact
tools it may call. The child never edits files directly — it closes its
piece through the same gated tools and reports diagnostics.

## Output

Report: pages and widgets installed (with their analyzer-gate results),
deviations from the plan (should be none without a re-pass), and the
owner walkthrough status.
