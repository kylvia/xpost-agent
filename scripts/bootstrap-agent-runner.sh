#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"

usage() {
  cat <<'USAGE'
Usage:
  scripts/bootstrap-agent-runner.sh

Environment overrides:
  XPOST_ACCOUNT=your_x_handle
  XPOST_X_INTERVAL=180
  XPOST_REDNOTE_INTERVAL=300
  XPOST_DAILY_COUNT=5
  XPOST_REDNOTE_COUNT=2
  XPOST_X_WINDOW_START=10:00
  XPOST_X_WINDOW_END=23:00
  XPOST_REDNOTE_WINDOW_START=11:00
  XPOST_REDNOTE_WINDOW_END=21:30
  XPOST_REDNOTE_IMAGE_PROVIDER=liao
  XPOST_METRICS_TIME=09:30
  XPOST_METRICS_DAYS=2
  XPOST_MODEL=claude-opus-4-8
  XPOST_THINKING_SKILL=creator-systems
  XPOST_SKILL=realist-perspective
  XPOST_GENERATOR=api|codex
  XPOST_FALLBACK_MODELS=gemini-3.1-pro-preview
  XPOST_API_TIMEOUT_MS=60000
  XPOST_CODEX_MODEL=
  XPOST_SKIP_TESTS=0
  XPOST_KICKSTART_DAILY=0

Requires XPOST_LIAOBOTS_AUTHCODE in the environment or project .env.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap installs macOS launchd services and must run on macOS." >&2
  exit 1
fi

if [[ -f "$repo_dir/.env" ]]; then
  set -a
  . "$repo_dir/.env"
  set +a
fi

if [[ -z "${XPOST_LIAOBOTS_AUTHCODE:-}" && -z "${LIAOBOTS_AUTHCODE:-}" ]]; then
  echo "Missing XPOST_LIAOBOTS_AUTHCODE. Add it to .env or export it before running." >&2
  exit 1
fi

x_account="${XPOST_ACCOUNT:-}"
x_interval="${XPOST_X_INTERVAL:-180}"
rednote_interval="${XPOST_REDNOTE_INTERVAL:-300}"
daily_count="${XPOST_DAILY_COUNT:-5}"
rednote_count="${XPOST_REDNOTE_COUNT:-2}"
x_window_start="${XPOST_X_WINDOW_START:-10:00}"
x_window_end="${XPOST_X_WINDOW_END:-23:00}"
rednote_window_start="${XPOST_REDNOTE_WINDOW_START:-11:00}"
rednote_window_end="${XPOST_REDNOTE_WINDOW_END:-21:30}"
rednote_image_provider="${XPOST_REDNOTE_IMAGE_PROVIDER:-liao}"
metrics_time="${XPOST_METRICS_TIME:-09:30}"
metrics_days="${XPOST_METRICS_DAYS:-2}"
model="${XPOST_MODEL:-${XPOST_CHAT_MODEL:-claude-opus-4-8}}"
thinking_skill="${XPOST_THINKING_SKILL:-creator-systems}"
voice_skill="${XPOST_SKILL:-realist-perspective}"
generator="${XPOST_GENERATOR:-}"
fallback_models="${XPOST_FALLBACK_MODELS:-}"
api_timeout_ms="${XPOST_API_TIMEOUT_MS:-}"
codex_model="${XPOST_CODEX_MODEL:-}"
skip_tests="${XPOST_SKIP_TESTS:-0}"
kickstart_daily="${XPOST_KICKSTART_DAILY:-0}"

echo "Installing xpost-agent dependencies and local skills..."
"$repo_dir/install.sh"

if [[ "$skip_tests" != "1" ]]; then
  echo "Running verification..."
  npm test
  npm run check
fi

echo "Reloading launchd services..."
node bin/xpost.js service stop --kind daily-agent --json >/dev/null || true
node bin/xpost.js service stop --json >/dev/null || true
node bin/xpost.js service stop --kind rednote --json >/dev/null || true
node bin/xpost.js service stop --kind metrics --json >/dev/null || true

daily_args=()
if [[ -n "$model" ]]; then
  daily_args+=(--model "$model")
fi
if [[ -n "$thinking_skill" ]]; then
  daily_args+=(--thinking-skill "$thinking_skill")
fi
if [[ -n "$voice_skill" ]]; then
  daily_args+=(--skill "$voice_skill")
fi
if [[ -n "$generator" ]]; then
  daily_args+=(--generator "$generator")
fi
if [[ -n "$fallback_models" ]]; then
  daily_args+=(--fallback-models "$fallback_models")
fi
if [[ -n "$api_timeout_ms" ]]; then
  daily_args+=(--api-timeout-ms "$api_timeout_ms")
fi
if [[ -n "$codex_model" ]]; then
  daily_args+=(--codex-model "$codex_model")
fi

node bin/xpost.js service install \
  --kind daily-agent \
  --yes \
  --schedule daily-random \
  --count "$daily_count" \
  --rednote-count "$rednote_count" \
  --x-window-start "$x_window_start" \
  --x-window-end "$x_window_end" \
  --rednote-window-start "$rednote_window_start" \
  --rednote-window-end "$rednote_window_end" \
  "${daily_args[@]}" \
  --json

worker_args=()
if [[ -n "$x_account" ]]; then
  worker_args+=(--account "$x_account")
fi

node bin/xpost.js service install --yes --interval "$x_interval" "${worker_args[@]}" --json

node bin/xpost.js service install \
  --kind rednote \
  --yes \
  --interval "$rednote_interval" \
  --publish \
  --image-provider "$rednote_image_provider" \
  --json

node bin/xpost.js service install \
  --kind metrics \
  --yes \
  --metrics-time "$metrics_time" \
  --metrics-days "$metrics_days" \
  --source daily-plan \
  --json

if [[ "$kickstart_daily" == "1" ]]; then
  node bin/xpost.js service start --kind daily-agent --kickstart --json
else
node bin/xpost.js service start --kind daily-agent --json
fi
node bin/xpost.js service start --json
node bin/xpost.js service start --kind rednote --json
node bin/xpost.js service start --kind metrics --json

echo
echo "Service status:"
node bin/xpost.js service status --kind daily-agent --json
node bin/xpost.js service status --json
node bin/xpost.js service status --kind rednote --json
node bin/xpost.js service status --kind metrics --json

echo
echo "Browser Relay status:"
browser-relay status || true

echo
echo "Chrome session check:"
node bin/xpost.js health --json || true

echo
echo "Bootstrap complete. Open Chrome and make sure Browser Relay, X, and Xiaohongshu sessions are logged in."
