"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chatCompletionsEndpoint, imageCompletionsEndpoint } = require("./liaobots");

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const SERVICE_KINDS = ["daily-agent", "worker", "rednote", "metrics"];
const SECRET_KEY_RE = /(authorization|authcode|token|secret|password|api[_-]?key|bearer)/i;

function firstEnv(env, keys) {
  for (const key of keys) {
    if (env[key]) return { key, value: env[key] };
  }
  return { key: null, value: null };
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[^\s"'`]+/gi, "Bearer [redacted]")
      .replace(/((?:AUTHCODE|TOKEN|SECRET|PASSWORD|AUTHORIZATION|API[_-]?KEY)\s*[:=]\s*)[^\s\n]+/gi, "$1[redacted]");
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : sanitize(item, seen);
  }
  return output;
}

function localDate(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function numberFromMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function stringFromMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : null;
}

function normalizeHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutUrl = raw
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .split(/[/?#]/)[0];
  return withoutUrl.replace(/^@+/, "").toLowerCase();
}

function accountMatches(actual, expected) {
  const actualHandle = normalizeHandle(actual && actual.handle ? actual.handle : actual);
  const expectedHandle = normalizeHandle(expected);
  return Boolean(actualHandle && expectedHandle && actualHandle === expectedHandle);
}

function stripLaunchdToken(value) {
  return String(value || "")
    .trim()
    .replace(/;$/, "")
    .replace(/^"([\s\S]*)"$/, "$1")
    .trim();
}

function launchdArgumentValue(rawStatus, flag) {
  const lines = String(rawStatus || "").split(/\r?\n/).map(stripLaunchdToken).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === flag) return lines[index + 1] ? stripLaunchdToken(lines[index + 1]) : null;
    if (line.startsWith(`${flag} `)) return stripLaunchdToken(line.slice(flag.length));
    if (line.startsWith(`${flag}=`)) return stripLaunchdToken(line.slice(flag.length + 1));
  }
  return null;
}

function summarizeLaunchdStatus(status = {}) {
  const rawStatus = String(status.status || "");
  const summary = {
    kind: status.kind,
    label: status.label,
    loaded: Boolean(status.loaded),
    plistExists: Boolean(status.plistExists),
    plistPath: status.plistPath || null,
    state: stringFromMatch(rawStatus, /^\s*state\s*=\s*([^\n]+)/im),
    pid: numberFromMatch(rawStatus, /^\s*pid\s*=\s*(\d+)/im),
    runs: numberFromMatch(rawStatus, /^\s*runs\s*=\s*(\d+)/im),
    lastExitCode: numberFromMatch(rawStatus, /^\s*last exit code\s*=\s*(-?\d+)/im),
  };

  if (summary.kind === "worker") {
    const xAccount = launchdArgumentValue(rawStatus, "--account");
    if (xAccount) summary.xAccount = xAccount;
  }

  if (!summary.loaded) {
    const firstLine = rawStatus.split("\n").find(Boolean);
    if (firstLine) summary.message = sanitize(firstLine.slice(0, 240));
  }

  return sanitize(summary);
}

function readJsonArrayIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function defaultDeps() {
  const relay = require("./browser-relay");
  const service = require("./service");
  const store = require("./store");
  const rednoteStore = require("./rednote-store");
  const archive = require("./archive");
  const { currentAccount } = require("./x");

  return {
    currentAccount,
    fetch: globalThis.fetch,
    readArchive: () => readJsonArrayIfExists(archive.archivePath()),
    readRednoteQueue: () => readJsonArrayIfExists(rednoteStore.queuePath()),
    readXQueue: () => readJsonArrayIfExists(store.queuePath()),
    relay,
    service,
  };
}

function mergeDeps(overrides = {}) {
  const base = defaultDeps();
  return {
    ...base,
    ...overrides,
    relay: { ...base.relay, ...(overrides.relay || {}) },
    service: { ...base.service, ...(overrides.service || {}) },
  };
}

function countBy(items, key = "status") {
  return items.reduce((bucket, item) => {
    const value = item[key] || "unknown";
    bucket[value] = (bucket[value] || 0) + 1;
    return bucket;
  }, {});
}

function queueItemDate(item, timeZone) {
  return item.planDate
    || localDate(item.postedAt || item.draftedAt || item.scheduledAt || item.createdAt, timeZone);
}

function compactFailureItem(item) {
  return sanitize({
    id: item.id,
    source: item.source || null,
    status: item.status || "unknown",
    scheduledAt: item.scheduledAt || null,
    title: item.title || null,
    lastError: item.lastError || null,
  });
}

function summarizeQueue(items = [], options = {}) {
  const now = options.now || new Date();
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const today = options.today || localDate(now, timeZone);
  const list = Array.isArray(items) ? items : [];
  const todayItems = list.filter((item) => queueItemDate(item, timeZone) === today);
  const dueItems = list.filter((item) => (
    item.status === "scheduled"
    && item.scheduledAt
    && new Date(item.scheduledAt).getTime() <= now.getTime()
  ));
  const failedItems = list.filter((item) => item.status === "failed");

  return {
    total: list.length,
    statuses: countBy(list),
    today: {
      date: today,
      total: todayItems.length,
      statuses: countBy(todayItems),
      posted: todayItems.filter((item) => item.status === "posted").length,
      scheduled: todayItems.filter((item) => item.status === "scheduled").length,
      failed: todayItems.filter((item) => item.status === "failed").length,
      drafted: todayItems.filter((item) => item.status === "drafted").length,
      filled: todayItems.filter((item) => item.status === "filled").length,
    },
    due: dueItems.length,
    failed: failedItems.map(compactFailureItem),
  };
}

function summarizeArchive(items = [], options = {}) {
  const now = options.now || new Date();
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const today = options.today || localDate(now, timeZone);
  const list = Array.isArray(items) ? items : [];
  const todayItems = list.filter((item) => (
    item.planDate
    || localDate(item.postedAt || item.scheduledAt || item.archivedAt, timeZone)
  ) === today);

  return {
    total: list.length,
    today: {
      date: today,
      count: todayItems.length,
      byPlatform: countBy(todayItems, "platform"),
      bySource: countBy(todayItems, "source"),
    },
  };
}

function addCheck(report, name, status, message, details) {
  report.checks.push(sanitize({
    details,
    message,
    name,
    ok: status === "ok",
    status,
  }));
}

function queueCheck(report, platform, summary) {
  const failed = summary.statuses.failed || 0;
  if (failed > 0) {
    addCheck(report, `${platform} queue`, "fail", `${failed} failed item(s) need attention`, {
      failed: summary.failed,
    });
    return;
  }
  if (summary.due > 0) {
    addCheck(report, `${platform} queue`, "warn", `${summary.due} scheduled item(s) are due`, {
      due: summary.due,
    });
    return;
  }
  addCheck(report, `${platform} queue`, "ok", "queue readable");
}

function configuredXAccount(env = {}, services = [], options = {}) {
  const candidates = [
    { source: "option", value: options.xAccount || options.expectedAccount || options.account },
    { source: "XPOST_ACCOUNT", value: env.XPOST_ACCOUNT },
    { source: "XPOST_EXPECTED_ACCOUNT", value: env.XPOST_EXPECTED_ACCOUNT },
    { source: "XPOST_EXPECTED_HANDLE", value: env.XPOST_EXPECTED_HANDLE },
  ];
  for (const candidate of candidates) {
    const expected = normalizeHandle(candidate.value);
    if (expected) return { expected, source: candidate.source };
  }

  const worker = (Array.isArray(services) ? services : []).find((service) => (
    service && service.kind === "worker" && service.xAccount
  ));
  const expected = normalizeHandle(worker && worker.xAccount);
  if (expected) return { expected, source: "worker service --account" };

  return { expected: null, source: null };
}

function accountCheck(report, expectedConfig) {
  if (!expectedConfig || !expectedConfig.expected) return;
  if (!report.browser || !report.browser.ok) return;
  const account = report.browser.account;
  if (!account || account.error) {
    addCheck(report, "x account", "warn", `expected @${expectedConfig.expected}, current unavailable`, {
      expected: expectedConfig.expected,
      source: expectedConfig.source,
      error: account && account.error ? account.error : null,
    });
    return;
  }

  if (!accountMatches(account, expectedConfig.expected)) {
    const actual = account && account.handle ? `@${normalizeHandle(account.handle)}` : "unknown";
    addCheck(report, "x account", "warn", `expected @${expectedConfig.expected}, current ${actual}`, {
      actual: account.handle || null,
      expected: expectedConfig.expected,
      source: expectedConfig.source,
    });
    return;
  }

  addCheck(report, "x account", "ok", `current @${expectedConfig.expected}`, {
    source: expectedConfig.source,
  });
}

function serviceCheck(report, serviceStatus) {
  const serviceName = serviceStatus.kind || serviceStatus.label || "service";
  if (!serviceStatus.loaded) {
    addCheck(report, `service ${serviceName}`, "warn", "service is not loaded", {
      plistExists: serviceStatus.plistExists,
      plistPath: serviceStatus.plistPath,
    });
    return;
  }
  if (serviceStatus.lastExitCode !== null && serviceStatus.lastExitCode !== 0) {
    addCheck(report, `service ${serviceName}`, "warn", `last exit code ${serviceStatus.lastExitCode}`, serviceStatus);
    return;
  }
  addCheck(report, `service ${serviceName}`, "ok", serviceStatus.state || "loaded", {
    pid: serviceStatus.pid,
    runs: serviceStatus.runs,
  });
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function apiErrorMessage(data) {
  if (!data) return null;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data.message === "string") return data.message;
  return null;
}

async function postCompletion({ endpoint, fetchImpl, model, prompt, timeoutMs, token }) {
  const response = await fetchImpl(endpoint, {
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      model,
      stream: false,
      temperature: model === "gpt-image-2" ? 1 : 0,
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: timeoutSignal(timeoutMs),
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = { error: { message: error.message } };
  }

  return sanitize({
    ok: Boolean(response.ok),
    status: response.status,
    model: data && data.model ? data.model : model,
    choices: Array.isArray(data && data.choices) ? data.choices.length : undefined,
    error: response.ok ? null : apiErrorMessage(data),
  });
}

async function runDeepApiChecks(report, options) {
  const { authCode, chatEndpoint, imageEndpoint, env, deps } = options;
  report.api.deep = {
    chat: { ok: false, skipped: true },
    image: { ok: false, skipped: true },
  };

  if (!authCode) {
    addCheck(report, "api deep", "fail", "API auth code is missing");
    return;
  }
  if (typeof deps.fetch !== "function") {
    addCheck(report, "api deep", "fail", "fetch is not available in this Node runtime");
    return;
  }

  const chatModel = options.chatModel || env.XPOST_LIAOBOTS_MODEL || env.XPOST_MODEL || "claude-opus-4-8";
  const imageModel = options.imageModel || env.XPOST_LIAOBOTS_IMAGE_MODEL || "gpt-image-2";

  try {
    report.api.deep.chat = await postCompletion({
      endpoint: chatEndpoint,
      fetchImpl: deps.fetch,
      model: chatModel,
      prompt: "Return exactly: OK",
      timeoutMs: options.timeoutMs || 60000,
      token: authCode,
    });
    addCheck(
      report,
      "chat API",
      report.api.deep.chat.ok ? "ok" : "fail",
      report.api.deep.chat.ok ? "chat completions request succeeded" : "chat completions request failed",
      report.api.deep.chat,
    );
  } catch (error) {
    report.api.deep.chat = sanitize({ ok: false, error: error.message });
    addCheck(report, "chat API", "fail", error.message);
  }

  try {
    report.api.deep.image = await postCompletion({
      endpoint: imageEndpoint,
      fetchImpl: deps.fetch,
      model: imageModel,
      prompt: "Generate a simple off-white letter paper background with the word OK.",
      timeoutMs: options.timeoutMs || 60000,
      token: authCode,
    });
    addCheck(
      report,
      "image API",
      report.api.deep.image.ok ? "ok" : "fail",
      report.api.deep.image.ok ? "image request succeeded" : "image request failed",
      report.api.deep.image,
    );
  } catch (error) {
    report.api.deep.image = sanitize({ ok: false, error: error.message });
    addCheck(report, "image API", "fail", error.message);
  }
}

async function runDoctor(options = {}) {
  const env = options.env || process.env;
  const deps = mergeDeps(options.deps);
  const now = options.now || new Date();
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const today = localDate(now, timeZone);
  const auth = firstEnv(env, ["XPOST_LIAOBOTS_AUTHCODE", "LIAOBOTS_AUTHCODE"]);
  const chatEndpoint = chatCompletionsEndpoint({ endpoint: options.endpoint }, env);
  const imageEndpoint = imageCompletionsEndpoint({ endpoint: options.imageEndpoint || options.endpoint }, env);
  const nodeVersion = options.nodeVersion || process.versions.node;
  const nodeMajor = Number(String(nodeVersion).split(".")[0]);

  const report = {
    ok: false,
    generatedAt: now.toISOString(),
    localDate: today,
    timeZone,
    deep: Boolean(options.deep),
    environment: {
      cwd: options.cwd || process.cwd(),
      node: {
        version: nodeVersion,
        ok: nodeMajor >= 20,
      },
      platform: options.platform || process.platform,
      xpostHome: env.XPOST_HOME || path.join(os.homedir(), ".xpost-agent"),
      api: {
        auth: {
          present: Boolean(auth.value),
          source: auth.key,
        },
        chatEndpoint,
        imageEndpoint,
      },
      xAccount: {
        expected: null,
        source: null,
      },
    },
    browser: null,
    services: [],
    queues: null,
    archive: null,
    api: {
      deep: null,
    },
    checks: [],
    summary: null,
  };

  addCheck(
    report,
    "node",
    nodeMajor >= 20 ? "ok" : "fail",
    nodeMajor >= 20 ? `Node ${nodeVersion}` : `Node ${nodeVersion}; expected >=20`,
  );
  addCheck(
    report,
    "api auth",
    auth.value ? "ok" : "fail",
    auth.value ? `present via ${auth.key}` : "missing XPOST_LIAOBOTS_AUTHCODE or LIAOBOTS_AUTHCODE",
  );

  try {
    const [version, status, tabs] = await Promise.all([
      deps.relay.version(),
      deps.relay.status(),
      deps.relay.tabs(),
    ]);
    const xTabs = tabs.filter((tab) => /https:\/\/(x|twitter)\.com\//i.test(tab.url || ""));
    const rednoteTabs = tabs.filter((tab) => /xiaohongshu\.com/i.test(tab.url || ""));
    report.browser = sanitize({
      ok: true,
      version,
      status,
      tabCount: tabs.length,
      xTabs: xTabs.length,
      rednoteTabs: rednoteTabs.length,
      account: null,
    });

    if (xTabs.length > 0 && typeof deps.currentAccount === "function") {
      try {
        report.browser.account = sanitize(await deps.currentAccount(xTabs[0].id));
      } catch (error) {
        report.browser.account = { error: error.message };
      }
    }

    addCheck(report, "browser relay", "ok", `${version}; ${tabs.length} tab(s)`);
    if (xTabs.length === 0) addCheck(report, "x tab", "warn", "no X tab found");
    if (rednoteTabs.length === 0) addCheck(report, "rednote tab", "warn", "no Xiaohongshu tab found");
  } catch (error) {
    report.browser = sanitize({ ok: false, error: error.message });
    addCheck(report, "browser relay", "fail", error.message);
  }

  for (const kind of (options.serviceKinds || SERVICE_KINDS)) {
    try {
      const status = summarizeLaunchdStatus(await deps.service.statusService({ kind }));
      report.services.push(status);
      serviceCheck(report, status);
    } catch (error) {
      const status = sanitize({ kind, loaded: false, error: error.message });
      report.services.push(status);
      addCheck(report, `service ${kind}`, "warn", error.message);
    }
  }

  report.environment.xAccount = configuredXAccount(env, report.services, options);
  accountCheck(report, report.environment.xAccount);

  try {
    const [xQueue, rednoteQueue] = await Promise.all([
      deps.readXQueue(),
      deps.readRednoteQueue(),
    ]);
    report.queues = {
      x: summarizeQueue(xQueue, { now, today, timeZone }),
      rednote: summarizeQueue(rednoteQueue, { now, today, timeZone }),
    };
    queueCheck(report, "x", report.queues.x);
    queueCheck(report, "rednote", report.queues.rednote);
  } catch (error) {
    report.queues = sanitize({ error: error.message });
    addCheck(report, "queues", "fail", error.message);
  }

  try {
    report.archive = summarizeArchive(await deps.readArchive(), { now, today, timeZone });
    addCheck(report, "archive", "ok", `${report.archive.today.count} archived item(s) today`);
  } catch (error) {
    report.archive = sanitize({ error: error.message });
    addCheck(report, "archive", "warn", error.message);
  }

  if (options.deep) {
    await runDeepApiChecks(report, {
      authCode: auth.value,
      chatEndpoint,
      chatModel: options.chatModel || options.model,
      deps,
      env,
      imageEndpoint,
      imageModel: options.imageModel,
      timeoutMs: options.timeoutMs,
    });
  }

  const failures = report.checks.filter((check) => check.status === "fail").length;
  const warnings = report.checks.filter((check) => check.status === "warn").length;
  report.summary = {
    ok: failures === 0,
    status: failures > 0 ? "fail" : warnings > 0 ? "warn" : "ok",
    failures,
    warnings,
    checks: report.checks.length,
  };
  report.ok = report.summary.ok;

  return sanitize(report);
}

function count(summary, status) {
  return summary && summary.statuses ? summary.statuses[status] || 0 : 0;
}

function todayCount(summary, status) {
  return summary && summary.today && summary.today.statuses ? summary.today.statuses[status] || 0 : 0;
}

function serviceLine(service) {
  const state = service.loaded ? service.state || "loaded" : "not loaded";
  const parts = [
    `${service.kind}: ${state}`,
    service.pid ? `pid ${service.pid}` : null,
    service.runs !== null && service.runs !== undefined ? `runs ${service.runs}` : null,
    service.lastExitCode !== null && service.lastExitCode !== undefined ? `lastExit ${service.lastExitCode}` : null,
  ].filter(Boolean);
  return `  ${parts.join(", ")}`;
}

function queueLine(name, summary) {
  return [
    `  ${name}: total ${summary.total}`,
    `today ${summary.today.total}`,
    `failed ${count(summary, "failed")}`,
    `due ${summary.due}`,
    `posted ${count(summary, "posted")}`,
    `scheduled ${count(summary, "scheduled")}`,
    `today-posted ${todayCount(summary, "posted")}`,
  ].join(", ");
}

function formatDoctorReport(report) {
  const lines = [
    "xpost doctor",
    `Generated: ${report.generatedAt} (${report.timeZone} ${report.localDate})`,
    "",
    "Summary",
    `  status: ${report.summary.status}`,
    `  checks: ${report.summary.checks}, failures: ${report.summary.failures}, warnings: ${report.summary.warnings}`,
    "",
    "Environment",
    `  Node: ${report.environment.node.version} (${report.environment.node.ok ? "ok" : "expected >=20"})`,
    `  Platform: ${report.environment.platform}`,
    `  XPOST_HOME: ${report.environment.xpostHome}`,
    `  X account expected: ${
      report.environment.xAccount && report.environment.xAccount.expected
        ? `@${report.environment.xAccount.expected} (${report.environment.xAccount.source})`
        : "not configured"
    }`,
    "",
    "API",
    `  Auth: ${report.environment.api.auth.present ? `present via ${report.environment.api.auth.source}` : "missing"}`,
    `  Chat endpoint: ${report.environment.api.chatEndpoint}`,
    `  Image endpoint: ${report.environment.api.imageEndpoint}`,
    `  Deep: ${report.deep ? "run" : "not run (pass --deep)"}`,
    "",
    "Browser",
  ];

  if (report.browser && report.browser.ok) {
    lines.push(`  Relay: ${report.browser.version}; tabs ${report.browser.tabCount}, x ${report.browser.xTabs}, rednote ${report.browser.rednoteTabs}`);
    if (report.browser.account) {
      lines.push(`  X account: ${report.browser.account.handle || report.browser.account.error || "unknown"}`);
    }
  } else {
    lines.push(`  Relay: ${report.browser && report.browser.error ? report.browser.error : "unavailable"}`);
  }

  lines.push("", "Services");
  if (Array.isArray(report.services) && report.services.length) {
    lines.push(...report.services.map(serviceLine));
  } else {
    lines.push("  none");
  }

  lines.push("", "Queues");
  if (report.queues && report.queues.x && report.queues.rednote) {
    lines.push(queueLine("x", report.queues.x));
    lines.push(queueLine("rednote", report.queues.rednote));
  } else {
    lines.push(`  ${report.queues && report.queues.error ? report.queues.error : "unavailable"}`);
  }

  lines.push("", "Archive");
  if (report.archive && report.archive.today) {
    lines.push(`  today ${report.archive.today.count}, total ${report.archive.total}`);
  } else {
    lines.push(`  ${report.archive && report.archive.error ? report.archive.error : "unavailable"}`);
  }

  if (report.deep && report.api && report.api.deep) {
    lines.push("", "Deep API");
    lines.push(`  chat: ${report.api.deep.chat && report.api.deep.chat.ok ? "ok" : "failed"}`);
    lines.push(`  image: ${report.api.deep.image && report.api.deep.image.ok ? "ok" : "failed"}`);
  }

  lines.push("", "Checks");
  for (const check of report.checks) {
    lines.push(`  [${check.status}] ${check.name}: ${check.message}`);
  }

  return lines.join("\n");
}

module.exports = {
  formatDoctorReport,
  localDate,
  runDoctor,
  summarizeArchive,
  summarizeLaunchdStatus,
  summarizeQueue,
};
