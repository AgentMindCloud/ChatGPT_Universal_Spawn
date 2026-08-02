import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { PersonalChatExportOptions, PersonalChatExportResult, PluginManifest } from "./types.js";
import { assertInside, atomicWrite, isInside, pathExists, readJson, sha256, walkFiles } from "./utils.js";
import { validatePlugin } from "./validate.js";

interface SkillDocument {
  name: string;
  description: string;
  body: string;
}

function parseSkill(source: string, path: string): SkillDocument {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Skill has no valid frontmatter: ${path}`);
  const metadata = YAML.parse(match[1] ?? "") as { name?: unknown; description?: unknown };
  if (typeof metadata.name !== "string" || typeof metadata.description !== "string") {
    throw new Error(`Skill frontmatter is incomplete: ${path}`);
  }
  return { name: metadata.name, description: metadata.description, body: (match[2] ?? "").trim() };
}

export async function exportPersonalChat(rootInput: string, options: PersonalChatExportOptions): Promise<PersonalChatExportResult> {
  const root = resolve(rootInput);
  const out = resolve(options.out);
  if (isInside(root, out)) throw new Error("Personal ChatGPT export output must be outside the plugin source tree.");

  const report = await validatePlugin(root, { profile: "local" });
  if (report.status === "invalid") {
    throw new Error(`Plugin validation failed before personal ChatGPT export: ${report.errors.map((item) => item.code).join(", ")}`);
  }

  const manifest = await readJson<PluginManifest>(resolve(root, ".codex-plugin", "plugin.json"));
  if (manifest.apps || manifest.mcpServers || await pathExists(resolve(root, ".mcp.json")) || await pathExists(resolve(root, ".app.json"))) {
    throw new Error("Personal ChatGPT export supports skills-only plugins; MCP tools and Apps UI require a supported registered app surface.");
  }
  if (!manifest.skills || typeof manifest.skills !== "string") throw new Error("Plugin does not declare a skills directory.");

  const skillsRoot = assertInside(root, resolve(root, manifest.skills));
  const skillPaths = (await walkFiles(skillsRoot)).filter((path) => path.endsWith("SKILL.md"));
  if (skillPaths.length === 0) throw new Error("Plugin has no SKILL.md files to export.");
  const skills: SkillDocument[] = [];
  for (const path of skillPaths) skills.push(parseSkill(await readFile(resolve(skillsRoot, path), "utf8"), path));

  if (await pathExists(out)) {
    const entries = await readdir(out);
    if (entries.length > 0 && !options.force) throw new Error(`Export directory is not empty: ${out}`);
    if (options.force) await rm(out, { recursive: true, force: true });
  }
  await mkdir(out, { recursive: true });

  const displayName = manifest.interface.displayName;
  const prompt = [
    `# ${displayName}`,
    "",
    `You are running the portable ${displayName} workflow in a normal ChatGPT conversation.`,
    "",
    "## Operating rules",
    "",
    "- Apply a skill only when the user's request matches its trigger description.",
    "- Follow the user's current request and supplied source material; ask a concise question when essential information is missing.",
    "- Never claim access to plugins, MCP tools, external services, private data, or actions that are not actually available in this chat.",
    "- Never request an API key or secret for this prompt-only workflow.",
    "- Keep facts, assumptions, and missing information clearly separated.",
    "",
    "## Available skills",
    "",
    ...skills.flatMap((skill) => {
      const trigger = skill.description.replace(/^Use when\s+/i, "");
      return [
        `### ${skill.name}`,
        "",
        `Use when: ${trigger}`,
        "",
        skill.body,
        "",
      ];
    }),
  ].join("\n").trimEnd() + "\n";

  const starters = manifest.interface.defaultPrompt ?? manifest.interface.default_prompt ?? [];
  const guide = [
    `# Start here: ${displayName}`,
    "",
    "This is the personal ChatGPT route. It needs no workspace, app ID, API key, MCP server, marketplace, or plugin installation.",
    "",
    "1. Open a normal ChatGPT conversation.",
    "2. Open `CHATGPT-PROMPT.md`, copy all of it, and paste it as your first message.",
    "3. In your next message, provide the material or request you want the workflow to handle.",
    "4. Keep this folder if you want to verify the prompt later with `SHA256SUMS`.",
    "",
    "You may also place the prompt in ChatGPT custom instructions if it fits your account's current limits and you want it applied across chats. Do not paste secrets into prompts or custom instructions.",
    "",
    "## Try one of these",
    "",
    ...(starters.length > 0 ? starters.map((starter) => `- ${starter}`) : ["- Ask ChatGPT to run the exported workflow on your material."]),
    "",
    "## What this route does not do",
    "",
    "It does not install a plugin, register an app, add tools, call an API, or publish anything. Those capabilities remain available through the separate developer workflow when you have the required surface.",
    "",
  ].join("\n");

  const promptPath = "CHATGPT-PROMPT.md";
  const guidePath = "START-HERE.md";
  const files = [promptPath, guidePath];
  await atomicWrite(resolve(out, promptPath), prompt);
  await atomicWrite(resolve(out, guidePath), guide);
  const checksumLines: string[] = [];
  for (const path of files) checksumLines.push(`${sha256(await readFile(resolve(out, path)))}  ${path}`);
  const checksumPath = resolve(out, "SHA256SUMS");
  await atomicWrite(checksumPath, `${checksumLines.join("\n")}\n`);
  return { out, files: [...files, "SHA256SUMS"], checksumPath };
}
