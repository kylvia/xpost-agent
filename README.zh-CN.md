# xpost-agent 中文说明

`xpost-agent` 是一个面向本地 AI agent 的 Mac 自动化工具，用来完成日常内容计划、X 队列发布、Rednote/小红书队列发布，以及 liao.work 文本和图片生成。

它不使用官方 X API，而是通过 Browser Relay 控制用户已经登录的 Chrome 会话。也就是说，发布能力来自本机浏览器登录状态，而不是平台 API token。

## 能做什么

- 生成一条简短的中文 realist-style 草稿。
- 生成每天一批跨平台内容计划：5 条 X，2 条小红书。
- 把内容写入本地队列，按计划时间发布。
- 通过 Chrome 填写 X composer 或小红书创作者后台。
- 只在明确传入 `--yes` 时执行真实发布。
- 保存截图、日志、队列和 archive，方便 agent 复盘和恢复。
- 每天抓取已发布 X 帖子的只读互动数据，用于后续内容优化。

## 核心原则

这个项目按 agent-first 方式设计：每个关键动作都应该能被本地 agent 诊断、复现、恢复。

实际运行时优先使用 `xpost` 命令，而不是临时拼 Browser Relay 请求。诊断从 `xpost doctor`、`xpost heartbeat`、服务状态、队列、archive 和日志开始。恢复通过 `retry`、`ignore`、`reschedule`、重新 bootstrap 或重启服务完成。

真实发布必须经过显式安全门：

- X 发布需要 `--yes`。
- 小红书发布需要 `--yes`，并且 worker 处于 publish mode，或显式运行 `xpost rednote-post --id NOTE_ID --yes`。
- 不自动化点赞、关注、私信、评论或批量互动。

## 安装

新机器从仓库安装：

```bash
git clone https://github.com/kylvia/xpost-agent.git
cd xpost-agent
./install.sh
```

安装脚本会：

- 安装项目依赖。
- 安装 Browser Relay。
- 把 `xpost` CLI 安装到全局。
- 安装仓库内置 skills 到本地 agent skill 目录。
- 启动 Browser Relay。
- 打印 Chrome extension 路径。

如果 Browser Relay 打印了 extension 路径，打开 `chrome://extensions`，开启 Developer Mode，然后加载这个目录。

基础检查：

```bash
xpost health
xpost doctor
```

如果你要让 Codex、Claude Code 或其他本地 agent 接手启动、诊断或维护，先看 [docs/agent-usage.md](docs/agent-usage.md)。

## 配置 `.env`

从 `.env.example` 复制一份本地 `.env`。真实 `.env` 不要提交。

最少需要：

```dotenv
XPOST_LIAOBOTS_AUTHCODE=...
XPOST_LIAOBOTS_BASE_URL=https://ai.liaobots1.work/v1
```

生产发布机器建议设置账号锁：

```dotenv
XPOST_ACCOUNT=_example_
```

把 `_example_` 换成预期的 X handle。设置后，如果 Chrome 当前登录的 X 账号不匹配，worker 会 fail closed，避免发到错误账号。

可选项：

```dotenv
XPOST_MODEL=claude-opus-4-8
XPOST_FALLBACK_MODELS=gemini-3.1-pro-preview
XPOST_THINKING_SKILL=creator-systems
XPOST_SKILL=realist-perspective
XPOST_GENERATOR=api
XPOST_API_TIMEOUT_MS=60000
XPOST_FEISHU_WEBHOOK_URL=
```

## 启动常驻 Runner

确保 Chrome 已登录：

- X 目标账号。
- 小红书创作者后台。

然后运行：

```bash
npm run bootstrap:agent
```

bootstrap 会安装或刷新四个 launchd 服务：

```text
daily-agent: 每天本地 00:00 生成 daily-plan
worker: 每 180 秒检查并发布 X 队列
rednote: 每 300 秒检查并发布小红书队列
metrics: 每天本地 09:30 采集近期 X 互动数据
```

如果想立刻生成今天的计划，而不是等下一个本地 00:00：

```bash
XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent
```

注意：bootstrap 只配置 launchd 执行层，不会创建 Codex App Automations。

## Codex Automations 与 launchd 的区别

本项目的执行调度由 launchd 负责：

- `daily-agent` 生成计划。
- `worker` 发布 X 队列。
- `rednote` 发布小红书队列。
- `metrics` 采集互动数据。

Codex App Automations 只适合作为只读审计层，用来检查状态、写日报、提示需要人工确认的恢复命令。它不应该生成、入队、重试、忽略、发布或重启服务。

预期的 Codex audit automations：

```text
xpost-daily-plan-audit
xpost-publish-progress-audit
xpost-daily-posting-summary
```

这些 Automations 是 Codex App 本地状态，不会通过 `git pull` 同步到另一台机器。

## 常用命令

只读检查：

```bash
xpost doctor
xpost doctor --json
xpost heartbeat --json
xpost service status --kind daily-agent
xpost service status
xpost service status --kind rednote
xpost service status --kind metrics
```

生成和队列：

```bash
xpost draft --topic 自动化
xpost agent-run --topic 自动化 --enqueue
xpost daily-plan --count 5 --rednote-count 2
xpost daily-plan --dry-run --count 2 --rednote-count 1 --json
```

X 队列：

```bash
xpost list --json
xpost retry --id POST_ID
xpost ignore --id POST_ID --reason "old failed run"
xpost reschedule --id POST_ID --at "2026-06-03T22:05:00+08:00"
xpost worker --once --yes
```

小红书队列：

```bash
xpost rednote-list --json
xpost rednote-retry --id NOTE_ID
xpost rednote-ignore --id NOTE_ID --reason "old failed run"
xpost rednote-worker --once --yes
xpost rednote-post --id NOTE_ID --yes
```

archive 和复盘：

```bash
xpost archive-list --since 2026-06-03 --json
xpost archive-report --since 2026-06-03 --json
xpost metrics-capture --since 2026-06-03 --source daily-plan --json
xpost weekly-review --days 7 --json
```

## 内容生成逻辑

`daily-plan` 会先让模型生成一个 `contentIntent`，再基于同一个 intent 生成 X 帖子和小红书笔记。

默认分工：

- `creator-systems` 是 thinking layer，负责目标、注意力、写作、系统和反馈循环。
- `realist-perspective` 是 voice layer，负责中文表达表面风格。
- 小红书从同一批 X 中挑适配度更高的内容改写，不是独立随机生成。

默认 API 主模型是：

```text
claude-opus-4-8
```

默认 fallback 模型是：

```text
gemini-3.1-pro-preview
```

也可以使用本地 Codex spawn：

```bash
xpost daily-plan --generator codex --count 5 --rednote-count 2
```

如果要持久化到 launchd：

```dotenv
XPOST_GENERATOR=codex
XPOST_CODEX_MODEL=
```

## 本地状态位置

运行状态默认在：

```text
~/.xpost-agent/
```

重要文件和目录：

```text
~/.xpost-agent/queue.json
~/.xpost-agent/rednote-queue.json
~/.xpost-agent/content-archive.json
~/.xpost-agent/logs/
~/.xpost-agent/screenshots/
~/.xpost-agent/rednote-screenshots/
~/.xpost-agent/rednote-assets/
```

这些都属于本地运行态，不要提交。

## 安全边界

不要提交或公开：

- `.env`、`.env.*`
- auth code、Feishu webhook、cookies、浏览器 profile
- launchd plist 中的环境变量或密钥
- `~/.xpost-agent` 下的队列、archive、截图、素材、日志
- 私有 skill 语料或 reference corpora

发布失败时，不要手动点浏览器按钮来“补完自动化”。应该检查 DOM、截图、日志，修复 `src/x.js` 或 `src/rednote.js`，让下一次 agent 能自动复现。

## 安全与历史说明

当前公开仓库是干净初始提交。以后如果要发布 fork、镜像，或从私有开发仓库再次导出公开版本，注意不要把本地运行态和私有历史带出去：

1. 阅读 [SECURITY.md](SECURITY.md)。
2. 阅读 [docs/open-source-readiness.md](docs/open-source-readiness.md)。
3. 用 `gitleaks` 或 `trufflehog` 扫描准备发布的当前树和 git 历史。
4. 如果历史里出现过密钥、真实账号、私有 skill、截图或本地状态，先 rewrite/squash 历史。
5. 轮换任何可能泄露过的 token、webhook 或 API key。
6. 再运行 `npm run check` 和 `npm test`。

## 常见问题

如果 `xpost doctor` 报 Browser Relay 不通，先运行：

```bash
browser-relay status
browser-relay start
```

如果 Chrome tab 不可见，检查 Browser Relay extension 是否已加载并连接。

如果账号检查失败，打开 Chrome 的 X 页面，确认当前账号就是 `XPOST_ACCOUNT` 配置的 handle。

如果服务使用旧代码或旧 `.env`，重新运行：

```bash
npm run bootstrap:agent
```

如果队列里有旧失败项，不要直接删除。先判断是重试还是忽略：

```bash
xpost retry --id POST_ID
xpost ignore --id POST_ID --reason "old failed run"
xpost rednote-retry --id NOTE_ID
xpost rednote-ignore --id NOTE_ID --reason "old failed run"
```
