# Implementation Status

## Architecture

ORCH uses layered domain, application, infrastructure, and CLI/TUI modules. The dedicated workflow domain persists contracts, a compact passport, sessions, usage, canonical artifacts, and events under `.orchestry/workflows/`. `WorkflowEngine` coordinates injected Codex, Fable, Opus, and Git ports independently from the generic goal state machine.

## Security Baseline

Dangerous permission bypass and shell execution are disabled by default and require config plus `ORCHESTRY_ALLOW_DANGEROUS_EXECUTION=1`. Prompt transport, restricted child environments, redaction, no-persistence defaults, path/symlink checks, opt-in postinstall behavior, private package metadata, and absence of background npm installs are protected by `test/security/security-regression.test.ts`.

## Verification

The deterministic fake-adapter workflow covers planning, bounded replans, patch validation, session recovery, FIX and REPLAN behavior, review joining, stale commit and diff approvals, deterministic checks, and fail-closed merging. The final local run passed 2,075 tests across 128 files with 2 skips, typecheck, build, `git diff --check`, package dry-run, and `npm audit` with zero advisories.

## Upstream Reconciliation

The fork and upstream were fetched and compared before implementation. Changes restoring Cursor `--yolo`, shell convenience defaults, npm publishing, and other unsafe execution behavior were rejected. The later Pi terminal-failure fix was reviewed as safe but deferred because it is unrelated to this pipeline and changes a large adapter surface; no wholesale upstream merge was performed.

## Limitation

Neither `claude` nor `codex` is installed on the development host, so their local help output and native resume behavior could not be verified. `orch workflow doctor` reports this plainly. The controller uses the durable passport/worktree fallback instead of inventing unverified resume syntax. `start` runs autonomously in the foreground after printing the recoverable job ID.
