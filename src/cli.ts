#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command, Option } from "commander";
import { applyInstall, buildPluginArchive, doctorPlugin, exportCustomGpt, exportPersonalChat, linkRegisteredApp, planInstall, scaffoldPlugin, validatePlugin } from "./index.js";
import type { InstallPlan, PluginTemplate, ValidationReport } from "./types.js";

const VERSION = "0.1.1";
const program = new Command();

function printValidation(report: ValidationReport): void {
  const icon = report.status === "valid" ? "PASS" : report.status === "manual_required" ? "MANUAL" : "FAIL";
  console.log(`${icon} ${report.profile} validation: ${report.status}`);
  for (const item of [...report.errors, ...report.warnings]) {
    console.log(`  ${item.severity.toUpperCase()} ${item.code}  ${item.path}`);
    console.log(`    ${item.message}`);
  }
  if (report.manualChecks.length > 0) {
    console.log("  Manual checks:");
    for (const check of report.manualChecks) console.log(`    [${check.complete ? "x" : " "}] ${check.label}`);
  }
  console.log(`  Rules checked: ${report.checkedRules.join(", ")}`);
}

function printPlan(plan: InstallPlan): void {
  console.log("Install preview");
  console.log(`  Plugin:      ${plan.pluginName}`);
  console.log(`  Source:      ${plan.sourceRoot}`);
  console.log(`  Destination: ${plan.destinationRoot}`);
  console.log(`  Marketplace: ${plan.marketplacePath}`);
  console.log(`  Replace:     ${plan.replace ? "yes" : "no"}`);
  if (plan.conflicts.length > 0) {
    console.log("  Conflicts:");
    for (const conflict of plan.conflicts) console.log(`    - ${conflict}`);
  }
  console.log("\nMarketplace after this operation:\n");
  console.log(plan.after.trimEnd());
  console.log("\nRollback data:");
  console.log(`  Restore prior marketplace: ${plan.rollback.restoreMarketplace === null ? "delete newly-created file" : "available"}`);
  console.log(`  Destination existed:       ${plan.rollback.destinationExisted ? "yes" : "no"}`);
}

async function confirm(question: string): Promise<boolean> {
  if (!input.isTTY) return false;
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(`${question} [y/N] `)).trim().toLowerCase() === "y";
  } finally {
    terminal.close();
  }
}

async function completeInitOptions(values: {
  template?: PluginTemplate;
  name?: string;
  description?: string;
  author?: string;
  repository?: string;
  mcpUrl?: string;
  actionBaseUrl?: string;
}): Promise<{ template: PluginTemplate; name: string; description: string; author: string; repositoryUrl: string; mcpUrl?: string; actionBaseUrl?: string }> {
  if (!input.isTTY) {
    const required = ["template", "name", "description", "author", "repository"];
    if (values.template === "mcp" || values.template === "mcp-ui") required.push("mcpUrl");
    if (values.template === "custom-gpt-action") required.push("actionBaseUrl");
    const missing = required.filter((key) => !values[key as keyof typeof values]);
    const flags = missing.map((key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
    if (flags.length > 0) throw new Error(`Noninteractive init requires: --${flags.join(", --")}.`);
  }
  const terminal = createInterface({ input, output });
  try {
    const template = values.template ?? (await terminal.question("Template (skill, mcp, mcp-ui, custom-gpt-action): ")).trim() as PluginTemplate;
    if (!(["skill", "mcp", "mcp-ui", "custom-gpt-action"] as string[]).includes(template)) throw new Error(`Unsupported template: ${template}`);
    const name = values.name ?? (await terminal.question("Normalized plugin name (kebab-case): ")).trim();
    const description = values.description ?? (await terminal.question("One-sentence description: ")).trim();
    const author = values.author ?? (await terminal.question("Developer or organization name: ")).trim();
    const repositoryUrl = values.repository ?? (await terminal.question("HTTPS repository URL: ")).trim();
    const mcpUrl = (template === "mcp" || template === "mcp-ui")
      ? values.mcpUrl ?? (await terminal.question("Public HTTPS MCP endpoint: ")).trim()
      : undefined;
    const actionBaseUrl = template === "custom-gpt-action"
      ? values.actionBaseUrl ?? (await terminal.question("Public HTTPS Action API base URL: ")).trim()
      : undefined;
    return {
      template,
      name,
      description,
      author,
      repositoryUrl,
      ...(mcpUrl ? { mcpUrl } : {}),
      ...(actionBaseUrl ? { actionBaseUrl } : {}),
    };
  } finally {
    terminal.close();
  }
}

program
  .name("chatgpt-spawn")
  .description("Create personal ChatGPT prompt packs and full ChatGPT-first plugins.")
  .version(VERSION);

program
  .command("init")
  .description("Create a complete plugin project from a supported template.")
  .argument("<dir>", "Target plugin directory")
  .addOption(new Option("--template <template>", "Template type").choices(["skill", "mcp", "mcp-ui", "custom-gpt-action"]))
  .option("--name <name>", "Normalized plugin name")
  .option("--description <description>", "Plain-language plugin description")
  .option("--author <author>", "Developer or organization name")
  .option("--repository <url>", "HTTPS source repository URL")
  .option("--mcp-url <url>", "Public HTTPS MCP endpoint for mcp and mcp-ui templates")
  .option("--action-base-url <url>", "Public HTTPS API base URL for custom-gpt-action")
  .action(async (dir: string, options) => {
    const metadata = await completeInitOptions(options);
    const result = await scaffoldPlugin({ root: dir, ...metadata });
    console.log(`Created ${result.pluginName} from the ${result.template} template.`);
    for (const path of result.createdFiles) console.log(`  + ${path}`);
    console.log(`\nNext: chatgpt-spawn validate "${result.root}"`);
  });

program
  .command("validate")
  .description("Validate a plugin offline by default, with optional remote endpoint checks.")
  .argument("<dir>", "Plugin directory")
  .addOption(new Option("--profile <profile>", "Validation profile").choices(["local", "publish"]).default("local"))
  .option("--online", "Inspect declared public MCP endpoints")
  .option("--json", "Print machine-readable JSON")
  .action(async (dir: string, options) => {
    const report = await validatePlugin(dir, { profile: options.profile, online: options.online === true });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printValidation(report);
    if (report.status === "invalid") process.exitCode = 1;
    else if (report.status === "manual_required") process.exitCode = 2;
  });

program
  .command("build")
  .description("Validate and create a deterministic plugin ZIP plus SHA-256 file.")
  .argument("<dir>", "Plugin directory")
  .requiredOption("--out <zip>", "Output ZIP path")
  .action(async (dir: string, options) => {
    const result = await buildPluginArchive(dir, { out: options.out });
    console.log("Build complete");
    console.log(`  Archive:  ${result.archivePath}`);
    console.log(`  SHA-256:  ${result.sha256}`);
    console.log(`  Files:    ${result.files.length}`);
    console.log(`  Bytes:    ${result.bytes}`);
    console.log(`  Checksum: ${result.checksumPath}`);
  });

program
  .command("link-app")
  .description("Link a plugin to a real app registered in ChatGPT Apps Management.")
  .argument("<dir>", "Plugin directory")
  .requiredOption("--id <app-id>", "Registered ID beginning with plugin_asdk_app")
  .action(async (dir: string, options) => {
    const result = await linkRegisteredApp(dir, options.id);
    console.log(`Linked ${result.appId}`);
    console.log(`  App manifest:    ${result.appManifestPath}`);
    console.log(`  Plugin manifest: ${result.pluginManifestPath}`);
  });

program
  .command("install")
  .description("Preview and explicitly install into a personal or repository marketplace.")
  .argument("<dir>", "Plugin directory")
  .addOption(new Option("--marketplace <target>", "Marketplace target").choices(["personal", "repo"]).makeOptionMandatory())
  .option("--repo-root <dir>", "Repository root for --marketplace repo")
  .option("--dry-run", "Print the complete plan without writing")
  .option("--yes", "Confirm noninteractive installation")
  .option("--replace", "Replace an existing destination and marketplace entry")
  .action(async (dir: string, options) => {
    const plan = await planInstall(dir, { marketplace: options.marketplace, repoRoot: options.repoRoot, replace: options.replace === true });
    printPlan(plan);
    if (options.dryRun) {
      console.log("\nDry run complete; nothing was written.");
      return;
    }
    const confirmed = options.yes === true || await confirm("Apply this installation plan?");
    const result = await applyInstall(plan, { confirmed });
    console.log(`\nInstalled at ${result.destinationRoot}`);
    console.log(`Marketplace updated: ${result.marketplacePath}`);
  });

const exportCommand = program.command("export").description("Export artifacts for manual workflows.");
exportCommand
  .command("personal-chat")
  .description("Export a skills-only prompt pack for normal ChatGPT chats; no app ID or API key required.")
  .argument("<dir>", "Skills-only plugin directory")
  .requiredOption("--out <dir>", "Output directory")
  .option("--force", "Replace a non-empty output directory")
  .action(async (dir: string, options) => {
    const result = await exportPersonalChat(dir, { out: options.out, force: options.force === true });
    console.log("Personal ChatGPT export complete");
    console.log(`  Directory: ${result.out}`);
    console.log(`  Files:     ${result.files.length}`);
    console.log(`  Checksums: ${result.checksumPath}`);
    console.log("  Next: open START-HERE.md; no workspace, app ID, API key, or installation is required.");
  });
exportCommand
  .command("custom-gpt")
  .description("Export a manual Custom GPT editor bundle; this does not create or publish a GPT.")
  .argument("<dir>", "Custom GPT Action template directory")
  .requiredOption("--out <dir>", "Output directory")
  .option("--force", "Replace a non-empty output directory")
  .action(async (dir: string, options) => {
    const result = await exportCustomGpt(dir, { out: options.out, force: options.force === true });
    console.log("Custom GPT export complete");
    console.log(`  Directory: ${result.out}`);
    console.log(`  Files:     ${result.files.length}`);
    console.log(`  Checksums: ${result.checksumPath}`);
    console.log("  Next: follow EDITOR-CHECKLIST.md in the ChatGPT GPT editor.");
  });

program
  .command("doctor")
  .description("Check runtime, package, marketplace, and OpenAI documentation compatibility.")
  .argument("<dir>", "Plugin directory")
  .option("--check-docs", "Check locked first-party documentation URLs online")
  .option("--json", "Print machine-readable JSON")
  .action(async (dir: string, options) => {
    const result = await doctorPlugin(dir, { checkDocs: options.checkDocs === true });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Doctor: ${result.ok ? "PASS" : "FAIL"}`);
      for (const check of result.checks) console.log(`  [${check.ok ? "x" : " "}] ${check.id}: ${check.message}`);
    }
    if (!result.ok) process.exitCode = 1;
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
