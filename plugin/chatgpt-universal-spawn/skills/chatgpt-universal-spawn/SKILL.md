---
name: chatgpt-universal-spawn
description: Use when a user wants to choose, create, validate, package, link, export, or locally install a ChatGPT-first workflow made from skills, MCP tools, or an MCP Apps UI, including a prompt-only route for normal ChatGPT accounts.
---

# ChatGPT Universal Spawn

Guide the user from an idea to either a portable personal-chat prompt or a reviewable plugin package. Explain unfamiliar terms before asking the user to choose a template.

## Choose the smallest template

- Use `skill` for instructions and repeatable workflows that need no new network tool.
- Use `mcp` when ChatGPT must call a remote or local MCP tool.
- Use `mcp-ui` when the tool also needs an interactive MCP Apps interface.
- Use `custom-gpt-action` only when the user wants artifacts for the manual Custom GPT editor.
- When the user has no workspace, app ID, API key, or plugin marketplace, use `skill` and finish with `export personal-chat`.

## Safe workflow

1. Confirm the plugin’s outcome, users, data sources, write actions, and whether any service leaves the local machine.
2. Run `chatgpt-spawn init` with real metadata. Never leave placeholder values.
3. Review the generated manifest, skill triggers, and least-privilege capabilities with the user.
4. Run local validation. Resolve every error; explain warnings.
5. Build only after local validation passes.
6. For normal ChatGPT accounts, export a personal prompt pack and stop; do not require registration or installation.
7. For MCP Apps, ask the user to register the app in ChatGPT Apps Management, then link only the real `plugin_asdk_app...` ID they provide.
8. Run `install --dry-run` and show the full destination, marketplace diff, conflicts, and rollback data.
9. Install only after explicit confirmation. Noninteractive installation requires `--yes`.
10. Treat publish-profile manual checks as human attestations, never as machine-proven facts.

## Boundaries

- Do not request, print, move, or store secret values. Document secret names only.
- Do not claim that the CLI creates or publishes a Custom GPT.
- Do not claim OpenAI endorsement or approval.
- Do not infer that static validation makes third-party code or endpoints safe.
- Keep all normal scaffold, build, and export writes inside the user-selected target.
- Do not imply that a prompt-only export installs tools or reproduces MCP capabilities.

## Completion

Return the exact validation status, export or archive checksum, output or installation destination, and any manual checks still required.
