## Goal
Add a first-class **“who / what is connected”** view that is owned by the PI extension runtime, not a separate ad-hoc server, and expose it in the surfaces you chose:
- **Web page**
- **Slash command**

It will cover **all active connection types** with **status + timestamps**:
- PI control-session agents
- PI inline/generated app runtimes
- PI-hosted MCP servers
- External MCP client sessions hitting PI-hosted routes

## Proposed design

### 1. Make `toolshed-dashboard-web` the live source of connection truth
Use the runtime maps it already owns (`registeredAgents`, `generatedAppInstances`, `hostedMcpServers`) and add a new in-memory tracker for **external MCP sessions** seen through `/mcp/servers/:serverId`.

For each category, track active rows with timestamps:
- **PI agents**: `agentId`, `sessionKey`, `registeredAt`, `lastTouchedAt`
- **Inline app runtimes**: `cardId`, `title`, `serverId`, `itemId`, `sessionId`, `openedAt`, `lastTouchedAt`
- **Hosted MCP servers**: `serverId`, `mode` (`managed`/`remote`), `route`, `startedAt`, `lastTouchedAt`
- **External MCP sessions**: `serverId`, `sessionId`, `source` (`local`/`public`), `openedAt`, `lastSeenAt`

Because you want **active only**, external sessions will be removed on:
- explicit MCP session deletion
- process/server shutdown
- idle timeout pruning

### 2. Add a PI web Connections page
Add a new page, likely `/connections`, alongside the existing lane/registry UI in `bin/toolshed-dashboard-web`.

Page contents:
- top summary counts
- 4 sections: Agents, Inline Apps, Hosted MCP Servers, External MCP Sessions
- one row/card per active connection with status pills and timestamps
- empty-state copy when a section has no active entries

Styling will reuse the existing registry/dashboard card patterns so it feels native to Toolshed.

### 3. Add a live API for connection state
Expose a new read-only endpoint, e.g.:
- `/api/connections`

and also include the same ephemeral `connections` block in `/api/state` so the web page can render it without changing the persisted state-file ownership model.

This keeps connection state **live and PI-owned** without writing transient connection data into the extension’s persisted JSON file.

### 4. Add a slash command in `pi-toolshed.ts`
Add `/toolshed-connections` that fetches the live roster from the local Toolshed web API and prints a compact summary such as:
- connected PI agents
- active inline app runtimes
- hosted MCP servers
- external MCP sessions
- local URL to open the full Connections page

This gives you a terminal/native PI way to inspect the same live data.

## Implementation outline

1. **`bin/toolshed-dashboard-web`**
   - add external-session tracking map
   - add timestamp fields to existing runtime maps where missing
   - update MCP proxy flow to record session start/touch/close
   - add idle-prune logic for active-only session visibility
   - add `/api/connections`
   - add `/connections` page + nav entry + renderer

2. **`extensions/pi-toolshed.ts`**
   - add `/toolshed-connections`
   - fetch and summarize live connection data from local Toolshed web API
   - include a shortcut/open message to the Connections page

## Validation
- `node --check bin/toolshed-dashboard-web`
- `npx -y -p esbuild esbuild extensions/pi-toolshed.ts --platform=node --format=esm --log-level=error >/dev/null`
- verify `/api/connections` locally
- verify `/connections` renders correctly
- verify `/toolshed-connections` prints the live roster
- verify external requests through the PI-owned MCP route show up as active sessions

## Expected result
After this change, you’ll have a PI-native answer to:
- “Is PI itself connected?”
- “Which apps/runtimes are active inside PI?”
- “Which hosted MCP servers is PI serving right now?”
- “Are external clients currently hitting those PI-hosted MCP routes?”