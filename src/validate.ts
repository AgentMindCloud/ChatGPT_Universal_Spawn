import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { inspectMcpEndpoint } from "./mcp.js";
import type {
  Diagnostic,
  ManualCheck,
  PluginManifest,
  ValidationOptions,
  ValidationProfile,
  ValidationReport,
} from "./types.js";
import { assertInside, isInside, normalizePluginName, pathExists, readJson, walkFiles } from "./utils.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const PLUGIN_SCHEMA = resolve(PACKAGE_ROOT, "schemas", "plugin.schema.json");
const SUBMISSION_SCHEMA = resolve(PACKAGE_ROOT, "schemas", "submission.schema.json");
const TODO_MARKER = "[TODO:";
const TEXT_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".md", ".txt", ".ts", ".js", ".mjs", ".cjs", ".toml"]);
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];
const FORBIDDEN_SECRET_FILENAMES = [
  /(^|\/)(?:id_rsa|id_ed25519)(?:\.pub)?$/i,
  /\.(?:pem|p12|pfx|key)$/i,
];
const DEBUG_ARTIFACTS = [/(^|\/)(?:debug|trace)(?:[-_.].*)?\.(?:log|json|txt)$/i, /(^|\/)npm-debug\.log$/i];

interface SubmissionConfig {
  mcpURL?: string;
  supportURL?: string;
  cspDomains?: string[];
  testCases?: { positive?: unknown[]; negative?: unknown[] };
  manualAttestations?: {
    publisherIdentity?: boolean;
    appsManagementAccess?: boolean;
    reviewerAccessReady?: boolean;
  };
}

interface CustomGptConfig {
  instructions?: string;
  knowledge?: string[];
  actions?: Array<{ openapi?: string }>;
}

function diagnostic(
  code: string,
  severity: "error" | "warning",
  path: string,
  message: string,
  helpUrl?: string,
): Diagnostic {
  return helpUrl ? { code, severity, path, message, helpUrl } : { code, severity, path, message };
}

async function validateWithSchema(
  schemaPath: string,
  value: unknown,
  path: string,
  code: string,
): Promise<Diagnostic[]> {
  const schema = await readJson<Record<string, unknown>>(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error: ErrorObject) =>
    diagnostic(
      code,
      "error",
      `${path}${error.instancePath || ""}`,
      error.message ?? "Schema validation failed.",
    ),
  );
}

async function validateRelativePath(root: string, rawPath: string, label: string): Promise<Diagnostic[]> {
  if (!rawPath.startsWith("./")) {
    return [diagnostic("path.relative", "error", label, "Path must begin with ./ and be relative to the plugin root.")];
  }
  const target = resolve(root, rawPath);
  if (!isInside(root, target)) {
    return [diagnostic("path.escape", "error", label, "Path must stay inside the plugin root.")];
  }
  if (!(await pathExists(target))) {
    return [diagnostic("path.missing", "error", label, `Referenced path does not exist: ${rawPath}`)];
  }
  return [];
}

async function validateSkills(root: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const skillsRoot = resolve(root, "skills");
  if (!(await pathExists(skillsRoot))) return diagnostics;
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("."))) {
    const skillPath = resolve(skillsRoot, entry.name, "SKILL.md");
    const label = `skills/${entry.name}/SKILL.md`;
    if (!(await pathExists(skillPath))) {
      diagnostics.push(diagnostic("skill.manifest.missing", "error", label, "Every skill directory must contain SKILL.md."));
      continue;
    }
    const content = await readFile(skillPath, "utf8");
    if (content.includes(TODO_MARKER)) {
      diagnostics.push(diagnostic("placeholder.todo", "error", label, "Replace every [TODO: ...] placeholder before validation."));
    }
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
    if (!match?.[1]) {
      diagnostics.push(diagnostic("skill.frontmatter", "error", label, "SKILL.md must begin with closed YAML frontmatter."));
      continue;
    }
    try {
      const frontmatter = YAML.parse(match[1]) as Record<string, unknown>;
      if (typeof frontmatter?.name !== "string" || !frontmatter.name.trim()) {
        diagnostics.push(diagnostic("skill.name", "error", label, "Skill frontmatter requires a non-empty name."));
      }
      if (typeof frontmatter?.description !== "string" || frontmatter.description.trim().length < 12) {
        diagnostics.push(diagnostic("skill.description", "error", label, "Skill description must clearly explain when the skill should be used."));
      } else if (!/\buse\s+when\b/i.test(frontmatter.description)) {
        diagnostics.push(diagnostic("skill.trigger", "error", label, "Skill description must include a focused ‘Use when …’ trigger."));
      }
      const disabled = frontmatter["disable-model-invocation"] ?? frontmatter.disable_model_invocation;
      if (disabled !== undefined && disabled !== false) {
        diagnostics.push(diagnostic("skill.invocation", "error", label, "Plugin skills must permit model invocation."));
      }
    } catch (error) {
      diagnostics.push(diagnostic("skill.frontmatter.yaml", "error", label, error instanceof Error ? error.message : String(error)));
    }
  }
  return diagnostics;
}

async function validatePackageFiles(root: string, profile: ValidationProfile): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const files = await walkFiles(root);
  for (const relWithMarker of files) {
    const symlink = relWithMarker.endsWith("::symlink");
    const rel = symlink ? relWithMarker.slice(0, -9) : relWithMarker;
    if (symlink) {
      diagnostics.push(diagnostic("archive.symlink", "error", rel, "Symbolic links are not allowed in plugin packages."));
      continue;
    }
    const segments = rel.split("/");
    if (segments.includes(".git")) continue;
    if (segments.includes("node_modules")) {
      diagnostics.push(diagnostic("archive.node-modules", profile === "publish" ? "error" : "warning", rel, "node_modules is excluded from release archives; remove it from the plugin tree."));
      continue;
    }
    const filename = basename(rel).toLowerCase();
    if (FORBIDDEN_SECRET_FILENAMES.some((pattern) => pattern.test(rel))) {
      diagnostics.push(diagnostic("secret.key-file", "error", rel, "Private-key and certificate containers are not allowed in plugin packages."));
      continue;
    }
    if (DEBUG_ARTIFACTS.some((pattern) => pattern.test(rel))) {
      diagnostics.push(diagnostic("archive.debug-payload", "error", rel, "Debug and trace payloads must not be included in plugin packages."));
      continue;
    }
    if ((filename === ".env" || filename.startsWith(".env.")) && filename !== ".env.example") {
      diagnostics.push(diagnostic("secret.env-file", "error", rel, "Secret-bearing environment files must not be stored in a plugin."));
      continue;
    }
    if (TEXT_EXTENSIONS.has(extname(filename))) {
      const full = assertInside(root, resolve(root, rel));
      const info = await stat(full);
      if (info.size > 1_000_000) continue;
      const content = await readFile(full, "utf8");
      if (content.includes(TODO_MARKER)) {
        diagnostics.push(diagnostic("placeholder.todo", "error", rel, "Replace every [TODO: ...] placeholder before packaging."));
      }
      for (const [label, pattern] of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          diagnostics.push(diagnostic("secret.detected", "error", rel, `${label} detected. Remove the value and declare only the secret name.`));
        }
      }
    }
  }
  return diagnostics;
}

async function validateMcpConfig(root: string): Promise<Diagnostic[]> {
  const path = resolve(root, ".mcp.json");
  if (!(await pathExists(path))) return [];
  const diagnostics: Diagnostic[] = [];
  try {
    const payload = await readJson<{ mcpServers?: Record<string, unknown> }>(path);
    if (!payload.mcpServers || typeof payload.mcpServers !== "object" || Array.isArray(payload.mcpServers) || Object.keys(payload.mcpServers).length === 0) {
      return [diagnostic("mcp.config", "error", ".mcp.json#mcpServers", "mcpServers must be a non-empty object.")];
    }
    for (const [name, rawValue] of Object.entries(payload.mcpServers)) {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        diagnostics.push(diagnostic("mcp.server", "error", `.mcp.json#mcpServers/${name}`, "Each MCP server must be an object."));
        continue;
      }
      const server = rawValue as Record<string, unknown>;
      if (server.type === "http") {
        if (typeof server.url !== "string" || !server.url.startsWith("https://")) {
          diagnostics.push(diagnostic("mcp.server.url", "error", `.mcp.json#mcpServers/${name}/url`, "HTTP MCP servers require an HTTPS URL."));
        } else {
          const url = new URL(server.url);
          if (url.username || url.password) diagnostics.push(diagnostic("mcp.server.credentials", "error", `.mcp.json#mcpServers/${name}/url`, "MCP URLs must not embed credentials."));
        }
      } else if (server.type === "stdio") {
        if (typeof server.command !== "string" || !server.command.trim()) {
          diagnostics.push(diagnostic("mcp.server.command", "error", `.mcp.json#mcpServers/${name}/command`, "stdio MCP servers require a command."));
        }
        if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((item) => typeof item !== "string"))) {
          diagnostics.push(diagnostic("mcp.server.args", "error", `.mcp.json#mcpServers/${name}/args`, "stdio args must be an array of strings."));
        }
      } else {
        diagnostics.push(diagnostic("mcp.server.type", "error", `.mcp.json#mcpServers/${name}/type`, "MCP server type must be http or stdio."));
      }
      if (server.env && (typeof server.env !== "object" || Array.isArray(server.env))) {
        diagnostics.push(diagnostic("mcp.server.env", "error", `.mcp.json#mcpServers/${name}/env`, "MCP env must map secret names to runtime references, never literal arrays or strings."));
      } else if (server.env) {
        for (const [secretName, reference] of Object.entries(server.env as Record<string, unknown>)) {
          if (!/^[A-Z][A-Z0-9_]*$/.test(secretName) || reference !== `\${${secretName}}`) {
            diagnostics.push(diagnostic("mcp.server.env-reference", "error", `.mcp.json#mcpServers/${name}/env/${secretName}`, "Environment entries must use an uppercase secret name and the matching runtime reference, for example API_TOKEN: ${API_TOKEN}."));
          }
        }
      }
    }
  } catch (error) {
    diagnostics.push(diagnostic("mcp.config.json", "error", ".mcp.json", error instanceof Error ? error.message : String(error)));
  }
  return diagnostics;
}

async function validateAppConfig(root: string): Promise<Diagnostic[]> {
  const path = resolve(root, ".app.json");
  if (!(await pathExists(path))) return [];
  const diagnostics: Diagnostic[] = [];
  try {
    const payload = await readJson<{ apps?: Record<string, unknown> }>(path);
    if (!payload.apps || typeof payload.apps !== "object" || Array.isArray(payload.apps) || Object.keys(payload.apps).length === 0) {
      return [diagnostic("app.config", "error", ".app.json#apps", "apps must be a non-empty object.")];
    }
    for (const [name, rawValue] of Object.entries(payload.apps)) {
      const app = rawValue as Record<string, unknown> | null;
      if (!app || typeof app !== "object" || Array.isArray(app)) {
        diagnostics.push(diagnostic("app.entry", "error", `.app.json#apps/${name}`, "Each app must be an object."));
        continue;
      }
      if (typeof app.id !== "string" || !/^plugin_asdk_app[A-Za-z0-9_-]+$/.test(app.id)) {
        diagnostics.push(diagnostic("app.id", "error", `.app.json#apps/${name}/id`, "App ID must begin with plugin_asdk_app and come from Apps Management."));
      }
      if (typeof app.category !== "string" || !app.category.trim()) {
        diagnostics.push(diagnostic("app.category", "error", `.app.json#apps/${name}/category`, "App category is required."));
      }
      const unknown = Object.keys(app).filter((key) => key !== "id" && key !== "category");
      if (unknown.length > 0) diagnostics.push(diagnostic("app.unknown-field", "error", `.app.json#apps/${name}`, `Unsupported app fields: ${unknown.join(", ")}.`));
    }
  } catch (error) {
    diagnostics.push(diagnostic("app.config.json", "error", ".app.json", error instanceof Error ? error.message : String(error)));
  }
  return diagnostics;
}

async function validateCustomGptProject(root: string): Promise<Diagnostic[]> {
  const configPath = resolve(root, "custom-gpt", "export.yaml");
  if (!(await pathExists(configPath))) return [];
  const diagnostics: Diagnostic[] = [];
  try {
    const config = YAML.parse(await readFile(configPath, "utf8")) as CustomGptConfig;
    diagnostics.push(...(await validateWithSchema(resolve(PACKAGE_ROOT, "schemas", "custom-gpt-export.schema.json"), config, "custom-gpt/export.yaml", "custom-gpt.schema")));
    const configuredPaths = [config.instructions, ...(config.knowledge ?? []), ...(config.actions ?? []).map((item) => item.openapi)].filter(
      (value): value is string => typeof value === "string",
    );
    for (const configuredPath of configuredPaths) diagnostics.push(...(await validateRelativePath(root, configuredPath, `custom-gpt/export.yaml#${configuredPath}`)));
    const operationIds = new Set<string>();
    for (const [index, action] of (config.actions ?? []).entries()) {
      if (!action.openapi) continue;
      const actionPath = resolve(root, action.openapi);
      if (!(await pathExists(actionPath)) || !isInside(root, actionPath)) continue;
      const document = YAML.parse(await readFile(actionPath, "utf8")) as Record<string, unknown>;
      if (typeof document.openapi !== "string" || !/^3\.\d+\.\d+$/.test(document.openapi)) {
        diagnostics.push(diagnostic("custom-gpt.openapi.version", "error", action.openapi, "Action documents require an OpenAPI 3.x version."));
      }
      const paths = document.paths as Record<string, unknown> | undefined;
      if (!paths || typeof paths !== "object" || Array.isArray(paths) || Object.keys(paths).length === 0) {
        diagnostics.push(diagnostic("custom-gpt.openapi.paths", "error", action.openapi, "Action documents require at least one path."));
        continue;
      }
      for (const [route, rawOperations] of Object.entries(paths)) {
        if (!rawOperations || typeof rawOperations !== "object" || Array.isArray(rawOperations)) continue;
        for (const [method, rawOperation] of Object.entries(rawOperations as Record<string, unknown>)) {
          if (!["get", "post", "put", "patch", "delete"].includes(method) || !rawOperation || typeof rawOperation !== "object") continue;
          const operationId = (rawOperation as Record<string, unknown>).operationId;
          if (typeof operationId !== "string" || !operationId.trim()) {
            diagnostics.push(diagnostic("custom-gpt.openapi.operation-id", "error", `${action.openapi}#paths/${route}/${method}`, "Every action operation requires operationId."));
          } else if (operationIds.has(operationId)) {
            diagnostics.push(diagnostic("custom-gpt.openapi.operation-id", "error", `${action.openapi}#paths/${route}/${method}`, `Duplicate operationId: ${operationId}.`));
          } else operationIds.add(operationId);
        }
      }
      if (index === 0 && operationIds.size === 0) diagnostics.push(diagnostic("custom-gpt.openapi.operations", "error", action.openapi, "Action document contains no callable operations."));
    }
  } catch (error) {
    diagnostics.push(diagnostic("custom-gpt.config", "error", "custom-gpt/export.yaml", error instanceof Error ? error.message : String(error)));
  }
  return diagnostics;
}

async function inspectPublicUrl(url: string, path: string): Promise<Diagnostic[]> {
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (response.status === 405) response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return [];
  } catch (error) {
    return [diagnostic("url.inspect.failed", "error", path, `Public URL check failed: ${error instanceof Error ? error.message : String(error)}`)];
  }
}

async function declaredMcpUrls(root: string, manifest: PluginManifest | undefined): Promise<string[]> {
  const urls = new Set<string>();
  let config: Record<string, unknown> | undefined;
  if (typeof manifest?.mcpServers === "object") config = manifest.mcpServers as Record<string, unknown>;
  const configPath = resolve(root, ".mcp.json");
  if (await pathExists(configPath)) config = (await readJson<{ mcpServers?: Record<string, unknown> }>(configPath)).mcpServers;
  for (const value of Object.values(config ?? {})) {
    if (value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") urls.add((value as Record<string, unknown>).url as string);
  }
  return [...urls];
}

function buildManualChecks(config: SubmissionConfig | undefined): ManualCheck[] {
  const values = config?.manualAttestations ?? {};
  return [
    {
      id: "publisher-identity",
      label: "Verified developer or business identity",
      complete: values.publisherIdentity === true,
      note: "This is a self-attestation for preflight only; the submission portal performs the real verification.",
    },
    {
      id: "apps-management-access",
      label: "Apps Management write access",
      complete: values.appsManagementAccess === true,
      note: "Confirm the submitting account has the required workspace permission.",
    },
    {
      id: "reviewer-access",
      label: "Reviewer access works without MFA or private-network dependencies",
      complete: values.reviewerAccessReady === true,
      note: "Never store reviewer credentials in this repository or preflight file.",
    },
  ];
}

export async function validatePlugin(rootInput: string, options: ValidationOptions = {}): Promise<ValidationReport> {
  const root = resolve(rootInput);
  const profile = options.profile ?? "local";
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const checkedRules = ["plugin-schema", "component-paths", "skills", "mcp-config", "app-config", "custom-gpt", "secrets", "archive-safety"];
  const manifestPath = resolve(root, ".codex-plugin", "plugin.json");
  let manifest: PluginManifest | undefined;

  try {
    manifest = await readJson<PluginManifest>(manifestPath);
    errors.push(...(await validateWithSchema(PLUGIN_SCHEMA, manifest, ".codex-plugin/plugin.json", "plugin.schema")));
  } catch (error) {
    errors.push(diagnostic("plugin.manifest", "error", ".codex-plugin/plugin.json", error instanceof Error ? error.message : String(error)));
  }

  if (manifest) {
    if (normalizePluginName(manifest.name) !== manifest.name) {
      errors.push(diagnostic("plugin.name", "error", ".codex-plugin/plugin.json#name", "Plugin name must be normalized kebab-case and no longer than 64 characters."));
    }
    if (basename(root) !== manifest.name) {
      errors.push(diagnostic("plugin.folder-name", "error", root, `Plugin folder must be named ${manifest.name}.`));
    }
    if (manifest.skills) errors.push(...(await validateRelativePath(root, manifest.skills, ".codex-plugin/plugin.json#skills")));
    if (manifest.apps) errors.push(...(await validateRelativePath(root, manifest.apps, ".codex-plugin/plugin.json#apps")));
    if (typeof manifest.mcpServers === "string") {
      errors.push(...(await validateRelativePath(root, manifest.mcpServers, ".codex-plugin/plugin.json#mcpServers")));
    }
    const assetFields = [manifest.interface.composerIcon, manifest.interface.logo, manifest.interface.logoDark, ...(manifest.interface.screenshots ?? [])].filter(
      (value): value is string => typeof value === "string",
    );
    for (const assetPath of assetFields) {
      errors.push(...(await validateRelativePath(root, assetPath, `.codex-plugin/plugin.json#interface/${assetPath}`)));
    }
  }

  errors.push(...(await validateSkills(root)));
  errors.push(...(await validateMcpConfig(root)));
  errors.push(...(await validateAppConfig(root)));
  errors.push(...(await validateCustomGptProject(root)));
  const packageDiagnostics = await validatePackageFiles(root, profile);
  for (const item of packageDiagnostics) (item.severity === "error" ? errors : warnings).push(item);

  let manualChecks: ManualCheck[] = [];
  if (profile === "publish") {
    checkedRules.push("publish-metadata", "submission-tests", "manual-attestations");
    if (manifest) {
      for (const [field, value] of [
        ["websiteURL", manifest.interface.websiteURL],
        ["privacyPolicyURL", manifest.interface.privacyPolicyURL],
        ["termsOfServiceURL", manifest.interface.termsOfServiceURL],
      ] as const) {
        if (!value) errors.push(diagnostic("publish.legal-url", "error", `.codex-plugin/plugin.json#interface/${field}`, `${field} is required for publish preflight.`));
      }
      if (!manifest.interface.composerIcon || !manifest.interface.logo || !manifest.interface.logoDark) {
        errors.push(diagnostic("publish.images", "error", ".codex-plugin/plugin.json#interface", "Publish preflight requires composerIcon, logo, and logoDark assets."));
      }
    }
    const submissionPath = resolve(root, "submission", "chatgpt-submission.yaml");
    let submission: SubmissionConfig | undefined;
    try {
      submission = YAML.parse(await readFile(submissionPath, "utf8")) as SubmissionConfig;
      errors.push(...(await validateWithSchema(SUBMISSION_SCHEMA, submission, "submission/chatgpt-submission.yaml", "submission.schema")));
      if (submission.mcpURL) {
        const host = new URL(submission.mcpURL).hostname;
        if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local") || host === "example.com") {
          errors.push(diagnostic("publish.mcp-url", "error", "submission/chatgpt-submission.yaml#mcpURL", "Publish preflight requires a real public production MCP URL."));
        }
      }
      if (submission.cspDomains?.some((value) => value.includes("*"))) {
        errors.push(diagnostic("publish.csp-wildcard", "error", "submission/chatgpt-submission.yaml#cspDomains", "CSP domains must be exact and cannot contain wildcards."));
      }
    } catch (error) {
      errors.push(diagnostic("submission.manifest", "error", "submission/chatgpt-submission.yaml", error instanceof Error ? error.message : String(error)));
    }
    manualChecks = buildManualChecks(submission);
    if (options.online) {
      checkedRules.push("public-url-inspection");
      const urls = [
        [manifest?.interface.websiteURL, ".codex-plugin/plugin.json#interface/websiteURL"],
        [manifest?.interface.privacyPolicyURL, ".codex-plugin/plugin.json#interface/privacyPolicyURL"],
        [manifest?.interface.termsOfServiceURL, ".codex-plugin/plugin.json#interface/termsOfServiceURL"],
        [submission?.supportURL, "submission/chatgpt-submission.yaml#supportURL"],
      ] as const;
      for (const [url, path] of urls) if (url) errors.push(...(await inspectPublicUrl(url, path)));
    }
  }

  if (options.online) {
    checkedRules.push("mcp-online-inspection");
    const urls = new Set(await declaredMcpUrls(root, manifest));
    if (profile === "publish") {
      try {
        const submission = YAML.parse(await readFile(resolve(root, "submission", "chatgpt-submission.yaml"), "utf8")) as SubmissionConfig;
        if (submission.mcpURL && !errors.some((item) => item.code === "publish.mcp-url")) urls.add(submission.mcpURL);
      } catch {
        // The publish parser reports the actionable error above.
      }
    }
    for (const url of urls) errors.push(...(await inspectMcpEndpoint(url)));
  }

  const status = errors.length > 0 ? "invalid" : manualChecks.some((item) => !item.complete) ? "manual_required" : "valid";
  return { profile, status, errors, warnings, manualChecks, checkedRules };
}
