"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accountMatches,
  normalizeHandle,
  postButtonTextMatches,
  shouldDiscardStaleDraft,
} = require("../src/x");

test("normalizeHandle accepts plain handles, @ handles, and X profile URLs", () => {
  assert.equal(normalizeHandle("_example_"), "_example_");
  assert.equal(normalizeHandle("@_example_"), "_example_");
  assert.equal(normalizeHandle("https://x.com/_example_?s=21"), "_example_");
});

test("accountMatches compares handles case-insensitively", () => {
  assert.equal(accountMatches({ handle: "_example_" }, "https://x.com/_example_"), true);
  assert.equal(accountMatches({ handle: "hh_todd" }, "_example_"), false);
});

test("postButtonTextMatches accepts bilingual X post button labels", () => {
  assert.equal(postButtonTextMatches("Post"), true);
  assert.equal(postButtonTextMatches("发帖"), true);
  assert.equal(postButtonTextMatches("帖子"), true);
  assert.equal(postButtonTextMatches("Post\n帖子"), true);
  assert.equal(postButtonTextMatches("Everyone can reply"), false);
});

test("shouldDiscardStaleDraft detects hidden stale composer state", () => {
  const text = "本地 xpost agent 真实链路已跑通";
  const state = {
    canPost: false,
    hasTextbox: true,
    remainingChars: -684,
    text,
  };

  assert.equal(shouldDiscardStaleDraft(state, text), true);
});

test("shouldDiscardStaleDraft does not discard when text itself is over the limit", () => {
  const text = "x".repeat(500);
  const state = {
    canPost: false,
    hasTextbox: true,
    remainingChars: -220,
    text,
  };

  assert.equal(shouldDiscardStaleDraft(state, text), false);
});
