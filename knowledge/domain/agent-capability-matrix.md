---
type: Domain
title: Agent Capability Matrix
description: Tool access matrix for all pipeline and specialist agents — only dev and prd-writer have write access; all others are read-only by design.
resource: ./README.md
tags: [pi-extensions, domain, agents, capabilities, tools, matrix, read-only]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Agent Capability Matrix

Agent definitions live in `agents/` as markdown files with YAML frontmatter specifying `name`, `description`, and `tools`. The extensions scan three directories (first match wins):

1. `<project>/.pi/agents/` — project-specific overrides
2. `~/.pi/agent/agents/` — pi global agents
3. `~/.pi-init/agents/` — custom agents (this repo)

## Tool Access Matrix

| Agent | read | write | edit | bash | grep | find | ls |
|-------|------|-------|------|------|------|------|----|
| dev | YES | YES | YES | YES | YES | YES | YES |
| compliance | YES | | | YES | YES | YES | YES |
| analyst | YES | | | | YES | YES | YES |
| reviewer | YES | | | YES | YES | YES | YES |
| lint-build | YES | | | YES | YES | YES | YES |
| tester | YES | | | YES | YES | YES | YES |
| uat-signoff | YES | | | YES | YES | YES | YES |
| sharder | YES | | | | YES | YES | YES |
| req-analyst | YES | | | YES | YES | YES | YES |
| tech-analyst | YES | | | YES | YES | YES | YES |
| ux-analyst | YES | | | | YES | YES | YES |
| scenario-analyst | YES | | | YES | YES | YES | YES |
| prd-writer | YES | YES | | | YES | YES | YES |

## Design Principle

Only `dev` and `prd-writer` have write access. All other agents are read-only by design — they analyze and report, they do not modify. This prevents evaluation agents from silently changing code during scoring.

## Related Concepts

- [Read-Only Agents by Design](../decisions/read-only-agents-by-design.md)
- [Specialist Agents](./specialist-agents.md)
- [Pipeline Agents](./pipeline-agents.md)
- [Agent Subprocess Execution](../architecture/agent-subprocess-execution.md)
