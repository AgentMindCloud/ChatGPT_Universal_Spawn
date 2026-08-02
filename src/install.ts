import { homedir } from "node:os";
import { readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { InstallOptions, InstallPlan, InstallResult, MarketplaceEntry, PluginManifest } from "./types.js";
import { atomicWrite, copyTree, pathExists, readJson, stableJson } from "./utils.js";
import { validatePlugin } from "./validate.js";

interface MarketplaceManifest {
  name: string;
  interface?: { displayName?: string };
  plugins: MarketplaceEntry[];
}

function emptyMarketplace(name: string): MarketplaceManifest {
  return {
    name,
    interface: { displayName: name === "personal" ? "Personal" : "Repository" },
    plugins: [],
  };
}

function marketplaceLocations(options: InstallOptions): { marketplacePath: string; destinationParent: string; name: string } {
  if (options.marketplace === "personal") {
    return {
      marketplacePath: resolve(homedir(), ".agents", "plugins", "marketplace.json"),
      destinationParent: resolve(homedir(), "plugins"),
      name: "personal",
    };
  }
  if (!options.repoRoot) throw new Error("repoRoot is required for a repository marketplace install.");
  const repoRoot = resolve(options.repoRoot);
  return {
    marketplacePath: resolve(repoRoot, ".agents", "plugins", "marketplace.json"),
    destinationParent: resolve(repoRoot, ".agents", "plugins", "plugins"),
    name: "repo-local",
  };
}

export async function planInstall(rootInput: string, options: InstallOptions): Promise<InstallPlan> {
  const sourceRoot = resolve(rootInput);
  const report = await validatePlugin(sourceRoot, { profile: "local" });
  if (report.status === "invalid") throw new Error("Plugin validation failed; installation was not planned.");
  const manifest = await readJson<PluginManifest>(resolve(sourceRoot, ".codex-plugin", "plugin.json"));
  const locations = marketplaceLocations(options);
  const destinationRoot = resolve(locations.destinationParent, manifest.name);
  const before = (await pathExists(locations.marketplacePath))
    ? await import("node:fs/promises").then(({ readFile }) => readFile(locations.marketplacePath, "utf8"))
    : null;
  const marketplace = before ? (JSON.parse(before) as MarketplaceManifest) : emptyMarketplace(locations.name);
  if (!marketplace || typeof marketplace !== "object" || !Array.isArray(marketplace.plugins)) {
    throw new Error(`Invalid marketplace file: ${locations.marketplacePath}`);
  }
  const conflicts: string[] = [];
  const existingIndex = marketplace.plugins.findIndex((entry) => entry.name === manifest.name);
  if (existingIndex >= 0) conflicts.push(`Marketplace already contains ${manifest.name}.`);
  if (await pathExists(destinationRoot)) conflicts.push(`Destination already exists: ${destinationRoot}`);
  if (conflicts.length > 0 && !options.replace) {
    conflicts.push("Use --replace only after reviewing this preview.");
  }

  const entry: MarketplaceEntry = {
    name: manifest.name,
    source: { source: "local", path: `./plugins/${manifest.name}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: manifest.interface.category,
  };
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = entry;
  else marketplace.plugins.push(entry);

  return {
    sourceRoot,
    destinationRoot,
    marketplacePath: locations.marketplacePath,
    pluginName: manifest.name,
    replace: options.replace === true,
    conflicts,
    before,
    after: stableJson(marketplace),
    rollback: { restoreMarketplace: before, destinationExisted: await pathExists(destinationRoot) },
  };
}

export async function applyInstall(plan: InstallPlan, options: { confirmed: boolean }): Promise<InstallResult> {
  if (!options.confirmed) throw new Error("Installation requires explicit confirmation.");
  if (plan.conflicts.length > 0 && !plan.replace) throw new Error("Installation has unresolved conflicts; use --replace after reviewing the plan.");
  const manifest = await readJson<PluginManifest>(resolve(plan.sourceRoot, ".codex-plugin", "plugin.json"));
  if (manifest.name !== plan.pluginName || basename(plan.destinationRoot) !== plan.pluginName || basename(plan.marketplacePath) !== "marketplace.json") {
    throw new Error("Install plan identity or destination shape is invalid; create a fresh plan with planInstall().");
  }
  const personalDestination = resolve(homedir(), "plugins", plan.pluginName);
  const repositoryDestination = resolve(dirname(plan.marketplacePath), "plugins", plan.pluginName);
  if (resolve(plan.destinationRoot) !== personalDestination && resolve(plan.destinationRoot) !== repositoryDestination) {
    throw new Error("Install destination is not contained in the selected marketplace layout.");
  }
  const marketplaceExists = await pathExists(plan.marketplacePath);
  const currentMarketplace = marketplaceExists ? await readFile(plan.marketplacePath, "utf8") : null;
  if (currentMarketplace !== plan.before) throw new Error("Marketplace changed after preview; create and review a fresh install plan.");
  const destinationExists = await pathExists(plan.destinationRoot);
  if (destinationExists !== plan.rollback.destinationExisted) throw new Error("Destination changed after preview; create and review a fresh install plan.");

  const backupRoot = `${plan.destinationRoot}.rollback-${process.pid}-${Date.now()}`;
  let backupCreated = false;
  try {
    if (destinationExists) {
      if (!plan.replace) throw new Error("Destination exists and replacement was not approved.");
      await rename(plan.destinationRoot, backupRoot);
      backupCreated = true;
    }
    await copyTree(plan.sourceRoot, plan.destinationRoot, {
      exclude: (path) => [".git", "node_modules", "dist", "coverage", "submission", "custom-gpt"].some(
        (segment) => path === segment || path.startsWith(`${segment}/`) || path.includes(`/${segment}/`),
      ),
    });
    await atomicWrite(plan.marketplacePath, plan.after);
    if (backupCreated) await rm(backupRoot, { recursive: true, force: true });
    return { destinationRoot: plan.destinationRoot, marketplacePath: plan.marketplacePath, installed: true };
  } catch (error) {
    if (await pathExists(plan.destinationRoot)) await rm(plan.destinationRoot, { recursive: true, force: true });
    if (backupCreated && await pathExists(backupRoot)) await rename(backupRoot, plan.destinationRoot);
    if (plan.before === null) {
      if (await pathExists(plan.marketplacePath)) await rm(plan.marketplacePath, { force: true });
    } else {
      await atomicWrite(plan.marketplacePath, plan.before);
    }
    throw error;
  }
}
