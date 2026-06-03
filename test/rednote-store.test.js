"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshStore(dir) {
  process.env.XPOST_HOME = dir;
  delete require.cache[require.resolve("../src/rednote-store")];
  return require("../src/rednote-store");
}

test("rednote store enqueues notes into a separate queue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const note = store.enqueueNote({
    title: "AI工具越多，越要先想清楚方向",
    body: "工具不是方向盘。",
    tags: ["AI工具", "个人成长"],
    coverText: "工具不是方向盘",
    scheduledAt: "2026-05-29T10:00:00+08:00",
  });

  assert.equal(note.status, "scheduled");
  assert.equal(note.attempts, 0);
  assert.equal(note.postedAt, null);
  assert.equal(note.title, "AI工具越多，越要先想清楚方向");
  assert.equal(store.readQueue().length, 1);
  assert.equal(path.basename(store.queuePath()), "rednote-queue.json");
});

test("rednote store filters due scheduled notes and updates status", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const due = store.enqueueNote({
    title: "due",
    body: "body",
    tags: ["AI"],
    coverText: "cover",
    scheduledAt: "2026-05-29T09:00:00+08:00",
  });
  store.enqueueNote({
    title: "future",
    body: "body",
    tags: ["AI"],
    coverText: "cover",
    scheduledAt: "2026-05-29T12:00:00+08:00",
  });

  const items = store.dueNotes(new Date("2026-05-29T02:00:00.000Z"));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, due.id);

  const updated = store.updateNote(due.id, { status: "drafted", draftedAt: "2026-05-29T02:01:00.000Z" });
  assert.equal(updated.status, "drafted");
  assert.equal(updated.draftedAt, "2026-05-29T02:01:00.000Z");
});

test("rednote store can retry a failed note without losing its content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const note = store.enqueueNote({
    title: "retry",
    body: "body",
    tags: ["AI"],
    coverText: "cover",
    scheduledAt: "2026-05-29T09:00:00+08:00",
  });
  store.updateNote(note.id, {
    status: "failed",
    lastError: "selector changed",
  });

  const retried = store.retryNote(note.id, "2026-05-29T10:00:00+08:00");

  assert.equal(retried.status, "scheduled");
  assert.equal(retried.title, "retry");
  assert.equal(retried.scheduledAt, "2026-05-29T10:00:00+08:00");
  assert.equal(retried.lastError, null);
});

test("rednote store can ignore failed notes without deleting them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const note = store.enqueueNote({
    title: "ignore",
    body: "body",
    tags: ["AI"],
    coverText: "cover",
    scheduledAt: "2026-05-29T09:00:00+08:00",
  });
  store.updateNote(note.id, {
    status: "failed",
    lastError: "old browser failure",
  });

  const ignored = store.ignoreNote(note.id, { reason: "old run" });

  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.title, "ignore");
  assert.equal(ignored.lastError, "old browser failure");
  assert.equal(ignored.ignoredReason, "old run");
  assert.match(ignored.ignoredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.getNote(note.id).status, "ignored");
});

test("rednote store refuses to ignore non-failed notes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const note = store.enqueueNote({
    title: "scheduled",
    body: "body",
    tags: ["AI"],
    coverText: "cover",
    scheduledAt: "2026-05-29T09:00:00+08:00",
  });

  assert.throws(
    () => store.ignoreNote(note.id),
    /Only failed Rednote items can be ignored/,
  );
});

test("rednote store creates screenshot and asset paths under state dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-store-"));
  const store = freshStore(dir);

  const screenshot = store.screenshotPath("abc123", "filled");
  const cover = store.coverPath("abc123");

  assert.match(screenshot, /rednote-screenshots\/abc123-filled-/);
  assert.match(cover, /rednote-assets\/abc123-cover\.png$/);
});
