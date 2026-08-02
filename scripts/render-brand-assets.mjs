import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const root = resolve(import.meta.dirname, "..");

await sharp(await readFile(resolve(root, "assets/brand/logo-mark.svg")))
  .resize(512, 512)
  .png({ compressionLevel: 9, palette: true })
  .toFile(resolve(root, "assets/brand/logo-512.png"));

await sharp(await readFile(resolve(root, "assets/brand/logo-mark.svg")))
  .resize(64, 64)
  .png({ compressionLevel: 9, palette: true })
  .toFile(resolve(root, "assets/brand/favicon.png"));

await sharp(await readFile(resolve(root, "assets/brand/social-card.svg")))
  .resize(1200, 630)
  .png({ compressionLevel: 9, palette: true })
  .toFile(resolve(root, "assets/brand/social-card.png"));
