"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function stateDir() {
  return process.env.XPOST_HOME || path.join(os.homedir(), ".xpost-agent");
}

function archivePath() {
  return path.join(stateDir(), "content-archive.json");
}

function ensureArchive() {
  fs.mkdirSync(stateDir(), { recursive: true });
  if (!fs.existsSync(archivePath())) {
    fs.writeFileSync(archivePath(), "[]\n");
  }
}

function readArchive() {
  ensureArchive();
  const data = JSON.parse(fs.readFileSync(archivePath(), "utf8"));
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function writeArchive(items) {
  ensureArchive();
  fs.writeFileSync(archivePath(), `${JSON.stringify(items, null, 2)}\n`);
}

function archiveId(platform, queueId) {
  return `${platform}:${queueId}`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function localDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function archiveItemDate(item) {
  return item.planDate || localDate(item.postedAt) || localDate(item.scheduledAt) || localDate(item.archivedAt);
}

function upsertArchiveRecord(record) {
  if (!record || !record.id) throw new Error("archive record id is required");
  if (!record.platform) throw new Error("archive record platform is required");
  if (!record.queueId) throw new Error("archive record queueId is required");

  const now = new Date().toISOString();
  const items = readArchive();
  const index = items.findIndex((item) => item.id === record.id);
  const existing = index === -1 ? null : items[index];
  const next = compactObject({
    ...existing,
    ...record,
    archivedAt: existing && existing.archivedAt ? existing.archivedAt : record.archivedAt || now,
    updatedAt: now,
    metrics: record.metrics !== undefined
      ? record.metrics
      : existing && existing.metrics
        ? existing.metrics
        : [],
  });

  if (index === -1) items.push(next);
  else items[index] = next;
  writeArchive(items);
  return next;
}

function appendMetricSnapshot(recordId, snapshot = {}) {
  if (!recordId) throw new Error("archive record id is required");
  const items = readArchive();
  const index = items.findIndex((item) => item.id === recordId);
  if (index === -1) throw new Error(`Archive record not found: ${recordId}`);

  const now = new Date().toISOString();
  const existing = items[index];
  const metric = compactObject({
    ...snapshot,
    capturedAt: snapshot.capturedAt || now,
  });
  const next = compactObject({
    ...existing,
    url: snapshot.url || existing.url || null,
    metrics: [...(Array.isArray(existing.metrics) ? existing.metrics : []), metric],
    updatedAt: now,
  });

  items[index] = next;
  writeArchive(items);
  return next;
}

function archiveXPost(post, options = {}) {
  if (!post || !post.id) throw new Error("X post id is required for archive");
  return upsertArchiveRecord(compactObject({
    id: archiveId("x", post.id),
    platform: "x",
    queueId: post.id,
    source: post.source || null,
    planDate: post.planDate || null,
    text: post.text || "",
    scheduledAt: post.scheduledAt || null,
    postedAt: post.postedAt || options.postedAt || new Date().toISOString(),
    screenshots: Array.isArray(post.screenshots) ? post.screenshots : [],
    contentIntent: post.contentIntent || null,
    contentAngle: post.contentAngle || null,
    url: post.url || options.url || null,
  }));
}

function archiveRednoteNote(note, options = {}) {
  if (!note || !note.id) throw new Error("Rednote note id is required for archive");
  return upsertArchiveRecord(compactObject({
    id: archiveId("rednote", note.id),
    platform: "rednote",
    queueId: note.id,
    source: note.source || null,
    planDate: note.planDate || null,
    title: note.title || "",
    body: note.body || "",
    tags: Array.isArray(note.tags) ? note.tags : [],
    coverText: note.coverText || "",
    scheduledAt: note.scheduledAt || null,
    postedAt: note.postedAt || options.postedAt || new Date().toISOString(),
    assets: Array.isArray(note.assets) ? note.assets : [],
    screenshots: Array.isArray(note.screenshots) ? note.screenshots : [],
    contentIntent: note.contentIntent || null,
    sourceTexts: Array.isArray(note.sourceTexts) ? note.sourceTexts : undefined,
    coverProvider: note.coverProvider || options.coverProvider || null,
    url: note.url || options.url || null,
  }));
}

function filterArchive(items = readArchive(), options = {}) {
  return items.filter((item) => {
    if (options.platform && item.platform !== options.platform) return false;
    if (options.source && item.source !== options.source) return false;
    const date = archiveItemDate(item);
    if (options.since && date && date < options.since) return false;
    if (options.until && date && date > options.until) return false;
    return true;
  });
}

function increment(bucket, key, item) {
  const value = key || "unknown";
  if (!bucket[value]) bucket[value] = { count: 0 };
  bucket[value].count += 1;
  if (item.platform) bucket[value][item.platform] = (bucket[value][item.platform] || 0) + 1;
}

function archiveReport(options = {}) {
  const items = filterArchive(readArchive(), options);
  const report = {
    count: items.length,
    byPlatform: {},
    bySource: {},
    byDate: {},
  };

  for (const item of items) {
    increment(report.byPlatform, item.platform, item);
    increment(report.bySource, item.source, item);
    increment(report.byDate, archiveItemDate(item), item);
  }

  return report;
}

module.exports = {
  appendMetricSnapshot,
  archivePath,
  archiveReport,
  archiveRednoteNote,
  archiveXPost,
  filterArchive,
  readArchive,
  upsertArchiveRecord,
  writeArchive,
};
