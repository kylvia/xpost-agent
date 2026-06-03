"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const installPath = path.join(repoRoot, "install.sh");
const scriptPath = path.join(repoRoot, "scripts", "bootstrap-agent-runner.sh");

test("install script installs Browser Relay from the locked local dependency", () => {
  const script = fs.readFileSync(installPath, "utf8");

  assert.match(script, /npm install\s*\n+npm install -g "\$repo_dir\/node_modules\/@linsoai\/browser-relay"/);
  assert.doesNotMatch(script, /npm install -g @linsoai\/browser-relay@latest/);
});

test("agent bootstrap script installs the unified planner and both workers", () => {
  const script = fs.readFileSync(scriptPath, "utf8");

  assert.match(script, /\. "\$repo_dir\/\.env"/);
  assert.match(script, /service install\s+\\?\s+--kind daily-agent/);
  assert.match(script, /worker_args=\(\)/);
  assert.match(script, /worker_args\+=\(--account "\$x_account"\)/);
  assert.match(script, /service install --yes --interval "\$x_interval" "\$\{worker_args\[@\]\}" --json/);
  assert.doesNotMatch(script, /service install --yes --interval "\$x_interval" --account "\$x_account"/);
  assert.match(script, /service install\s+\\?\s+--kind rednote\s+\\?\s+--yes\s+\\?\s+--interval "\$rednote_interval"\s+\\?\s+--publish/);
  assert.match(script, /service install\s+\\?\s+--kind metrics\s+\\?\s+--yes\s+\\?\s+--metrics-time "\$metrics_time"\s+\\?\s+--metrics-days "\$metrics_days"/);
  assert.match(script, /model="\$\{XPOST_MODEL:-\$\{XPOST_CHAT_MODEL:-claude-opus-4-8\}\}"/);
  assert.match(script, /metrics_time="\$\{XPOST_METRICS_TIME:-09:30\}"/);
  assert.match(script, /metrics_days="\$\{XPOST_METRICS_DAYS:-2\}"/);
  assert.match(script, /thinking_skill="\$\{XPOST_THINKING_SKILL:-creator-systems\}"/);
  assert.match(script, /voice_skill="\$\{XPOST_SKILL:-realist-perspective\}"/);
  assert.match(script, /daily_args\+=\(--model "\$model"\)/);
  assert.match(script, /daily_args\+=\(--thinking-skill "\$thinking_skill"\)/);
  assert.match(script, /daily_args\+=\(--skill "\$voice_skill"\)/);
  assert.match(script, /service start --kind daily-agent/);
  assert.match(script, /service start --kind rednote/);
  assert.match(script, /service start --kind metrics/);
  assert.doesNotMatch(script, /echo .*\$\{?XPOST_LIAOBOTS_AUTHCODE/);
});
