"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_X_ANGLES,
  analyzeBatchRepetition,
  assignAngles,
  excerpt,
  finalSentence,
} = require("../src/content-quality");

test("assignAngles fills missing angles from defaults", () => {
  assert.deepEqual(assignAngles(["mechanism"], 3), [
    "mechanism",
    "strong judgment",
    "counterintuitive reframe",
  ]);
  assert.equal(DEFAULT_X_ANGLES.length, 5);
});

test("assignAngles treats non-array input as empty", () => {
  assert.deepEqual(assignAngles(null, 2), [
    "strong judgment",
    "counterintuitive reframe",
  ]);
});

test("excerpt trims whitespace and caps text", () => {
  assert.equal(excerpt("  abcdef  ", 4), "abcd...");
});

test("finalSentence returns the last non-empty sentence-like segment", () => {
  assert.equal(finalSentence("第一句。\n\n最后一句。"), "最后一句");
});

test("finalSentence ignores trailing quote punctuation", () => {
  assert.equal(finalSentence("他说：“手机放远。”"), "手机放远");
});

test("analyzeBatchRepetition flags repeated starts and endings", () => {
  const analysis = analyzeBatchRepetition([
    { text: "成年人最该保护的不是时间。今晚只做一件事：手机放远。" },
    { text: "成年人最该保护的不是时间。今晚只做一件事：手机放远。" },
    { text: "关系里太快回应，会让你变被动。先慢十分钟。" },
  ], {
    practice: "手机放远",
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.warnings.some((warning) => warning.type === "duplicate-start"));
  assert.ok(analysis.warnings.some((warning) => warning.type === "duplicate-ending"));
  assert.ok(analysis.warnings.some((warning) => warning.type === "practice-overuse"));
});

test("analyzeBatchRepetition passes distinct posts with no repeated practice", () => {
  const analysis = analyzeBatchRepetition([
    { text: "早起不是自律表演。先把闹钟放远一点。" },
    { text: "表达边界不需要很凶。只说一句我今晚不方便。" },
    { text: "长期关系最怕自动驾驶。今天认真问一个问题。" },
  ], {
    practice: "手机放远",
  });

  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.warnings, []);
  assert.equal(analysis.checked, 3);
});
