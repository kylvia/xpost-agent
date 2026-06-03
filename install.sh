#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$repo_dir"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js first." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 20 or newer first." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Current: $(node -v)" >&2
  exit 1
fi

npm install
npm install -g "$repo_dir/node_modules/@linsoai/browser-relay"
npm install -g .

install_skill() {
  local root="$1"
  mkdir -p "$root/skills"
  for skill_dir in "$repo_dir"/skills/*; do
    [ -d "$skill_dir" ] || continue
    local name
    name="$(basename "$skill_dir")"
    local target="$root/skills/$name"
    rm -rf "$target"
    cp -R "$skill_dir" "$target"
    echo "Installed skill: $target"
  done
}

install_skill "${CODEX_HOME:-$HOME/.codex}"
install_skill "${AGENTS_HOME:-$HOME/.agents}"

browser-relay start || true

echo
echo "xpost installed."
echo
echo "Next checks:"
echo "  browser-relay status"
echo "  browser-relay path"
echo "  xpost health"
echo
echo "Load or reload the Browser Relay Chrome extension from:"
echo "  $(browser-relay path)"
