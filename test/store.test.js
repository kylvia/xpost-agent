"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("store enqueues and updates posts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-test-"));
  process.env.XPOST_HOME = dir;

  const store = require("../src/store");
  const post = store.enqueuePost({
    text: "hello",
    scheduledAt: "2026-05-28T23:00:00+08:00",
    contentAngle: "hidden cost",
  });
  assert.equal(post.text, "hello");
  assert.equal(post.contentAngle, "hidden cost");
  assert.equal(store.readQueue().length, 1);

  const updated = store.updatePost(post.id, { status: "posted" });
  assert.equal(updated.status, "posted");
});

test("store retries failed posts without losing content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-test-"));
  process.env.XPOST_HOME = dir;

  const store = require("../src/store");
  const post = store.enqueuePost({ text: "retry me", scheduledAt: "2026-05-28T23:00:00+08:00" });
  store.updatePost(post.id, {
    attempts: 2,
    lastError: "No live X tab available",
    screenshots: ["/tmp/filled.png"],
    status: "failed",
  });

  const retried = store.retryPost(post.id, "2026-05-29T22:05:00+08:00");

  assert.equal(retried.status, "scheduled");
  assert.equal(retried.scheduledAt, "2026-05-29T22:05:00+08:00");
  assert.equal(retried.text, "retry me");
  assert.equal(retried.lastError, null);
  assert.deepEqual(retried.screenshots, []);
});

test("store can ignore failed posts without deleting them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-test-"));
  process.env.XPOST_HOME = dir;

  const store = require("../src/store");
  const post = store.enqueuePost({ text: "ignore me", scheduledAt: "2026-05-28T23:00:00+08:00" });
  store.updatePost(post.id, {
    lastError: "old browser failure",
    status: "failed",
  });

  const ignored = store.ignorePost(post.id, { reason: "old run" });

  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.text, "ignore me");
  assert.equal(ignored.lastError, "old browser failure");
  assert.equal(ignored.ignoredReason, "old run");
  assert.match(ignored.ignoredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.getPost(post.id).status, "ignored");
});

test("store refuses to ignore non-failed posts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-test-"));
  process.env.XPOST_HOME = dir;

  const store = require("../src/store");
  const post = store.enqueuePost({ text: "scheduled", scheduledAt: "2026-05-28T23:00:00+08:00" });

  assert.throws(
    () => store.ignorePost(post.id),
    /Only failed posts can be ignored/,
  );
});

test("store reschedules only unposted posts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-test-"));
  process.env.XPOST_HOME = dir;

  const store = require("../src/store");
  const post = store.enqueuePost({ text: "move me", scheduledAt: "2026-05-28T23:00:00+08:00" });

  const moved = store.reschedulePost(post.id, "2026-05-29T22:05:00+08:00");
  assert.equal(moved.status, "scheduled");
  assert.equal(moved.scheduledAt, "2026-05-29T22:05:00+08:00");

  store.updatePost(post.id, { status: "posted" });
  assert.throws(
    () => store.reschedulePost(post.id, "2026-05-30T22:05:00+08:00"),
    /Cannot reschedule posted post/,
  );
});
