# Release process

## Prepare

1. Update `CHANGELOG.md`, package version, companion plugin version, and documentation date together.
2. Verify the first-party URLs and semantic fingerprints in `compat/openai-docs.lock.json`.
3. Regenerate `assets/brand/*.png` and README WebP captures only when their SVG sources or verified transcripts change.
4. Run `npm ci`, `npm run verify`, and `npm pack --dry-run`.
5. Inspect the package inventory. It must not contain `.git`, `node_modules`, test fixtures, preflight submissions, `.env`, private keys, or debug payloads.

## Tag and publish

1. Create a signed `v<version>` tag on the reviewed commit.
2. Publish the npm package using provenance-enabled trusted publishing when configured.
3. Attach the packed archive and checksum to the GitHub release.
4. Verify installation from the published package in a clean task-owned directory.
5. Capture authenticated ChatGPT UI screenshots only during a real registered-app test, then redact account data before committing them.

The repository never automates GPT Store submission or publisher attestations.
