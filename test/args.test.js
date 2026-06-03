"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../src/args");

test("parseArgs handles flags and values", () => {
  const args = parseArgs(["--text", "hello", "--json", "--at=tomorrow", "extra"]);
  assert.equal(args.text, "hello");
  assert.equal(args.json, true);
  assert.equal(args.at, "tomorrow");
  assert.deepEqual(args._, ["extra"]);
});
