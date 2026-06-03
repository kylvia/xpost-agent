"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshArchive(dir) {
  process.env.XPOST_HOME = dir;
  delete require.cache[require.resolve("../src/archive")];
  return require("../src/archive");
}

test("archiveXPost upserts posted X content into a separate archive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-archive-"));
  const archive = freshArchive(dir);

  const first = archive.archiveXPost({
    id: "x1",
    text: "关系里太快交出注意力的人，很容易变被动。",
    scheduledAt: "2026-05-30T18:20:00+08:00",
    postedAt: "2026-05-30T10:20:10.000Z",
    screenshots: ["/tmp/x-filled.png", "/tmp/x-posted.png"],
    source: "daily-plan",
    planDate: "2026-05-30",
    contentAngle: "hidden cost",
    contentIntent: { pointOfView: "关系里太快交出注意力会让自己变被动" },
    url: "https://x.com/_example_/status/1",
  });

  assert.equal(first.id, "x:x1");
  assert.equal(first.platform, "x");
  assert.equal(first.queueId, "x1");
  assert.equal(first.text, "关系里太快交出注意力的人，很容易变被动。");
  assert.equal(first.contentAngle, "hidden cost");
  assert.equal(first.url, "https://x.com/_example_/status/1");
  assert.deepEqual(first.metrics, []);
  assert.equal(path.basename(archive.archivePath()), "content-archive.json");
  assert.equal(archive.readArchive().length, 1);

  archive.upsertArchiveRecord({
    id: "x:x1",
    platform: "x",
    queueId: "x1",
    metrics: [{ capturedAt: "2026-05-31T00:00:00+08:00", views: 100 }],
  });
  const updated = archive.archiveXPost({
    id: "x1",
    text: "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回。",
    postedAt: "2026-05-30T10:20:10.000Z",
  });

  assert.equal(archive.readArchive().length, 1);
  assert.equal(updated.text, "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回。");
  assert.deepEqual(updated.metrics, [{ capturedAt: "2026-05-31T00:00:00+08:00", views: 100 }]);
});

test("appendMetricSnapshot appends engagement snapshots to archived content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-archive-"));
  const archive = freshArchive(dir);

  archive.archiveXPost({
    id: "x2",
    text: "有些熬夜不是贪玩，是讨债。",
    source: "daily-plan",
    planDate: "2026-06-03",
  });

  const updated = archive.appendMetricSnapshot("x:x2", {
    capturedAt: "2026-06-03T13:00:00+08:00",
    views: 1200,
    likes: 30,
    reposts: 5,
    url: "https://x.com/_example_/status/2",
  });

  assert.equal(updated.url, "https://x.com/_example_/status/2");
  assert.deepEqual(updated.metrics, [{
    capturedAt: "2026-06-03T13:00:00+08:00",
    views: 1200,
    likes: 30,
    reposts: 5,
    url: "https://x.com/_example_/status/2",
  }]);
});

test("archiveRednoteNote stores note fields and assets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-archive-"));
  const archive = freshArchive(dir);

  const record = archive.archiveRednoteNote({
    id: "n1",
    title: "别太快交出注意力",
    body: "有些关系让你累，是你太快把注意力交出去。",
    tags: ["关系", "注意力", "边界感"],
    coverText: "别太快回应",
    scheduledAt: "2026-05-30T19:00:00+08:00",
    postedAt: "2026-05-30T11:00:00.000Z",
    assets: ["/tmp/cover.png"],
    screenshots: ["/tmp/filled.png", "/tmp/posted.png"],
    source: "daily-plan",
    planDate: "2026-05-30",
  }, { coverProvider: "local" });

  assert.equal(record.id, "rednote:n1");
  assert.equal(record.platform, "rednote");
  assert.equal(record.title, "别太快交出注意力");
  assert.deepEqual(record.tags, ["关系", "注意力", "边界感"]);
  assert.deepEqual(record.assets, ["/tmp/cover.png"]);
  assert.equal(record.coverProvider, "local");
});

test("archiveReport summarizes by platform, source, and local post date", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-archive-"));
  const archive = freshArchive(dir);

  archive.archiveXPost({
    id: "x1",
    text: "x",
    postedAt: "2026-05-30T03:20:00.000Z",
    source: "daily-plan",
    planDate: "2026-05-30",
  });
  archive.archiveRednoteNote({
    id: "n1",
    title: "r",
    body: "body",
    tags: ["生活"],
    coverText: "cover",
    postedAt: "2026-05-30T09:00:00.000Z",
    source: "daily-plan",
    planDate: "2026-05-30",
  });

  const report = archive.archiveReport({ since: "2026-05-30" });

  assert.equal(report.count, 2);
  assert.equal(report.byPlatform.x.count, 1);
  assert.equal(report.byPlatform.rednote.count, 1);
  assert.equal(report.bySource["daily-plan"].count, 2);
  assert.equal(report.byDate["2026-05-30"].count, 2);
});
