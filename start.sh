#!/usr/bin/env sh
# FableChat launcher for macOS and Linux. Double-click it, or run ./start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "FableChat needs Node.js 22.18 or newer, and it isn't installed."
  echo "Get it from https://nodejs.org (the \"LTS\" download is fine), then run this again."
  echo
  exit 1
fi

exec node scripts/start.mjs "$@"
