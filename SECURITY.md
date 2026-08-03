# Security Policy

## Supported Distribution

Only the secured fork at [Thibault1818/ORCH](https://github.com/Thibault1818/ORCH) is covered by this policy. It is a private/local package and is not published to npm. Install from the fork at an audited commit or tag; do not substitute the upstream npm package.

```bash
npm install -g "git+https://github.com/Thibault1818/ORCH.git#7ea78932cca32b305c6b2a97a1e4a320411a00de"
```

## Security Defaults

- Permission bypass and the shell adapter default to disabled.
- Dangerous execution requires both the corresponding config flag and `ORCHESTRY_ALLOW_DANGEROUS_EXECUTION=1`.
- Prompts are sent over stdin where supported, excluded from child environments, and not persisted by default.
- Child environments are allowlisted; persisted data and terminal output are redacted.
- Worktree isolation, path containment, identifier validation, and symlink checks protect local state.
- Postinstall exits without side effects unless `ORCH_POSTINSTALL_OPT_IN=1`.
- ORCH does not install npm packages automatically or in the background. `orch update` only displays the secured fork's explicit update procedure.

These invariants are enforced by `test/security/security-regression.test.ts` and CI.

## Reporting

Do not open a public issue for a vulnerability. Use the fork's [private security advisory form](https://github.com/Thibault1818/ORCH/security/advisories/new) and include impact, reproduction steps, affected commit, OS, and Node.js version.

External agent CLI vulnerabilities remain the responsibility of their respective vendors.
