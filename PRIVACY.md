# Privacy

ChatGPT Universal Spawn is a local developer tool. The CLI does not collect telemetry, stage credentials, or send plugin contents to AgentMindCloud. Offline validation is the default. Network access occurs only when a user explicitly passes `--online` or `doctor --check-docs`, and then only to the URLs declared by the plugin or documentation lock.

Plugins created with this toolkit have their own privacy responsibilities. Review every MCP endpoint, action, tool annotation, and content-security-policy domain before installation or publication.
