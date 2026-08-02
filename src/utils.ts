import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const UTF8 = "utf8" as const;

export function normalizePluginName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function displayNameFromPluginName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return resolvedCandidate;
  }
  throw new Error(`Path escapes the allowed root: ${candidate}`);
}

export function isInside(root: string, candidate: string): boolean {
  try {
    assertInside(root, candidate);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, UTF8)) as T;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

export async function copyTree(
  sourceRoot: string,
  destinationRoot: string,
  options: { replace?: boolean; exclude?: (relativePath: string) => boolean } = {},
): Promise<string[]> {
  if (await pathExists(destinationRoot)) {
    if (!options.replace) {
      throw new Error(`Destination already exists: ${destinationRoot}`);
    }
    await rm(destinationRoot, { recursive: true, force: true });
  }
  await mkdir(destinationRoot, { recursive: true });
  const copied: string[] = [];

  async function visit(currentSource: string): Promise<void> {
    const entries = await readdir(currentSource, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const source = resolve(currentSource, entry.name);
      const rel = relative(sourceRoot, source).split(sep).join("/");
      if (options.exclude?.(rel)) continue;
      const destination = assertInside(destinationRoot, resolve(destinationRoot, rel));
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported: ${rel}`);
      }
      if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await visit(source);
      } else if (entry.isFile()) {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, await readFile(source));
        copied.push(rel);
      }
    }
  }

  await visit(resolve(sourceRoot));
  return copied;
}

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        files.push(`${rel}::symlink`);
      } else if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await visit(resolve(root));
  return files;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}
