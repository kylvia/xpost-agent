# Public Release Safety

Use this checklist for forks, mirrors, or future public release exports from a private development repository.

## Current Tree

- Keep `.env`, `.env.*`, launchd plists, logs, screenshots, queue files, archive files, and `~/.xpost-agent` data out of git.
- Keep private skill corpora and reference exports out of git.
- Use generic bundled skills such as `realist-perspective` and `creator-systems` for public defaults.
- Use placeholder handles such as `_example_` in tests and docs.
- Run `npm run check` and `npm test`.

## Repository History

The current working tree is not the whole story. Before publishing history that has ever contained private prompts, real handles, auth codes, screenshots, or reference corpora:

1. Scan history with a secret scanner such as `gitleaks` or `trufflehog`.
2. Rewrite or squash history if private data was committed.
3. Rotate any token, webhook, or API key that may have appeared in git history, shell history, logs, screenshots, or launchd plists.
4. Re-run the scanner after rewriting history.
5. Push only after confirming the public branch contains no private runtime state.

## Local Runner

Open-sourcing the repo does not move local automation state. Each Mac still needs its own:

- `.env`
- Chrome sessions for X and Xiaohongshu
- Browser Relay extension state
- launchd services
- `~/.xpost-agent` queues, archives, screenshots, assets, and logs
- Codex App automation audit jobs, if used

Use `docs/new-runner-handoff.md` for a clean setup on another machine.
