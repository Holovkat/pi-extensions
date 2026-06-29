---
type: Process
title: Installation Guide
description: Installation steps, shell aliases, and prerequisites for setting up pi-extensions.
resource: ./README.md
tags: [pi-extensions, process, installation, setup, aliases, prerequisites]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Installation Guide

## Prerequisites

- [pi coding agent CLI](https://github.com/nichochar/pi) installed globally
- Node.js 20+
- GitHub CLI (`gh`) authenticated for issue publishing
- tmux (for log panes and dashboard)
- Bun (for the embedded/local `council` hub server)
- glow (optional, for `/req-prd` markdown rendering)

## Installation Steps

```bash
# 1. Clone into your workspace
git clone <repo-url> ~/workspace/pi-extensions

# 2. Symlink to ~/.pi-init (where pi loads from)
ln -sf ~/workspace/pi-extensions/extensions ~/.pi-init/extensions
ln -sf ~/workspace/pi-extensions/agents/req-qa/* ~/.pi-init/agents/
ln -sf ~/workspace/pi-extensions/agents/dev-pipeline/* ~/.pi-init/agents/
ln -sf ~/workspace/pi-extensions/bin/pipeline-dashboard ~/.pi-init/bin/pipeline-dashboard
ln -sf ~/workspace/pi-extensions/bin/pipeline-dashboard-web ~/.pi-init/bin/pipeline-dashboard-web
ln -sf ~/workspace/pi-extensions/bin/blueprint-dashboard-web ~/.pi-init/bin/blueprint-dashboard-web
ln -sf ~/workspace/pi-extensions/bin/toolshed-dashboard-web ~/.pi-init/bin/toolshed-dashboard-web

# 3. Install dependencies
cd ~/.pi-init && npm install @mariozechner/pi-tui

# 4. Add aliases to ~/.zshrc
_PIX="$HOME/.pi-init/extensions"
alias pi-dev='pi -ne -e "$_PIX/dev-pipeline.ts" -e "$_PIX/theme-cycler.ts"'
alias pi-req='pi -ne -e "$_PIX/req-qa.ts" -e "$_PIX/theme-cycler.ts"'
alias pi-blueprint='pi -ne -e "$_PIX/pi-blueprint.ts" -e "$_PIX/theme-cycler.ts"'
alias pi-council='pi --no-extensions -e "$_PIX/council.ts"'
alias pi-dash='~/.pi-init/bin/pipeline-dashboard'
alias pi-web='~/.pi-init/bin/pipeline-dashboard-web'

# 5. Install glow for PRD rendering (optional)
brew install glow
```

## Shell Aliases

| Alias | Purpose |
|-------|---------|
| `pi-req` | Launch requirements discovery session |
| `pi-dev` | Launch sprint development pipeline |
| `pi-blueprint` | Launch the Blueprint planning cockpit |
| `pi-council` | Launch a Pi session with the networked council extension |
| `pi-dash` | Launch standalone terminal dashboard |
| `pi-web` | Launch Pipeline Control Center (web, port 3141) |

## Related Concepts

- [Commands Reference](./commands-reference.md)
- [System Architecture](../architecture/system-architecture.md)
- [Council Extension](../components/council-extension.md)
