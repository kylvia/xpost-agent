# xpost-agent

Agent-facing local X posting CLI powered by Browser Relay.

[中文说明](README.zh-CN.md)

## What It Does

`xpost` is a thin, local wrapper around `browser-relay`. It lets Codex, Claude Code, or another local agent:

- generate a simple realist-style draft
- enqueue post text locally
- fill the X composer without posting
- publish only when `--yes` is provided
- save screenshots as proof
- discard a stale over-limit X draft before retrying a clean composer

It uses your existing Chrome session through Browser Relay. It does not use the official X API.

## Agent-First Principle

This project is agent-first, human-authorized, and browser-session-based.

Every operation should be diagnosable, reproducible, and recoverable by a local agent through CLI commands, structured state, logs, screenshots, and explicit safety gates. The agent should not depend on hidden manual UI steps to understand what happened or what to do next.

That means:

- diagnosis starts with `xpost doctor`, `xpost heartbeat`, queue state, archive records, and launchd logs
- recovery uses explicit commands such as `retry`, `ignore`, `reschedule`, service restart, and bootstrap
- real posting remains gated by `--yes`, configured workers, and the user's logged-in browser session
- secrets stay in local env or launchd state, never committed docs or queue files
- if browser automation fails, patch the adapter or selectors so the next agent can repeat the flow automatically

## Install

On a new Mac:

```bash
git clone https://github.com/kylvia/xpost-agent.git
cd xpost-agent
./install.sh
```

The installer:

- installs `@linsoai/browser-relay`
- installs this CLI globally as `xpost`
- installs bundled skills into `~/.codex/skills` and `~/.agents/skills`
- starts Browser Relay
- prints the Chrome extension path

Load that extension directory in `chrome://extensions` with Developer Mode enabled, then run:

```bash
xpost health
xpost doctor
```

For an always-on agent runner Mac, use the bootstrap script after `.env` is in place and Chrome is logged into X plus Xiaohongshu:

```bash
npm run bootstrap:agent
```

This runs the installer, verifies the repo, reloads the unified daily planner, reloads the X worker, reloads the Rednote publish worker, starts Browser Relay, and prints service status. It is safe to run again after code or `.env` changes.

For a second always-on Mac or a no-skill agent handoff, use [docs/new-runner-handoff.md](docs/new-runner-handoff.md). The repo can carry the code, runbooks, and bootstrap script, but `.env`, Chrome sessions, launchd state, Browser Relay extension state, `~/.xpost-agent`, and Codex automation history are local to each machine.

The default runner shape is:

```text
daily-agent: daily-plan at local 00:00, 5 X posts, 2 Rednote notes
worker: X queue every 180 seconds, optional account lock from XPOST_ACCOUNT
rednote: Rednote queue every 300 seconds, publish mode, image-provider liao
metrics: X engagement metrics capture once daily at local 09:30, recent 2 local days
```

Useful overrides:

```bash
XPOST_ACCOUNT=_example_ \
XPOST_X_INTERVAL=180 \
XPOST_REDNOTE_INTERVAL=300 \
XPOST_KICKSTART_DAILY=1 \
npm run bootstrap:agent
```

`XPOST_KICKSTART_DAILY=1` immediately runs the daily planner once after install. Leave it off when you only want tomorrow's midnight schedule.
Set `XPOST_ACCOUNT` on a production runner to make the X worker fail closed if Chrome is logged into the wrong account.

Manual install from this repo:

```bash
npm install -g @linsoai/browser-relay@latest
npm install
npm install -g .
browser-relay start
browser-relay path
```

From another Mac, install from a GitHub repo:

```bash
npm install -g git+https://github.com/kylvia/xpost-agent.git
```

## Commands

```bash
xpost health
xpost doctor --json
xpost doctor --notify
xpost doctor --deep
xpost notify-test --json
xpost heartbeat --json
xpost heartbeat --notify
xpost draft --topic 自动化
xpost enqueue --text "hello" --at "2026-05-28T23:30:00+08:00"
xpost list
xpost retry --id POST_ID
xpost ignore --id POST_ID --reason "old failed run"
xpost dry-run --text "只填入，不发布"
xpost clear
xpost post --text "真正发布" --yes
xpost agent-run --topic 自动化 --enqueue
xpost daily-plan --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30
xpost rednote-worker --once --yes
xpost rednote-retry --id NOTE_ID
xpost rednote-ignore --id NOTE_ID --reason "old failed run"
xpost rednote-post --id NOTE_ID --yes
xpost archive-list --since 2026-05-30
xpost archive-report --since 2026-05-30
xpost weekly-review --days 7 --json
xpost weekly-review --days 7 --notify
xpost worker --once --yes
xpost service install --yes
xpost service start
xpost service status
```

`post` and `worker` never click the X post button unless `--yes` is present.

`rednote-worker` saves Xiaohongshu drafts by default. It only clicks publish when both `--yes` and `--publish` are present, or when you explicitly run `rednote-post --yes`.

Use `ignore` or `rednote-ignore` only after deciding a failed queue item should not be retried. It preserves the item, `lastError`, and `ignoredReason`, changes the status to `ignored`, and keeps doctor/heartbeat from treating stale failures as active incidents.

If X reports an impossible negative character counter after `xpost` inserts the requested text, `xpost` treats the current composer as polluted by an old draft. It closes that composer, chooses "Discard", reopens compose in the same tab, and retries before publishing.

## Feishu Notifications

Notifications are optional. Configure only a local `.env` value or launchd environment; keep real webhook URLs out of git:

```dotenv
# Optional: Feishu notification webhook. Keep real values out of git.
# XPOST_FEISHU_WEBHOOK_URL=
```

Smoke test the webhook:

```bash
xpost notify-test --json
```

If `XPOST_FEISHU_WEBHOOK_URL` is missing, `notify-test` prints JSON with `ok: false`, `skipped: true`, and warning `XPOST_FEISHU_WEBHOOK_URL is not configured.`, then exits 1. That is expected for the smoke test when Feishu is optional and should not be treated as a core automation failure.

Useful notification event identifiers:

- `command.failed`: command failed
- `publish.failed`: X publish failed
- `rednote.publish.failed`: Rednote publish failed
- `api.image.fallback`: Rednote image fallback used
- `doctor.unhealthy`: unhealthy doctor report, only with `xpost doctor --notify`
- `heartbeat.summary`: heartbeat summary completed
- `weekly-review.completed`: weekly review completed

Feishu notifications send summaries, IDs, statuses, errors, and suggested commands. They do not send full prompts, full post bodies, cookies, auth codes, or screenshots by default.

## Doctor

`xpost doctor` is a read-only health check for agents and runner Macs. It does not start services, open composers, retry queue items, or publish anything.

```bash
xpost doctor
xpost doctor --json
xpost doctor --notify
```

It checks Node, API configuration, Browser Relay, launchd service status, the expected X account, X/Rednote queues, and the content archive. The JSON output is safe for agents to parse and reports API auth only as `present` plus the env var source. The expected X account comes from `XPOST_ACCOUNT`/expected-account env vars or the worker service `--account` argument.

`xpost doctor --notify` sends a Feishu notification only when the doctor report is unhealthy.

Use `--deep` only when you want real API smoke checks. It performs one chat completions request and one `gpt-image-2` image request, so it can consume API quota:

```bash
xpost doctor --deep
```

## Heartbeat

`xpost heartbeat` is a compact, read-only runner summary. It is useful for debugging daily scheduled runs because it reports the doctor-derived service, queue, archive, Browser Relay status, and warning checks without starting services, opening composers, retrying items, or publishing. Items marked `ignored` stay in the queue for audit history but are not counted as active failures.

```bash
xpost heartbeat --json
xpost heartbeat --notify
```

## macOS Background Service

`xpost service` installs a launchd user service that keeps `xpost worker --yes` running in the background. It is not installed automatically.

```bash
xpost service install --yes --interval 30
xpost service start
xpost service status
```

Stop or remove it:

```bash
xpost service stop
xpost service uninstall
```

The service writes logs to:

```text
~/.xpost-agent/logs/worker.out.log
~/.xpost-agent/logs/worker.err.log
```

## Codex Automation Audit Layer

Codex automations are used as a read-only audit layer so each scheduled run has a human-readable history. They should not be the source of truth for generating, queueing, retrying, ignoring, publishing, or restarting services.

Current intended split:

```text
launchd daily-agent: generates the daily-plan batch
launchd worker: publishes X queue items
launchd rednote: publishes Rednote queue items
Codex automations: inspect state, summarize history, and suggest follow-up commands
```

Expected Codex automations:

```text
xpost-daily-plan-audit: 00:10, verifies today's daily-plan batch
xpost-publish-progress-audit: 12:30 / 18:30 / 21:30, reports posting progress
xpost-daily-posting-summary: 23:40, records the end-of-day result
daily-legacy-x-draft-queue: paused legacy generator; keep paused
```

The audit automations should use only read-only commands such as `xpost heartbeat --json`, `xpost doctor --json`, queue lists, archive reports, and log tails. If action is needed, they should report exact suggested commands instead of executing them.

Codex automation configs live under the local Codex app state and do not sync with this repo. On a new machine, follow [docs/new-runner-handoff.md](docs/new-runner-handoff.md) to recreate or refresh the read-only audit layer.

## API Content Generation

`xpost agent-run` uses an OpenAI-compatible Chat Completions API by default to generate one realist-style post. It embeds the bundled lightweight `realist-perspective` skill into the prompt.

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost agent-run --topic 自动化 --enqueue
```

Defaults:

```text
base URL: https://ai.liaobots1.work/v1
endpoint: https://ai.liaobots1.work/v1/chat/completions
model: claude-opus-4-8
fallback models: gemini-3.1-pro-preview
```

The CLI auto-loads a project `.env` file. Put shared liao.work config there:

```dotenv
XPOST_LIAOBOTS_AUTHCODE=...
XPOST_LIAOBOTS_BASE_URL=https://ai.liaobots1.work/v1
```

`XPOST_LIAOBOTS_BASE_URL` may be either the OpenAI-compatible base URL (`.../v1`) or the full chat completions endpoint (`.../v1/chat/completions`).

You can still override the endpoint or model per command:

```bash
xpost agent-run --topic 自动化 --model claude-opus-4-8 --endpoint https://ai.liaobots1.work/v1/chat/completions --enqueue
```

For the launchd daily planner, set `XPOST_MODEL` before `npm run bootstrap:agent` to persist the primary chat model in the service arguments.

API content generation stays on the API path. On 5xx or network failures it retries the configured fallback models, still through the same OpenAI-compatible endpoint:

```bash
xpost daily-plan --fallback-models gemini-3.1-pro-preview --count 5 --rednote-count 2
```

Each API request has a bounded timeout before trying the next fallback model. Set `XPOST_API_TIMEOUT_MS` or pass `--api-timeout-ms`; set `XPOST_FALLBACK_MODELS=false` or pass `--fallback-models false` to disable API model fallback.

Content generation can also use the local Codex CLI:

```bash
xpost daily-plan --generator codex --count 5 --rednote-count 2
```

Set `XPOST_GENERATOR=codex` before `npm run bootstrap:agent` to persist local Codex spawn in the launchd daily planner. `XPOST_CODEX_MODEL` or `--codex-model` can pin the Codex model; otherwise Codex uses its normal local config.

Generate one unified daily content plan for both X and Xiaohongshu:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost daily-plan --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30
```

`daily-plan` first asks the model for one `contentIntent`, using the creator systems skill as the thinking layer and the local account strategy as the surface strategy. It then generates 5 X posts from that same intent, scores those posts for Xiaohongshu fit, and rewrites the best 2 into notes with title, body, tags, and cover text. It only enqueues items; publishing still happens through the X worker and Rednote worker.

Install the unified daily planner:

```bash
xpost service install --kind daily-agent --yes --schedule daily-random --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30 --auth-code "..."
xpost service start --kind daily-agent
```

The unified planner runs at local 00:00, tags both queues with `source: "daily-plan"` and the local `planDate`, and skips if either queue already has that day's non-failed batch.

Keep the queue workers running separately:

```bash
xpost service install --yes --interval 180 --account _example_
xpost service start

xpost service install --kind rednote --yes --interval 300 --publish --image-provider liao --auth-code "..."
xpost service start --kind rednote

xpost service install --kind metrics --yes --metrics-time 09:30 --metrics-days 2 --source daily-plan
xpost service start --kind metrics
```

The `--auth-code` value is written only to the local launchd plist so the background timer can call the API. It is not stored in this repo.
Replace `_example_` with the expected X handle, or omit `--account` only for a local test runner where account locking is not needed.

Standalone generators are still available for special cases:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost agent-plan --topic 自动化 --count 5 --window-start 00:00 --window-end 06:00
XPOST_LIAOBOTS_AUTHCODE="..." xpost rednote-plan --topic 自动化 --count 2 --window-start 11:00 --window-end 21:30
```

## Xiaohongshu / Rednote

For the current cross-platform workflow, prefer `daily-plan` so Xiaohongshu notes are selected from the same X batch instead of generated from an unrelated topic. Use `rednote-plan` only for one-off standalone Xiaohongshu batches.

Fill due items into Xiaohongshu Creator as drafts. The uploaded image is generated locally as a square letter-paper graphic that includes the note title and body copy:

```bash
xpost rednote-worker --once --yes
```

Use liao.work image generation instead of the local renderer:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost rednote-worker --once --yes --image-provider liao
```

The liao provider calls `https://ai.liaobots1.work/v1/chat/completions` with `gpt-image-2` by default and asks for a 1:1 letter-paper image containing the note title/body. If the image API fails, `xpost` falls back to the local letter-paper renderer unless you pass `--image-fallback false`.

If Rednote image generation should use a different host from text generation, set `XPOST_LIAOBOTS_IMAGE_BASE_URL` or pass `--image-endpoint`.

Retry a failed note after fixing a browser/session issue:

```bash
xpost rednote-retry --id NOTE_ID
```

Publish a queued note explicitly:

```bash
xpost rednote-post --id NOTE_ID --yes
```

`rednote-post` only marks an item as posted after verifying the editor is gone and the publish success state is visible. A successful run records:

```text
coverProvider
~/.xpost-agent/rednote-assets/NOTE_ID-cover.png
~/.xpost-agent/rednote-screenshots/NOTE_ID-filled-*.png
~/.xpost-agent/rednote-screenshots/NOTE_ID-posted-*.png
postedAt
```

If the command returns a filled/editor screenshot or the red publish button is still visible, treat it as not posted. Inspect the current Creator DOM and patch the Rednote adapter rather than completing the run with manual UI clicks. Xiaohongshu may render the bottom action as a custom `<xhs-publish-btn>` component, so generic DOM `click()` can be insufficient.

For publish mode, `publish: true` must take precedence over draft-only options. The worker passes `save: false` while publishing so it does not also save a draft; that must never short-circuit the publish branch. A regression test in `test/rednote.test.js` covers this exact worker shape.

Run the background Rednote worker in draft mode:

```bash
xpost service install --kind rednote --yes --interval 300
xpost service start --kind rednote
```

Run the background Rednote worker with liao.work image generation:

```bash
xpost service install --kind rednote --yes --interval 300 --image-provider liao --auth-code "..."
xpost service start --kind rednote
```

Run the background Rednote worker in publish mode:

```bash
xpost service install --kind rednote --yes --interval 300 --publish
xpost service start --kind rednote
```

Publish mode is deliberately opt-in. Draft mode remains the default so generated notes can be reviewed before posting.

After changing Rednote publish code or `.env` API settings, restart the launchd worker so the background process uses the new code and environment:

```bash
xpost service stop --kind rednote
xpost service start --kind rednote
```

If liao image generation returns a transient `fetch failed`, keep the note publishable by allowing the local letter-paper fallback. Re-run a small image API smoke check before treating the provider as down.

## Local State

Data is stored in:

```text
~/.xpost-agent/queue.json
~/.xpost-agent/content-archive.json
~/.xpost-agent/screenshots/
~/.xpost-agent/rednote-queue.json
~/.xpost-agent/rednote-assets/
~/.xpost-agent/rednote-screenshots/
```

Override with:

```bash
XPOST_HOME=/tmp/xpost-test xpost list
```

## Agent Rule

Agents should run `xpost dry-run` first unless the user explicitly says to publish.

For realist-style posts, use `xpost agent-run` for API generation or the bundled `realist-perspective` skill for interactive agent writing, then use `xpost-agent` to dry-run or publish it. The public repo includes only lightweight generic skills; keep private voice models and reference corpora outside git.

## Open Source Notes

The package is MIT licensed. Before publishing a fork or moving this repo to a public remote, read [SECURITY.md](SECURITY.md) and [docs/open-source-readiness.md](docs/open-source-readiness.md). The short version: scan current files and git history, keep local runner state out of git, and rotate anything that may have appeared in committed history.

## Content Archive

When an X post or Xiaohongshu note reaches `posted`, `xpost` upserts it into:

```text
~/.xpost-agent/content-archive.json
```

The archive is separate from the execution queues. Queue files can stay focused on scheduling and retries; the archive keeps long-lived content assets for later analysis. Records are keyed by `platform:queueId`, so retries or repeated worker runs update the same archive item instead of duplicating it.

List archived posts:

```bash
xpost archive-list --since 2026-05-30
xpost archive-list --platform rednote --source daily-plan
```

Summarize archived posts:

```bash
xpost archive-report --since 2026-05-30
```

Each archive record keeps the published content, queue id, platform, `source`, `planDate`, screenshots/assets, post URL when available, `contentIntent`, `contentAngle`, and an append-only `metrics` array for daily performance snapshots.

Capture X engagement metrics from the user's logged-in Chrome session:

```bash
xpost metrics-capture --id POST_ID --json
xpost metrics-capture --since 2026-06-03 --source daily-plan --json
xpost metrics-capture --id POST_ID --url https://x.com/_example_/status/123 --json
xpost service install --kind metrics --yes --metrics-time 09:30 --metrics-days 2 --source daily-plan
xpost service start --kind metrics
```

`metrics-capture` reads the post page through Browser Relay and appends views, replies, reposts, likes, bookmarks, and engagement rate to the archive. The launchd metrics service runs once daily by default and captures recent `daily-plan` X posts. It does not like, repost, comment, follow, or use the official X API.

## Weekly Review

`xpost weekly-review` is a weekly content-quality reflection command. It analyzes the local X queue, Rednote queue, content archive, and any metrics already captured by `metrics-capture`, then outputs next-week guidance such as style risks, phrases to avoid, winning angles, and high-signal examples to prefer in future prompt iterations.

```bash
xpost weekly-review --days 7 --json
xpost weekly-review --days 7 --notify
```
