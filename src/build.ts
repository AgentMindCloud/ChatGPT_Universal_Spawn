import { mkdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { zipSync, type Zippable } from "fflate";
import type { BuildOptions, BuildResult } from "./types.js";
import { atomicWrite, isInside, sha256, walkFiles } from "./utils.js";
import { validatePlugin } from "./validate.js";

const FIXED_MTIME = new Date("1980-01-01T00:00:00.000Z");
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "dist", "coverage"]);
const EXCLUDED_ROOTS = new Set(["submission", "custom-gpt"]);

function includeInArchive(path: string): boolean {
  const segments = path.split("/");
  return !segments.some((segment) => EXCLUDED_SEGMENTS.has(segment)) && !EXCLUDED_ROOTS.has(segments[0] ?? "");
}

export async function buildPluginArchive(rootInput: string, options: BuildOptions): Promise<BuildResult> {
  const root = resolve(rootInput);
  const archivePath = resolve(options.out);
  if (isInside(root, archivePath)) throw new Error("Build output must be outside the plugin source tree to prevent recursive archives.");
  const report = await validatePlugin(root, { profile: "local" });
  if (report.status === "invalid") {
    const summary = report.errors.map((item) => `${item.code}: ${item.message}`).join("\n");
    throw new Error(`Plugin validation failed before build.\n${summary}`);
  }

  const files = (await walkFiles(root))
    .map((item) => {
      if (item.endsWith("::symlink")) throw new Error(`Symbolic links cannot be archived: ${item.slice(0, -9)}`);
      return item;
    })
    .filter(includeInArchive)
    .sort((left, right) => left.localeCompare(right));
  const archive: Zippable = {};
  for (const path of files) {
    const fullPath = resolve(root, ...path.split("/"));
    const normalized = relative(root, fullPath).split(sep).join("/");
    archive[normalized] = [new Uint8Array(await readFile(fullPath)), { mtime: FIXED_MTIME, level: 9 }];
  }

  const data = zipSync(archive, { level: 9 });
  const checksumPath = `${archivePath}.sha256`;
  const digest = sha256(data);
  await mkdir(dirname(archivePath), { recursive: true });
  await atomicWrite(archivePath, data);
  await atomicWrite(checksumPath, `${digest}  ${archivePath.split(/[\\/]/).at(-1) ?? "plugin.zip"}\n`);
  return { archivePath, checksumPath, sha256: digest, bytes: data.byteLength, files };
}
