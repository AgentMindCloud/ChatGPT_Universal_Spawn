import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScaffoldOptions, ScaffoldResult } from "./types.js";
import { displayNameFromPluginName, normalizePluginName, pathExists, toPosixPath } from "./utils.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tokenMap(options: ScaffoldOptions, pluginName: string): Record<string, string> {
  const displayName = displayNameFromPluginName(pluginName);
  const repositoryUrl = options.repositoryUrl;
  const supportUrl = repositoryUrl.includes("github.com/") ? `${repositoryUrl.replace(/\.git$/, "")}/issues` : repositoryUrl;
  const endpoint = options.mcpUrl ?? options.actionBaseUrl;
  return {
    pluginName,
    displayName,
    description: options.description,
    author: options.author,
    repositoryUrl,
    supportUrl,
    descriptionJson: JSON.stringify(options.description),
    displayNameJson: JSON.stringify(displayName),
    authorJson: JSON.stringify(options.author),
    descriptionYaml: JSON.stringify(options.description),
    skillDescriptionYaml: JSON.stringify(`Use when a user needs this workflow: ${options.description}`),
    mcpUrl: options.mcpUrl ?? "",
    actionBaseUrl: options.actionBaseUrl ?? "",
    endpointOrigin: endpoint ? new URL(endpoint).origin : "",
    displayNameYaml: JSON.stringify(displayName),
  };
}

function replaceTokens(value: string, tokens: Record<string, string>): string {
  return value.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_match, key: string) => tokens[key] ?? _match);
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const pluginName = normalizePluginName(options.name);
  if (!pluginName) throw new Error("Plugin name must contain at least one letter or number.");
  if (pluginName !== options.name) {
    throw new Error(`Plugin name must already be normalized kebab-case. Suggested name: ${pluginName}`);
  }
  if (options.description.trim().length < 8) throw new Error("Description must be at least 8 characters.");
  if (!options.author.trim()) throw new Error("Author is required.");
  const requireHttps = (value: string | undefined, label: string): string => {
    if (!value) throw new Error(`${label} is required for the ${options.template} template.`);
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
    if (url.protocol !== "https:") throw new Error(`${label} must be a valid HTTPS URL.`);
    if (url.username || url.password) throw new Error(`${label} must not embed credentials.`);
    if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) throw new Error(`${label} cannot use an example.com placeholder.`);
    return value;
  };
  requireHttps(options.repositoryUrl, "Repository URL");
  if (options.template === "mcp" || options.template === "mcp-ui") requireHttps(options.mcpUrl, "MCP URL");
  if (options.template === "custom-gpt-action") requireHttps(options.actionBaseUrl, "Action base URL");

  const root = resolve(options.root);
  if (await pathExists(root)) {
    const info = await stat(root);
    const entries = info.isDirectory() ? await readdir(root) : ["not-a-directory"];
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${root}`);
    }
  }
  await mkdir(root, { recursive: true });

  const templateRoot = resolve(PACKAGE_ROOT, "templates", options.template);
  if (!(await pathExists(templateRoot))) throw new Error(`Unknown template: ${options.template}`);
  const tokens = tokenMap(options, pluginName);
  const createdFiles: string[] = [];

  async function copyDirectory(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const source = resolve(current, entry.name);
      const templateRelative = relative(templateRoot, source);
      const renderedRelative = replaceTokens(templateRelative, tokens).replace(/\.template$/, "");
      const destination = resolve(root, renderedRelative);
      if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await copyDirectory(source);
      } else if (entry.isFile()) {
        const rendered = replaceTokens(await readFile(source, "utf8"), tokens);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, rendered, "utf8");
        createdFiles.push(toPosixPath(relative(root, destination)));
      }
    }
  }

  await copyDirectory(templateRoot);
  createdFiles.sort();
  return { root, template: options.template, pluginName, createdFiles };
}
