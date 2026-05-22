#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
echo "Building..."
npm run build
echo "Linking..."
npm link
echo "Done — 'orch' now points to local build."
