#!/usr/bin/env bash
# Builds dist/home-base-extension.zip for uploading to the Chrome Web Store.
# Only the extension's own files are included. The "key" field is removed because
# the Web Store assigns its own extension ID.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

cp newtab.html newtab.css newtab.js "$BUILD/"
cp -R icons "$BUILD/icons"
node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  delete manifest.key;
  fs.writeFileSync(process.argv[1], JSON.stringify(manifest, null, 2) + "\n");
' "$BUILD/manifest.json"

mkdir -p dist
rm -f dist/home-base-extension.zip
(cd "$BUILD" && zip -qr "$ROOT/dist/home-base-extension.zip" .)
echo "Built $ROOT/dist/home-base-extension.zip"
