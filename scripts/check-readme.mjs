import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = await readFile(resolve(root, "README.md"), "utf8");
const failures = [];
const referenced = new Set();

for (const match of readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
  const alt = match[1]?.trim() ?? "";
  const source = match[2]?.trim() ?? "";
  if (!alt) failures.push(`Markdown image has empty alt text: ${source}`);
  if (!/^https?:\/\//.test(source)) referenced.add(source.replace(/^\.\//, ""));
}

for (const match of readme.matchAll(/<img\b[^>]*>/gi)) {
  const tag = match[0];
  const alt = /\balt="([^"]*)"/i.exec(tag)?.[1]?.trim() ?? "";
  const source = /\bsrc="([^"]+)"/i.exec(tag)?.[1]?.trim() ?? "";
  if (!alt) failures.push(`HTML image has empty alt text: ${source || tag}`);
  if (source && !/^https?:\/\//.test(source)) referenced.add(source.replace(/^\.\//, ""));
}

for (const path of referenced) {
  try {
    await stat(resolve(root, path));
  } catch {
    failures.push(`README image does not exist: ${path}`);
  }
}

const mediaRoot = resolve(root, "docs/images/readme");
const mediaFiles = (await readdir(mediaRoot)).filter((name) => !name.startsWith("."));
let totalBytes = 0;
for (const name of mediaFiles) {
  const path = `docs/images/readme/${name}`;
  const details = await stat(resolve(root, path));
  totalBytes += details.size;
  if (!referenced.has(path)) failures.push(`README media is not referenced: ${path}`);
  if (name.endsWith(".webp") && details.size > 250_000) failures.push(`Screenshot exceeds 250 KB: ${path}`);
}
if (totalBytes > 3_000_000) failures.push(`README media exceeds 3 MB: ${totalBytes} bytes`);

const required = [
  "workflow-overview.svg",
  "choose-template.svg",
  "cli-init.webp",
  "generated-tree.svg",
  "validation-pass.webp",
  "validation-error.webp",
  "build-output.webp",
  "marketplace-preview.webp",
  "chatgpt-developer-mode.svg",
  "chatgpt-plugin-installed.svg",
  "chatgpt-plugin-use.svg",
  "custom-gpt-export.webp",
  "publish-preflight.webp",
];
for (const name of required) if (!mediaFiles.includes(name)) failures.push(`Required README visual is missing: ${name}`);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`README media check passed: ${mediaFiles.length} files, ${totalBytes} bytes, all referenced with alt text.`);
}
