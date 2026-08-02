import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import {
  applyInstall,
  buildPluginArchive,
  exportCustomGpt,
  linkRegisteredApp,
  planInstall,
  scaffoldPlugin,
  validatePlugin,
} from "../src/index.js";
import type { PluginManifest, PluginTemplate } from "../src/types.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "chatgpt-spawn-test-"));
  temporaryRoots.push(root);
  return root;
}

async function scaffold(template: PluginTemplate, name = `fixture-${template}`): Promise<string> {
  const parent = await tempRoot();
  const root = join(parent, name);
  await scaffoldPlugin({
    root,
    template,
    name,
    description: "Create a safe and deterministic test workflow.",
    author: "Test Publisher",
    repositoryUrl: "https://github.com/AgentMindCloud/ChatGPT_Universal_Spawn",
    ...(template === "mcp" || template === "mcp-ui" ? { mcpUrl: "https://mcp.example.test/mcp" } : {}),
    ...(template === "custom-gpt-action" ? { actionBaseUrl: "https://api.example.test" } : {}),
  });
  return root;
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("golden templates", () => {
  for (const template of ["skill", "mcp", "mcp-ui", "custom-gpt-action"] as const) {
    it(`scaffolds and validates ${template}`, async () => {
      const root = await scaffold(template);
      const report = await validatePlugin(root, { profile: "local" });
      expect(report.status).toBe("valid");
      expect(report.errors).toEqual([]);
      expect(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8")).not.toContain("[TODO:");
    });
  }

  it("rejects incomplete non-empty targets", async () => {
    const parent = await tempRoot();
    const root = join(parent, "occupied");
    await mkdir(root);
    await writeFile(join(root, "keep.txt"), "user data");
    await expect(scaffoldPlugin({ root, template: "skill", name: "occupied", description: "A complete description.", author: "Test", repositoryUrl: "https://github.com/AgentMindCloud/occupied" })).rejects.toThrow("not empty");
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("user data");
  });

  it("requires real template-specific endpoints", async () => {
    const parent = await tempRoot();
    await expect(scaffoldPlugin({
      root: join(parent, "missing-endpoint"),
      template: "mcp",
      name: "missing-endpoint",
      description: "A complete MCP description.",
      author: "Test",
      repositoryUrl: "https://github.com/AgentMindCloud/missing-endpoint",
    })).rejects.toThrow("MCP URL is required");
    await expect(scaffoldPlugin({
      root: join(parent, "placeholder-endpoint"),
      template: "custom-gpt-action",
      name: "placeholder-endpoint",
      description: "A complete Action description.",
      author: "Test",
      repositoryUrl: "https://github.com/AgentMindCloud/placeholder-endpoint",
      actionBaseUrl: "https://api.example.com",
    })).rejects.toThrow("example.com placeholder");
  });
});

describe("validation and adversarial inputs", () => {
  it("rejects traversal, secrets, debug payloads, and unknown manifest fields", async () => {
    const root = await scaffold("skill", "unsafe-plugin");
    const manifestPath = join(root, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifest & { unsupported?: boolean };
    manifest.interface.logo = "./assets/../../outside.svg";
    manifest.unsupported = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(root, ".env"), "SERVICE_TOKEN=not-a-real-secret\n");
    await writeFile(join(root, "debug.log"), "request payload\n");
    await writeFile(join(root, "certificate.pem"), "not a real certificate\n");
    const report = await validatePlugin(root, { profile: "local" });
    expect(report.status).toBe("invalid");
    expect(report.errors.map((item) => item.code)).toEqual(expect.arrayContaining([
      "plugin.schema",
      "path.escape",
      "secret.env-file",
      "archive.debug-payload",
      "secret.key-file",
    ]));
  });

  it("uses manual_required only after automated publish checks pass", async () => {
    const root = await scaffold("skill", "publish-ready");
    const manifestPath = join(root, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifest;
    manifest.interface.websiteURL = "https://github.com/AgentMindCloud/ChatGPT_Universal_Spawn";
    manifest.interface.privacyPolicyURL = "https://github.com/AgentMindCloud/ChatGPT_Universal_Spawn/blob/main/PRIVACY.md";
    manifest.interface.termsOfServiceURL = "https://github.com/AgentMindCloud/ChatGPT_Universal_Spawn/blob/main/TERMS.md";
    manifest.interface.composerIcon = "./assets/icon.svg";
    manifest.interface.logo = "./assets/logo.svg";
    manifest.interface.logoDark = "./assets/logo-dark.svg";
    await mkdir(join(root, "assets"));
    for (const name of ["icon.svg", "logo.svg", "logo-dark.svg"]) await writeFile(join(root, "assets", name), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const report = await validatePlugin(root, { profile: "publish" });
    expect(report.errors).toEqual([]);
    expect(report.status).toBe("manual_required");
    expect(report.manualChecks).toHaveLength(3);
  });

  it("validates linked app IDs and exact app fields", async () => {
    const root = await scaffold("mcp-ui", "linked-app");
    await expect(linkRegisteredApp(root, "fake-app-id")).rejects.toThrow("plugin_asdk_app");
    const linked = await linkRegisteredApp(root, "plugin_asdk_app_test_123");
    expect(linked.appId).toBe("plugin_asdk_app_test_123");
    expect((await validatePlugin(root)).status).toBe("valid");
  });

  it("rejects unsafe MCP transport configuration", async () => {
    const root = await scaffold("mcp", "unsafe-mcp");
    await writeFile(join(root, ".mcp.json"), JSON.stringify({ mcpServers: {
      unsafe: { type: "http", url: "http://localhost:3000/mcp", env: { API_TOKEN: "literal-secret" } },
      embedded: { type: "http", url: "https://user:password@mcp.example.test/mcp" },
    } }));
    const report = await validatePlugin(root);
    expect(report.status).toBe("invalid");
    expect(report.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["mcp.server.url", "mcp.server.credentials", "mcp.server.env-reference"]));
  });

  it("rejects Custom GPT actions without operation IDs", async () => {
    const root = await scaffold("custom-gpt-action", "unsafe-action");
    const actionPath = join(root, "custom-gpt", "openapi.yaml");
    const original = await readFile(actionPath, "utf8");
    await writeFile(actionPath, original.replace("      operationId: getItem\n", ""));
    const report = await validatePlugin(root);
    expect(report.status).toBe("invalid");
    expect(report.errors.map((item) => item.code)).toContain("custom-gpt.openapi.operation-id");
  });
});

describe("deterministic build", () => {
  it("produces byte-identical archives and excludes development content", async () => {
    const root = await scaffold("skill", "deterministic-plugin");
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "ignored");
    const parent = await tempRoot();
    const first = await buildPluginArchive(root, { out: join(parent, "first.zip") });
    const second = await buildPluginArchive(root, { out: join(parent, "second.zip") });
    expect(first.sha256).toBe(second.sha256);
    expect(Buffer.compare(await readFile(first.archivePath), await readFile(second.archivePath))).toBe(0);
    const entries = Object.keys(unzipSync(new Uint8Array(await readFile(first.archivePath))));
    expect(entries.some((path) => path.includes(".git"))).toBe(false);
    expect(entries.some((path) => path.startsWith("submission/"))).toBe(false);
  });

  it("rejects build output inside its own source tree", async () => {
    const root = await scaffold("skill", "recursive-archive");
    await expect(buildPluginArchive(root, { out: join(root, "plugin.zip") })).rejects.toThrow("outside the plugin source tree");
  });
});

describe("marketplace installation", () => {
  it("plans, applies, and detects repository marketplace conflicts", async () => {
    const root = await scaffold("skill", "installable-plugin");
    const repoRoot = await tempRoot();
    const plan = await planInstall(root, { marketplace: "repo", repoRoot });
    expect(plan.conflicts).toEqual([]);
    expect(plan.before).toBeNull();
    const result = await applyInstall(plan, { confirmed: true });
    expect(result.installed).toBe(true);
    expect(JSON.parse(await readFile(result.marketplacePath, "utf8")).plugins[0].source.path).toBe("./plugins/installable-plugin");
    const conflict = await planInstall(root, { marketplace: "repo", repoRoot });
    expect(conflict.conflicts.length).toBeGreaterThan(0);
    await expect(applyInstall(conflict, { confirmed: true })).rejects.toThrow("unresolved conflicts");
  });

  it("never applies an unconfirmed plan", async () => {
    const root = await scaffold("skill", "confirmation-plugin");
    const repoRoot = await tempRoot();
    const plan = await planInstall(root, { marketplace: "repo", repoRoot });
    await expect(applyInstall(plan, { confirmed: false })).rejects.toThrow("explicit confirmation");
  });

  it("rejects a stale preview when the marketplace changes", async () => {
    const root = await scaffold("skill", "fenced-plugin");
    const repoRoot = await tempRoot();
    const plan = await planInstall(root, { marketplace: "repo", repoRoot });
    await mkdir(dirname(plan.marketplacePath), { recursive: true });
    await writeFile(plan.marketplacePath, '{"name":"changed","plugins":[]}\n');
    await expect(applyInstall(plan, { confirmed: true })).rejects.toThrow("changed after preview");
  });
});

describe("Custom GPT export", () => {
  it("copies byte-identical artifacts and writes a manual checklist with checksums", async () => {
    const root = await scaffold("custom-gpt-action", "custom-gpt-fixture");
    const outParent = await tempRoot();
    const result = await exportCustomGpt(root, { out: join(outParent, "export") });
    expect(result.files).toEqual(expect.arrayContaining(["instructions.md", "conversation-starters.md", "EDITOR-CHECKLIST.md", "SHA256SUMS"]));
    expect(await readFile(join(result.out, "instructions.md"), "utf8")).toBe(await readFile(join(root, "custom-gpt", "instructions.md"), "utf8"));
    expect(await readFile(result.checksumPath, "utf8")).toContain("instructions.md");
  });

  it("rejects colliding knowledge export destinations", async () => {
    const root = await scaffold("custom-gpt-action", "collision-action");
    await mkdir(join(root, "other"));
    await writeFile(join(root, "other", "README.md"), "different knowledge\n");
    const configPath = join(root, "custom-gpt", "export.yaml");
    const config = await readFile(configPath, "utf8");
    await writeFile(configPath, config.replace('  - "./custom-gpt/knowledge/README.md"', '  - "./custom-gpt/knowledge/README.md"\n  - "./other/README.md"'));
    const outParent = await tempRoot();
    await expect(exportCustomGpt(root, { out: join(outParent, "export") })).rejects.toThrow("collision");
  });
});

describe("repository fixtures", () => {
  it("self-validates the companion and canonical examples", async () => {
    for (const path of ["plugin/chatgpt-universal-spawn", "examples/meeting-follow-up", "examples/project-launch-planner"]) {
      expect((await validatePlugin(resolve(REPOSITORY_ROOT, path))).status).toBe("valid");
    }
  });

  it("uses documented CLI exit codes 0, 1, and 2", async () => {
    const cli = resolve(REPOSITORY_ROOT, "dist/cli.js");
    const run = (args: string[]) => new Promise<number>((resolveExit, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (code) => resolveExit(code ?? -1));
    });
    expect(await run(["validate", resolve(REPOSITORY_ROOT, "examples/meeting-follow-up"), "--profile", "local"])).toBe(0);
    expect(await run(["validate", resolve(REPOSITORY_ROOT, "tests/fixtures/invalid-plugin"), "--profile", "local"])).toBe(1);
    expect(await run(["validate", resolve(REPOSITORY_ROOT, "examples/meeting-follow-up"), "--profile", "publish"])).toBe(2);
  });
});
