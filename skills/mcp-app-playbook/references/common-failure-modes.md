# Common MCP App Failure Modes

| Symptom | Likely Cause | First Checks | Typical Fix |
| --- | --- | --- | --- |
| Tool appears locally but not in external client | Wrong endpoint or stale connector cache | compare `tools/list` locally vs public | unify endpoint or reconnect the external app |
| Widget shell renders but shows empty/default state | widget never consumed host globals/tool output | inspect `widgetState`, `toolOutput`, late globals | add dual-bridge hydration and delayed bootstrap |
| External session list shows nonsense IDs | transport ID shown instead of app session | inspect headers vs structured content | track and display app/business session ID |
| Multiple “active sessions” from one action | repeated initialize/reconnect behavior or stale session bookkeeping | inspect raw `Mcp-Session-Id` churn and DELETE behavior | collapse or prune transport sessions and surface the app session |
| Fix exists on disk but behavior is unchanged | stale runtime process | compare file mtime/version to live version | restart the real serving process |
| Public route works but widget actions fail | host bridge method mismatch | inspect whether host is `window.openai` or local app bridge | support both bridge surfaces explicitly |
| Board/tool opens but shows fallback mode | backend returned fallback data or widget never applied payload | inspect structured content counts, warnings, and error fields | fix server payload or hydration path depending on where data disappears |
| Lane/model context gets flooded with huge payloads | missing data contract or overly broad tool response | inspect default output shape and raw collection sizes | move bulk data server-side and return summaries, filters, or targeted queries |
