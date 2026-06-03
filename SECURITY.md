# Security Policy

`xpost-agent` controls the user's logged-in Chrome session through Browser Relay. Treat it as a local automation tool with access to browser state, local queue files, screenshots, and launchd configuration.

## Sensitive Local State

Never commit or share:

- `.env` or `.env.*` files
- API auth codes, Feishu webhooks, cookies, or browser profile data
- launchd plists containing environment variables or auth codes
- queue, archive, screenshot, asset, or log data from `~/.xpost-agent`
- screenshots that may contain private account, draft, or notification data
- private skill reference corpora

The project is designed so source code and public runbooks live in git, while runtime state stays local to each Mac.

## Reporting Issues

If you find a vulnerability, please report it privately to the repository maintainer instead of opening a public issue with exploit details, secrets, screenshots, or account identifiers.

When reporting, include:

- affected version or commit
- local operating system and Node.js version
- the command that exposed the issue
- redacted logs or screenshots only when needed

## Automation Boundaries

This project should only automate content drafting, queueing, and explicit user-authorized publishing. It must not automate likes, follows, DMs, comments, mass replies, scraping private pages, or bulk engagement.

Publishing actions must stay gated by `--yes` and the user's authenticated Chrome session. Read-only diagnostics such as `xpost doctor` and `xpost heartbeat` should remain safe to run without posting, retrying, restarting services, or opening composers.
