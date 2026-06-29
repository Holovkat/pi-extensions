# Architecture Concepts

How the system is structured: data models, infrastructure, provider hierarchy, deployment topology.

| Title | Description | Tags | Status |
|-------|-------------|------|--------|
| [Two-Phase Pipeline System Architecture](./system-architecture.md) | Overall system design: req-qa -> dev-pipeline | pi-extensions, architecture, pipeline, sdlc | active |
| [Agent Subprocess Execution Model](./agent-subprocess-execution.md) | RPC mode, stdin/stdout, steering, session reuse | pi-extensions, architecture, rpc, subprocess | active |
| [Fast Track Pipeline Architecture](./fast-track-architecture.md) | Default lean pipeline: build, evaluate, fix, UAT | pi-extensions, architecture, fast-track | active |
| [Three-Wave Pipeline Architecture](./three-wave-architecture.md) | Thorough multi-wave pipeline: council, prototype, dev | pi-extensions, architecture, three-wave | active |
| [Networked Council Architecture](./council-architecture.md) | Networked request/response council over Bun hub | pi-extensions, architecture, council, networked | active |
| [Pipeline State System](./pipeline-state-system.md) | State file, dashboards, observer mode, control socket | pi-extensions, architecture, state, dashboard | active |
| [GitHub Integration Layer](./github-integration.md) | Issue publishing, learnings, enrichment, rebuild | pi-extensions, architecture, github, issues | active |
| [Model Configuration System](./model-configuration.md) | Per-role models, escalation, thinking levels, ping test | pi-extensions, architecture, models, configuration | active |
