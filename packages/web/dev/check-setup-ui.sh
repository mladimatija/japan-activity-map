#!/bin/sh
# Server-renders every screen of the setup page, in English and Japanese, with the real steps
# (written by packages/cli/dev/setup-views.ts from the example configs). Needs no build and no data.
set -e
cd "$(dirname "$0")/../../.."
out="${JAM_SETUP_UI_OUT:-$PWD/packages/web/node_modules/.check-setup-ui}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export JAM_SETUP_UI_OUT="$out" JAM_SETUP_VIEWS="$tmp/views.json"
JAM_DATA_DIR="$tmp/data" NODE_NO_WARNINGS=1 node packages/cli/dev/setup-views.ts "$JAM_SETUP_VIEWS"
vp build --config packages/web/dev/check-setup-ui.config.ts
node "$out/check-setup-ui.mjs"
