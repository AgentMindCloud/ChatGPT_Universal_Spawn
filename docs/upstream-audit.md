# Upstream audit

## Scope and provenance

The rewrite began from `AgentMindCloud/ChatGPT_Universal_Spawn` commit `b35bc1fb6aa6e6315365352a5ed1fef05d41e3b6`. The analyzed `universal-spawn-main.zip` contained 1,374 files and has SHA-256 `F2AEDF68C5616C06FB5D406D5DFB5DF7BD545E78CB94F31815B73F135DC7AB05`.

## Retained as principles

- Apache-2.0 licensing and upstream attribution.
- Deterministic, strict validation and schema-backed examples.
- Least-privilege defaults, secret-name-only configuration, path containment, and human confirmation.
- Skills and MCP as the portable compatibility boundary.

## Replaced

- Duplicated OpenAI layouts were replaced by one canonical `.codex-plugin/plugin.json` package.
- Multiple generator and validator implementations were replaced by one Node.js 20+ TypeScript/ESM package.
- The old visual system was replaced by an original portal-and-conversation identity.
- Speculative or outdated product descriptions were replaced by first-party OpenAI documentation links locked in `compat/openai-docs.lock.json`.

## Removed

The rewrite does not import the 964-file platform catalog, 148 generator scripts, hosting/gaming/creative/hardware templates, Grok migrations, funding pages, speculative perks, conflicting specifications, or duplicate validator stacks. It also excludes named Claude, Gemini, and Grok adapters; Assistants registration; model presets; fictional OpenAI CLI entrypoints; automatic GPT Store publishing; automatic secret staging; spending-cap guarantees; and sandbox-enforcement claims.

Responses API, Agents SDK, and Realtime scaffolding remain intentionally outside v1. MCP and skill interoperability may allow secondary clients to consume a package, but ChatGPT Work is the product priority.
