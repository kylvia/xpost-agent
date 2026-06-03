# Agent Instructions

This repository is designed to be operated by a local AI agent without requiring a separate installed skill. Treat this file as the first runbook when you enter the repo.

## Mission

Set up and operate `xpost-agent`, a local Mac automation layer for:

- daily AI content planning
- X queue publishing through Chrome and Browser Relay
- Rednote/Xiaohongshu queue publishing through Chrome and Browser Relay
- liao.work text and image generation

The project does not use the official X API. It uses the user's logged-in Chrome session.

## Agent-First Principle

Operate this project as agent-first, human-authorized, browser-session-based automation.

Every important action must be diagnosable, reproducible, and recoverable by a local agent through CLI commands, structured queue/archive state, logs, screenshots, and explicit safety gates. Do not rely on hidden manual UI steps as the normal operating path.

Practical rules:

- Prefer `xpost` commands over ad hoc Browser Relay calls.
- Start diagnosis with `xpost doctor`, `xpost heartbeat`, service status, queue state, archive records, and logs.
- Recover with explicit state-changing commands such as `retry`, `ignore`, `reschedule`, `service restart`, and `npm run bootstrap:agent`.
- Keep real publishing behind explicit `--yes`, configured launchd workers, and the user's authenticated browser session.
- If automated browser publishing fails, inspect DOM/screenshots/logs and patch selectors or adapter code so future agents can repeat the flow.
- Preserve audit history; do not delete queues, screenshots, logs, or archive records to hide failures.

## Read First

Before changing or running anything substantial, read:

1. `README.md`
2. `.env.example`
3. `docs/new-runner-handoff.md` when starting or refreshing an always-on Mac
4. `docs/failure-modes.md`
5. `docs/runbook-x-worker.md` when debugging X
6. `skills/xpost-agent/SKILL.md` if it is available, but do not require it

## Safety Rules

- Never commit `.env`, auth tokens, cookies, screenshots with private data, queue state, or `~/.xpost-agent` data.
- Use `xpost doctor` for diagnosis. It is read-only.
- Use `xpost heartbeat` for compact daily-run debugging. It is read-only and does not start services, open composers, retry items, or publish.
- Use `xpost doctor --deep` only when the user wants real API smoke checks, because it consumes API quota.
- Do not manually click publish buttons in Chrome to "complete" an automation run. If the automated path fails, inspect logs/screenshots/DOM and patch the adapter.
- X publishing requires explicit `--yes`.
- Rednote publishing requires explicit `--yes` plus publish mode, either through the configured worker or `xpost rednote-post --id NOTE_ID --yes`.
- Do not automate likes, follows, DMs, comments, or bulk engagement.

## New Always-On Mac Setup

Assume the user has cloned the repo and wants this Mac to run the daily automation.

If the user simply says "启动项目", treat that as permission to set up and verify the local runner. It is not permission to publish an extra manual test post. Follow `docs/new-runner-handoff.md` for the full no-skill handoff flow.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and fill in at least:

   ```dotenv
   XPOST_LIAOBOTS_AUTHCODE=...
   XPOST_LIAOBOTS_BASE_URL=https://ai.liaobots1.work/v1

   # Optional: Feishu notification webhook. Keep real values out of git.
   # XPOST_FEISHU_WEBHOOK_URL=
   ```

   For production publishing, also set `XPOST_ACCOUNT` to the expected X handle so the worker fails closed when Chrome is logged into the wrong account.

3. Make sure Chrome is installed and logged into:

   - X as the expected account
   - Rednote/Xiaohongshu Creator

4. Run the idempotent bootstrap:

   ```bash
   npm run bootstrap:agent
   ```

5. If Browser Relay prints an extension path, load that directory in `chrome://extensions` with Developer Mode enabled.

6. Verify:

   ```bash
   xpost doctor
   xpost heartbeat --json
   ```

7. If Feishu notifications are configured, verify the webhook:

   ```bash
   xpost notify-test --json
   ```

   If `XPOST_FEISHU_WEBHOOK_URL` is missing, `notify-test` prints JSON with `ok: false`, `skipped: true`, and warning `XPOST_FEISHU_WEBHOOK_URL is not configured.`, then exits 1. That is expected for the smoke test when Feishu is optional and should not be treated as a core automation failure.

Expected service shape:

```text
daily-agent: daily-plan at local 00:00, 5 X posts, 2 Rednote notes
worker: X queue every 180 seconds, optional expected-account lock from XPOST_ACCOUNT
rednote: Rednote queue every 300 seconds, publish mode, image-provider liao
metrics: X engagement metrics capture once daily at local 09:30, recent 2 local days
```

## Startup Acceptance Checklist

When reporting that the runner is started, separate these three layers clearly:

- Execution layer: launchd service status for `daily-agent`, `worker`, and `rednote`.
- Audit layer: whether Codex App automations exist under `~/.codex/automations`.
- State layer: today's X/Rednote queue counts, archive counts, failed item IDs, and last errors.

Do not treat `npm run bootstrap:agent` as proof that Codex App Automations exist. Bootstrap installs and refreshes launchd services only. Codex Automations are app-local audit jobs and must be created or refreshed through the Codex automation tool when needed.

For a clean rebuild of today's task state after user approval:

1. Stop `worker`, `rednote`, and `daily-agent` services.
2. Back up `~/.xpost-agent/queue.json` and `~/.xpost-agent/rednote-queue.json`.
3. Clear only the queue files. Preserve archive, screenshots, assets, and logs.
4. Generate the new daily plan.
5. Restart the launchd services.
6. Verify with `xpost doctor` and `xpost heartbeat --json`.

## Codex Automation Audit Layer

Codex automations are for read-only supervision and historical reporting, not for generating, queueing, retrying, ignoring, or publishing content. The launchd services above remain the only scheduler/executor for the posting workflow.

Codex automations are local app state under `~/.codex/automations`; they are not committed and will not appear on another Mac after `git pull`. If the Codex automation tool is available on a new machine, recreate or refresh the audit layer from the shape below and keep the legacy generator paused.

Expected Codex automation shape:

```text
xpost-daily-plan-audit: 00:10, read-only daily-plan audit
xpost-publish-progress-audit: 12:30 / 18:30 / 21:30, read-only progress audit
xpost-daily-posting-summary: 23:40, read-only end-of-day summary
daily-legacy-x-draft-queue: PAUSED legacy generator
```

If an automation report finds failures, it should suggest safe commands such as `xpost retry --id POST_ID`, but it must not execute them unless the user explicitly asks in an interactive thread.

To generate today's plan immediately instead of waiting for the next local midnight:

```bash
XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent
```

To enable or refresh the automation manually without the bootstrap script, install and start the launchd services:

```bash
xpost service install --kind daily-agent --yes --schedule daily-random --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30 --auth-code "..."
xpost service start --kind daily-agent

xpost service install --yes --interval 180 --account _example_
xpost service start

xpost service install --kind rednote --yes --interval 300 --publish --image-provider liao --auth-code "..."
xpost service start --kind rednote

xpost service install --kind metrics --yes --metrics-time 09:30 --metrics-days 2 --source daily-plan
xpost service start --kind metrics
```

Never put the real `--auth-code` or Feishu webhook in committed docs. Use local `.env`, shell history-safe input, or launchd plist generation only on the runner Mac.
Replace `_example_` with the expected X handle, or omit `--account` only for a local test runner where account locking is not needed.

## Common Commands

```bash
xpost doctor
xpost doctor --json
xpost doctor --notify
xpost heartbeat --json
xpost heartbeat --notify
xpost notify-test --json
xpost health
xpost archive-report --since YYYY-MM-DD
xpost archive-list --since YYYY-MM-DD
xpost weekly-review --days 7 --json
xpost weekly-review --days 7 --notify
xpost service status --kind daily-agent
xpost service status
xpost service status --kind rednote
xpost service status --kind metrics
```

If `XPOST_FEISHU_WEBHOOK_URL` is missing, `xpost notify-test --json` prints JSON with `ok: false`, `skipped: true`, and warning `XPOST_FEISHU_WEBHOOK_URL is not configured.`, then exits 1. That is expected for the smoke test when Feishu is optional and should not be treated as a core automation failure.

`xpost doctor --notify` sends to Feishu only when the runner is unhealthy. `xpost heartbeat --notify` sends a compact read-only runner summary and is useful when debugging scheduled daily runs.

`xpost doctor` compares the current browser X account with `XPOST_ACCOUNT`/expected-account env vars or the worker service `--account` argument. Treat an `x account` warning as actionable before the next due X post.

`xpost metrics-capture` reads published X post pages through the user's logged-in Chrome session and appends views, replies, reposts, likes, bookmarks, and engagement rate into archive `metrics`. It does not like, repost, comment, follow, DM, or use the official X API.

The metrics launchd service should run once daily, not 1h/6h/24h sampling:

```bash
xpost service install --kind metrics --yes --metrics-time 09:30 --metrics-days 2 --source daily-plan
xpost service start --kind metrics
```

`xpost weekly-review --days 7` is a weekly content-quality reflection command. It analyzes the local queue/archive plus any metrics already captured by `metrics-capture`, then returns next-week guidance and high-signal examples.

Feishu notification event identifiers:

- `command.failed`: command failed
- `publish.failed`: X publish failed
- `rednote.publish.failed`: Rednote publish failed
- `api.image.fallback`: Rednote image fallback used
- `doctor.unhealthy`: unhealthy doctor report, only with `xpost doctor --notify`
- `heartbeat.summary`: heartbeat summary completed
- `weekly-review.completed`: weekly review completed

Feishu notifications send summaries, IDs, statuses, errors, and suggested commands. They do not send full prompts, full post bodies, cookies, auth codes, or screenshots by default.

Retry failed items only after fixing the underlying issue:

```bash
xpost retry --id POST_ID
xpost rednote-retry --id NOTE_ID
```

If the user decides a stale failed item should not be retried, preserve it by marking it ignored instead of deleting it:

```bash
xpost ignore --id POST_ID --reason "old failed run"
xpost rednote-ignore --id NOTE_ID --reason "old failed run"
```

## Verification Before Reporting Success

For code changes:

```bash
npm test
npm run check
```

For runner setup:

```bash
xpost doctor
```

For API configuration only:

```bash
xpost doctor --deep
```

Report the important status lines to the user, especially:

- whether Browser Relay is responding
- which launchd services are loaded/running
- today's X/Rednote queue counts
- today's archive counts
- whether the metrics service is loaded
- any failed queue item IDs and last errors

## Troubleshooting

- If `xpost doctor` says Browser Relay is down, run `browser-relay status`, then `browser-relay start`.
- If Browser Relay is running but Chrome tabs are unavailable, load or reload the Browser Relay Chrome extension.
- If the account check fails, open X in Chrome and confirm the active session is the expected handle.
- If Rednote publish leaves the editor visible, do not mark the item posted. Inspect the screenshot and current DOM, then fix `src/rednote.js`.
- If services keep old behavior after code or `.env` changes, run `npm run bootstrap:agent` again to reinstall/restart launchd services.
- If queues have old failed items, do not delete them casually. Summarize the IDs and ask whether to retry them or mark them ignored with a reason.
