"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function stateDir() {
  return process.env.XPOST_HOME || path.join(os.homedir(), ".xpost-agent");
}

function queuePath() {
  return path.join(stateDir(), "queue.json");
}

function screenshotDir() {
  return path.join(stateDir(), "screenshots");
}

function ensureState() {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.mkdirSync(screenshotDir(), { recursive: true });
  if (!fs.existsSync(queuePath())) {
    fs.writeFileSync(queuePath(), "[]\n");
  }
}

function readQueue() {
  ensureState();
  return JSON.parse(fs.readFileSync(queuePath(), "utf8"));
}

function writeQueue(items) {
  ensureState();
  fs.writeFileSync(queuePath(), `${JSON.stringify(items, null, 2)}\n`);
}

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function enqueuePost({ text, scheduledAt, source, planDate, contentIntent, contentAngle }) {
  const now = new Date().toISOString();
  const post = {
    id: id(),
    text,
    scheduledAt: scheduledAt || now,
    status: "scheduled",
    attempts: 0,
    screenshots: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    postedAt: null,
  };
  if (source) post.source = source;
  if (planDate) post.planDate = planDate;
  if (contentIntent) post.contentIntent = contentIntent;
  if (contentAngle) post.contentAngle = contentAngle;
  const queue = readQueue();
  queue.push(post);
  writeQueue(queue);
  return post;
}

function getPost(postId) {
  return readQueue().find((post) => post.id === postId);
}

function updatePost(postId, patch) {
  const queue = readQueue();
  const index = queue.findIndex((post) => post.id === postId);
  if (index === -1) throw new Error(`Post not found: ${postId}`);
  queue[index] = {
    ...queue[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeQueue(queue);
  return queue[index];
}

function retryPost(postId, scheduledAt = new Date().toISOString()) {
  return updatePost(postId, {
    scheduledAt,
    status: "scheduled",
    screenshots: [],
    lastError: null,
    postedAt: null,
  });
}

function ignorePost(postId, options = {}) {
  const post = getPost(postId);
  if (!post) throw new Error(`Post not found: ${postId}`);
  if (post.status !== "failed") {
    throw new Error(`Only failed posts can be ignored: ${postId}`);
  }
  return updatePost(postId, {
    status: "ignored",
    ignoredAt: new Date().toISOString(),
    ignoredReason: options.reason || null,
  });
}

function reschedulePost(postId, scheduledAt) {
  if (!scheduledAt) throw new Error("scheduledAt is required");
  const post = getPost(postId);
  if (!post) throw new Error(`Post not found: ${postId}`);
  if (post.status === "posted") {
    throw new Error(`Cannot reschedule posted post: ${postId}`);
  }
  return updatePost(postId, {
    scheduledAt,
    status: "scheduled",
    lastError: null,
  });
}

function duePosts(now = new Date()) {
  return readQueue().filter((post) => (
    post.status === "scheduled"
    && new Date(post.scheduledAt).getTime() <= now.getTime()
  ));
}

function screenshotPath(postId, phase) {
  ensureState();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(screenshotDir(), `${postId || "manual"}-${phase}-${stamp}.png`);
}

module.exports = {
  duePosts,
  enqueuePost,
  ensureState,
  getPost,
  ignorePost,
  queuePath,
  readQueue,
  reschedulePost,
  retryPost,
  screenshotDir,
  screenshotPath,
  updatePost,
  writeQueue,
};
