"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planDailyPosts } = require("../src/planner");

test("planDailyPosts generates and enqueues posts at random scheduled times", async () => {
  const generatedTopics = [];
  const enqueued = [];
  const result = await planDailyPosts({
    count: 2,
    generate: async (options) => {
      generatedTopics.push(options.topic);
      return `post ${generatedTopics.length}`;
    },
    enqueue: (post) => {
      enqueued.push(post);
      return { id: `p${enqueued.length}`, ...post };
    },
    now: new Date(2026, 4, 29, 0, 0, 0),
    rng: (() => {
      const values = [0, 0.5];
      return () => values.shift();
    })(),
    topic: "自动化",
    windowEnd: "06:00",
    windowStart: "00:00",
  });

  assert.equal(result.posts.length, 2);
  assert.equal(enqueued.length, 2);
  assert.match(generatedTopics[0], /自动化/);
  assert.match(generatedTopics[0], /第 1\/2 条/);
  assert.equal(new Date(enqueued[0].scheduledAt).getHours(), 0);
  assert.equal(new Date(enqueued[1].scheduledAt).getHours(), 3);
  assert.equal(enqueued[0].source, "agent-plan");
  assert.equal(enqueued[0].planDate, "2026-05-29");
});

test("planDailyPosts skips when the same daily plan already exists", async () => {
  let generateCalls = 0;
  const result = await planDailyPosts({
    count: 1,
    enqueue: () => {
      throw new Error("should not enqueue");
    },
    existing: () => [
      {
        source: "agent-plan",
        planDate: "2026-05-29",
        status: "scheduled",
      },
    ],
    generate: async () => {
      generateCalls += 1;
      return "post";
    },
    now: new Date(2026, 4, 29, 0, 0, 0),
    rng: () => 0,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.count, 0);
  assert.equal(generateCalls, 0);
});

test("planDailyPosts does not treat ignored posts as an existing daily plan", async () => {
  let generateCalls = 0;
  const enqueued = [];
  const result = await planDailyPosts({
    count: 1,
    enqueue: (post) => {
      enqueued.push(post);
      return { id: "p1", ...post };
    },
    existing: () => [
      {
        source: "agent-plan",
        planDate: "2026-05-29",
        status: "ignored",
      },
    ],
    generate: async () => {
      generateCalls += 1;
      return "post";
    },
    now: new Date(2026, 4, 29, 0, 0, 0),
    rng: () => 0,
  });

  assert.equal(result.skipped, undefined);
  assert.equal(result.count, 1);
  assert.equal(generateCalls, 1);
  assert.equal(enqueued.length, 1);
});
