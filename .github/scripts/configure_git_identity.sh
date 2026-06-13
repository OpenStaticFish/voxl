#!/usr/bin/env bash
# Give the local checkout a stable identity so opencode can commit if needed.
set -euo pipefail

name="${1:?git user name required}"
email="${2:?git user email required}"

git config user.name "$name"
git config user.email "$email"
