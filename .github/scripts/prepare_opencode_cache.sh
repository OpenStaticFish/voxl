#!/usr/bin/env bash
# Point opencode's cache at /tmp so it lands in the diagnostics artifact.
set -euo pipefail

cache_dir="${1:-/tmp/opencode-cache}"
mkdir -p "$cache_dir"
printf 'XDG_CACHE_HOME=%s\n' "$cache_dir" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
