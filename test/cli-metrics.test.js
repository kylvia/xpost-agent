"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshCli(home) {
  process.env.XPOST_HOME = home;
  for (const id of ["../src/cli", "../src/archive"]) {
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

function localDate(value = new Date()) {
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

test("metrics-capture skips archive records without URLs instead of reading the current tab", async () => {
  const originalHome = process.env.XPOST_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-cli-metrics-"));
  const logs = captureLog();
  const { main } = freshCli(home);

  try {
    const archive = require("../src/archive");
    archive.archiveXPost({
      id: "x1",
      text: "没有 URL 的旧帖",
      source: "daily-plan",
      planDate: localDate(),
    });

    await main(["metrics-capture", "--days", "2", "--source", "daily-plan", "--json"]);
  } finally {
    logs.restore();
    if (originalHome === undefined) delete process.env.XPOST_HOME;
    else process.env.XPOST_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const result = JSON.parse(logs.output.at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.captured, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /missing url/);
});
