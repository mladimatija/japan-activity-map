#!/bin/sh
# Server-renders the panel against the real build in dist/data. Build the data first (pnpm jam build).
set -e
cd "$(dirname "$0")/../../.."
out="${JAM_WEB_CHECK_OUT:-$PWD/packages/web/node_modules/.check-web}"
export JAM_WEB_CHECK_OUT="$out"
vp build --config packages/web/dev/check-web.config.ts
node "$out/check-web.mjs"
