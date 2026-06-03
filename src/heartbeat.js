"use strict";

const { redactSecrets } = require("./notifier");

function queueSummary(queue) {
  const summary = queue && typeof queue === "object" ? queue : {};
  const today = summary.today && typeof summary.today === "object" ? summary.today : {};
  const statuses = summary.statuses && typeof summary.statuses === "object" ? summary.statuses : {};
  const todayStatuses = today.statuses && typeof today.statuses === "object" ? today.statuses : {};

  return {
    total: Number(summary.total || 0),
    today: Number(today.total || 0),
    due: Number(summary.due || 0),
    posted: Number(statuses.posted || 0),
    scheduled: Number(statuses.scheduled || 0),
    failed: Number(statuses.failed || 0),
    drafted: Number(statuses.drafted || 0),
    filled: Number(statuses.filled || 0),
    todayPosted: Number(todayStatuses.posted || 0),
    todayScheduled: Number(todayStatuses.scheduled || 0),
    todayFailed: Number(todayStatuses.failed || 0),
    todayDrafted: Number(todayStatuses.drafted || 0),
    todayFilled: Number(todayStatuses.filled || 0),
  };
}

function serviceMap(services) {
  return (Array.isArray(services) ? services : []).reduce((map, service) => {
    if (!service || typeof service !== "object") return map;
    const kind = service.kind || service.label;
    if (!kind) return map;
    map[kind] = {
      kind,
      label: service.label || null,
      loaded: Boolean(service.loaded),
      state: service.loaded ? service.state || "loaded" : "not loaded",
      pid: service.pid || null,
      runs: service.runs !== undefined ? service.runs : null,
      lastExitCode: service.lastExitCode !== undefined ? service.lastExitCode : null,
      message: service.message || service.error || null,
      plistExists: service.plistExists !== undefined ? Boolean(service.plistExists) : undefined,
    };
    return map;
  }, {});
}

function failureItems(platform, queue) {
  const failed = queue && Array.isArray(queue.failed) ? queue.failed : [];
  return failed.map((item) => ({
    platform,
    id: item && item.id ? item.id : null,
    title: item && item.title ? redactSecrets(item.title) : null,
    lastError: redactSecrets(item && item.lastError ? item.lastError : ""),
  }));
}

function warningItems(report = {}) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return checks
    .filter((check) => check && check.status === "warn")
    .map((check) => ({
      name: check.name || "warning",
      message: redactSecrets(check.message || ""),
    }));
}

function buildHeartbeat(report = {}) {
  if (report.today && Array.isArray(report.failures) && report.services && !Array.isArray(report.services)) {
    return {
      ok: Boolean(report.ok),
      status: report.status || (report.ok ? "ok" : "fail"),
      generatedAt: report.generatedAt || null,
      localDate: report.localDate || null,
      browser: report.browser || null,
      services: report.services || {},
      today: {
        x: report.today.x || queueSummary(null),
        rednote: report.today.rednote || queueSummary(null),
        archive: report.today.archive || { count: 0, total: 0, byPlatform: {} },
      },
      failures: report.failures.map((item) => ({
        platform: item.platform,
        id: item.id || null,
        title: item.title ? redactSecrets(item.title) : null,
        lastError: redactSecrets(item.lastError || ""),
      })),
      warnings: Array.isArray(report.warnings) ? report.warnings.map((item) => ({
        name: item.name || "warning",
        message: redactSecrets(item.message || ""),
      })) : [],
    };
  }

  const xQueue = report.queues && report.queues.x;
  const rednoteQueue = report.queues && report.queues.rednote;
  const summary = report.summary || {};
  const archiveToday = report.archive && report.archive.today ? report.archive.today : {};

  return {
    ok: Boolean(report.ok),
    status: summary.status || (report.ok ? "ok" : "fail"),
    generatedAt: report.generatedAt || null,
    localDate: report.localDate || null,
    browser: report.browser || null,
    services: serviceMap(report.services),
    today: {
      x: queueSummary(xQueue),
      rednote: queueSummary(rednoteQueue),
      archive: {
        count: Number(archiveToday.count || 0),
        total: Number(report.archive && report.archive.total || 0),
        byPlatform: archiveToday.byPlatform || {},
      },
    },
    failures: [
      ...failureItems("x", xQueue),
      ...failureItems("rednote", rednoteQueue),
    ],
    warnings: warningItems(report),
  };
}

function formatFailure(failure) {
  const title = failure.title ? ` ${failure.title}` : "";
  const error = failure.lastError ? `: ${failure.lastError}` : "";
  return `  ${failure.platform} ${failure.id || "unknown"}${title}${error}`;
}

function formatWarning(warning) {
  return `  ${warning.name || "warning"}: ${warning.message || ""}`;
}

function formatQueue(name, summary) {
  return `  ${name}: total ${summary.total}, today ${summary.today}, failed ${summary.failed}, due ${summary.due}, posted ${summary.posted}, scheduled ${summary.scheduled}`;
}

function formatHeartbeat(heartbeat) {
  const hb = buildHeartbeat(heartbeat);
  const serviceLines = Object.values(hb.services).map((service) => {
    const parts = [
      `${service.kind}: ${service.state}`,
      service.pid ? `pid ${service.pid}` : null,
      service.runs !== null && service.runs !== undefined ? `runs ${service.runs}` : null,
      service.lastExitCode !== null && service.lastExitCode !== undefined ? `lastExit ${service.lastExitCode}` : null,
    ].filter(Boolean);
    return `  ${parts.join(", ")}`;
  });

  const lines = [
    "xpost heartbeat",
    `Generated: ${hb.generatedAt || "unknown"} (${hb.localDate || "unknown"})`,
    `status: ${hb.status}`,
    "",
    "Browser",
    hb.browser && hb.browser.ok
      ? `  relay ok; tabs ${hb.browser.tabCount || 0}, x ${hb.browser.xTabs || 0}, rednote ${hb.browser.rednoteTabs || 0}`
      : `  ${hb.browser && hb.browser.error ? hb.browser.error : "unavailable"}`,
    "",
    "Services",
    ...(serviceLines.length ? serviceLines : ["  none"]),
    "",
    "Today",
    formatQueue("x", hb.today.x),
    formatQueue("rednote", hb.today.rednote),
    `  archive: today ${hb.today.archive.count}, total ${hb.today.archive.total}`,
    "",
    "Warnings",
    ...(hb.warnings.length ? hb.warnings.map(formatWarning) : ["  none"]),
    "",
    "Failures",
    ...(hb.failures.length ? hb.failures.map(formatFailure) : ["  none"]),
  ];

  return redactSecrets(lines.join("\n"));
}

function heartbeatNotifyLines(heartbeat) {
  const hb = buildHeartbeat(heartbeat);
  const lines = [
    `status: ${hb.status}`,
    `date: ${hb.localDate || "unknown"}`,
    `x today ${hb.today.x.today}, failed ${hb.today.x.failed}, due ${hb.today.x.due}`,
    `rednote today ${hb.today.rednote.today}, failed ${hb.today.rednote.failed}, due ${hb.today.rednote.due}`,
    `archive today ${hb.today.archive.count}`,
  ];

  for (const failure of hb.failures) {
    lines.push(`failure: ${failure.platform} ${failure.id || "unknown"}${failure.title ? ` ${failure.title}` : ""}${failure.lastError ? `: ${failure.lastError}` : ""}`);
  }

  for (const warning of hb.warnings) {
    lines.push(`warning: ${warning.name || "warning"}${warning.message ? `: ${warning.message}` : ""}`);
  }

  return lines.map(redactSecrets);
}

module.exports = {
  buildHeartbeat,
  formatHeartbeat,
  heartbeatNotifyLines,
};
