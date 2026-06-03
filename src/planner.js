"use strict";

const { buildDailyRandomSchedule } = require("./schedule");

function batchTopic(topic, index, count) {
  const base = topic || "random";
  return `${base}\n这是今日第 ${index + 1}/${count} 条，避免和同一天其他帖重复。`;
}

function localPlanDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function planDailyPosts(options = {}) {
  const count = Number(options.count || 5);
  const generate = options.generate;
  const enqueue = options.enqueue;
  if (typeof generate !== "function") throw new Error("generate function is required");
  if (typeof enqueue !== "function") throw new Error("enqueue function is required");

  const times = buildDailyRandomSchedule({
    count,
    minLeadMinutes: options.minLeadMinutes,
    now: options.now,
    rng: options.rng,
    windowEnd: options.windowEnd || "06:00",
    windowStart: options.windowStart || "00:00",
  });
  const planDate = localPlanDate(times[0]);
  const existing = typeof options.existing === "function" ? options.existing() : [];
  const alreadyPlanned = existing.some((post) => (
    post.source === "agent-plan"
    && post.planDate === planDate
    && post.status !== "failed"
    && post.status !== "ignored"
  ));
  if (alreadyPlanned) {
    return {
      ok: true,
      count: 0,
      planDate,
      skipped: true,
      windowEnd: options.windowEnd || "06:00",
      windowStart: options.windowStart || "00:00",
      posts: [],
    };
  }

  const posts = [];
  for (let index = 0; index < times.length; index += 1) {
    const scheduledAt = times[index].toISOString();
    const text = await generate({
      ...options.generateOptions,
      topic: batchTopic(options.topic, index, count),
    });
    const post = enqueue({
      planDate,
      scheduledAt,
      source: "agent-plan",
      text,
    });
    posts.push({ scheduledAt, text, post });
  }

  return {
    ok: true,
    count: posts.length,
    planDate,
    windowEnd: options.windowEnd || "06:00",
    windowStart: options.windowStart || "00:00",
    posts,
  };
}

module.exports = {
  batchTopic,
  localPlanDate,
  planDailyPosts,
};
