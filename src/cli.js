"use strict";

const { parseArgs, readStdin } = require("./args");
const { generatePost } = require("./agent");
const archive = require("./archive");
const relay = require("./browser-relay");
const { planDailyContent } = require("./daily-plan");
const { formatDoctorReport, runDoctor } = require("./doctor");
const { createDraft } = require("./draft");
const { buildHeartbeat, formatHeartbeat, heartbeatNotifyLines } = require("./heartbeat");
const { notifyFeishu, redactSecrets } = require("./notifier");
const { localPlanDate, planDailyPosts } = require("./planner");
const { draftNote } = require("./rednote");
const { generateRednoteNotes, normalizeRednoteNote } = require("./rednote-content");
const rednoteStore = require("./rednote-store");
const { buildDailyRandomSchedule } = require("./schedule");
const service = require("./service");
const store = require("./store");
const { buildWeeklyReview, formatWeeklyReview } = require("./weekly-review");
const { clearComposer, currentAccount, fillComposer, openComposer, publish } = require("./x");
const { captureXPostMetrics } = require("./x-metrics");

const DEFAULT_THINKING_SKILL = "creator-systems";
const DEFAULT_VOICE_SKILL = "realist-perspective";

function print(data, json) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function appendNotification(text, notification) {
  if (!notification) return text;
  return `${text}\n\nNotification\n  ${JSON.stringify(notification)}`;
}

function sanitizeNotificationValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeNotificationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeNotificationValue(item)]),
    );
  }
  if (value === undefined || value === null) return value;
  return redactSecrets(value);
}

async function safeNotify(title, lines, options = {}) {
  const env = options.env || process.env;
  const explicitlyEnabled = Boolean(options.enabled);
  if (!explicitlyEnabled && !env.XPOST_FEISHU_WEBHOOK_URL) return null;

  const notifyImpl = options.notifyImpl || notifyFeishu;
  const notificationOptions = {
    ...options,
    env,
    title: redactSecrets(title || "notice"),
    lines: (lines || []).map((line) => redactSecrets(line)),
  };
  delete notificationOptions.enabled;
  delete notificationOptions.notifyImpl;
  delete notificationOptions.stderr;

  try {
    return sanitizeNotificationValue(await notifyImpl(notificationOptions));
  } catch (error) {
    const redacted = redactSecrets(error && error.message ? error.message : error);
    if (options.stderr !== false) {
      console.error(`Notification failed for ${redactSecrets(title || "notice")}: ${redacted}`);
    }
    return { ok: false, error: redacted };
  }
}

function safeArchiveXPost(post) {
  try {
    return archive.archiveXPost(post);
  } catch (error) {
    console.error(`Archive failed for X post ${post && post.id ? post.id : "unknown"}: ${error.message}`);
    return null;
  }
}

function safeArchiveRednoteNote(note, options = {}) {
  try {
    return archive.archiveRednoteNote(note, options);
  } catch (error) {
    console.error(`Archive failed for Rednote note ${note && note.id ? note.id : "unknown"}: ${error.message}`);
    return null;
  }
}

function weeklyReviewNotificationLines(review) {
  const top = review.performance && review.performance.top && review.performance.top[0];
  return [
    `range: ${review.dateRange.since} to ${review.dateRange.until}`,
    `counts: x ${review.counts.x}, rednote ${review.counts.rednote}, archive ${review.counts.archive}`,
    `metricSnapshots: ${review.performance ? review.performance.metricSnapshots : 0}`,
    ...(top ? [`top: ${top.id} views ${top.views || 0}, engagements ${top.engagements || 0}`] : []),
    `risks: ${review.styleRisks.length}`,
    `avoidPhrases: ${review.nextWeekGuidance.avoidPhrases.join(", ") || "none"}`,
    `actionPolicy: ${review.nextWeekGuidance.actionPolicy}`,
  ];
}

async function textFromArgs(args) {
  if (args.text) return args.text;
  if (args.stdin) return (await readStdin()).trim();
  if (args.id) {
    const post = store.getPost(args.id);
    if (!post) throw new Error(`Post not found: ${args.id}`);
    return post.text;
  }
  throw new Error("Text is required. Use --text, --stdin, or --id.");
}

function xAccountFromArgs(args) {
  return args.account || args["x-account"] || args["expected-account"] || args["expected-handle"];
}

function splitTags(value) {
  return String(value || "")
    .split(/[#,，,\s]+/)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

async function rednoteFromArgs(args) {
  if (args.id) {
    const note = rednoteStore.getNote(args.id);
    if (!note) throw new Error(`Rednote item not found: ${args.id}`);
    return note;
  }

  if (args.stdin) {
    const raw = (await readStdin()).trim();
    if (!raw) throw new Error("Rednote JSON is required on stdin.");
    return normalizeRednoteNote(JSON.parse(raw));
  }

  return normalizeRednoteNote({
    title: args.title,
    body: args.body,
    tags: splitTags(args.tags),
    coverText: args["cover-text"] || args.coverText,
  });
}

function rednoteImageOptions(args) {
  const options = {};
  if (args["auth-code"]) options.authCode = args["auth-code"];
  if (args["image-provider"]) options.imageProvider = args["image-provider"];
  if (args["image-model"]) options.imageModel = args["image-model"];
  if (args["image-endpoint"] || args.endpoint) options.imageEndpoint = args["image-endpoint"] || args.endpoint;
  if (args["image-temperature"] || args.temperature) options.imageTemperature = args["image-temperature"] || args.temperature;
  if (args["image-fallback"] !== undefined) options.imageFallback = args["image-fallback"] !== "false";
  return options;
}

async function health(args) {
  const [version, status, tabs] = await Promise.all([
    relay.version(),
    relay.status(),
    relay.tabs(),
  ]);
  const xTabs = tabs.filter((tab) => /https:\/\/(x|twitter)\.com\//i.test(tab.url || ""));
  let account = null;
  for (const tab of xTabs) {
    try {
      account = await currentAccount(tab.id);
      break;
    } catch (error) {
      account = { error: error.message };
    }
  }
  if (!account || account.error) {
    try {
      const tab = await openComposer();
      account = await currentAccount(tab.id);
    } catch (error) {
      account = account || { error: error.message };
    }
  }
  print({ ok: true, account, browserRelayVersion: version, status, tabCount: tabs.length, xTabs }, args.json);
}

async function doctor(args) {
  const env = args["auth-code"]
    ? { ...process.env, XPOST_LIAOBOTS_AUTHCODE: args["auth-code"] }
    : process.env;
  const report = await runDoctor({
    chatModel: args.model,
    deep: Boolean(args.deep),
    endpoint: args.endpoint,
    env,
    imageEndpoint: args["image-endpoint"],
    imageModel: args["image-model"],
  });
  if (args.notify && report.ok === false) {
    report.notification = await notifyFeishu({
      title: "doctor.unhealthy",
      lines: formatDoctorReport(report).split("\n"),
    });
  }
  print(args.json ? report : appendNotification(formatDoctorReport(report), report.notification), args.json);
}

async function heartbeat(args) {
  const report = await runDoctor({ deep: false });
  const result = buildHeartbeat(report);
  if (args.notify) {
    result.notification = await notifyFeishu({
      title: "heartbeat.summary",
      lines: heartbeatNotifyLines(result),
    });
  }
  print(args.json ? result : appendNotification(formatHeartbeat(result), result.notification), args.json);
}

async function draft(args) {
  const result = createDraft({ style: args.style || "realist", topic: args.topic || "random" });
  print(args.json ? result : result.text, args.json);
}

async function enqueue(args) {
  const text = await textFromArgs(args);
  const post = store.enqueuePost({ text, scheduledAt: args.at || new Date().toISOString() });
  print(post, args.json);
}

async function retry(args) {
  if (!args.id) throw new Error("Post id is required. Use --id.");
  const post = store.retryPost(args.id, args.at || new Date().toISOString());
  print(post, args.json);
}

async function ignore(args) {
  if (!args.id) throw new Error("Post id is required. Use --id.");
  const post = store.ignorePost(args.id, { reason: args.reason });
  print(post, args.json);
}

async function reschedule(args) {
  if (!args.id) throw new Error("Post id is required. Use --id.");
  if (!args.at) throw new Error("Schedule time is required. Use --at.");
  const post = store.reschedulePost(args.id, args.at);
  print(post, args.json);
}

async function list(args) {
  const items = store.readQueue();
  const filtered = args.status ? items.filter((post) => post.status === args.status) : items;
  print(filtered, args.json);
}

async function dryRun(args) {
  const text = await textFromArgs(args);
  const result = await fillComposer(text, { account: xAccountFromArgs(args), postId: args.id });
  if (args.id) {
    store.updatePost(args.id, { status: "filled", screenshots: [result.screenshot] });
  }
  print({ ok: true, posted: false, ...result }, args.json);
}

async function clear(args) {
  const tab = await openComposer();
  if (!tab || !tab.id) throw new Error("No Browser Relay tab available");
  await clearComposer(tab.id);
  print({ ok: true, tabId: tab.id }, args.json);
}

async function post(args) {
  const text = await textFromArgs(args);
  const result = await publish(text, { account: xAccountFromArgs(args), postId: args.id, yes: Boolean(args.yes) });
  if (args.id) {
    const screenshots = [result.screenshot];
    if (result.postedScreenshot) screenshots.push(result.postedScreenshot);
    const updated = store.updatePost(args.id, {
      status: result.posted ? "posted" : "filled",
      postedAt: result.posted ? new Date().toISOString() : null,
      screenshots,
      url: result.posted ? result.url || null : null,
      lastError: null,
    });
    if (result.posted) safeArchiveXPost(updated);
  } else if (result.posted) {
    safeArchiveXPost({
      id: `manual-${Date.now().toString(36)}`,
      text,
      postedAt: new Date().toISOString(),
      screenshots: [result.screenshot, result.postedScreenshot].filter(Boolean),
      url: result.url || null,
    });
  }
  print({ ok: true, ...result }, args.json);
}

async function worker(args) {
  const intervalMs = Number(args.interval || 30) * 1000;

  async function tick() {
    const due = store.duePosts();
    for (const item of due) {
      try {
        store.updatePost(item.id, { status: "posting", attempts: item.attempts + 1 });
        const result = await publish(item.text, { account: xAccountFromArgs(args), postId: item.id, yes: Boolean(args.yes) });
        const screenshots = [result.screenshot];
        if (result.postedScreenshot) screenshots.push(result.postedScreenshot);
        const updated = store.updatePost(item.id, {
          status: result.posted ? "posted" : "filled",
          postedAt: result.posted ? new Date().toISOString() : null,
          screenshots,
          url: result.posted ? result.url || null : null,
          lastError: null,
        });
        if (result.posted) safeArchiveXPost(updated);
        print({ id: item.id, status: result.posted ? "posted" : "filled" }, args.json);
      } catch (error) {
        store.updatePost(item.id, { status: "failed", lastError: error.message });
        await safeNotify("publish.failed", [
          "platform: x",
          `id: ${item.id}`,
          `error: ${redactSecrets(error.message)}`,
          `next: xpost retry --id ${item.id}`,
        ]);
        print({ id: item.id, status: "failed", error: error.message }, args.json);
      }
    }
  }

  await tick();
  if (args.once) return;

  setInterval(tick, intervalMs);
}

async function rednoteEnqueue(args) {
  const note = await rednoteFromArgs(args);
  const queued = rednoteStore.enqueueNote({
    ...note,
    scheduledAt: args.at || new Date().toISOString(),
  });
  print(queued, args.json);
}

async function rednoteList(args) {
  const items = rednoteStore.readQueue();
  const filtered = args.status ? items.filter((note) => note.status === args.status) : items;
  print(filtered, args.json);
}

async function rednoteRetry(args) {
  if (!args.id) throw new Error("Rednote item id is required. Use --id.");
  const retried = rednoteStore.retryNote(args.id, args.at || new Date().toISOString());
  print(retried, args.json);
}

async function rednoteIgnore(args) {
  if (!args.id) throw new Error("Rednote item id is required. Use --id.");
  const ignored = rednoteStore.ignoreNote(args.id, { reason: args.reason });
  print(ignored, args.json);
}

async function rednoteDryRun(args) {
  const note = await rednoteFromArgs(args);
  const result = await draftNote(note, {
    ...rednoteImageOptions(args),
    noteId: args.id,
    save: false,
  });
  if (args.id) {
    rednoteStore.updateNote(args.id, {
      status: "filled",
      assets: [result.cover],
      screenshots: [result.screenshot],
      lastError: null,
    });
  }
  print({ ok: true, drafted: false, ...result }, args.json);
}

async function rednotePost(args) {
  if (!args.yes) throw new Error("Pass --yes to publish a Rednote note.");
  const note = await rednoteFromArgs(args);
  const result = await draftNote(note, {
    ...rednoteImageOptions(args),
    noteId: args.id,
    publish: true,
  });
  if (args.id) {
    const updated = rednoteStore.updateNote(args.id, {
      status: result.posted ? "posted" : "filled",
      postedAt: result.posted ? new Date().toISOString() : null,
      assets: [result.cover],
      coverFallbackError: result.coverFallbackError,
      coverFallbackFrom: result.coverFallbackFrom,
      coverProvider: result.coverProvider,
      screenshots: [result.screenshot, result.postedScreenshot].filter(Boolean),
      lastError: result.posted ? null : result.publishError || "publish failed",
    });
    if (result.posted) safeArchiveRednoteNote(updated, { coverProvider: result.coverProvider });
  } else if (result.posted) {
    safeArchiveRednoteNote({
      ...note,
      id: `manual-${Date.now().toString(36)}`,
      postedAt: new Date().toISOString(),
      assets: [result.cover],
      coverProvider: result.coverProvider,
      screenshots: [result.screenshot, result.postedScreenshot].filter(Boolean),
    });
  }
  print({ ok: true, ...result }, args.json);
}

async function rednoteWorker(args) {
  if (!args.yes) throw new Error("Pass --yes to fill/save Rednote drafts.");
  const intervalMs = Number(args.interval || 300) * 1000;
  const publishMode = Boolean(args.publish);

  async function tick() {
    const due = rednoteStore.dueNotes();
    for (const item of due) {
      try {
        rednoteStore.updateNote(item.id, { status: "drafting", attempts: item.attempts + 1 });
        const result = await draftNote(item, {
          ...rednoteImageOptions(args),
          noteId: item.id,
          publish: publishMode,
          save: !publishMode,
        });
        const screenshots = [result.screenshot];
        if (result.draftedScreenshot) screenshots.push(result.draftedScreenshot);
        if (result.postedScreenshot) screenshots.push(result.postedScreenshot);
        const updated = rednoteStore.updateNote(item.id, {
          status: result.posted ? "posted" : result.savedDraft ? "drafted" : "filled",
          draftedAt: result.savedDraft ? new Date().toISOString() : null,
          postedAt: result.posted ? new Date().toISOString() : null,
          assets: [result.cover],
          coverFallbackError: result.coverFallbackError,
          coverFallbackFrom: result.coverFallbackFrom,
          coverProvider: result.coverProvider,
          screenshots,
          lastError: result.posted || result.savedDraft ? null : result.publishError || result.saveError || null,
        });
        if (result.coverFallbackError) {
          await safeNotify("api.image.fallback", [
            "platform: rednote",
            `id: ${item.id}`,
            ...(item.title ? [`title: ${item.title}`] : []),
            ...(result.coverFallbackFrom ? [`fallbackFrom: ${result.coverFallbackFrom}`] : []),
            `error: ${redactSecrets(result.coverFallbackError)}`,
          ]);
        }
        if (result.posted) safeArchiveRednoteNote(updated, { coverProvider: result.coverProvider });
        print({ id: item.id, status: result.posted ? "posted" : result.savedDraft ? "drafted" : "filled" }, args.json);
      } catch (error) {
        rednoteStore.updateNote(item.id, { status: "failed", lastError: error.message });
        await safeNotify("rednote.publish.failed", [
          "platform: rednote",
          `id: ${item.id}`,
          ...(item.title ? [`title: ${item.title}`] : []),
          `error: ${redactSecrets(error.message)}`,
          `next: xpost rednote-retry --id ${item.id}`,
        ]);
        print({ id: item.id, status: "failed", error: error.message }, args.json);
      }
    }
  }

  await tick();
  if (args.once) return;
  setInterval(tick, intervalMs);
}

async function agentRun(args) {
  const text = await generatePost({
    apiTimeoutMs: args["api-timeout-ms"],
    authCode: args["auth-code"],
    codexModel: args["codex-model"],
    endpoint: args.endpoint,
    fallbackModels: args["fallback-models"],
    generator: args.generator,
    maxChars: args["max-chars"],
    model: args.model,
    skill: args.skill || DEFAULT_VOICE_SKILL,
    temperature: args.temperature,
    topic: args.topic || "random",
  });

  const result = { ok: true, text };
  if (args.enqueue) {
    result.post = store.enqueuePost({ text, scheduledAt: args.at || new Date().toISOString() });
  }
  print(result, args.json);
}

async function agentPlan(args) {
  const result = await planDailyPosts({
    count: args.count || 5,
    enqueue: store.enqueuePost,
    existing: store.readQueue,
    generate: (options) => generatePost({
      apiTimeoutMs: args["api-timeout-ms"],
      authCode: args["auth-code"],
      codexModel: args["codex-model"],
      endpoint: args.endpoint,
      fallbackModels: args["fallback-models"],
      generator: args.generator,
      maxChars: args["max-chars"],
      model: args.model,
      skill: args.skill || DEFAULT_VOICE_SKILL,
      temperature: args.temperature,
      topic: options.topic,
    }),
    minLeadMinutes: args["min-lead-minutes"] || 0,
    topic: args.topic || "random",
    windowEnd: args["window-end"] || "06:00",
    windowStart: args["window-start"] || "00:00",
  });
  print(result, args.json);
}

async function rednotePlan(args) {
  const count = Number(args.count || 2);
  const times = buildDailyRandomSchedule({
    count,
    minLeadMinutes: args["min-lead-minutes"] || 0,
    windowEnd: args["window-end"] || "21:30",
    windowStart: args["window-start"] || "11:00",
  });
  const planDate = localPlanDate(times[0]);
  const existing = rednoteStore.readQueue();
  const alreadyPlanned = existing.some((note) => (
    note.source === "rednote-plan"
    && note.planDate === planDate
    && note.status !== "failed"
    && note.status !== "ignored"
  ));
  if (alreadyPlanned) {
    return print({
      ok: true,
      count: 0,
      planDate,
      skipped: true,
      notes: [],
    }, args.json);
  }

  const notes = await generateRednoteNotes({
    apiTimeoutMs: args["api-timeout-ms"],
    authCode: args["auth-code"],
    codexModel: args["codex-model"],
    count,
    endpoint: args.endpoint,
    fallbackModels: args["fallback-models"],
    generator: args.generator,
    model: args.model,
    skill: args.skill || DEFAULT_VOICE_SKILL,
    sourceTexts: args["source-text"] ? [args["source-text"]] : [],
    temperature: args.temperature,
    topic: args.topic || "random",
  });
  const queued = notes.map((note, index) => rednoteStore.enqueueNote({
    ...note,
    planDate,
    scheduledAt: times[index].toISOString(),
    source: "rednote-plan",
  }));
  print({ ok: true, count: queued.length, planDate, notes: queued }, args.json);
}

async function dailyPlan(args) {
  const dryRun = Boolean(args["dry-run"]);
  const result = await planDailyContent({
    apiTimeoutMs: args["api-timeout-ms"],
    authCode: args["auth-code"],
    codexModel: args["codex-model"],
    count: args.count || 5,
    dryRun,
    endpoint: args.endpoint,
    enqueueNote: dryRun ? undefined : rednoteStore.enqueueNote,
    enqueuePost: dryRun ? undefined : store.enqueuePost,
    existingNotes: dryRun ? undefined : rednoteStore.readQueue,
    existingPosts: dryRun ? undefined : store.readQueue,
    fallbackModels: args["fallback-models"],
    generator: args.generator,
    maxChars: args["max-chars"],
    maxWeightedChars: args["max-weighted-chars"],
    minLeadMinutes: args["min-lead-minutes"] || 0,
    model: args.model,
    rednoteCount: args["rednote-count"] || 2,
    rednoteTemperature: args["rednote-temperature"],
    rednoteWindowEnd: args["rednote-window-end"] || "21:30",
    rednoteWindowStart: args["rednote-window-start"] || "11:00",
    skill: args.skill || DEFAULT_VOICE_SKILL,
    skillPath: args["skill-path"],
    temperature: args.temperature,
    thinkingSkill: args["thinking-skill"] || DEFAULT_THINKING_SKILL,
    thinkingSkillPath: args["thinking-skill-path"],
    xWindowEnd: args["x-window-end"] || args["window-end"] || "23:00",
    xWindowStart: args["x-window-start"] || args["window-start"] || "10:00",
  });
  print(result, args.json);
}

async function archiveList(args) {
  const items = archive.filterArchive(archive.readArchive(), {
    platform: args.platform,
    since: args.since,
    source: args.source,
    until: args.until,
  });
  print(items, args.json);
}

async function archiveReport(args) {
  const report = archive.archiveReport({
    platform: args.platform,
    since: args.since,
    source: args.source,
    until: args.until,
  });
  print(report, args.json);
}

function localDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function daysWindow(daysValue, now = new Date()) {
  if (daysValue === undefined) return {};
  const days = Number(daysValue);
  if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive integer");
  const sinceDate = new Date(now);
  sinceDate.setDate(sinceDate.getDate() - days + 1);
  return {
    since: localDate(sinceDate),
    until: localDate(now),
  };
}

function metricTargets(args) {
  const window = daysWindow(args.days);
  const since = args.since || window.since;
  const until = args.until || window.until;
  if (args.url) {
    const records = archive.readArchive();
    const record = args.id
      ? records.find((item) => item.platform === "x" && (item.id === args.id || item.queueId === args.id))
      : null;
    if (args.id && !record) throw new Error(`X archive record not found: ${args.id}`);
    return [{
      ...(record || {}),
      id: record ? record.id : null,
      queueId: record ? record.queueId : args.id || null,
      text: args.text || (record && record.text) || "",
      url: args.url,
    }];
  }

  const items = archive.filterArchive(archive.readArchive(), {
    platform: "x",
    since,
    source: args.source,
    until,
  });
  if (args.id) {
    const item = items.find((record) => record.id === args.id || record.queueId === args.id);
    if (!item) throw new Error(`X archive record not found: ${args.id}`);
    return [item];
  }
  return items;
}

async function metricsCapture(args) {
  const targets = metricTargets(args);
  const captured = [];
  const skipped = [];

  for (const target of targets) {
    if (!target.url) {
      const reason = "missing url; pass --url with --id for old archive records";
      if (args.id) throw new Error(reason);
      skipped.push({ id: target.id || null, queueId: target.queueId || null, reason });
      continue;
    }

    const snapshot = await captureXPostMetrics({
      text: target.text,
      url: target.url,
      waitMs: args["wait-ms"],
    });
    let updated = null;
    if (target.id) {
      updated = archive.appendMetricSnapshot(target.id, snapshot);
    }
    captured.push({
      id: target.id || null,
      queueId: target.queueId || null,
      url: snapshot.url || target.url || null,
      metrics: snapshot,
      metricsCount: updated && Array.isArray(updated.metrics) ? updated.metrics.length : null,
    });
  }

  print({
    ok: true,
    captured: captured.length,
    skipped,
    items: captured,
  }, args.json);
}

async function weeklyReview(args) {
  const review = buildWeeklyReview({
    archiveItems: archive.readArchive(),
    days: args.days || 7,
    rednoteItems: rednoteStore.readQueue(),
    xItems: store.readQueue(),
  });
  if (args.notify) {
    try {
      review.notification = await notifyFeishu({
        title: "weekly-review.completed",
        lines: weeklyReviewNotificationLines(review),
      });
    } catch (error) {
      review.notification = {
        ok: false,
        error: redactSecrets(error && error.message ? error.message : error),
      };
    }
  }
  print(args.json ? review : appendNotification(formatWeeklyReview(review), review.notification), args.json);
}

async function notifyTest(args) {
  const result = await notifyFeishu({
    title: "notify-test",
    lines: [
      `cwd: ${process.cwd()}`,
      `time: ${new Date().toISOString()}`,
    ],
  });
  print(result, args.json);
  if (result.ok !== true) {
    throw new Error(redactSecrets(result.error || result.warning || "notify-test failed"));
  }
}

async function serviceCommand(args) {
  const [action] = args._;
  const options = {
    authCode: args["auth-code"],
    endpoint: args.endpoint,
    generator: args.generator,
    imageEndpoint: args["image-endpoint"],
    imageFallback: args["image-fallback"] !== undefined ? args["image-fallback"] !== "false" : undefined,
    imageModel: args["image-model"],
    imageProvider: args["image-provider"],
    imageTemperature: args["image-temperature"],
    count: args.count,
    everyMinutes: args["every-minutes"],
    interval: args.interval,
    kind: args.kind || "worker",
    kickstart: Boolean(args.kickstart),
    maxChars: args["max-chars"],
    maxWeightedChars: args["max-weighted-chars"],
    minLeadMinutes: args["min-lead-minutes"],
    model: args.model,
    metricsDays: args["metrics-days"] || args.days,
    metricsTime: args["metrics-time"] || args.time,
    apiTimeoutMs: args["api-timeout-ms"],
    fallbackModels: args["fallback-models"],
    codexModel: args["codex-model"],
    publish: Boolean(args.publish),
    rednoteCount: args["rednote-count"],
    rednoteWindowEnd: args["rednote-window-end"],
    rednoteWindowStart: args["rednote-window-start"],
    schedule: args.schedule,
    skill: args.skill,
    skillPath: args["skill-path"],
    thinkingSkill: args["thinking-skill"],
    thinkingSkillPath: args["thinking-skill-path"],
    topic: args.topic,
    source: args.source,
    waitMs: args["wait-ms"],
    windowEnd: args["window-end"],
    windowStart: args["window-start"],
    xAccount: xAccountFromArgs(args),
    xpostHome: args["xpost-home"],
    xWindowEnd: args["x-window-end"],
    xWindowStart: args["x-window-start"],
    yes: Boolean(args.yes),
  };

  switch (action) {
    case "install":
      return print(await service.installService(options), args.json);
    case "start":
      return print(await service.startService(options), args.json);
    case "stop":
      return print(await service.stopService(options), args.json);
    case "status":
      return print(await service.statusService(options), args.json);
    case "uninstall":
      return print(await service.uninstallService(options), args.json);
    default:
      throw new Error(`Unknown service command: ${action || ""}\n\n${usage()}`);
  }
}

function usage() {
  return `xpost - local X posting helper for agents

Commands:
  health                       Check Browser Relay and attached X tabs
  doctor [--deep] [--notify]   Check local runner health without changing state
  heartbeat [--notify]         Print compact runner heartbeat
  draft [--topic random]       Generate a local realist-style draft
  enqueue --text TEXT [--at]   Add a post to the local queue
  retry --id ID [--at]         Requeue a failed/filled X post
  ignore --id ID [--reason TEXT] Mark a failed X post ignored
  reschedule --id ID --at TIME Move an unposted X post to a new time
  list [--status STATUS]       List queued posts
  dry-run --text TEXT          Fill X composer without posting
  clear                        Open X composer and clear current text
  post --text TEXT --yes       Fill and publish
  worker [--once] [--yes]      Process due queued posts
  agent-run --enqueue          Generate one post through the chat completions API
  agent-plan                   Generate and queue a random daily posting plan
  daily-plan [--dry-run]       Generate one intent, queue X posts, then Rednote notes
  rednote-enqueue              Add a Xiaohongshu draft note to the local queue
  rednote-list                 List queued Xiaohongshu draft notes
  rednote-retry --id ID        Requeue a failed Xiaohongshu note
  rednote-ignore --id ID [--reason TEXT] Mark a failed Xiaohongshu note ignored
  rednote-dry-run              Fill Xiaohongshu editor without saving draft
  rednote-post --yes           Fill and publish a Xiaohongshu note
  rednote-worker --yes         Process due Xiaohongshu notes into drafts
  rednote-plan                 Generate and queue 2 daily Xiaohongshu notes
  archive-list                 List posted content archive
  archive-report               Summarize posted content archive
  metrics-capture              Capture X post views/likes/reposts into archive
  weekly-review [--days 7] [--notify] Review recent content and suggest next-week guidance
  notify-test                  Send a Feishu webhook smoke test
  service install --yes        Install macOS launchd worker service
  service start|stop|status    Manage macOS launchd worker service
  service uninstall            Remove macOS launchd worker service

Common flags:
  --json                       Print machine-readable JSON
  --deep                       Doctor: perform real chat/image API requests
  --notify                     Send heartbeat, weekly review, or unhealthy doctor report, to Feishu
  --dry-run                    Preview daily-plan output without writing queues
  --stdin                      Read post text from stdin
  --id ID                      Use a queued post by id
  --reason TEXT                Reason for ignoring a failed queue item
  --title TEXT                 Xiaohongshu note title
  --body TEXT                  Xiaohongshu note body
  --tags TEXT                  Xiaohongshu tags, comma or space separated
  --cover-text TEXT            Xiaohongshu cover headline text
  --platform x|rednote         Filter archive by platform
  --source SOURCE              Filter archive by source
  --since YYYY-MM-DD           Filter archive/report from date
  --until YYYY-MM-DD           Filter archive/report through date
  --url URL                    X status URL for metrics-capture
  --wait-ms MS                 Wait after navigating before reading metrics
  --auth-code CODE             API bearer token for agent-run
  --endpoint URL               Chat completions endpoint
  --generator api|codex        Content generator: API, or local Codex spawn
  --fallback-models MODELS     API fallback models, comma/space separated; false disables
  --api-timeout-ms MS          API request timeout before trying the next fallback model
  --codex-model MODEL          Optional model for local codex exec generation
  --image-provider local|liao  Rednote image renderer
  --image-endpoint URL         Rednote image chat completions endpoint
  --image-model MODEL          Rednote image model
  --image-temperature N        Rednote image generation temperature
  --image-fallback false       Disable local fallback for Rednote image generation
  --model MODEL                Chat completions model for agent-run
  --topic TOPIC                Topic for draft or agent-run
  --max-chars N                Reject generated posts longer than N chars
  --account HANDLE             Only post when the current X account matches this handle
  --kind worker|agent|rednote|rednote-agent|daily-agent|metrics
  --schedule daily-random|interval
  --count N                    Posts to generate for agent-plan/daily-plan
  --rednote-count N            Notes to generate for daily-plan
  --window-start HH:MM         Daily random window start
  --window-end HH:MM           Daily random window end
  --x-window-start HH:MM       X daily-plan window start
  --x-window-end HH:MM         X daily-plan window end
  --rednote-window-start HH:MM Xiaohongshu daily-plan window start
  --rednote-window-end HH:MM   Xiaohongshu daily-plan window end
  --skill TEXT                 X/Rednote voice skill for generation
  --skill-path PATH            Read local voice skill text from an explicit path
  --thinking-skill TEXT        daily-plan thinking skill for contentIntent
  --thinking-skill-path PATH   Read local thinking skill text from an explicit path
  --every-minutes N            Agent service generation interval
  --days N                     metrics-capture recent local-day window
  --metrics-days N             Metrics service recent local-day window
  --metrics-time HH:MM         Metrics service daily run time, default 09:30
  --interval SECONDS           Worker/service polling interval
  --kickstart                  Immediately run an agent service after start
  --publish                    Rednote worker publishes instead of saving drafts
  --yes                        Required for X posting or Rednote draft/publish actions
`;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  switch (command) {
    case "health":
      return health(args);
    case "doctor":
      return doctor(args);
    case "heartbeat":
      return heartbeat(args);
    case "draft":
      return draft(args);
    case "enqueue":
      return enqueue(args);
    case "retry":
      return retry(args);
    case "ignore":
      return ignore(args);
    case "reschedule":
      return reschedule(args);
    case "list":
      return list(args);
    case "dry-run":
      return dryRun(args);
    case "clear":
      return clear(args);
    case "post":
      return post(args);
    case "worker":
      return worker(args);
    case "agent-run":
      return agentRun(args);
    case "agent-plan":
      return agentPlan(args);
    case "daily-plan":
      return dailyPlan(args);
    case "rednote-enqueue":
      return rednoteEnqueue(args);
    case "rednote-list":
      return rednoteList(args);
    case "rednote-retry":
      return rednoteRetry(args);
    case "rednote-ignore":
      return rednoteIgnore(args);
    case "rednote-dry-run":
      return rednoteDryRun(args);
    case "rednote-post":
      return rednotePost(args);
    case "rednote-worker":
      return rednoteWorker(args);
    case "rednote-plan":
      return rednotePlan(args);
    case "archive-list":
      return archiveList(args);
    case "archive-report":
      return archiveReport(args);
    case "metrics-capture":
      return metricsCapture(args);
    case "weekly-review":
      return weeklyReview(args);
    case "notify-test":
      return notifyTest(args);
    case "service":
      return serviceCommand(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(usage());
      return undefined;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

module.exports = { main, safeNotify };
