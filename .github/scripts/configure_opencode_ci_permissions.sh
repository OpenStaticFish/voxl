#!/usr/bin/env bash
# Allow opencode to run tools non-interactively in CI (no TTY to prompt on).
set -euo pipefail

config_dir="${HOME:?HOME is required}/.config/opencode"
mkdir -p "$config_dir"

cat > "$config_dir/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
JSON

echo "Configured opencode CI permissions at $config_dir/opencode.json"
