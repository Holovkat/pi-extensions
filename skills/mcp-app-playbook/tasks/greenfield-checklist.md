# Greenfield MCP App Checklist

## Discovery

- [ ] Confirm whether the feature should live in an existing app or a new one
- [ ] Confirm internal-only vs external-facing requirements
- [ ] Record the data contract: input scope, output scope, ownership, mutation authority, transfer limits
- [ ] Record the transport/session model
- [ ] Record required tools and widget resources

## Server

- [ ] Implement tool registration
- [ ] Implement resource/widget registration
- [ ] Support required transport mode(s)
- [ ] Add close/delete handling

## Widget

- [ ] Implement widget payload normalization
- [ ] Support local host bridge
- [ ] Support OpenAI/external host globals
- [ ] Handle late initialization

## Exposure

- [ ] Verify endpoint shape matches product expectation
- [ ] If external, verify public route exists and serves the same tools
- [ ] If multiple features belong together, combine them before release

## Lane / Token Discipline

- [ ] Default lane responses to compact summaries or targeted result sets
- [ ] Keep large raw collections behind query or pagination paths
- [ ] Confirm high-volume data stays server-side unless explicitly requested

## Validation

- [ ] `initialize`
- [ ] `tools/list`
- [ ] open-tool call
- [ ] widget hydration
- [ ] session alignment
- [ ] delete/cleanup
- [ ] local/public comparison if applicable
- [ ] compact lane-facing output on representative high-volume paths
