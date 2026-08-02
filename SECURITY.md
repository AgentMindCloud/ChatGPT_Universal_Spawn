# Security policy

## Supported version

Security fixes are provided for the latest published minor release. This project is pre-1.0, so upgrade to the newest `0.x` release before reporting an issue.

## Report a vulnerability

Do not open a public issue containing a credential, exploit payload, or private endpoint. Use [GitHub private vulnerability reporting](https://github.com/AgentMindCloud/ChatGPT_Universal_Spawn/security/advisories/new). Include the affected version, a minimal reproduction, impact, and safe contact details. Never include live access tokens.

## Trust boundary

The CLI performs static checks and contained filesystem operations. It does not claim to sandbox plugin code, enforce provider spending limits, verify publisher identity, or make a remote MCP service safe. Review generated content and every installation preview before confirming it.
