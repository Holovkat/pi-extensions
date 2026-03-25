# Greenfield MCP App Checklist

## Discovery

- [ ] Confirm whether the feature should live in an existing app or a new one
- [ ] Confirm internal-only vs external-facing requirements
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

## Validation

- [ ] `initialize`
- [ ] `tools/list`
- [ ] open-tool call
- [ ] widget hydration
- [ ] session alignment
- [ ] delete/cleanup
- [ ] local/public comparison if applicable
