import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorOptions, DoctorResult } from "./types.js";
import { pathExists, readJson } from "./utils.js";
import { validatePlugin } from "./validate.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function doctorPlugin(rootInput: string, options: DoctorOptions = {}): Promise<DoctorResult> {
  const root = resolve(rootInput);
  const checks = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ id: "node", ok: nodeMajor >= 20, message: `Node.js ${process.versions.node}; version 20 or newer is required.` });
  const report = await validatePlugin(root, { profile: "local" });
  checks.push({ id: "plugin", ok: report.status !== "invalid", message: `${report.errors.length} error(s), ${report.warnings.length} warning(s).` });
  const personalMarketplace = resolve(homedir(), ".agents", "plugins", "marketplace.json");
  const marketplaceExists = await pathExists(personalMarketplace);
  checks.push({ id: "marketplace", ok: true, message: marketplaceExists ? personalMarketplace : `Ready to create on explicit install: ${personalMarketplace}` });
  const lockPath = resolve(PACKAGE_ROOT, "compat", "openai-docs.lock.json");
  const lock = await readJson<{ checkedAt: string; sources: Array<{ url: string; expectedTerms?: string[] }> }>(lockPath);
  checks.push({ id: "docs-lock", ok: Array.isArray(lock.sources) && lock.sources.length > 0, message: `Documentation snapshot checked ${lock.checkedAt}.` });
  if (options.checkDocs) {
    let ok = true;
    const failures: string[] = [];
    for (const source of lock.sources) {
      try {
        const response = await fetch(source.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
          failures.push(`${source.url} (${response.status})`);
          continue;
        }
        const body = (await response.text()).toLowerCase();
        const missing = (source.expectedTerms ?? []).filter((term) => !body.includes(term.toLowerCase()));
        if (missing.length > 0) failures.push(`${source.url} (missing semantic terms: ${missing.join(", ")})`);
      } catch (error) {
        failures.push(`${source.url} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    ok = failures.length === 0;
    checks.push({ id: "docs-online", ok, message: ok ? "All locked first-party documentation URLs responded." : failures.join("; ") });
  }
  return { ok: checks.every((check) => check.ok), checks };
}
