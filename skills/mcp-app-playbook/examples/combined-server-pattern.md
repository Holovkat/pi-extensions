# Example: Combined MCP Server Pattern

Use this pattern when multiple user-facing features must appear under one external app entry.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFeatureA } from "./feature-a/server.ts";
import { registerFeatureB } from "./feature-b/server.ts";

export function createCombinedServer() {
  const server = new McpServer({
    name: "my-app",
    version: "0.1.0",
  });

  registerFeatureA(server);
  registerFeatureB(server);
  return server;
}
```

## Why This Worked Better

- one connector namespace
- one `tools/list`
- one hosting/deployment path
- one place to add shared transport logic

## When Not To Use It

- when the product explicitly wants separate apps
- when permissions or tenancy must be isolated by endpoint
