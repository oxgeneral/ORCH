#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh patch|minor|major
# Bumps version in package.json + cli.ts, commits, and tags for a GitHub-only release.

BUMP="${1:?Usage: release.sh patch|minor|major}"

# Bump package.json version (no git tag from npm)
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
VERSION="${NEW_VERSION#v}"

# Sync version into cli.ts
sed -i.bak "s/\.version('[^']*')/\.version('${VERSION}')/" src/bin/cli.ts
rm -f src/bin/cli.ts.bak

# Sync version into landing (hero badge, hero sidebar, footer)
sed -i.bak "s/v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/v${VERSION}/g" landing/index.html
rm -f landing/index.html.bak

# Commit and tag
git add package.json package-lock.json src/bin/cli.ts
git add -f landing/index.html
git commit -m "Release ${NEW_VERSION}"
git tag "$NEW_VERSION"

echo ""
echo "  ✓ ${NEW_VERSION}"
echo ""
echo "  Push GitHub release:"
echo "    git push && git push --tags"
echo ""
