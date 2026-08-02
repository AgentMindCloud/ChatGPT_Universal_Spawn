import { createInterface } from "node:readline";

const plan = {
  project: "Northstar demo",
  launchDate: "2026-09-15",
  milestones: [
    { name: "Requirements", owner: "Avery", status: "complete" },
    { name: "Security review", owner: "Morgan", status: "blocked", reason: "Threat model not approved" },
    { name: "Launch rehearsal", owner: "Riley", status: "planned" }
  ]
};

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === "initialize") {
    reply(request.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "project-launch-planner", version: "0.1.0" } });
  } else if (request.method === "tools/list") {
    reply(request.id, { tools: [{ name: "get_launch_plan", description: "Return fixed credential-free demonstration launch data.", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] });
  } else if (request.method === "tools/call" && request.params?.name === "get_launch_plan") {
    reply(request.id, { content: [{ type: "text", text: JSON.stringify(plan) }], structuredContent: plan });
  }
});
