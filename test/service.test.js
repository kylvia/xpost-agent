"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAgentRunArguments,
  buildAgentPlanArguments,
  buildDailyPlanArguments,
  buildLaunchdPlist,
  buildMetricsCaptureArguments,
  buildRednotePlanArguments,
  buildRednoteWorkerArguments,
  buildWorkerArguments,
  normalizeAgentSchedule,
  redactServiceStatus,
  servicePaths,
  shouldKickstartService,
} = require("../src/service");

test("servicePaths creates launchd and log paths under the user home", () => {
  const paths = servicePaths({ homeDir: "/Users/tester", xpostHome: "/tmp/xpost" });

  assert.equal(paths.label, "com.xpost-agent.worker");
  assert.equal(paths.plistPath, "/Users/tester/Library/LaunchAgents/com.xpost-agent.worker.plist");
  assert.equal(paths.stdoutPath, "/tmp/xpost/logs/worker.out.log");
  assert.equal(paths.stderrPath, "/tmp/xpost/logs/worker.err.log");
});

test("servicePaths rejects unknown service kinds", () => {
  assert.throws(
    () => servicePaths({ kind: "spawn" }),
    /Unknown service kind: spawn/,
  );
});

test("servicePaths supports the rednote draft worker service", () => {
  const paths = servicePaths({ homeDir: "/Users/tester", kind: "rednote", xpostHome: "/tmp/xpost" });

  assert.equal(paths.label, "com.xpost-agent.rednote-worker");
  assert.equal(paths.plistPath, "/Users/tester/Library/LaunchAgents/com.xpost-agent.rednote-worker.plist");
  assert.equal(paths.stdoutPath, "/tmp/xpost/logs/rednote.out.log");
  assert.equal(paths.stderrPath, "/tmp/xpost/logs/rednote.err.log");
});

test("servicePaths supports the rednote daily planner service", () => {
  const paths = servicePaths({ homeDir: "/Users/tester", kind: "rednote-agent", xpostHome: "/tmp/xpost" });

  assert.equal(paths.label, "com.xpost-agent.rednote-agent-runner");
  assert.equal(paths.plistPath, "/Users/tester/Library/LaunchAgents/com.xpost-agent.rednote-agent-runner.plist");
  assert.equal(paths.stdoutPath, "/tmp/xpost/logs/rednote-agent.out.log");
  assert.equal(paths.stderrPath, "/tmp/xpost/logs/rednote-agent.err.log");
});

test("servicePaths supports the unified daily planner service", () => {
  const paths = servicePaths({ homeDir: "/Users/tester", kind: "daily-agent", xpostHome: "/tmp/xpost" });

  assert.equal(paths.label, "com.xpost-agent.daily-agent-runner");
  assert.equal(paths.plistPath, "/Users/tester/Library/LaunchAgents/com.xpost-agent.daily-agent-runner.plist");
  assert.equal(paths.stdoutPath, "/tmp/xpost/logs/daily-agent.out.log");
  assert.equal(paths.stderrPath, "/tmp/xpost/logs/daily-agent.err.log");
});

test("servicePaths supports the daily metrics capture service", () => {
  const paths = servicePaths({ homeDir: "/Users/tester", kind: "metrics", xpostHome: "/tmp/xpost" });

  assert.equal(paths.label, "com.xpost-agent.metrics-capture");
  assert.equal(paths.plistPath, "/Users/tester/Library/LaunchAgents/com.xpost-agent.metrics-capture.plist");
  assert.equal(paths.stdoutPath, "/tmp/xpost/logs/metrics.out.log");
  assert.equal(paths.stderrPath, "/tmp/xpost/logs/metrics.err.log");
});

test("normalizeAgentSchedule rejects unknown schedules", () => {
  assert.equal(normalizeAgentSchedule("daily-random"), "daily-random");
  assert.throws(
    () => normalizeAgentSchedule("daily"),
    /Unknown agent schedule: daily/,
  );
});

test("shouldKickstartService does not kickstart agent calendar services by default", () => {
  assert.equal(shouldKickstartService("worker"), true);
  assert.equal(shouldKickstartService("rednote"), true);
  assert.equal(shouldKickstartService("agent"), false);
  assert.equal(shouldKickstartService("rednote-agent"), false);
  assert.equal(shouldKickstartService("daily-agent"), false);
  assert.equal(shouldKickstartService("metrics"), false);
  assert.equal(shouldKickstartService("agent", { kickstart: true }), true);
  assert.equal(shouldKickstartService("rednote-agent", { kickstart: true }), true);
  assert.equal(shouldKickstartService("daily-agent", { kickstart: true }), true);
  assert.equal(shouldKickstartService("metrics", { kickstart: true }), true);
});

test("buildAgentPlanArguments uses daily random planning arguments", () => {
  const args = buildAgentPlanArguments({
    count: 5,
    model: "claude-opus-4-8",
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    topic: "自动化",
    windowEnd: "06:00",
    windowStart: "00:00",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "agent-plan",
    "--topic",
    "自动化",
    "--model",
    "claude-opus-4-8",
    "--count",
    "5",
    "--window-start",
    "00:00",
    "--window-end",
    "06:00",
    "--json",
  ]);
});

test("buildRednotePlanArguments uses realist daily Rednote planning arguments", () => {
  const args = buildRednotePlanArguments({
    count: 2,
    model: "claude-opus-4-8",
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    skill: "realist-perspective",
    topic: "一人公司",
    windowEnd: "21:30",
    windowStart: "11:00",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "rednote-plan",
    "--topic",
    "一人公司",
    "--model",
    "claude-opus-4-8",
    "--skill",
    "realist-perspective",
    "--count",
    "2",
    "--window-start",
    "11:00",
    "--window-end",
    "21:30",
    "--json",
  ]);
});

test("buildDailyPlanArguments queues unified X and Rednote daily content", () => {
  const args = buildDailyPlanArguments({
    count: 5,
    endpoint: "https://ai.liaobots1.work/v1/chat/completions",
    model: "claude-opus-4-8",
    nodePath: "/opt/node/bin/node",
    rednoteCount: 2,
    rednoteWindowEnd: "21:30",
    rednoteWindowStart: "11:00",
    scriptPath: "/repo/bin/xpost.js",
    skill: "realist-perspective",
    thinkingSkill: "creator-systems",
    xWindowEnd: "23:00",
    xWindowStart: "10:00",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "daily-plan",
    "--model",
    "claude-opus-4-8",
    "--skill",
    "realist-perspective",
    "--count",
    "5",
    "--rednote-count",
    "2",
    "--x-window-start",
    "10:00",
    "--x-window-end",
    "23:00",
    "--rednote-window-start",
    "11:00",
    "--rednote-window-end",
    "21:30",
    "--json",
    "--endpoint",
    "https://ai.liaobots1.work/v1/chat/completions",
    "--thinking-skill",
    "creator-systems",
  ]);
});

test("buildDailyPlanArguments can select local Codex generation", () => {
  const args = buildDailyPlanArguments({
    codexModel: "gpt-test",
    count: 5,
    generator: "codex",
    nodePath: "/opt/node/bin/node",
    rednoteCount: 2,
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args.slice(-4), [
    "--generator",
    "codex",
    "--codex-model",
    "gpt-test",
  ]);
});

test("buildDailyPlanArguments can persist API fallback models", () => {
  const args = buildDailyPlanArguments({
    apiTimeoutMs: 20000,
    count: 5,
    fallbackModels: "gemini-3.1-pro-preview",
    nodePath: "/opt/node/bin/node",
    rednoteCount: 2,
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args.slice(-4), [
    "--fallback-models",
    "gemini-3.1-pro-preview",
    "--api-timeout-ms",
    "20000",
  ]);
});

test("buildWorkerArguments launches xpost worker with explicit publish consent", () => {
  const args = buildWorkerArguments({
    interval: 45,
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "worker",
    "--yes",
    "--interval",
    "45",
  ]);
});

test("buildWorkerArguments can lock the X account handle", () => {
  const args = buildWorkerArguments({
    interval: 300,
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    xAccount: "_example_",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "worker",
    "--yes",
    "--interval",
    "300",
    "--account",
    "_example_",
  ]);
});

test("buildRednoteWorkerArguments launches rednote draft worker with explicit consent", () => {
  const args = buildRednoteWorkerArguments({
    interval: 300,
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "rednote-worker",
    "--yes",
    "--interval",
    "300",
  ]);
});

test("buildRednoteWorkerArguments can launch rednote publish mode only when requested", () => {
  const args = buildRednoteWorkerArguments({
    interval: 300,
    nodePath: "/opt/node/bin/node",
    publish: true,
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "rednote-worker",
    "--yes",
    "--interval",
    "300",
    "--publish",
  ]);
});

test("buildRednoteWorkerArguments can pass Rednote image provider options", () => {
  const args = buildRednoteWorkerArguments({
    imageEndpoint: "https://ai.liaobots1.work/v1/chat/completions",
    imageModel: "gpt-image-2",
    imageProvider: "liao",
    interval: 300,
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "rednote-worker",
    "--yes",
    "--interval",
    "300",
    "--image-provider",
    "liao",
    "--image-model",
    "gpt-image-2",
    "--image-endpoint",
    "https://ai.liaobots1.work/v1/chat/completions",
  ]);
});

test("buildAgentRunArguments launches one API generation run", () => {
  const args = buildAgentRunArguments({
    model: "claude-opus-4-8",
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    topic: "本地自动化",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "agent-run",
    "--topic",
    "本地自动化",
    "--model",
    "claude-opus-4-8",
    "--enqueue",
    "--json",
  ]);
});

test("buildMetricsCaptureArguments captures recent daily-plan X metrics", () => {
  const args = buildMetricsCaptureArguments({
    days: 2,
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    source: "daily-plan",
  });

  assert.deepEqual(args, [
    "/opt/node/bin/node",
    "/repo/bin/xpost.js",
    "metrics-capture",
    "--source",
    "daily-plan",
    "--days",
    "2",
    "--json",
  ]);
});

test("buildLaunchdPlist can create a timer service without keepalive", () => {
  const plist = buildLaunchdPlist({
    args: ["/node", "/repo/bin/xpost.js", "agent-run", "--enqueue"],
    env: { PATH: "/usr/bin", XPOST_HOME: "/tmp/xpost" },
    keepAlive: false,
    label: "com.xpost-agent.agent-runner",
    runAtLoad: false,
    startInterval: 14400,
    stderrPath: "/tmp/xpost/logs/agent.err.log",
    stdoutPath: "/tmp/xpost/logs/agent.out.log",
    workingDirectory: "/repo",
  });

  assert.match(plist, /<string>com\.xpost-agent\.agent-runner<\/string>/);
  assert.match(plist, /<string>agent-run<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>14400<\/integer>/);
  assert.doesNotMatch(plist, /<key>KeepAlive<\/key>/);
  assert.doesNotMatch(plist, /<key>RunAtLoad<\/key>/);
});

test("buildLaunchdPlist can create a daily calendar trigger", () => {
  const plist = buildLaunchdPlist({
    args: ["/node", "/repo/bin/xpost.js", "agent-plan"],
    env: { PATH: "/usr/bin", XPOST_HOME: "/tmp/xpost" },
    keepAlive: false,
    label: "com.xpost-agent.agent-runner",
    runAtLoad: false,
    startCalendarInterval: { hour: 0, minute: 0 },
    stderrPath: "/tmp/xpost/logs/agent.err.log",
    stdoutPath: "/tmp/xpost/logs/agent.out.log",
    workingDirectory: "/repo",
  });

  assert.match(plist, /<key>StartCalendarInterval<\/key>/);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>0<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
});

test("buildLaunchdPlist includes worker args, logs, env, and xml escaping", () => {
  const plist = buildLaunchdPlist({
    interval: 30,
    label: "com.xpost-agent.worker",
    nodePath: "/opt/node/bin/node",
    scriptPath: "/repo/bin/xpost.js",
    stdoutPath: "/tmp/xpost/logs/out.log",
    stderrPath: "/tmp/xpost/logs/err.log",
    workingDirectory: "/repo",
    env: {
      PATH: "/opt/node/bin:/usr/bin",
      XPOST_HOME: "/tmp/xpost",
      SPECIAL: "a&b<c>d",
    },
  });

  assert.match(plist, /<string>com\.xpost-agent\.worker<\/string>/);
  assert.match(plist, /<string>worker<\/string>/);
  assert.match(plist, /<string>--yes<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/tmp\/xpost\/logs\/out\.log<\/string>/);
  assert.match(plist, /<string>a&amp;b&lt;c&gt;d<\/string>/);
});

test("redactServiceStatus removes launchd environment secrets", () => {
  const status = redactServiceStatus([
    "environment = {",
    "\tXPOST_LIAOBOTS_AUTHCODE => launchd-secret",
    "\tXPOST_FEISHU_WEBHOOK_URL => https://open.feishu.cn/open-apis/bot/v2/hook/abc-123",
    "\tPATH => /usr/bin:/bin",
    "}",
  ].join("\n"));

  assert.doesNotMatch(status, /launchd-secret|hook\/abc-123/);
  assert.match(status, /XPOST_LIAOBOTS_AUTHCODE => \[redacted\]/);
  assert.match(status, /XPOST_FEISHU_WEBHOOK_URL => \[redacted\]/);
  assert.match(status, /PATH => \/usr\/bin:\/bin/);
});
