# X Worker Failure Modes

This file lists failure modes seen in real local publishing runs and the preferred response.

## Extension Or Relay Disconnected

Symptoms:

- `No live X tab available`
- `Unable to open a live X compose tab`
- `xpost health` has no X tabs

Response:

1. Open Chrome with an X tab.
2. Check Browser Relay extension is connected.
3. Run `node bin/xpost.js health --json`.
4. Retry failed queue items explicitly with `xpost retry`.

## Wrong X Account

Symptoms:

- `X account mismatch: expected @_example_, current @...`

Response:

1. Switch Chrome/X to the intended account.
2. Confirm with `node bin/xpost.js health --json`.
3. Keep launchd installed with `--account _example_`.

The worker must fail closed when the account does not match.
Replace `_example_` with the expected X handle for the runner Mac.

## Chrome Native "Leave Site" Dialog

Symptoms:

- Browser shows `Leave this site?`
- Browser Relay `Page.navigate` or `Runtime.evaluate` times out.
- The next queued post fails because the composer textbox is not found.

Response:

1. Do not assume the post succeeded unless the queue item is `posted` and has a posted screenshot.
2. Dismiss the native dialog only when it is safe to discard the current draft.
3. Prefer posting one recovery item at a time with `xpost post --id ... --yes --account _example_`.

Longer-term mitigation: avoid tight consecutive posts, and add browser-state checks before navigating away from a composer.

## Composer Text Not Inserted

Symptoms:

- `X composer text was not inserted`
- filled screenshot is missing or does not show the intended text

Response:

1. Run a dry-run with short text:

```bash
node bin/xpost.js dry-run --account _example_ --text "link test, do not post" --json
node bin/xpost.js clear --json
```

2. If dry-run fails, inspect `src/x.js` selectors and current Browser Relay snapshot.

## Post Button Disabled

Symptoms:

- `X post button is not enabled after typing`
- negative character counter

Response:

1. Let `xpost` discard stale over-limit draft state.
2. If repeated, clear the composer and retry one item.
3. Verify the queue text is within X limits after formatting.

## Polling Looks Late

Symptoms:

- A scheduled item remains `scheduled` shortly after its time.

Response:

Check the worker interval. With `--interval 180`, the item can run about 3 minutes after its scheduled time. This is normal unless it remains scheduled after more than one interval.

## Rednote Worker Filled But Did Not Publish

Symptoms:

- Rednote queue item becomes `filled`, not `posted`.
- Filled screenshot still shows the Creator editor and the red `发布` button.
- Worker is installed with `rednote-worker --yes --publish`.

Response:

1. Treat the item as not posted. Do not infer success from an upload/fill screenshot.
2. Inspect the filled screenshot and queue item status.
3. Check whether `draftNote` returned early through a draft-only path. In publish mode, `publish: true` must take precedence over `save: false`.
4. Add or run the regression in `test/rednote.test.js` that exercises `draftNote(..., { publish: true, save: false })`.
5. Retry the item explicitly:

```bash
node bin/xpost.js rednote-retry --id NOTE_ID --json
node bin/xpost.js rednote-post --id NOTE_ID --yes --image-provider liao --json
```

6. Restart the launchd worker after code or `.env` changes:

```bash
node bin/xpost.js service stop --kind rednote --json
node bin/xpost.js service start --kind rednote --json
```

## Rednote Liao Image Fetch Failed

Symptoms:

- `coverFallbackFrom` is `liao`.
- `coverFallbackError` is `fetch failed`.
- A later direct request to the same `gpt-image-2` endpoint may succeed.

Response:

1. Keep local letter-paper fallback enabled unless the user explicitly asked for liao-only images.
2. Run a small image API smoke check before changing credentials or endpoint.
3. If text generation works but image generation intermittently fails, classify it as transient provider/network instability, not a Rednote publish blocker.

## Browser Relay Upload Endpoint Missing

Symptoms:

- Rednote items fail with `Unknown API endpoint: /api/upload`.
- `browser-relay --version` may still show the expected version.
- `curl -X POST http://127.0.0.1:18795/api/upload ...` returns `Unknown API endpoint` instead of a validation error such as `files are required`.

Response:

1. Confirm which Browser Relay launchd is running:

```bash
plutil -p ~/Library/LaunchAgents/org.browser-relay.service.plist
ps -p "$(pgrep -f 'browser-relay/server/cli.js' | head -n 1)" -o pid,command
```

2. Compare the global Browser Relay package with the repo-local package. Same version numbers are not enough; the global service may be running older package contents.

```bash
diff -u "$(npm root -g)/@linsoai/browser-relay/server/relay-server.js" \
  node_modules/@linsoai/browser-relay/server/relay-server.js
```

3. Reinstall the global Browser Relay from the repo-local locked dependency, then restart it:

```bash
npm install
npm install -g "$PWD/node_modules/@linsoai/browser-relay"
browser-relay restart
```

4. Verify the upload endpoint exists before retrying Rednote:

```bash
curl -sS -X POST http://127.0.0.1:18795/api/upload \
  -H 'content-type: application/json' \
  -d '{}'
```

The expected fixed response is a validation error like `files are required`, not `Unknown API endpoint`.

5. Open or refresh a Xiaohongshu Creator tab so Browser Relay sees a Rednote tab, then retry failed Rednote items only after explicit user approval.
