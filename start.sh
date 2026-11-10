#!/usr/bin/env bash
# Career-Ops Platform — one-command start for macOS / Linux.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 22 LTS or newer from https://nodejs.org" >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Node.js 22 or newer is required (found $(node -v))." >&2
  exit 1
fi

if [ ! -d node_modules/js-yaml ]; then
  echo "Installing core dependencies…"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
fi
cd platform
if [ ! -d node_modules/express ]; then
  echo "Installing platform dependencies…"
  npm install --no-audit --no-fund
fi
node scripts/setup.mjs
echo
echo "Starting the web server and the job scheduler. Press Ctrl+C to stop."
exec node scripts/start-all.mjs "$@"
