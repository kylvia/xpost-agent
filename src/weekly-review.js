"use strict";

const { analyzeBatchRepetition, normalizeText } = require("./content-quality");

function localDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function dateDaysAgo(now, days) {
  const date = new Date(now);
  date.setDate(date.getDate() - Number(days || 7) + 1);
  return localDate(date);
}

function itemDate(item) {
  return item.planDate || localDate(item.postedAt || item.scheduledAt || item.createdAt || item.archivedAt);
}

function recent(items, since, until) {
  return (items || []).filter((item) => {
    const date = itemDate(item);
    return date && date >= since && date <= until;
  });
}

function contentText(item) {
  return normalizeText([
    item.text,
    item.title,
    item.body,
  ].filter(Boolean).join(" "));
}

function excerpt(value, max = 56) {
  const text = contentText(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function latestMetric(item = {}) {
  const metrics = Array.isArray(item.metrics) ? item.metrics.filter(Boolean) : [];
  if (!metrics.length) return null;
  return metrics.slice().sort((a, b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")))[0];
}

function metricEngagements(metric = {}) {
  return ["replies", "reposts", "quotes", "likes", "bookmarks"]
    .reduce((total, key) => total + Number(metric[key] || 0), 0);
}

function metricScore(metric = {}) {
  const views = Number(metric.views || 0);
  const interactions = metricEngagements(metric);
  return views + interactions * 50;
}

function metricSummary(item) {
  const metric = latestMetric(item);
  if (!metric) return null;
  const views = Number(metric.views || 0);
  const engagements = Number(metric.engagements !== undefined ? metric.engagements : metricEngagements(metric));
  const engagementRate = metric.engagementRate !== undefined
    ? Number(metric.engagementRate)
    : views
      ? Number((engagements / views).toFixed(6))
      : null;
  return {
    id: item.id,
    queueId: item.queueId || null,
    platform: item.platform || null,
    contentAngle: item.contentAngle || null,
    capturedAt: metric.capturedAt || null,
    views: metric.views !== undefined ? Number(metric.views) : null,
    likes: metric.likes !== undefined ? Number(metric.likes) : null,
    reposts: metric.reposts !== undefined ? Number(metric.reposts) : null,
    replies: metric.replies !== undefined ? Number(metric.replies) : null,
    bookmarks: metric.bookmarks !== undefined ? Number(metric.bookmarks) : null,
    engagements,
    engagementRate,
    score: metricScore(metric),
    excerpt: excerpt(item),
  };
}

function performanceReview(items = []) {
  const summaries = items
    .map(metricSummary)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const top = summaries.slice(0, 3);
  const low = summaries.length > 3 ? summaries.slice(-3).reverse() : [];
  return {
    metricSnapshots: summaries.length,
    top,
    low,
  };
}

function genericPhraseCandidates(value) {
  const text = normalizeText(value);
  const phrases = new Set();
  const segments = text
    .split(/[。！？!?；;：:\n]+/)
    .map((segment) => segment.replace(/\s+/g, ""))
    .filter((segment) => segment.length >= 6);

  for (const segment of segments) {
    phrases.add(segment.slice(0, Math.min(12, segment.length)));
    if (segment.length > 12) {
      for (let index = 0; index <= segment.length - 8; index += 2) {
        phrases.add(segment.slice(index, index + 8));
      }
    }
  }

  return phrases;
}

function repeatedPhrases(items) {
  const phrases = new Map();
  for (const item of items) {
    const text = contentText(item);
    const itemPhrases = new Set();
    for (const phrase of ["今晚只做一件事", "成年人最该", "手机放远", "不是时间"]) {
      if (text.includes(phrase)) itemPhrases.add(phrase);
    }
    for (const phrase of genericPhraseCandidates(text)) {
      itemPhrases.add(phrase);
    }
    for (const phrase of itemPhrases) {
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }
  return [...phrases.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(([phrase, count]) => ({ phrase, count }));
}

function validateDays(value) {
  if (typeof value === "boolean") {
    throw new Error("days must be a positive integer");
  }
  const days = Number(value === undefined ? 7 : value);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("days must be a positive integer");
  }
  return days;
}

function buildWeeklyReview(options = {}) {
  const now = options.now || new Date();
  const days = validateDays(options.days);
  const until = localDate(now);
  const since = dateDaysAgo(now, days);
  const xItems = recent(options.xItems, since, until).filter((item) => item.source === "daily-plan");
  const rednoteItems = recent(options.rednoteItems, since, until).filter((item) => item.source === "daily-plan");
  const archiveItems = recent(options.archiveItems, since, until).filter((item) => item.source === "daily-plan");
  const contentItems = [...xItems, ...rednoteItems, ...archiveItems];
  const performance = performanceReview(archiveItems);
  const repetitionAnalysis = analyzeBatchRepetition(contentItems.map((item) => ({ text: contentText(item) })), {});
  const phraseRepeats = repeatedPhrases(contentItems);
  const practiceScopeItems = [...xItems, ...archiveItems];
  const microPracticeCount = practiceScopeItems.filter((item) => (
    item.contentAngle === "micro practice"
    || /只做一件事|手机放远|写下/.test(contentText(item))
  )).length;
  const styleRisks = [];
  if (microPracticeCount > Math.ceil(Math.max(practiceScopeItems.length, 1) / 3)) {
    styleRisks.push("Explicit practice/action endings are overused; keep them to at most one X post per 5-post batch.");
  }
  if ([...rednoteItems, ...archiveItems].filter((item) => /成年人最该/.test(item.title || "")).length > 1) {
    styleRisks.push("Rednote titles repeat the same opener pattern.");
  }
  const avoidPhrases = [...new Set([
    ...phraseRepeats.map((item) => item.phrase),
    ...(microPracticeCount > 1 ? ["今晚只做一件事"] : []),
  ])];

  return {
    ok: true,
    days,
    dateRange: { since, until },
    counts: {
      x: xItems.length,
      rednote: rednoteItems.length,
      archive: archiveItems.length,
    },
    findings: [
      `${xItems.length} X item(s), ${rednoteItems.length} Rednote item(s), ${archiveItems.length} archive record(s) reviewed.`,
      performance.metricSnapshots
        ? `${performance.metricSnapshots} archive record(s) have engagement metrics; top content should guide the next prompt iteration.`
        : "No engagement metrics captured yet; run metrics-capture after posts have had time to collect impressions.",
    ],
    repetition: [
      ...repetitionAnalysis.warnings.map((warning) => `${warning.type}: ${warning.value} (${warning.count})`),
      ...phraseRepeats.map((item) => `Repeated phrase: ${item.phrase} (${item.count})`),
    ],
    styleRisks,
    performance,
    winningAngles: [...new Set(performance.top.map((item) => item.contentAngle).filter(Boolean))],
    avoidNextWeek: avoidPhrases,
    nextWeekGuidance: {
      actionPolicy: "At most one explicit practice post per 5-post X batch.",
      angleMix: ["strong judgment", "counterintuitive reframe", "mechanism", "hidden cost", "micro practice"],
      avoidPhrases,
      preferAngles: ["mechanism", "hidden cost", "counterintuitive reframe"],
      preferSignals: performance.top.map((item) => ({
        id: item.id,
        views: item.views,
        engagements: item.engagements,
        engagementRate: item.engagementRate,
        excerpt: item.excerpt,
      })),
      rednoteStyleNotes: ["Use concrete life scenes and fewer slogan-like openers."],
    },
  };
}

function formatWeeklyReview(review) {
  return [
    "xpost weekly-review",
    `Range: ${review.dateRange.since} to ${review.dateRange.until}`,
    `Counts: x ${review.counts.x}, rednote ${review.counts.rednote}, archive ${review.counts.archive}`,
    "",
    "Findings",
    ...review.findings.map((item) => `  - ${item}`),
    "",
    "Repetition",
    ...(review.repetition.length ? review.repetition.map((item) => `  - ${item}`) : ["  - none"]),
    "",
    "Style Risks",
    ...(review.styleRisks.length ? review.styleRisks.map((item) => `  - ${item}`) : ["  - none"]),
    "",
    "Performance",
    review.performance && review.performance.metricSnapshots
      ? `  snapshots: ${review.performance.metricSnapshots}`
      : "  snapshots: 0",
    ...(review.performance && review.performance.top.length
      ? review.performance.top.map((item) => `  - top ${item.id}: views ${item.views ?? "?"}, engagements ${item.engagements}, rate ${item.engagementRate ?? "?"} :: ${item.excerpt}`)
      : ["  - top: none"]),
    "",
    "Next Week",
    `  actionPolicy: ${review.nextWeekGuidance.actionPolicy}`,
    `  avoidPhrases: ${review.nextWeekGuidance.avoidPhrases.join(", ") || "none"}`,
  ].join("\n");
}

module.exports = {
  buildWeeklyReview,
  formatWeeklyReview,
};
