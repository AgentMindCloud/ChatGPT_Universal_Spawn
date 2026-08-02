import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { CustomGptExportOptions, CustomGptExportResult } from "./types.js";
import { assertInside, atomicWrite, isInside, pathExists, readJson, sha256 } from "./utils.js";
import { validatePlugin } from "./validate.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

interface ExportConfig {
  schemaVersion: "1";
  instructions: string;
  conversationStarters: string[];
  knowledge?: string[];
  actions?: Array<{ openapi: string; auth: "none" | "api_key" | "oauth" }>;
}

async function validateConfig(value: unknown): Promise<ExportConfig> {
  const schema = await readJson<Record<string, unknown>>(resolve(PACKAGE_ROOT, "schemas", "custom-gpt-export.schema.json"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(`Invalid custom-gpt/export.yaml: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }
  return value as ExportConfig;
}

function resolveSource(root: string, configuredPath: string): string {
  if (!configuredPath.startsWith("./")) throw new Error(`Export path must begin with ./: ${configuredPath}`);
  const source = assertInside(root, resolve(root, configuredPath));
  return source;
}

export async function exportCustomGpt(rootInput: string, options: CustomGptExportOptions): Promise<CustomGptExportResult> {
  const root = resolve(rootInput);
  const out = resolve(options.out);
  if (out === root || out === resolve(root, "custom-gpt")) throw new Error("Export output cannot replace the plugin root or its Custom GPT source directory.");
  const report = await validatePlugin(root, { profile: "local" });
  if (report.status === "invalid") throw new Error(`Plugin validation failed before Custom GPT export: ${report.errors.map((item) => item.code).join(", ")}`);
  const config = await validateConfig(YAML.parse(await readFile(resolve(root, "custom-gpt", "export.yaml"), "utf8")));
  if (await pathExists(out)) {
    const entries = await readdir(out);
    if (entries.length > 0 && !options.force) throw new Error(`Export directory is not empty: ${out}`);
    if (options.force) await rm(out, { recursive: true, force: true });
  }
  await mkdir(out, { recursive: true });

  const files: string[] = [];
  const copy = async (source: string, destinationRelative: string): Promise<void> => {
    const normalizedRelative = destinationRelative.split(sep).join("/");
    if (files.includes(normalizedRelative)) throw new Error(`Export destination collision: ${normalizedRelative}`);
    const data = await readFile(source);
    const destination = assertInside(out, resolve(out, destinationRelative));
    await atomicWrite(destination, data);
    files.push(normalizedRelative);
  };
  await copy(resolveSource(root, config.instructions), "instructions.md");
  const knowledgeRoot = resolve(root, "custom-gpt", "knowledge");
  for (const knowledge of config.knowledge ?? []) {
    const source = resolveSource(root, knowledge);
    const nestedPath = isInside(knowledgeRoot, source) ? relative(knowledgeRoot, source) : basename(knowledge);
    await copy(source, `knowledge/${nestedPath}`);
  }
  for (const [index, action] of (config.actions ?? []).entries()) {
    await copy(resolveSource(root, action.openapi), `actions/action-${index + 1}.yaml`);
  }

  const startersPath = resolve(out, "conversation-starters.md");
  await atomicWrite(startersPath, `# Conversation starters\n\n${config.conversationStarters.map((value) => `- ${value}`).join("\n")}\n`);
  files.push("conversation-starters.md");
  const checklistPath = resolve(out, "EDITOR-CHECKLIST.md");
  await atomicWrite(checklistPath, [
    "# Manual Custom GPT editor checklist",
    "",
    "ChatGPT Universal Spawn does not create or publish a GPT. Complete these steps in the ChatGPT GPT editor:",
    "",
    "- [ ] Paste `instructions.md` into Instructions.",
    "- [ ] Add the entries from `conversation-starters.md`.",
    "- [ ] Upload every file in `knowledge/`.",
    "- [ ] Add every OpenAPI document in `actions/` and configure the declared authentication manually.",
    "- [ ] Test successful, empty, invalid-input, and unauthorized cases.",
    "- [ ] Review privacy, support, and sharing settings before publishing.",
    "",
  ].join("\n"));
  files.push("EDITOR-CHECKLIST.md");

  files.sort();
  const checksumLines: string[] = [];
  for (const path of files) checksumLines.push(`${sha256(await readFile(resolve(out, path)))}  ${path}`);
  const checksumPath = resolve(out, "SHA256SUMS");
  await atomicWrite(checksumPath, `${checksumLines.join("\n")}\n`);
  return { out, files: [...files, "SHA256SUMS"], checksumPath };
}
