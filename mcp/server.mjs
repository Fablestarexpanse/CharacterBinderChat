#!/usr/bin/env node
// ─── FableChat MCP server ─────────────────────────────────────────────────────
// Lets an MCP client (Claude Code, Claude Desktop, …) create and edit characters,
// lorebooks, personas and scenarios in a running FableChat. It talks to the app's
// HTTP API, so changes land on the server and open tabs pick them up — there is no
// pairing step and no second copy of the library.
//
//   claude mcp add fablechat -- node /absolute/path/to/mcp/server.mjs
//
// Environment:
//   FABLE_URL       where FableChat is running   (default http://127.0.0.1:3000)
//   FABLE_PASSWORD  only if FableChat was started with FABLE_PASSWORD

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildTools, makeCall } from "./tools.mjs";

const server = new McpServer({ name: "fablechat", version: "1.0.0" });

// Who made a change is shown to the user ("Claude Code created character …"), so
// use the connecting client's own name rather than a generic label.
const source = () => server.server.getClientVersion()?.name ?? "agent";
const call = makeCall({
  baseUrl: process.env.FABLE_URL ?? "http://127.0.0.1:3000",
  password: process.env.FABLE_PASSWORD,
  source,
});

for (const tool of buildTools(call)) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (args) => {
      try {
        const result = await tool.handler(args ?? {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        // A failure is data the agent can act on, not a protocol error
        return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
