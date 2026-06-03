"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { redactSecrets } = require("./notifier");

const SERVICE_LABEL = "com.xpost-agent.worker";
const AGENT_SERVICE_LABEL = "com.xpost-agent.agent-runner";
const REDNOTE_SERVICE_LABEL = "com.xpost-agent.rednote-worker";
const REDNOTE_AGENT_SERVICE_LABEL = "com.xpost-agent.rednote-agent-runner";
const DAILY_AGENT_SERVICE_LABEL = "com.xpost-agent.daily-agent-runner";
const METRICS_SERVICE_LABEL = "com.xpost-agent.metrics-capture";
const DEFAULT_THINKING_SKILL = "creator-systems";
const DEFAULT_VOICE_SKILL = "realist-perspective";
const SERVICE_KINDS = new Set(["worker", "agent", "rednote", "rednote-agent", "daily-agent", "metrics"]);
const AGENT_SCHEDULES = new Set(["interval", "daily-random"]);

function normalizeServiceKind(kind = "worker") {
  const value = kind || "worker";
  if (!SERVICE_KINDS.has(value)) {
    throw new Error(`Unknown service kind: ${value}. Use "worker", "agent", "rednote", "rednote-agent", "daily-agent", or "metrics".`);
  }
  return value;
}

function normalizeAgentSchedule(schedule = "interval") {
  const value = schedule || "interval";
  if (!AGENT_SCHEDULES.has(value)) {
    throw new Error(`Unknown agent schedule: ${value}. Use "interval" or "daily-random".`);
  }
  return value;
}

function defaultXpostHome(homeDir = os.homedir()) {
  return process.env.XPOST_HOME || path.join(homeDir, ".xpost-agent");
}

function servicePaths(options = {}) {
  const kind = normalizeServiceKind(options.kind);
  const homeDir = options.homeDir || os.homedir();
  const xpostHome = options.xpostHome || defaultXpostHome(homeDir);
  const label = options.label || (kind === "agent"
    ? AGENT_SERVICE_LABEL
      : kind === "rednote"
        ? REDNOTE_SERVICE_LABEL
        : kind === "rednote-agent"
          ? REDNOTE_AGENT_SERVICE_LABEL
          : kind === "daily-agent"
            ? DAILY_AGENT_SERVICE_LABEL
            : kind === "metrics"
              ? METRICS_SERVICE_LABEL
              : SERVICE_LABEL);
  const logPrefix = kind === "agent"
    ? "agent"
    : kind === "rednote"
      ? "rednote"
      : kind === "rednote-agent"
        ? "rednote-agent"
        : kind === "daily-agent"
          ? "daily-agent"
          : kind === "metrics"
            ? "metrics"
            : "worker";
  return {
    label,
    launchAgentsDir: path.join(homeDir, "Library", "LaunchAgents"),
    logDir: path.join(xpostHome, "logs"),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`),
    stderrPath: path.join(xpostHome, "logs", `${logPrefix}.err.log`),
    stdoutPath: path.join(xpostHome, "logs", `${logPrefix}.out.log`),
    xpostHome,
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function uniquePath(items) {
  return [...new Set(items.filter(Boolean).flatMap((item) => String(item).split(":")).filter(Boolean))].join(":");
}

function defaultPathEnv(nodePath = process.execPath) {
  return uniquePath([
    path.dirname(nodePath),
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]);
}

function packageRoot() {
  return path.resolve(__dirname, "..");
}

function defaultScriptPath() {
  return path.join(packageRoot(), "bin", "xpost.js");
}

function buildWorkerArguments(options = {}) {
  const interval = String(options.interval || 30);
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "worker",
    "--yes",
    "--interval",
    interval,
  ];
  if (options.xAccount) args.push("--account", options.xAccount);
  return args;
}

function buildRednoteWorkerArguments(options = {}) {
  const interval = String(options.interval || 300);
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "rednote-worker",
    "--yes",
    "--interval",
    interval,
  ];
  if (options.publish) args.push("--publish");
  if (options.imageProvider) args.push("--image-provider", options.imageProvider);
  if (options.imageModel) args.push("--image-model", options.imageModel);
  if (options.imageEndpoint) args.push("--image-endpoint", options.imageEndpoint);
  if (options.imageTemperature) args.push("--image-temperature", String(options.imageTemperature));
  if (options.imageFallback === false) args.push("--image-fallback", "false");
  return args;
}

function buildAgentRunArguments(options = {}) {
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "agent-run",
    "--topic",
    options.topic || "random",
    "--model",
    options.model || "claude-opus-4-8",
    "--enqueue",
    "--json",
  ];
  if (options.endpoint) args.push("--endpoint", options.endpoint);
  if (options.generator) args.push("--generator", options.generator);
  if (options.fallbackModels) args.push("--fallback-models", options.fallbackModels);
  if (options.apiTimeoutMs) args.push("--api-timeout-ms", String(options.apiTimeoutMs));
  if (options.codexModel) args.push("--codex-model", options.codexModel);
  return args;
}

function buildAgentPlanArguments(options = {}) {
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "agent-plan",
    "--topic",
    options.topic || "random",
    "--model",
    options.model || "claude-opus-4-8",
    "--count",
    String(options.count || 5),
    "--window-start",
    options.windowStart || "00:00",
    "--window-end",
    options.windowEnd || "06:00",
    "--json",
  ];
  if (options.endpoint) args.push("--endpoint", options.endpoint);
  if (options.generator) args.push("--generator", options.generator);
  if (options.fallbackModels) args.push("--fallback-models", options.fallbackModels);
  if (options.apiTimeoutMs) args.push("--api-timeout-ms", String(options.apiTimeoutMs));
  if (options.codexModel) args.push("--codex-model", options.codexModel);
  return args;
}

function buildRednotePlanArguments(options = {}) {
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "rednote-plan",
    "--topic",
    options.topic || "random",
    "--model",
    options.model || "claude-opus-4-8",
    "--skill",
    options.skill || DEFAULT_VOICE_SKILL,
    "--count",
    String(options.count || 2),
    "--window-start",
    options.windowStart || "11:00",
    "--window-end",
    options.windowEnd || "21:30",
    "--json",
  ];
  if (options.endpoint) args.push("--endpoint", options.endpoint);
  if (options.generator) args.push("--generator", options.generator);
  if (options.fallbackModels) args.push("--fallback-models", options.fallbackModels);
  if (options.apiTimeoutMs) args.push("--api-timeout-ms", String(options.apiTimeoutMs));
  if (options.codexModel) args.push("--codex-model", options.codexModel);
  return args;
}

function buildDailyPlanArguments(options = {}) {
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "daily-plan",
    "--model",
    options.model || "claude-opus-4-8",
    "--skill",
    options.skill || DEFAULT_VOICE_SKILL,
    "--count",
    String(options.count || 5),
    "--rednote-count",
    String(options.rednoteCount || 2),
    "--x-window-start",
    options.xWindowStart || options.windowStart || "10:00",
    "--x-window-end",
    options.xWindowEnd || options.windowEnd || "23:00",
    "--rednote-window-start",
    options.rednoteWindowStart || "11:00",
    "--rednote-window-end",
    options.rednoteWindowEnd || "21:30",
    "--json",
  ];
  if (options.endpoint) args.push("--endpoint", options.endpoint);
  args.push("--thinking-skill", options.thinkingSkill || DEFAULT_THINKING_SKILL);
  if (options.thinkingSkillPath) args.push("--thinking-skill-path", options.thinkingSkillPath);
  if (options.generator) args.push("--generator", options.generator);
  if (options.fallbackModels) args.push("--fallback-models", options.fallbackModels);
  if (options.apiTimeoutMs) args.push("--api-timeout-ms", String(options.apiTimeoutMs));
  if (options.codexModel) args.push("--codex-model", options.codexModel);
  if (options.skillPath) args.push("--skill-path", options.skillPath);
  if (options.maxChars) args.push("--max-chars", String(options.maxChars));
  if (options.maxWeightedChars) args.push("--max-weighted-chars", String(options.maxWeightedChars));
  if (options.minLeadMinutes) args.push("--min-lead-minutes", String(options.minLeadMinutes));
  return args;
}

function parseClock(value, fallback = "09:30") {
  const input = String(value || fallback).trim();
  const match = input.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid time: ${input}. Use HH:MM.`);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function buildMetricsCaptureArguments(options = {}) {
  const args = [
    options.nodePath || process.execPath,
    options.scriptPath || defaultScriptPath(),
    "metrics-capture",
    "--source",
    options.source || "daily-plan",
    "--days",
    String(options.days || 2),
    "--json",
  ];
  if (options.waitMs) args.push("--wait-ms", String(options.waitMs));
  return args;
}

function plistArray(items) {
  return [
    "<array>",
    ...items.map((item) => `  <string>${xmlEscape(item)}</string>`),
    "</array>",
  ].join("\n");
}

function plistDict(data) {
  const lines = ["<dict>"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`  <key>${xmlEscape(key)}</key>`);
    lines.push(`  <string>${xmlEscape(value)}</string>`);
  }
  lines.push("</dict>");
  return lines.join("\n");
}

function plistIntegerDict(data) {
  const lines = ["<dict>"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`  <key>${xmlEscape(key)}</key>`);
    lines.push(`  <integer>${Number(value)}</integer>`);
  }
  lines.push("</dict>");
  return lines.join("\n");
}

function buildLaunchdPlist(options = {}) {
  const args = options.args || buildWorkerArguments(options);
  const env = options.env || {};
  const body = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(options.label || SERVICE_LABEL)}</string>`,
    "  <key>ProgramArguments</key>",
    plistArray(args).split("\n").map((line) => `  ${line}`).join("\n"),
    "  <key>WorkingDirectory</key>",
    `  <string>${xmlEscape(options.workingDirectory || packageRoot())}</string>`,
    "  <key>EnvironmentVariables</key>",
    plistDict(env).split("\n").map((line) => `  ${line}`).join("\n"),
    ...(options.runAtLoad === false ? [] : ["  <key>RunAtLoad</key>", "  <true/>"]),
    ...(options.keepAlive === false ? [] : ["  <key>KeepAlive</key>", "  <true/>"]),
    ...(options.startInterval ? ["  <key>StartInterval</key>", `  <integer>${Number(options.startInterval)}</integer>`] : []),
    ...(options.startCalendarInterval ? [
      "  <key>StartCalendarInterval</key>",
      plistIntegerDict({
        Hour: options.startCalendarInterval.hour,
        Minute: options.startCalendarInterval.minute,
      }).split("\n").map((line) => `  ${line}`).join("\n"),
    ] : []),
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(options.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(options.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ];
  return body.join("\n");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error((stderr || stdout || error.message).trim());
        wrapped.code = error.code;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        reject(wrapped);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function redactServiceStatus(value) {
  return redactSecrets(value);
}

function launchDomain() {
  if (typeof process.getuid !== "function") return "gui/501";
  return `gui/${process.getuid()}`;
}

function shouldKickstartService(kind, options = {}) {
  if (options.kickstart) return true;
  return kind !== "agent" && kind !== "rednote-agent" && kind !== "daily-agent" && kind !== "metrics";
}

async function installService(options = {}) {
  if (process.platform !== "darwin") throw new Error("xpost service is only supported on macOS launchd.");
  if (!options.yes) throw new Error("Pass --yes to install a launchd service.");

  const kind = normalizeServiceKind(options.kind);
  const paths = servicePaths({ kind, xpostHome: options.xpostHome });
  fs.mkdirSync(paths.launchAgentsDir, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });

  const nodePath = options.nodePath || process.execPath;
  const scriptPath = options.scriptPath || defaultScriptPath();
  const isAgent = kind === "agent";
  const isRednote = kind === "rednote";
  const isRednoteAgent = kind === "rednote-agent";
  const isDailyAgent = kind === "daily-agent";
  const isMetrics = kind === "metrics";
  const isPlanningAgent = isAgent || isRednoteAgent || isDailyAgent;
  const inferredSchedule = (
    options.count
    || options.rednoteCount
    || options.windowStart
    || options.windowEnd
    || options.xWindowStart
    || options.xWindowEnd
    || options.rednoteWindowStart
    || options.rednoteWindowEnd
  ) ? "daily-random" : "interval";
  const agentSchedule = normalizeAgentSchedule(options.schedule || inferredSchedule);
  const contentGenerator = String(options.generator || process.env.XPOST_GENERATOR || "api").trim().toLowerCase();
  const planningNeedsApiToken = isPlanningAgent && contentGenerator !== "codex";
  const env = {
    PATH: defaultPathEnv(nodePath),
    XPOST_HOME: paths.xpostHome,
  };
  if (planningNeedsApiToken || (isRednote && options.imageProvider === "liao")) {
    const apiToken = options.authCode || process.env.XPOST_LIAOBOTS_AUTHCODE || process.env.LIAOBOTS_AUTHCODE;
    if (!apiToken) {
      const label = planningNeedsApiToken ? `${kind} service` : "Rednote liao image service";
      throw new Error(`${label} requires an API auth code. Pass --auth-code or set XPOST_LIAOBOTS_AUTHCODE.`);
    }
    env.XPOST_LIAOBOTS_AUTHCODE = apiToken;
  }
  const plist = buildLaunchdPlist({
    args: isMetrics ? buildMetricsCaptureArguments({
      days: options.metricsDays || options.days,
      nodePath,
      scriptPath,
      source: options.source,
      waitMs: options.waitMs,
    }) : isRednote ? buildRednoteWorkerArguments({
      imageEndpoint: options.imageEndpoint || options.endpoint,
      imageFallback: options.imageFallback,
      imageModel: options.imageModel,
      imageProvider: options.imageProvider,
      imageTemperature: options.imageTemperature,
      interval: options.interval,
      nodePath,
      publish: Boolean(options.publish),
      scriptPath,
    }) : isDailyAgent ? buildDailyPlanArguments({
      count: options.count,
      apiTimeoutMs: options.apiTimeoutMs,
      codexModel: options.codexModel,
      endpoint: options.endpoint,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      maxChars: options.maxChars,
      maxWeightedChars: options.maxWeightedChars,
      minLeadMinutes: options.minLeadMinutes,
      model: options.model,
      nodePath,
      rednoteCount: options.rednoteCount,
      rednoteWindowEnd: options.rednoteWindowEnd,
      rednoteWindowStart: options.rednoteWindowStart,
      scriptPath,
      skill: options.skill,
      skillPath: options.skillPath,
      thinkingSkill: options.thinkingSkill,
      thinkingSkillPath: options.thinkingSkillPath,
      windowEnd: options.windowEnd,
      windowStart: options.windowStart,
      xWindowEnd: options.xWindowEnd,
      xWindowStart: options.xWindowStart,
    }) : isRednoteAgent ? buildRednotePlanArguments({
      count: options.count,
      apiTimeoutMs: options.apiTimeoutMs,
      codexModel: options.codexModel,
      endpoint: options.endpoint,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      model: options.model,
      nodePath,
      scriptPath,
      skill: options.skill,
      topic: options.topic,
      windowEnd: options.windowEnd,
      windowStart: options.windowStart,
    }) : isAgent && agentSchedule === "daily-random" ? buildAgentPlanArguments({
      count: options.count,
      apiTimeoutMs: options.apiTimeoutMs,
      codexModel: options.codexModel,
      endpoint: options.endpoint,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      model: options.model,
      nodePath,
      scriptPath,
      topic: options.topic,
      windowEnd: options.windowEnd,
      windowStart: options.windowStart,
    }) : isAgent ? buildAgentRunArguments({
      apiTimeoutMs: options.apiTimeoutMs,
      endpoint: options.endpoint,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      codexModel: options.codexModel,
      model: options.model,
      nodePath,
      scriptPath,
      topic: options.topic,
    }) : buildWorkerArguments({
      interval: options.interval,
      nodePath,
      scriptPath,
      xAccount: options.xAccount,
    }),
    interval: options.interval || 30,
    keepAlive: (isPlanningAgent || isMetrics) ? false : true,
    label: paths.label,
    nodePath,
    runAtLoad: (isPlanningAgent || isMetrics) ? Boolean(options.runAtLoad) : true,
    scriptPath,
    startCalendarInterval: isMetrics
      ? parseClock(options.metricsTime || options.time, "09:30")
      : isPlanningAgent && agentSchedule === "daily-random"
        ? { hour: 0, minute: 0 }
        : undefined,
    startInterval: !isMetrics && isPlanningAgent && agentSchedule !== "daily-random" ? Number(options.everyMinutes || 240) * 60 : undefined,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    workingDirectory: packageRoot(),
    env,
  });

  fs.writeFileSync(paths.plistPath, plist, "utf8");
  return { ok: true, kind, label: paths.label, plistPath: paths.plistPath, installed: true };
}

async function startService(options = {}) {
  const kind = normalizeServiceKind(options.kind);
  const paths = servicePaths({ kind, xpostHome: options.xpostHome });
  if (!fs.existsSync(paths.plistPath)) {
    const installHint = kind === "agent"
      ? "xpost service install --kind agent --yes --auth-code ..."
      : kind === "rednote-agent"
        ? "xpost service install --kind rednote-agent --yes --auth-code ..."
        : kind === "daily-agent"
          ? "xpost service install --kind daily-agent --yes --auth-code ..."
          : kind === "metrics"
            ? "xpost service install --kind metrics --yes"
            : "xpost service install --yes";
    throw new Error(`Service plist not found. Run: ${installHint}`);
  }
  const domain = launchDomain();
  try {
    await run("launchctl", ["bootstrap", domain, paths.plistPath]);
  } catch (error) {
    if (!/already|Bootstrap failed: 5|Input\/output error/i.test(error.message)) throw error;
  }
  if (shouldKickstartService(kind, options)) {
    await run("launchctl", ["kickstart", "-k", `${domain}/${paths.label}`]).catch(() => undefined);
  }
  return { ok: true, kind, label: paths.label, plistPath: paths.plistPath, started: true };
}

async function stopService(options = {}) {
  const kind = normalizeServiceKind(options.kind);
  const paths = servicePaths({ kind, xpostHome: options.xpostHome });
  const domain = launchDomain();
  try {
    await run("launchctl", ["bootout", `${domain}/${paths.label}`]);
    return { ok: true, kind, label: paths.label, stopped: true };
  } catch (error) {
    if (/Could not find|No such process|service is not loaded|No such file/i.test(error.message)) {
      return { ok: true, kind, label: paths.label, stopped: false };
    }
    throw error;
  }
}

async function statusService(options = {}) {
  const kind = normalizeServiceKind(options.kind);
  const paths = servicePaths({ kind, xpostHome: options.xpostHome });
  const domain = launchDomain();
  try {
    const result = await run("launchctl", ["print", `${domain}/${paths.label}`]);
    return {
      ok: true,
      kind,
      label: paths.label,
      loaded: true,
      plistExists: fs.existsSync(paths.plistPath),
      plistPath: paths.plistPath,
      status: redactServiceStatus(result.stdout.trim()),
    };
  } catch (error) {
    return {
      ok: true,
      kind,
      label: paths.label,
      loaded: false,
      plistExists: fs.existsSync(paths.plistPath),
      plistPath: paths.plistPath,
      status: redactServiceStatus(error.message),
    };
  }
}

async function uninstallService(options = {}) {
  const kind = normalizeServiceKind(options.kind);
  const paths = servicePaths({ kind, xpostHome: options.xpostHome });
  await stopService(options);
  if (fs.existsSync(paths.plistPath)) fs.unlinkSync(paths.plistPath);
  return { ok: true, kind, label: paths.label, plistPath: paths.plistPath, uninstalled: true };
}

module.exports = {
  AGENT_SERVICE_LABEL,
  DAILY_AGENT_SERVICE_LABEL,
  METRICS_SERVICE_LABEL,
  REDNOTE_AGENT_SERVICE_LABEL,
  SERVICE_LABEL,
  buildAgentPlanArguments,
  buildAgentRunArguments,
  buildDailyPlanArguments,
  buildLaunchdPlist,
  buildMetricsCaptureArguments,
  buildRednotePlanArguments,
  buildRednoteWorkerArguments,
  buildWorkerArguments,
  installService,
  normalizeAgentSchedule,
  redactServiceStatus,
  servicePaths,
  shouldKickstartService,
  startService,
  statusService,
  stopService,
  uninstallService,
};
