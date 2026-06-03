"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFeishuTextPayload,
  notifyFeishu,
  redactSecrets,
} = require("../src/notifier");

test("redactSecrets removes webhook and bearer secrets", () => {
  const text = redactSecrets("url https://open.feishu.cn/open-apis/bot/v2/hook/abc token Bearer secret-token XPOST_LIAOBOTS_AUTHCODE=abc");
  assert.doesNotMatch(text, /secret-token|hook\/abc|AUTHCODE=abc/);
});

test("redactSecrets does not preserve numeric offsets for uncaptured secrets", () => {
  const text = redactSecrets("publish failed Bearer secret-token via https://open.feishu.cn/open-apis/bot/v2/hook/abc");
  assert.equal(text, "publish failed [redacted] via [redacted]");
  assert.doesNotMatch(text, /\d+\[redacted\]/);
});

test("redactSecrets removes flexible authcode assignments", () => {
  const text = redactSecrets("XPOST_LIAOBOTS_AUTHCODE = secret-token LIAOBOTS_AUTHCODE: other-secret XPOST_LIAOBOTS_AUTHCODE => launchd-secret");
  assert.doesNotMatch(text, /secret-token|other-secret|launchd-secret/);
  assert.match(text, /XPOST_LIAOBOTS_AUTHCODE = \[redacted\]/);
  assert.match(text, /LIAOBOTS_AUTHCODE: \[redacted\]/);
  assert.match(text, /XPOST_LIAOBOTS_AUTHCODE => \[redacted\]/);
});

test("redactSecrets removes launchd-style webhook assignments", () => {
  const text = redactSecrets("XPOST_FEISHU_WEBHOOK_URL => https://open.feishu.cn/open-apis/bot/v2/hook/abc-123");
  assert.doesNotMatch(text, /hook\/abc-123/);
  assert.match(text, /XPOST_FEISHU_WEBHOOK_URL => \[redacted\]/);
});

test("buildFeishuTextPayload formats compact text messages", () => {
  const payload = buildFeishuTextPayload({
    title: "小红书发布失败",
    lines: ["id: r1", "next: xpost rednote-retry --id r1"],
  });
  assert.deepEqual(payload, {
    msg_type: "text",
    content: {
      text: "[xpost-agent] 小红书发布失败\nid: r1\nnext: xpost rednote-retry --id r1",
    },
  });
});

test("notifyFeishu warns when webhook is missing", async () => {
  const result = await notifyFeishu({
    env: {},
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.match(result.warning, /XPOST_FEISHU_WEBHOOK_URL/);
});

test("notifyFeishu sends webhook payload", async () => {
  const calls = [];
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{\"StatusCode\":0}" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://example.test/hook");
  assert.equal(JSON.parse(calls[0].init.body).msg_type, "text");
});

test("notifyFeishu fails on Feishu non-zero StatusCode", async () => {
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "{\"StatusCode\":9499,\"msg\":\"invalid webhook\"}",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.match(result.response, /9499/);
});

test("notifyFeishu fails on Feishu non-zero code", async () => {
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "{\"code\":19001,\"msg\":\"bad sign\"}",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.match(result.response, /19001/);
});

test("notifyFeishu fails when Feishu body has no status fields", async () => {
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
});

test("notifyFeishu fails when Feishu response is invalid JSON", async () => {
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "not-json XPOST_LIAOBOTS_AUTHCODE = secret-token",
    }),
  });

  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test("notifyFeishu fails when mixed Feishu status fields include a failure", async () => {
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: "https://example.test/hook" },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "{\"StatusCode\":0,\"code\":19001}",
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.response, /19001/);
});

test("notifyFeishu redacts webhook from send errors", async () => {
  const webhook = "https://example.test/hook/secret-webhook";
  const result = await notifyFeishu({
    env: { XPOST_FEISHU_WEBHOOK_URL: webhook },
    title: "test",
    lines: ["hello"],
    fetchImpl: async () => {
      throw new Error(`failed to send ${webhook} with Bearer secret-token`);
    },
  });

  const serialized = JSON.stringify(result);
  assert.equal(result.ok, false);
  assert.doesNotMatch(serialized, /secret-webhook|secret-token/);
  assert.doesNotMatch(serialized, new RegExp(webhook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
