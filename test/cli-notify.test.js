"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function loadCli() {
  delete require.cache[require.resolve("../src/cli")];
  return require("../src/cli");
}

test("notify-test throws after printing failed result", async () => {
  const originalWebhook = process.env.XPOST_FEISHU_WEBHOOK_URL;
  const originalLog = console.log;
  const output = [];
  delete process.env.XPOST_FEISHU_WEBHOOK_URL;
  console.log = (value) => output.push(value);
  const { main } = loadCli();

  try {
    await assert.rejects(
      () => main(["notify-test", "--json"]),
      /XPOST_FEISHU_WEBHOOK_URL is not configured/,
    );
  } finally {
    console.log = originalLog;
    if (originalWebhook === undefined) {
      delete process.env.XPOST_FEISHU_WEBHOOK_URL;
    } else {
      process.env.XPOST_FEISHU_WEBHOOK_URL = originalWebhook;
    }
  }

  const printed = JSON.parse(output[0]);
  assert.equal(printed.ok, false);
  assert.equal(printed.skipped, true);
});

test("heartbeat --notify text output includes skipped notification warning", async () => {
  const originalWebhook = process.env.XPOST_FEISHU_WEBHOOK_URL;
  const originalLog = console.log;
  const output = [];
  delete process.env.XPOST_FEISHU_WEBHOOK_URL;
  console.log = (value) => output.push(value);
  const { main } = loadCli();

  try {
    await main(["heartbeat", "--notify"]);
  } finally {
    console.log = originalLog;
    if (originalWebhook === undefined) {
      delete process.env.XPOST_FEISHU_WEBHOOK_URL;
    } else {
      process.env.XPOST_FEISHU_WEBHOOK_URL = originalWebhook;
    }
  }

  const text = output.join("\n");
  assert.match(text, /xpost heartbeat/);
  assert.match(text, /Notification/);
  assert.match(text, /XPOST_FEISHU_WEBHOOK_URL is not configured/);
});

test("weekly-review --notify json attaches skipped notification warning when webhook is missing", async () => {
  const originalHome = process.env.XPOST_HOME;
  const originalWebhook = process.env.XPOST_FEISHU_WEBHOOK_URL;
  const originalLog = console.log;
  const output = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-cli-notify-"));
  process.env.XPOST_HOME = home;
  delete process.env.XPOST_FEISHU_WEBHOOK_URL;
  console.log = (value) => output.push(value);
  const { main } = loadCli();

  try {
    await main(["weekly-review", "--days", "7", "--notify", "--json"]);
  } finally {
    console.log = originalLog;
    if (originalHome === undefined) delete process.env.XPOST_HOME;
    else process.env.XPOST_HOME = originalHome;
    if (originalWebhook === undefined) delete process.env.XPOST_FEISHU_WEBHOOK_URL;
    else process.env.XPOST_FEISHU_WEBHOOK_URL = originalWebhook;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const review = JSON.parse(output[0]);
  assert.equal(review.ok, true);
  assert.equal(review.notification.ok, false);
  assert.equal(review.notification.skipped, true);
  assert.match(review.notification.warning, /XPOST_FEISHU_WEBHOOK_URL is not configured/);
});

test("safeNotify redacts thrown notification errors", async () => {
  const { safeNotify } = loadCli();
  const secretWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123";
  const result = await safeNotify(
    "publish.failed",
    [`error: Bearer abc123 ${secretWebhook}`],
    {
      enabled: true,
      env: { XPOST_FEISHU_WEBHOOK_URL: secretWebhook },
      notifyImpl: async () => {
        throw new Error(`send failed for ${secretWebhook} with Bearer abc123`);
      },
      stderr: false,
    },
  );

  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /abc123|abc-123|open-apis\/bot/);
  assert.match(result.error, /\[redacted\]/);
});

test("worker failure notification is quiet and does not throw when webhook is missing", async () => {
  const originalHome = process.env.XPOST_HOME;
  const originalWebhook = process.env.XPOST_FEISHU_WEBHOOK_URL;
  const originalLog = console.log;
  const originalX = require.cache[require.resolve("../src/x")];
  const output = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-worker-notify-"));
  process.env.XPOST_HOME = home;
  delete process.env.XPOST_FEISHU_WEBHOOK_URL;
  console.log = (value) => output.push(value);
  require.cache[require.resolve("../src/x")] = {
    id: require.resolve("../src/x"),
    filename: require.resolve("../src/x"),
    loaded: true,
    exports: {
      clearComposer: async () => ({ ok: true }),
      currentAccount: async () => ({ handle: "test" }),
      fillComposer: async () => ({ screenshot: null }),
      openComposer: async () => ({ id: "tab" }),
      publish: async () => {
        throw new Error("publish failed with Bearer should-not-leak");
      },
    },
  };
  const { main } = loadCli();

  try {
    await main(["enqueue", "--text", "queued", "--at", "2020-01-01T00:00:00Z", "--json"]);
    await main(["worker", "--once", "--yes", "--json"]);
  } finally {
    console.log = originalLog;
    if (originalX) require.cache[require.resolve("../src/x")] = originalX;
    else delete require.cache[require.resolve("../src/x")];
    delete require.cache[require.resolve("../src/cli")];
    if (originalHome === undefined) delete process.env.XPOST_HOME;
    else process.env.XPOST_HOME = originalHome;
    if (originalWebhook === undefined) delete process.env.XPOST_FEISHU_WEBHOOK_URL;
    else process.env.XPOST_FEISHU_WEBHOOK_URL = originalWebhook;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const failed = output.map((line) => JSON.parse(line)).find((item) => item.status === "failed");
  assert.equal(failed.status, "failed");
});
