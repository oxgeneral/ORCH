# Security Policy

Thanks for helping keep ORCH and its users safe.

## Supported Versions

Security fixes land on the latest published minor version on npm (`@oxgeneral/orch`). Older versions are not patched — upgrade to the latest to stay protected.

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's built-in advisory form:

1. Go to the [Security tab](https://github.com/oxgeneral/ORCH/security) of this repository
2. Click **Report a vulnerability**
3. Fill out the advisory form

Please include:

- A clear description of the issue and its impact
- Steps to reproduce (minimal example preferred)
- Affected version(s) and environment (OS, Node version)
- Any suggested fix or mitigation

### What to expect

This is a small open-source project maintained in spare time — please be patient. A realistic expectation:

- **Acknowledgement**: within a week
- **Fix timeline**: based on severity, communicated after triage
- **Credit**: we're glad to credit you in the release notes (unless you prefer to remain anonymous)

## Scope

In scope:
- The `@oxgeneral/orch` npm package and its runtime
- The CLI (`orch`) and TUI
- Adapters that spawn external processes (claude, opencode, codex, cursor, shell)
- File storage under `.orchestry/` (YAML/JSON/JSONL)
- Template rendering (LiquidJS prompts)

Out of scope:
- Vulnerabilities in external AI tools (Claude CLI, OpenCode, etc.) — report those upstream
- Misconfiguration by end users (e.g., running untrusted skills, exposing API keys)
- Denial-of-service via self-inflicted resource exhaustion

## Disclosure

We prefer **coordinated disclosure**: give us a reasonable window to release a fix before publishing details. Low-impact issues can be disclosed sooner; critical issues may need longer — we'll agree a timeline together.

Thank you for reporting responsibly.
