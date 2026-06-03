"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stateDir() {
  return process.env.XPOST_HOME || path.join(os.homedir(), ".xpost-agent");
}

function queuePath() {
  return path.join(stateDir(), "rednote-queue.json");
}

function screenshotDir() {
  return path.join(stateDir(), "rednote-screenshots");
}

function assetDir() {
  return path.join(stateDir(), "rednote-assets");
}

function ensureState() {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.mkdirSync(screenshotDir(), { recursive: true });
  fs.mkdirSync(assetDir(), { recursive: true });
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

function enqueueNote({ title, body, tags, coverText, scheduledAt, source, planDate, contentIntent, sourceTexts }) {
  const now = new Date().toISOString();
  const note = {
    id: id(),
    title,
    body,
    tags: Array.isArray(tags) ? tags : [],
    coverText,
    scheduledAt: scheduledAt || now,
    status: "scheduled",
    attempts: 0,
    screenshots: [],
    assets: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    draftedAt: null,
    postedAt: null,
  };
  if (source) note.source = source;
  if (planDate) note.planDate = planDate;
  if (contentIntent) note.contentIntent = contentIntent;
  if (Array.isArray(sourceTexts) && sourceTexts.length) note.sourceTexts = sourceTexts;

  const queue = readQueue();
  queue.push(note);
  writeQueue(queue);
  return note;
}

function getNote(noteId) {
  return readQueue().find((note) => note.id === noteId);
}

function updateNote(noteId, patch) {
  const queue = readQueue();
  const index = queue.findIndex((note) => note.id === noteId);
  if (index === -1) throw new Error(`Rednote item not found: ${noteId}`);
  queue[index] = {
    ...queue[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeQueue(queue);
  return queue[index];
}

function retryNote(noteId, scheduledAt = new Date().toISOString()) {
  return updateNote(noteId, {
    scheduledAt,
    status: "scheduled",
    lastError: null,
  });
}

function ignoreNote(noteId, options = {}) {
  const note = getNote(noteId);
  if (!note) throw new Error(`Rednote item not found: ${noteId}`);
  if (note.status !== "failed") {
    throw new Error(`Only failed Rednote items can be ignored: ${noteId}`);
  }
  return updateNote(noteId, {
    status: "ignored",
    ignoredAt: new Date().toISOString(),
    ignoredReason: options.reason || null,
  });
}

function dueNotes(now = new Date()) {
  return readQueue().filter((note) => (
    note.status === "scheduled"
    && new Date(note.scheduledAt).getTime() <= now.getTime()
  ));
}

function screenshotPath(noteId, phase) {
  ensureState();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(screenshotDir(), `${noteId || "manual"}-${phase}-${stamp}.png`);
}

function coverPath(noteId) {
  ensureState();
  return path.join(assetDir(), `${noteId || "manual"}-cover.png`);
}

module.exports = {
  assetDir,
  coverPath,
  dueNotes,
  enqueueNote,
  getNote,
  ignoreNote,
  queuePath,
  readQueue,
  retryNote,
  screenshotDir,
  screenshotPath,
  stateDir,
  updateNote,
  writeQueue,
};
