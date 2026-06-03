# New Runner Handoff

Use this runbook when a second always-on Mac has cloned or pulled `xpost-agent` and the user says something like "start the project".

The goal is to make the runner reproducible by an agent without needing hidden local memory or a preinstalled skill.

## What Is Versioned

These files come from the repo and should be enough for an agent to understand the workflow:

- `README.md`
- `AGENTS.md`
- `skills/xpost-agent/SKILL.md`
- `scripts/bootstrap-agent-runner.sh`
- `docs/daily-content-pipeline.md`
- `docs/failure-modes.md`
- this handoff runbook

These are local-only and do not come from `git pull`:

- `.env`
- Chrome login sessions for X and Xiaohongshu
- Browser Relay Chrome extension state
- launchd plists under `~/Library/LaunchAgents`
- queue, archive, screenshots, assets, and logs under `~/.xpost-agent`
- Codex automation configs and history under `~/.codex/automations`

## First Message For Another Agent

If the user wants another Codex or local agent to start the runner, a good instruction is:

```text
进入 xpost-agent 仓库，按 AGENTS.md 和 docs/new-runner-handoff.md 启动项目。先做只读检查；如果 .env、Chrome 登录、Browser Relay 或 launchd 服务缺失，就补齐并运行 npm run bootstrap:agent。不要发测试帖。需要今天立刻生成计划时，先告诉我，再用 XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent。
```

If the user says only "启动项目", treat that as permission to set up and verify the local runner, not permission to publish an extra manual test post.

## Setup Flow

From the repo root:

```bash
git status --short --branch
npm install
```

Create `.env` from `.env.example` if it is missing. Required values:

```dotenv
XPOST_LIAOBOTS_AUTHCODE=...
XPOST_LIAOBOTS_BASE_URL=https://ai.liaobots1.work/v1
```

Optional notification value:

```dotenv
XPOST_FEISHU_WEBHOOK_URL=...
```

For production publishing, also set `XPOST_ACCOUNT` to the expected X handle so the worker fails closed when Chrome is logged into the wrong account.
Never print the real auth code or webhook in the final report.

Make sure Chrome is logged into:

- X as the expected account
- Xiaohongshu Creator

Then bootstrap the launchd runner:

```bash
npm run bootstrap:agent
```

Bootstrap refreshes the macOS launchd execution layer only. It does not create Codex App Automations, does not copy Codex automation history, and should not be reported as if the Automations UI has been configured.

Use this only when the user explicitly wants today's plan generated immediately:

```bash
XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent
```

## Expected Runner Shape

The bootstrap installs or refreshes four launchd jobs:

```text
daily-agent: daily-plan at local 00:00, 5 X posts, 2 Rednote notes
worker: X queue every 180 seconds, optional expected-account lock from XPOST_ACCOUNT
rednote: Rednote queue every 300 seconds, publish mode, image-provider liao
metrics: X engagement metrics capture once daily at local 09:30, recent 2 local days
```

`daily-agent` plans and enqueues. The two workers publish due queue items through the user's Chrome session. `metrics` captures read-only X engagement snapshots into the local archive.

## Verification

Run these before reporting success:

```bash
xpost doctor
xpost heartbeat --json
xpost service status --kind daily-agent
xpost service status
xpost service status --kind rednote
```

Also inspect Codex App automation state when the user asks about Automations:

```bash
find ~/.codex/automations -maxdepth 3 -type f -name automation.toml -print
```

If Feishu is configured, run:

```bash
xpost notify-test --json
```

Report these facts back to the user:

- Browser Relay reachable or not
- current browser X account, if available
- whether the four launchd services are loaded: daily-agent, worker, rednote, metrics
- today's X queue counts
- today's Rednote queue counts
- today's archive counts
- failed item IDs and last errors, if any
- whether Codex audit automations were found, refreshed, or still need local setup

Use this exact distinction in the final report: launchd is the execution scheduler, Codex Automations are the read-only audit layer, and queue/archive files are the local state layer.

## Logs For Debugging

Use these logs to see the actual scheduled execution:

```bash
tail -n 80 ~/.xpost-agent/logs/daily-agent.out.log
tail -n 80 ~/.xpost-agent/logs/daily-agent.err.log
tail -n 80 ~/.xpost-agent/logs/worker.out.log
tail -n 80 ~/.xpost-agent/logs/worker.err.log
tail -n 80 ~/.xpost-agent/logs/rednote.out.log
tail -n 80 ~/.xpost-agent/logs/rednote.err.log
```

Read daily content history with:

```bash
xpost archive-list --since YYYY-MM-DD --json
xpost archive-report --since YYYY-MM-DD --json
xpost metrics-capture --since YYYY-MM-DD --source daily-plan --json
xpost weekly-review --days 7 --json
```

The daily-agent output log contains the daily-plan result, including the generated `contentIntent`, X posts, Rednote source choices, and Rednote notes. Use it to debug the planning process before changing prompts or strategy.

## Codex Automation Audit Layer

Codex automations are local app configuration, not repo state. A second machine will not receive them from `git pull`.

`npm run bootstrap:agent` will not create these automations. If the Automations UI is empty after bootstrap, that is expected until a local agent creates the audit layer through the Codex automation tool.

If the Codex automation tool is available, create or refresh these read-only audit automations on the new machine:

```text
xpost-daily-plan-audit: shortly after local midnight, verify today's daily-plan batch
xpost-publish-progress-audit: midday, evening, and late evening progress checks
xpost-daily-posting-summary: late-night end-of-day summary
daily-legacy-x-draft-queue: paused legacy generator, keep paused if present
```

The audit automations must only inspect state and suggest commands. They may use:

- `xpost heartbeat --json`
- `xpost doctor --json`
- `xpost list --json`
- `xpost rednote-list --json`
- `xpost archive-list --since YYYY-MM-DD --json`
- `xpost archive-report --since YYYY-MM-DD --json`
- log tails from `~/.xpost-agent/logs`

They must not enqueue, retry, ignore, reschedule, publish, restart services, or modify files. If they find a problem, they should record the issue and suggest the exact command for an interactive agent to run after user approval.
