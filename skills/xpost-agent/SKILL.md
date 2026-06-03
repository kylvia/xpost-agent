---
name: xpost-agent
description: Use when the user asks an agent to draft, queue, dry-run, or publish posts to X/Twitter or Xiaohongshu/Rednote from their local Chrome session using xpost and Browser Relay. Especially relevant for agent-facing X/Rednote automation, realist/creator systems-style posts, local Mac posting, screenshots, and Browser Relay based browser control.
---

# xpost-agent

Use `xpost` as the stable execution layer. Do not hand-roll Browser Relay `curl` calls unless `xpost` is missing or broken.

## Agent-First Principle

This project is agent-first, human-authorized, and browser-session-based.

Every operation should be diagnosable, reproducible, and recoverable by a local agent through `xpost` commands, queue/archive state, logs, screenshots, and explicit safety gates. Do not rely on hidden manual UI steps as the normal path. If browser automation fails, inspect the DOM/screenshots/logs and patch `xpost` so the next run is automatic.

## Safety Defaults

- Run `xpost doctor` before diagnosing an always-on runner or posting from a new machine. Use `xpost health` for a quick Browser Relay/X-tab check.
- Use `xpost heartbeat` for compact daily-run debugging. It is read-only and does not start services, open composers, retry items, or publish.
- Default to `xpost dry-run` unless the user explicitly says to publish.
- Only run `xpost post ... --yes` or `xpost worker --yes` when the user clearly asked for real posting.
- For Xiaohongshu/Rednote, default to `xpost rednote-worker --once --yes` draft mode. Only run `xpost rednote-post ... --yes` or `xpost rednote-worker --publish --yes` when the user clearly asked for real posting.
- Rednote image uploads use local letter-paper rendering by default. Use `--image-provider liao` only when the user asks for liao.work/AI image generation, and pass the auth code through `--auth-code` or `XPOST_LIAOBOTS_AUTHCODE`.
- After a real post, report the screenshot path and final status. Do not treat a click result as proof of posting; Rednote must reach a success state where the editor file input and publish button are gone.
- Do not automate likes, follows, DMs, or bulk replies with this skill.
- If `xpost` detects stale over-limit X draft state, let it discard the current composer and retry; do not bypass its text/button checks.
- If a fully automatic publish path fails, debug and patch `xpost`/Browser Relay selectors or component handling. Do not switch to Computer Use/manual clicking unless the user explicitly asks to take over the UI.

## Common Workflows

Write a realist-style post, then publish through `xpost`:

```bash
# First use the realist-perspective skill to produce the text.
xpost dry-run --text "post text"
xpost post --text "post text" --yes
```

Draft a realist-style post:

```bash
xpost draft --style realist --topic random
```

Generate one realist-style post through the configured Chat Completions API. This embeds the repo's lightweight `realist-perspective` skill into the prompt; it does not spawn Codex or Claude:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost agent-run --topic random --enqueue
```

Generate one cross-platform daily plan. This should be the default workflow: one AI-generated `contentIntent`, 5 X posts, then 2 Xiaohongshu notes rewritten from the best-fit X posts. `creator-systems` is the thinking layer; Xiaohongshu surface should stay close to "成年人清醒生活 + 内容创作者的自我管理" and avoid obvious AI/tooling/product language.

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost daily-plan --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30
```

Fill composer without posting:

```bash
xpost dry-run --text "post text"
```

Publish after explicit user confirmation:

```bash
xpost post --text "post text" --yes
```

Queue and process:

```bash
xpost enqueue --text "post text" --at "2026-05-28T23:30:00+08:00"
xpost worker --once --yes
```

Reschedule or retry queued X posts:

```bash
xpost reschedule --id POST_ID --at "2026-05-29T22:05:00+08:00"
xpost retry --id POST_ID --at "2026-05-29T22:05:00+08:00"
xpost ignore --id POST_ID --reason "old failed run"
```

Use `ignore` only after deciding a failed X item should not be retried. It preserves the record and `lastError`, but removes it from active failed queue health.

Standalone generation commands are for special cases only. Prefer `daily-plan` for the current cross-platform workflow:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost agent-plan --topic random --count 5 --window-start 00:00 --window-end 06:00
XPOST_LIAOBOTS_AUTHCODE="..." xpost rednote-plan --topic random --count 2
```

For the unified X + Xiaohongshu strategy, install `daily-agent` as the planner, then keep the two queue workers running:

```bash
xpost service install --kind daily-agent --yes --schedule daily-random --count 5 --rednote-count 2 --x-window-start 10:00 --x-window-end 23:00 --rednote-window-start 11:00 --rednote-window-end 21:30 --auth-code "..."
xpost service start --kind daily-agent

xpost service install --yes --interval 180 --account _example_
xpost service start

xpost service install --kind rednote --yes --interval 300 --publish --image-provider liao --auth-code "..."
xpost service start --kind rednote
```

Replace `_example_` with the expected X handle, or omit `--account` only for a local test runner where account locking is not needed.

On a new always-on runner Mac, prefer the idempotent bootstrap script after `.env` and browser login are ready:

```bash
npm run bootstrap:agent
```

Use `XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent` only when the user wants to generate today's unified plan immediately instead of waiting for the next local midnight.

For a no-skill handoff to another local agent, read `docs/new-runner-handoff.md` from the repo. If the user only says "启动项目", set up and verify the runner; do not publish an extra manual test post.

Codex automations are only a read-only audit layer for this workflow. Keep launchd as the execution scheduler. The expected automation IDs are `xpost-daily-plan-audit`, `xpost-publish-progress-audit`, and `xpost-daily-posting-summary`; the old `daily-legacy-x-draft-queue` generator should stay paused.

Codex automation configs are local to the Codex app and do not sync with git. On another Mac, recreate or refresh them from `docs/new-runner-handoff.md` if the automation tool is available.

Diagnose the local runner without changing state:

```bash
xpost doctor
xpost doctor --json
xpost doctor --notify
xpost heartbeat --json
xpost heartbeat --notify
```

`xpost doctor --notify` sends a Feishu notification only when the doctor report is unhealthy. `xpost heartbeat --notify` sends a compact read-only runner summary and is useful for debugging scheduled daily runs.

`xpost doctor` compares the current browser X account with `XPOST_ACCOUNT`/expected-account env vars or the worker service `--account` argument. If it reports an `x account` warning, switch Chrome to the expected account before waiting for the worker.

Use `xpost doctor --deep` only when the user wants real chat/image API smoke checks; it consumes API quota.

Configure Feishu notifications only through local env or launchd, never committed files:

```dotenv
# Optional: Feishu notification webhook. Keep real values out of git.
# XPOST_FEISHU_WEBHOOK_URL=
```

Smoke test:

```bash
xpost notify-test --json
```

If `XPOST_FEISHU_WEBHOOK_URL` is missing, `notify-test` prints JSON with `ok: false`, `skipped: true`, and warning `XPOST_FEISHU_WEBHOOK_URL is not configured.`, then exits 1. That is expected for the smoke test when Feishu is optional and should not be treated as a core automation failure.

Feishu notification event identifiers:

- `command.failed`: command failed
- `publish.failed`: X publish failed
- `rednote.publish.failed`: Rednote publish failed
- `api.image.fallback`: Rednote image fallback used
- `doctor.unhealthy`: unhealthy doctor report, only with `xpost doctor --notify`
- `heartbeat.summary`: heartbeat summary completed
- `weekly-review.completed`: weekly review completed

Feishu notifications send summaries, IDs, statuses, errors, and suggested commands. They do not send full prompts, full post bodies, cookies, auth codes, or screenshots by default.

Fill Xiaohongshu Creator without publishing:

```bash
xpost rednote-worker --once --yes
```

Fill Xiaohongshu Creator with liao.work-generated letter-paper images:

```bash
XPOST_LIAOBOTS_AUTHCODE="..." xpost rednote-worker --once --yes --image-provider liao
```

Retry a failed Xiaohongshu queue item:

```bash
xpost rednote-retry --id NOTE_ID
xpost rednote-ignore --id NOTE_ID --reason "old failed run"
```

Use `rednote-ignore` only after deciding a failed Rednote item should not be retried.

Publish a queued Xiaohongshu note after explicit confirmation:

```bash
xpost rednote-post --id NOTE_ID --yes
```

For Rednote, a successful publish must show `posted: true`, `coverProvider` when relevant, and a posted screenshot whose page text indicates success. If the screenshot still shows the editor or red publish button, set or leave the queue item as `filled`/`failed`, inspect the current DOM, and patch `src/rednote.js`.

Posted X and Rednote items are automatically upserted into the content archive. Use it for review instead of mining the live queues:

```bash
xpost archive-list --since 2026-05-30
xpost archive-report --since 2026-05-30
xpost metrics-capture --since 2026-05-30 --source daily-plan --json
xpost service install --kind metrics --yes --metrics-time 09:30 --metrics-days 2 --source daily-plan
xpost service start --kind metrics
```

Run weekly content-quality reflection:

```bash
xpost weekly-review --days 7 --json
xpost weekly-review --days 7 --notify
```

`metrics-capture` reads published X post pages through Browser Relay and appends local engagement snapshots into the archive. The metrics service should run once daily. `weekly-review` analyzes the local queue/archive plus captured metrics and outputs next-week guidance.

Install the macOS background worker after explicit user approval:

```bash
xpost service install --yes --interval 30
xpost service start
xpost service status
```

Install the standalone X API generation timer only when the user explicitly wants X-only generation:

```bash
xpost service install --kind agent --yes --schedule daily-random --count 5 --window-start 00:00 --window-end 06:00 --topic random --auth-code "..."
xpost service start --kind agent
```

For daily random mode, `xpost service start --kind agent` should not kickstart an immediate run by default. The plan runs at local 00:00 and skips duplicate `agent-plan` batches for the same local date.

For unified daily mode, `xpost service start --kind daily-agent` also should not kickstart an immediate run by default. `daily-plan` tags both queues with `source: "daily-plan"` and the same local `planDate`, then skips duplicates if either queue already has that day's non-failed batch.

## Troubleshooting

- Start troubleshooting with `xpost doctor --json`; it summarizes Browser Relay, launchd services, queues, archive, and API env without printing auth tokens.
- Use `xpost heartbeat --json` for a compact read-only view when debugging whether the daily scheduled runs are alive.
- If health fails, run `browser-relay status`.
- If there are no tabs, open Chrome with at least one regular tab.
- If the extension is disconnected, reload Browser Relay in `chrome://extensions`.
- If scheduled posts are not processing, run `xpost service status` and check `~/.xpost-agent/logs/worker.err.log`.
- If a scheduled post is only a little late, remember the worker polls by `--interval`; `180` means up to about 3 minutes of delay.
- If generated posts are not appearing in the queue, run `xpost service status --kind agent` and check `~/.xpost-agent/logs/agent.err.log`.
- If generated Rednote notes are not appearing in the queue, run `xpost service status --kind rednote-agent` and check `~/.xpost-agent/logs/rednote-agent.err.log`.
- If unified daily content is not appearing in either queue, run `xpost service status --kind daily-agent` and check `~/.xpost-agent/logs/daily-agent.err.log`.
- If Rednote drafts are not being created, run `xpost service status --kind rednote` and check `~/.xpost-agent/logs/rednote.err.log`.
- If a Rednote item is `failed` after a transient browser/session issue, use `xpost rednote-retry --id NOTE_ID` after fixing the issue.
- If old failed X/Rednote items should not be retried, mark them ignored instead of deleting queue records.
- If a Rednote item is `filled` while the worker is running with `--publish`, inspect the filled screenshot first. If the red publish button is still present, the publish branch did not complete; fix `src/rednote.js` or retry with `xpost rednote-post --id NOTE_ID --yes`.
- When changing Rednote publish code or `.env` API settings, restart `xpost service --kind rednote`; launchd workers keep running with their existing process code/env until restarted.
- If `--image-provider liao` reports a transient `fetch failed`, run a small image smoke test and keep local fallback enabled unless the user explicitly requires liao-only images with `--image-fallback false`.
- If Rednote publish returns success but the screenshot still shows the editor, inspect `<xhs-publish-btn>` and similar custom elements. Xiaohongshu may require invoking the component publish handler rather than dispatching a generic click event.
- After changing worker, Rednote, or archive code, restart the relevant launchd worker; running workers keep their old Node process code until restarted.
- If X keeps showing a negative character counter after the requested text is inserted, use the built-in `xpost dry-run`/`post` flow so stale draft cleanup can run.
- If Chrome shows a native "Leave this site?" dialog, Browser Relay may time out because the dialog is outside the page DOM. Dismiss it only when it is safe to discard the current composer, then retry one item at a time.
- If X selectors change, use Browser Relay snapshots to inspect the current compose page, then patch `src/x.js`.
