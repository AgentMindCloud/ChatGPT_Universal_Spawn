# Contributing

1. Use Node.js 20 or newer and run `npm ci`.
2. Create a focused branch and include tests for behavior changes.
3. Run `npm run check`, `npm test`, `npm run build`, and `npm run validate:self`.
4. Keep templates credential-free, deterministic, and specific to supported ChatGPT plugin surfaces.
5. Update `compat/openai-docs.lock.json` only after checking the linked first-party OpenAI documentation.

Contributions must not add unrelated platform catalogs, automated secret staging, claims of OpenAI endorsement, or unsupported automatic GPT Store publishing.
