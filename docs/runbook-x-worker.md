# X Worker Runbook

This runbook captures the operating habits that keep local X publishing predictable.

## Safety Invariants

- Keep the worker account-locked:

```bash
node bin/xpost.js service install --yes --interval 180 --account _example_
node bin/xpost.js service start
```

- Check health before a real post or after changing accounts:

```bash
node bin/xpost.js health --json
```

The `account.handle` field must match `_example_`.
Replace `_example_` with the expected X handle for the runner Mac.

- Treat Browser Relay as a browser control layer, not a posting API. A healthy relay means Chrome is reachable; it does not guarantee that the X composer is ready.

## Normal Checks

See whether the worker is running:

```bash
node bin/xpost.js service status --json
```

List queue state:

```bash
node bin/xpost.js list --json
```

Tail worker output:

```bash
tail -n 80 ~/.xpost-agent/logs/worker.out.log
tail -n 80 ~/.xpost-agent/logs/worker.err.log
```

## Timing

`--interval 180` is polling, not exact scheduling. A post scheduled for `22:05` can run up to about 3 minutes later.

When moving a post that is already due or nearly due, stop the worker first:

```bash
node bin/xpost.js service stop --json
node bin/xpost.js reschedule --id POST_ID --at "2026-05-29T22:05:00+08:00" --json
node bin/xpost.js service start --json
```

## Retry Failed Posts

Failed posts are not retried automatically. This is intentional: it prevents accidental repeated public posts after a browser or account issue.

After fixing the browser/account condition:

```bash
node bin/xpost.js retry --id POST_ID --at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --json
node bin/xpost.js worker --once --yes --account _example_ --json
```

For manual one-off recovery, prefer one post at a time:

```bash
node bin/xpost.js post --id POST_ID --yes --account _example_ --json
```

## Content Formatting

Generated posts are formatted before enqueueing:

- one to two sentences per paragraph
- blank line between paragraphs
- existing intentional newlines are preserved

If a queued post was created before this rule existed, resave its `text` through `formatPostTextForX` or edit it before it reaches the worker.
