import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "docs/images/readme");
await mkdir(out, { recursive: true });

const captures = {
  "cli-init.webp": {
    title: "PowerShell — initialize the canonical demo",
    lines: [
      "> chatgpt-spawn init meeting-follow-up --template skill …",
      "Created meeting-follow-up from the skill template.",
      "  + .codex-plugin/plugin.json",
      "  + skills/meeting-follow-up/SKILL.md",
      "  + skills/meeting-follow-up/agents/openai.yaml",
      "  + submission/chatgpt-submission.yaml",
      "",
      "Next: chatgpt-spawn validate \"C:\\tmp\\cgus-docs-v010\\meeting-follow-up\"",
    ],
  },
  "validation-pass.webp": {
    title: "PowerShell — local validation",
    lines: [
      "> chatgpt-spawn validate meeting-follow-up --profile local",
      "PASS local validation: valid",
      "  Rules checked: plugin-schema, component-paths, skills, mcp-config,",
      "  app-config, secrets, archive-safety",
    ],
  },
  "validation-error.webp": {
    title: "PowerShell — actionable validation failure",
    lines: [
      "> chatgpt-spawn validate tests/fixtures/invalid-plugin --profile local",
      "FAIL local validation: invalid",
      "  ERROR plugin.schema  .codex-plugin/plugin.json/version                 [1]",
      "    must match strict semantic versioning",
      "  ERROR path.missing  .codex-plugin/plugin.json#interface/…              [2]",
      "    Referenced path does not exist: ./assets/missing.svg",
      "  ERROR skill.trigger  skills/invalid-plugin/SKILL.md                    [3]",
      "    Skill description must include a focused ‘Use when …’ trigger.",
    ],
  },
  "build-output.webp": {
    title: "PowerShell — deterministic build",
    lines: [
      "> chatgpt-spawn build meeting-follow-up --out dist/meeting-follow-up.zip",
      "Build complete",
      "  Archive:  C:\\tmp\\cgus-docs-v010\\dist\\meeting-follow-up.zip",
      "  SHA-256:  3fbb5bdd4d0d027dac38ea673c6afa54578ecaddb89bd1a9895c72c95024304b",
      "  Files:    3",
      "  Bytes:    1445",
      "  Checksum: C:\\tmp\\cgus-docs-v010\\dist\\meeting-follow-up.zip.sha256",
    ],
  },
  "marketplace-preview.webp": {
    title: "PowerShell — repository marketplace dry run",
    lines: [
      "> chatgpt-spawn install meeting-follow-up --marketplace repo --dry-run",
      "Install preview",
      "  Plugin:      meeting-follow-up",
      "  Source:      C:\\tmp\\cgus-docs-v010\\meeting-follow-up",
      "  Destination: C:\\tmp\\cgus-docs-v010\\repository\\.agents\\plugins\\plugins\\meeting-follow-up",
      "  Marketplace: C:\\tmp\\cgus-docs-v010\\repository\\.agents\\plugins\\marketplace.json",
      "  Replace:     no",
      "",
      "  source.path: ./plugins/meeting-follow-up",
      "  installation: AVAILABLE · authentication: ON_INSTALL",
      "  rollback: delete newly-created marketplace · destination existed: no",
      "",
      "Dry run complete; nothing was written.",
    ],
  },
  "custom-gpt-export.webp": {
    title: "PowerShell — manual Custom GPT bundle",
    lines: [
      "> chatgpt-spawn export custom-gpt catalog-lookup-action --out custom-gpt-export",
      "Custom GPT export complete",
      "  Directory: C:\\tmp\\cgus-docs-v010\\custom-gpt-export",
      "  Files:     6",
      "  Checksums: C:\\tmp\\cgus-docs-v010\\custom-gpt-export\\SHA256SUMS",
      "  Next: follow EDITOR-CHECKLIST.md in the ChatGPT GPT editor.",
    ],
  },
  "publish-preflight.webp": {
    title: "PowerShell — publish preflight",
    lines: [
      "> chatgpt-spawn validate examples/meeting-follow-up --profile publish",
      "MANUAL publish validation: manual_required",
      "  Manual checks:",
      "    [ ] Verified developer or business identity",
      "    [ ] Apps Management write access",
      "    [ ] Reviewer access works without MFA or private-network dependencies",
      "  Automated checks passed; exit code 2 means human verification remains.",
    ],
  },
};

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function frame(title, lines) {
  const width = 1280;
  const lineHeight = 31;
  const height = 105 + lines.length * lineHeight + 35;
  const text = lines.map((line, index) => `<text x="48" y="${103 + index * lineHeight}" fill="${index === 1 && /PASS|MANUAL|Build|Custom/.test(line) ? "#5EEAD4" : line.includes("ERROR") ? "#FCA5A5" : "#E2E8F0"}">${escapeXml(line || " ")}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><rect width="${width}" height="${height}" rx="18" fill="#0B1020"/><rect width="${width}" height="58" rx="18" fill="#172033"/><rect y="40" width="${width}" height="18" fill="#172033"/><circle cx="28" cy="29" r="7" fill="#FB7185"/><circle cx="52" cy="29" r="7" fill="#FBBF24"/><circle cx="76" cy="29" r="7" fill="#34D399"/><text x="110" y="36" fill="#CBD5E1" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="650">${escapeXml(title)}</text><g font-family="Cascadia Mono,ui-monospace,SFMono-Regular,Consolas,monospace" font-size="18">${text}</g></svg>`;
}

for (const [filename, capture] of Object.entries(captures)) {
  await sharp(Buffer.from(frame(capture.title, capture.lines)))
    .webp({ quality: 82, effort: 6 })
    .toFile(resolve(out, filename));
}
