import type { Diagnostic } from "./types.js";

interface JsonRpcResponse {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

function parseJsonRpcBody(body: string): JsonRpcResponse {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonRpcResponse;
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  for (const line of dataLines.reverse()) {
    if (line.startsWith("{")) return JSON.parse(line) as JsonRpcResponse;
  }
  throw new Error("MCP endpoint returned neither JSON nor JSON-RPC SSE data.");
}

async function rpc(
  url: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<{ response: JsonRpcResponse; sessionId?: string }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const httpResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!httpResponse.ok) {
    throw new Error(`MCP endpoint returned HTTP ${httpResponse.status}.`);
  }
  const nextSession = httpResponse.headers.get("mcp-session-id") ?? sessionId;
  const parsed = parseJsonRpcBody(await httpResponse.text());
  return nextSession ? { response: parsed, sessionId: nextSession } : { response: parsed };
}

async function notify(url: string, method: string, sessionId?: string): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`MCP ${method} notification returned HTTP ${response.status}.`);
}

export async function inspectMcpEndpoint(url: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  try {
    const initialized = await rpc(url, 1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "chatgpt-spawn", version: "0.1.0" },
    });
    if (initialized.response.error) {
      throw new Error(initialized.response.error.message ?? "MCP initialize failed.");
    }
    await notify(url, "notifications/initialized", initialized.sessionId);
    const listed = await rpc(url, 2, "tools/list", {}, initialized.sessionId);
    if (listed.response.error) {
      throw new Error(listed.response.error.message ?? "MCP tools/list failed.");
    }
    const tools = listed.response.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      diagnostics.push({
        code: "mcp.tools.empty",
        severity: "error",
        path: "submission/chatgpt-submission.yaml#mcpURL",
        message: "The MCP endpoint did not advertise any tools.",
      });
      return diagnostics;
    }
    for (const [index, rawTool] of tools.entries()) {
      const tool = rawTool as Record<string, unknown>;
      const name = typeof tool.name === "string" ? tool.name : `tool-${index}`;
      if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
        diagnostics.push({
          code: "mcp.tool.input-schema",
          severity: "error",
          path: `mcp.tools.${name}`,
          message: `Tool ${name} is missing an input schema.`,
        });
      }
      const annotations = tool.annotations as Record<string, unknown> | undefined;
      for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint"] as const) {
        if (typeof annotations?.[hint] !== "boolean") {
          diagnostics.push({
            code: `mcp.tool.annotation.${hint}`,
            severity: "error",
            path: `mcp.tools.${name}.annotations.${hint}`,
            message: `Tool ${name} must declare an accurate boolean ${hint}.`,
            helpUrl: "https://developers.openai.com/plugins/deploy/submission#final-checklist",
          });
        }
      }
    }
  } catch (error) {
    diagnostics.push({
      code: "mcp.inspect.failed",
      severity: "error",
      path: "submission/chatgpt-submission.yaml#mcpURL",
      message: error instanceof Error ? error.message : String(error),
      helpUrl: "https://developers.openai.com/plugins/build/mcp-server",
    });
  }
  return diagnostics;
}
