# Phase 1 Diff Viewer dogfood

The Phase 1 exit widget is `lib/widgets/diff_viewer/`. It uses only the public `PifWidgetPlugin`/`PifHost` contract and is non-core.

The repeatable integration record is `extensions/pif.integration.test.mjs`. In a temporary copy of the real app it:

1. starts the real pif hub through Pi with Flutter launch disabled;
2. invokes the same control methods exposed by `pif_widget_create` to scaffold `diff_viewer`;
3. writes ordinary Dart implementation source;
4. invokes the same analyze-gated pipeline exposed by `pif_widget_install`;
5. asserts clean compiler diagnostics and generated registry state;
6. opens the widget through the same control method exposed by `pif_layout`;
7. requests a fresh shell snapshot and verifies the Diff Viewer is installed and enabled.

The repository version adds editable Before/After inputs and a line-oriented red/green comparison, proving the resulting widget is usable rather than a placeholder. Interactive Agent Console invocation and visual confirmation remain the Dev UAT flow; the automated T2 smoke proves the full underlying tool path without using a model or mutating the working tree.
