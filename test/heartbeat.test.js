"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildHeartbeat,
  formatHeartbeat,
  heartbeatNotifyLines,
} = require("../src/heartbeat");

function report(overrides = {}) {
  return {
    ok: false,
    generatedAt: "2026-06-01T02:00:00.000Z",
    localDate: "2026-06-01",
    browser: {
      ok: true,
      version: "browser-relay 1.0.0",
      tabCount: 3,
      xTabs: 1,
      rednoteTabs: 1,
      account: { handle: "_example_" },
    },
    services: [
      { kind: "daily-agent", loaded: true, state: "running", pid: 123, runs: 4, lastExitCode: 0 },
      { kind: "rednote", loaded: false, plistExists: true, message: "not loaded" },
    ],
    queues: {
      x: {
        total: 3,
        statuses: { posted: 1, scheduled: 1, failed: 1 },
        today: { total: 2, statuses: { posted: 1, failed: 1 } },
        due: 0,
        failed: [
          { id: "x1", title: null, lastError: "Bearer x-secret publish failed" },
        ],
      },
      rednote: {
        total: 2,
        statuses: { scheduled: 1, failed: 1 },
        today: { total: 2, statuses: { scheduled: 1, failed: 1 } },
        due: 1,
        failed: [
          { id: "r1", title: "夏日笔记", lastError: "XPOST_LIAOBOTS_AUTHCODE=rn-secret failed" },
        ],
      },
    },
    archive: {
      total: 9,
      today: { count: 2, byPlatform: { x: 1, rednote: 1 } },
    },
    checks: [],
    summary: { status: "fail", failures: 1, warnings: 2, checks: 8 },
    ...overrides,
  };
}

test("buildHeartbeat summarizes doctor report services queues archive and failures", () => {
  const heartbeat = buildHeartbeat(report());

  assert.equal(heartbeat.ok, false);
  assert.equal(heartbeat.status, "fail");
  assert.equal(heartbeat.generatedAt, "2026-06-01T02:00:00.000Z");
  assert.equal(heartbeat.localDate, "2026-06-01");
  assert.equal(heartbeat.services.rednote.loaded, false);
  assert.equal(heartbeat.today.x.posted, 1);
  assert.equal(heartbeat.today.rednote.failed, 1);
  assert.equal(heartbeat.today.archive.count, 2);
  assert.equal(heartbeat.failures.length, 2);
  assert.deepEqual(heartbeat.failures.map((item) => item.platform), ["x", "rednote"]);
  assert.equal(heartbeat.failures[1].id, "r1");
  assert.equal(heartbeat.failures[1].title, "夏日笔记");
});

test("buildHeartbeat carries warning checks into text and notify lines", () => {
  const heartbeat = buildHeartbeat(report({
    checks: [
      { status: "ok", name: "browser relay", message: "ok" },
      { status: "warn", name: "x account", message: "expected @_example_, current @cocouk" },
    ],
    summary: { status: "warn", failures: 0, warnings: 1, checks: 2 },
  }));

  assert.equal(heartbeat.warnings.length, 1);
  assert.equal(heartbeat.warnings[0].name, "x account");
  assert.match(formatHeartbeat(heartbeat), /Warnings/);
  assert.match(formatHeartbeat(heartbeat), /expected @_example_, current @cocouk/);
  assert.ok(heartbeatNotifyLines(heartbeat).some((line) => (
    line.includes("warning: x account: expected @_example_, current @cocouk")
  )));
});

test("buildHeartbeat tolerates missing queue objects", () => {
  const heartbeat = buildHeartbeat(report({ queues: null }));

  assert.equal(heartbeat.today.x.total, 0);
  assert.equal(heartbeat.today.rednote.total, 0);
  assert.equal(heartbeat.failures.length, 0);
});

test("formatHeartbeat includes heading and redacts secrets", () => {
  const text = formatHeartbeat(buildHeartbeat(report()));

  assert.match(text, /xpost heartbeat/);
  assert.match(text, /status: fail/);
  assert.match(text, /rednote r1 夏日笔记/);
  assert.doesNotMatch(text, /x-secret/);
  assert.doesNotMatch(text, /rn-secret/);
  assert.match(text, /\[redacted\] publish failed/);
  assert.match(text, /XPOST_LIAOBOTS_AUTHCODE=\[redacted\]/);
});

test("heartbeatNotifyLines includes rednote failure and redacts secrets", () => {
  const lines = heartbeatNotifyLines(buildHeartbeat(report()));

  assert(lines.some((line) => line.includes("rednote r1 夏日笔记")));
  assert.doesNotMatch(lines.join("\n"), /rn-secret/);
  assert.match(lines.join("\n"), /XPOST_LIAOBOTS_AUTHCODE=\[redacted\]/);
});

test("heartbeat redacts embedded bearer and webhook secrets without numeric offsets", () => {
  const webhook = "https://open.feishu.cn/open-apis/bot/v2/hook/abc";
  const heartbeat = buildHeartbeat(report({
    queues: {
      x: {
        failed: [
          { id: "x1", title: `title ${webhook}`, lastError: "publish failed Bearer x-secret" },
        ],
      },
      rednote: {
        failed: [
          { id: "r1", title: `note ${webhook}`, lastError: `upload failed ${webhook}` },
        ],
      },
    },
  }));
  const formatted = formatHeartbeat(heartbeat);
  const notified = heartbeatNotifyLines(heartbeat).join("\n");
  const combined = `${formatted}\n${notified}`;

  assert.doesNotMatch(combined, /x-secret|hook\/abc/);
  assert.doesNotMatch(combined, /\d+\[redacted\]/);
  assert.match(combined, /publish failed \[redacted\]/);
  assert.match(combined, /title \[redacted\]/);
  assert.match(combined, /note \[redacted\]/);
});

test("buildHeartbeat redacts failure titles before JSON output", () => {
  const webhook = "https://open.feishu.cn/open-apis/bot/v2/hook/abc";
  const heartbeat = buildHeartbeat(report({
    queues: {
      x: {
        failed: [
          { id: "x1", title: `title Bearer title-secret`, lastError: "publish failed" },
          { id: "x2", title: `title ${webhook}`, lastError: "publish failed" },
        ],
      },
      rednote: {
        failed: [
          { id: "r1", title: "XPOST_LIAOBOTS_AUTHCODE=title-auth failed", lastError: "publish failed" },
        ],
      },
    },
  }));
  const serialized = JSON.stringify(heartbeat);

  assert.doesNotMatch(serialized, /title-secret|hook\/abc|title-auth/);
  assert.match(serialized, /title \[redacted\]/);
  assert.match(serialized, /XPOST_LIAOBOTS_AUTHCODE=\[redacted\]/);
});
