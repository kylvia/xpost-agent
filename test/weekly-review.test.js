"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWeeklyReview,
  formatWeeklyReview,
} = require("../src/weekly-review");

test("buildWeeklyReview flags repeated phrases and explicit practice overuse", () => {
  const review = buildWeeklyReview({
    days: 7,
    now: new Date("2026-06-02T12:00:00+08:00"),
    xItems: [
      {
        id: "x1",
        source: "daily-plan",
        planDate: "2026-06-02",
        text: "成年人最该保护的不是时间。今晚只做一件事：手机放远。",
        contentAngle: "micro practice",
        contentIntent: { practice: "手机放远" },
      },
      {
        id: "x2",
        source: "daily-plan",
        planDate: "2026-06-02",
        text: "成年人最该保护的不是时间。今晚只做一件事：手机放远。",
        contentAngle: "micro practice",
        contentIntent: { practice: "手机放远" },
      },
    ],
    rednoteItems: [
      { id: "r1", source: "daily-plan", planDate: "2026-06-02", title: "成年人最该护住的，是睡前那一小时" },
      { id: "r2", source: "daily-plan", planDate: "2026-06-02", title: "成年人最该护住的，是注意力" },
    ],
    archiveItems: [],
  });

  assert.equal(review.ok, true);
  assert.ok(review.repetition.length > 0);
  assert.ok(review.styleRisks.some((item) => /practice|行动|建议/i.test(item)));
  assert.ok(review.nextWeekGuidance.avoidPhrases.includes("今晚只做一件事"));
  assert.match(formatWeeklyReview(review), /weekly-review/);
});

test("buildWeeklyReview analyzes archive-only daily-plan repeated content", () => {
  const review = buildWeeklyReview({
    days: 7,
    now: new Date("2026-06-02T12:00:00+08:00"),
    xItems: [],
    rednoteItems: [],
    archiveItems: [
      {
        id: "a1",
        platform: "x",
        source: "daily-plan",
        planDate: "2026-06-01",
        text: "睡前的注意力修复，不靠鸡血。今晚只做一件事：手机放远。",
      },
      {
        id: "a2",
        platform: "rednote",
        source: "daily-plan",
        planDate: "2026-06-02",
        title: "睡前的注意力修复，从关掉小屏幕开始",
        body: "别再靠意志力硬撑。今晚只做一件事：手机放远。",
      },
    ],
  });

  assert.equal(review.counts.archive, 2);
  assert.ok(review.repetition.some((item) => /睡前的注意力修复|今晚只做一件事/.test(item)));
  assert.ok(review.styleRisks.some((item) => /practice|行动|建议/i.test(item)));
  assert.ok(review.nextWeekGuidance.avoidPhrases.includes("今晚只做一件事"));
});

test("buildWeeklyReview excludes non-daily-plan archive items from counts", () => {
  const review = buildWeeklyReview({
    days: 7,
    now: new Date("2026-06-02T12:00:00+08:00"),
    archiveItems: [
      {
        id: "manual-1",
        platform: "x",
        source: null,
        planDate: "2026-06-02",
        text: "今晚只做一件事：手机放远。",
      },
      {
        id: "manual-2",
        platform: "rednote",
        source: "manual",
        planDate: "2026-06-02",
        title: "今晚只做一件事",
      },
    ],
    rednoteItems: [],
    xItems: [],
  });

  assert.equal(review.counts.archive, 0);
  assert.deepEqual(review.repetition, []);
  assert.deepEqual(review.nextWeekGuidance.avoidPhrases, []);
});

test("buildWeeklyReview ranks archived content by captured engagement metrics", () => {
  const review = buildWeeklyReview({
    days: 7,
    now: new Date("2026-06-03T22:00:00+08:00"),
    xItems: [],
    rednoteItems: [],
    archiveItems: [
      {
        id: "x:low",
        platform: "x",
        source: "daily-plan",
        planDate: "2026-06-03",
        text: "这是一条表现一般的帖子。",
        contentAngle: "micro practice",
        metrics: [{ capturedAt: "2026-06-03T14:00:00+08:00", views: 100, likes: 1, reposts: 0 }],
      },
      {
        id: "x:top",
        platform: "x",
        source: "daily-plan",
        planDate: "2026-06-03",
        text: "有些熬夜不是贪玩，是白天没活成自己。",
        contentAngle: "counterintuitive reframe",
        metrics: [{ capturedAt: "2026-06-03T14:00:00+08:00", views: 900, likes: 20, reposts: 4, replies: 2 }],
      },
    ],
  });

  assert.equal(review.performance.metricSnapshots, 2);
  assert.equal(review.performance.top[0].id, "x:top");
  assert.equal(review.performance.top[0].engagements, 26);
  assert.deepEqual(review.winningAngles, ["counterintuitive reframe", "micro practice"]);
  assert.equal(review.nextWeekGuidance.preferSignals[0].id, "x:top");
  assert.match(formatWeeklyReview(review), /Performance/);
});

test("buildWeeklyReview rejects invalid days", () => {
  for (const days of [0, -1, 1.5, "seven", "", true]) {
    assert.throws(
      () => buildWeeklyReview({ days }),
      /days must be a positive integer/,
    );
  }
});
