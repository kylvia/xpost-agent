"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshCli(home) {
  process.env.XPOST_HOME = home;
  for (const id of ["../src/cli", "../src/store", "../src/rednote-store"]) {
    delete require.cache[require.resolve(id)];
  }
  return require("../src/cli");
}

function captureLog() {
  const original = console.log;
  const output = [];
  console.log = (value) => output.push(value);
  return {
    output,
    restore: () => {
      console.log = original;
    },
  };
}

test("ignore marks a failed X post ignored without deleting it", async () => {
  const originalHome = process.env.XPOST_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-cli-ignore-"));
  const logs = captureLog();
  const { main } = freshCli(home);

  try {
    await main(["enqueue", "--text", "old post", "--at", "2026-05-29T10:00:00+08:00", "--json"]);
    const store = require("../src/store");
    const post = store.readQueue()[0];
    store.updatePost(post.id, { status: "failed", lastError: "old failure" });

    await main(["ignore", "--id", post.id, "--reason", "old failed run", "--json"]);
  } finally {
    logs.restore();
    if (originalHome === undefined) delete process.env.XPOST_HOME;
    else process.env.XPOST_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const ignored = JSON.parse(logs.output.at(-1));
  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.text, "old post");
  assert.equal(ignored.lastError, "old failure");
  assert.equal(ignored.ignoredReason, "old failed run");
});

test("rednote-ignore marks a failed Rednote item ignored without deleting it", async () => {
  const originalHome = process.env.XPOST_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-cli-ignore-"));
  const logs = captureLog();
  const { main } = freshCli(home);

  try {
    await main([
      "rednote-enqueue",
      "--title",
      "old note",
      "--body",
      "body",
      "--cover-text",
      "cover",
      "--tags",
      "AI",
      "--at",
      "2026-05-29T10:00:00+08:00",
      "--json",
    ]);
    const store = require("../src/rednote-store");
    const note = store.readQueue()[0];
    store.updateNote(note.id, { status: "failed", lastError: "old failure" });

    await main(["rednote-ignore", "--id", note.id, "--reason", "old failed run", "--json"]);
  } finally {
    logs.restore();
    if (originalHome === undefined) delete process.env.XPOST_HOME;
    else process.env.XPOST_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const ignored = JSON.parse(logs.output.at(-1));
  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.title, "old note");
  assert.equal(ignored.lastError, "old failure");
  assert.equal(ignored.ignoredReason, "old failed run");
});
