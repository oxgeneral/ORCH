# Releasing ORCH

## Quick release

```bash
./scripts/release.sh patch    # 0.2.2 → 0.2.3
./scripts/release.sh minor    # 0.2.2 → 0.3.0
./scripts/release.sh major    # 0.2.2 → 1.0.0

git push && git push --tags
```

That's it. The release script bumps the version, commits, and tags. Pushing the tag triggers GitHub Actions to publish to npm automatically.

## What happens

### `release.sh` updates version in:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `package-lock.json` | `"version"` |
| `src/bin/cli.ts` | `.version('X.Y.Z')` |
| `landing/index.html` | `vX.Y.Z — open source` |

### GitHub Actions (on tag push `v*`):

1. **CI** (`ci.yml`) — runs `typecheck` + `test`
2. **Publish** (`publish.yml`) — runs CI checks, then `npm publish` to npmjs.org

### npm token

The `NPM_TOKEN` secret is configured in the GitHub repo settings. If the token expires, generate a new Granular Access Token at https://www.npmjs.com/settings/0xgeneral/tokens with:
- Packages: **Read and write**
- 2FA bypass: **enabled**

Then update: `gh secret set NPM_TOKEN --repo oxgeneral/ORCH --body "npm_NEW_TOKEN"`

## Manual publish (fallback)

If GitHub Actions fails:

```bash
npm publish --registry https://registry.npmjs.org/
```

## What to update manually

These are NOT auto-updated by the release script:

| File | What to update |
|------|---------------|
| `CHANGELOG.md` | Add release notes before running release.sh |
| `readme.md` | Test count badge (if changed significantly) |

## Verifying a release

```bash
# Check published version
npm view @oxgeneral/orch version

# Test install
npm install -g @oxgeneral/orch@latest
orch --version
```

## Users update via

```bash
orch update              # auto-check and install
npm install -g @oxgeneral/orch@latest   # manual
```
