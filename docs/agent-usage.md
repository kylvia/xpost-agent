# Agent 使用说明

这份说明给使用 Codex、Claude Code 或其他本地 agent 的用户。目标是让 agent 能安全地启动、诊断和维护 `xpost-agent`，同时避免误发帖或泄露本地状态。

## 适合交给 Agent 的任务

可以交给 agent：

- 安装依赖和 Browser Relay。
- 检查 `.env` 是否缺少必要配置，但不要打印真实密钥。
- 运行 `npm run bootstrap:agent` 刷新 launchd 服务。
- 用 `xpost doctor` 和 `xpost heartbeat --json` 做只读健康检查。
- 查看队列、archive、日志和失败项。
- 修复浏览器选择器、发布适配器或 prompt 生成逻辑。
- 生成 daily-plan dry-run 预览。
- 在用户明确授权后，重试、忽略、重新调度队列项。

不要默认交给 agent：

- 发布测试帖。
- 点击浏览器里的发布按钮来补完自动化。
- 自动点赞、关注、私信、评论或批量互动。
- 删除队列、archive、截图或日志来掩盖失败。
- 打印 `.env`、auth code、webhook、cookies 或截图中的隐私内容。

## 推荐的 Agent 指令

首次启动或换机器时，可以把下面这段直接发给 agent：

```text
进入 xpost-agent 仓库，按 AGENTS.md、README.zh-CN.md 和 docs/new-runner-handoff.md 启动项目。
先做只读检查；如果依赖、.env、Chrome 登录、Browser Relay 或 launchd 服务缺失，就补齐并运行 npm run bootstrap:agent。
用 xpost doctor 和 xpost heartbeat --json 验证。
不要发测试帖，不要手动点发布按钮，不要打印真实密钥。
如果需要今天立刻生成计划，先告诉我，再用 XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent。
```

如果只是检查当前 runner 是否健康：

```text
只做只读检查：运行 xpost doctor、xpost heartbeat --json，并查看 daily-agent、worker、rednote、metrics 四个 launchd 服务状态。
汇报 Browser Relay 是否响应、当前 X 账号是否匹配、今日 X/Rednote 队列数量、archive 数量、失败项 ID 和最后错误。
不要启动发布，不要重试，不要生成新计划。
```

如果要修复失败项：

```text
先用 xpost doctor、xpost heartbeat --json、队列列表、archive 和相关日志定位失败原因。
修复底层问题后，再建议 retry/ignore/reschedule 命令。
除非我明确同意，不要执行 retry、ignore、reschedule 或任何带 --yes 的发布命令。
```

## Agent 启动流程

推荐 agent 按这个顺序执行：

```bash
git status --short --branch
npm install
xpost doctor
xpost heartbeat --json
```

如果依赖、Browser Relay 或 launchd 服务需要刷新：

```bash
npm run bootstrap:agent
xpost doctor
xpost heartbeat --json
```

如果只想验证 API 生成链路，不写队列、不发布：

```bash
xpost daily-plan --dry-run --count 1 --rednote-count 0 --json
```

如果要立即生成今日正式计划，必须由用户明确授权：

```bash
XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent
```

## Agent 汇报格式

agent 完成检查后，建议按三层汇报：

- 执行层：`daily-agent`、`worker`、`rednote`、`metrics` 四个 launchd 服务是否 loaded/running。
- 浏览器层：Browser Relay 是否 responding，Chrome 是否有 X 和小红书 tab，X 当前账号是否匹配 `XPOST_ACCOUNT`。
- 状态层：今日 X/Rednote 队列数量、due 数量、posted/scheduled/failed 数量、archive 数量、失败项 ID 和最后错误。

示例：

```text
Browser Relay responding，X tab 1，小红书 tab 1，当前 X 账号匹配。
daily-agent loaded/not running 是正常定时状态；worker running；rednote running；metrics loaded/not running 是正常定时状态。
今日 X 队列 5：scheduled 5，failed 0；Rednote 队列 2：scheduled 2，failed 0；archive 今日 0。
```

## 安全边界

`xpost doctor` 和 `xpost heartbeat` 是只读命令，适合作为 agent 的默认入口。

这些命令会改变状态，需要用户明确授权：

- `xpost retry`
- `xpost ignore`
- `xpost reschedule`
- `xpost post --yes`
- `xpost worker --yes`
- `xpost rednote-post --yes`
- `xpost rednote-worker --publish --yes`
- `XPOST_KICKSTART_DAILY=1 npm run bootstrap:agent`

这些文件和目录属于本地运行态，不应提交或公开：

- `.env`
- `~/Library/LaunchAgents/com.xpost-agent.*.plist`
- `~/.xpost-agent/queue.json`
- `~/.xpost-agent/rednote-queue.json`
- `~/.xpost-agent/content-archive.json`
- `~/.xpost-agent/logs/`
- `~/.xpost-agent/screenshots/`
- `~/.xpost-agent/rednote-screenshots/`
- `~/.xpost-agent/rednote-assets/`

## 与 Codex Automations 的关系

launchd 是执行层，负责生成计划、发布队列、采集 metrics。

Codex App Automations 只建议作为只读审计层：

- 定时检查 daily-plan 是否生成。
- 定时汇报发布进度。
- 晚上生成当天总结。

Automations 不应该直接生成内容、入队、重试、忽略、发布或重启服务。发现问题时，它应该记录问题并给出建议命令，等待用户在交互线程里确认。
