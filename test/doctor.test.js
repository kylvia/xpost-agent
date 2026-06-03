"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatDoctorReport,
  runDoctor,
  summarizeLaunchdStatus,
} = require("../src/doctor");

function deps(overrides = {}) {
  return {
    currentAccount: async () => ({ handle: "_example_" }),
    readArchive: () => [],
    readRednoteQueue: () => [],
    readXQueue: () => [],
    relay: {
      status: async () => "Browser Relay is running",
      tabs: async () => [],
      version: async () => "browser-relay 1.0.0",
    },
    service: {
      statusService: async ({ kind }) => ({
        ok: true,
        kind,
        label: `com.xpost-agent.${kind}`,
        loaded: true,
        plistExists: true,
        plistPath: `/tmp/${kind}.plist`,
        status: "state = running\npid = 123\nruns = 2\nlast exit code = 0",
      }),
    },
    ...overrides,
  };
}

test("runDoctor default is read-only and redacts API secrets", async () => {
  let fetchCalls = 0;
  const report = await runDoctor({
    env: {
      LIAOBOTS_AUTHCODE: "secret-token",
      XPOST_HOME: "/tmp/xpost-agent-test",
      XPOST_LIAOBOTS_BASE_URL: "https://api.example.test/v1",
    },
    now: new Date("2026-06-01T10:00:00+08:00"),
    deps: deps({
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("fetch should not be called without --deep");
      },
      readArchive: () => [
        { id: "x:a", platform: "x", source: "daily-plan", postedAt: "2026-06-01T09:00:00+08:00" },
      ],
      readRednoteQueue: () => [
        { id: "r1", title: "note", status: "scheduled", scheduledAt: "2026-06-01T20:00:00+08:00" },
      ],
      readXQueue: () => [
        { id: "x1", status: "posted", postedAt: "2026-06-01T09:30:00+08:00" },
        { id: "x2", status: "failed", scheduledAt: "2026-06-01T08:00:00+08:00", lastError: "publish failed" },
      ],
      relay: {
        status: async () => "Browser Relay is running",
        tabs: async () => [
          { id: "tab-x", url: "https://x.com/home" },
          { id: "tab-rednote", url: "https://www.xiaohongshu.com/explore" },
        ],
        version: async () => "browser-relay 1.0.0",
      },
    }),
  });

  assert.equal(fetchCalls, 0);
  assert.equal(report.deep, false);
  assert.equal(report.environment.api.auth.present, true);
  assert.equal(report.environment.api.auth.source, "LIAOBOTS_AUTHCODE");
  assert.equal(report.environment.api.chatEndpoint, "https://api.example.test/v1/chat/completions");
  assert.equal(report.browser.xTabs, 1);
  assert.equal(report.browser.rednoteTabs, 1);
  assert.equal(report.browser.account.handle, "_example_");
  assert.equal(report.queues.x.total, 2);
  assert.equal(report.queues.x.statuses.failed, 1);
  assert.equal(report.queues.rednote.today.total, 1);
  assert.equal(report.archive.today.count, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

test("runDoctor --deep checks chat and image APIs without storing secrets", async () => {
  const requests = [];
  const report = await runDoctor({
    deep: true,
    env: {
      XPOST_LIAOBOTS_AUTHCODE: "secret-token",
      XPOST_LIAOBOTS_BASE_URL: "https://api.example.test",
    },
    now: new Date("2026-06-01T10:00:00+08:00"),
    deps: deps({
      fetch: async (url, options) => {
        requests.push({
          url,
          authorization: options.headers.authorization,
          body: JSON.parse(options.body),
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ model: "ok-model", choices: [{ message: { content: "OK" } }] }),
        };
      },
    }),
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.example.test/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer secret-token");
  assert.equal(requests[0].body.model, "claude-opus-4-8");
  assert.equal(requests[1].body.model, "gpt-image-2");
  assert.equal(report.api.deep.chat.ok, true);
  assert.equal(report.api.deep.image.ok, true);
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

test("runDoctor warns when the browser X account differs from the worker account", async () => {
  const report = await runDoctor({
    env: { XPOST_LIAOBOTS_AUTHCODE: "secret-token" },
    now: new Date("2026-06-01T10:00:00+08:00"),
    deps: deps({
      currentAccount: async () => ({ handle: "cocouk", source: "account-switcher" }),
      relay: {
        status: async () => "Browser Relay is running",
        tabs: async () => [
          { id: "tab-x", url: "https://x.com/home" },
          { id: "tab-rednote", url: "https://www.xiaohongshu.com/explore" },
        ],
        version: async () => "browser-relay 1.0.0",
      },
      service: {
        statusService: async ({ kind }) => ({
          ok: true,
          kind,
          label: `com.xpost-agent.${kind}`,
          loaded: true,
          plistExists: true,
          plistPath: `/tmp/${kind}.plist`,
          status: kind === "worker"
            ? "state = running\narguments = {\n\t/opt/node\n\t/bin/xpost.js\n\tworker\n\t--yes\n\t--account\n\t_example_\n}\npid = 123\nruns = 2\nlast exit code = 0"
            : "state = running\npid = 123\nruns = 2\nlast exit code = 0",
        }),
      },
    }),
  });

  const accountCheck = report.checks.find((check) => check.name === "x account");
  assert.equal(report.summary.status, "warn");
  assert.equal(report.environment.xAccount.expected, "_example_");
  assert.equal(report.environment.xAccount.source, "worker service --account");
  assert.equal(accountCheck.status, "warn");
  assert.match(accountCheck.message, /expected @_example_, current @cocouk/);
});

test("formatDoctorReport prints compact human-readable sections", async () => {
  const report = await runDoctor({
    env: { XPOST_LIAOBOTS_AUTHCODE: "secret-token" },
    now: new Date("2026-06-01T10:00:00+08:00"),
    deps: deps({
      readXQueue: () => [
        { id: "x2", status: "failed", scheduledAt: "2026-06-01T08:00:00+08:00", lastError: "publish failed" },
      ],
    }),
  });

  const text = formatDoctorReport(report);

  assert.match(text, /xpost doctor/);
  assert.match(text, /Summary/);
  assert.match(text, /Queues/);
  assert.match(text, /x: total 1, today 1, failed 1/);
  assert.match(text, /API/);
  assert.doesNotMatch(text, /secret-token/);
});

test("summarizeLaunchdStatus extracts safe service fields", () => {
  const summary = summarizeLaunchdStatus({
    ok: true,
    kind: "rednote",
    label: "com.xpost-agent.rednote-worker",
    loaded: true,
    plistExists: true,
    plistPath: "/tmp/rednote.plist",
    status: "state = running\npid = 42\nruns = 7\nlast exit code = 0\nXPOST_LIAOBOTS_AUTHCODE = secret-token",
  });

  assert.equal(summary.kind, "rednote");
  assert.equal(summary.loaded, true);
  assert.equal(summary.state, "running");
  assert.equal(summary.pid, 42);
  assert.equal(summary.runs, 7);
  assert.equal(summary.lastExitCode, 0);
  assert.doesNotMatch(JSON.stringify(summary), /secret-token/);
});

test("summarizeLaunchdStatus extracts worker account argument", () => {
  const summary = summarizeLaunchdStatus({
    ok: true,
    kind: "worker",
    label: "com.xpost-agent.worker",
    loaded: true,
    plistExists: true,
    plistPath: "/tmp/worker.plist",
    status: "state = running\narguments = {\n\t/opt/node\n\t/bin/xpost.js\n\tworker\n\t--yes\n\t--account\n\t_example_\n}\npid = 42\nruns = 7",
  });

  assert.equal(summary.xAccount, "_example_");
});
