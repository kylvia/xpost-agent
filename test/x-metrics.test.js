"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalStatusUrl,
  engagementRate,
  engagementTotal,
  metricsFromTexts,
  parseMetricCount,
  statusUrlFromSnapshot,
} = require("../src/x-metrics");

test("parseMetricCount handles localized compact X counts", () => {
  assert.equal(parseMetricCount("1,234 Views"), 1234);
  assert.equal(parseMetricCount("1.2K Likes"), 1200);
  assert.equal(parseMetricCount("2.5M Views"), 2500000);
  assert.equal(parseMetricCount("1.3万 次查看"), 13000);
  assert.equal(parseMetricCount("2亿 浏览"), 200000000);
});

test("metricsFromTexts extracts X engagement labels", () => {
  const metrics = metricsFromTexts([
    "12 Replies. Reply",
    "3 Reposts. Repost",
    "2 Quotes. Quote",
    "45 Likes. Like",
    "4 Bookmarks. Bookmark",
    "1.2K Views. View post analytics",
  ]);

  assert.equal(metrics.replies, 12);
  assert.equal(metrics.reposts, 3);
  assert.equal(metrics.quotes, 2);
  assert.equal(metrics.likes, 45);
  assert.equal(metrics.bookmarks, 4);
  assert.equal(metrics.views, 1200);
  assert.equal(metrics.engagements, 66);
  assert.equal(metrics.engagementRate, 0.055);
  assert.equal(engagementTotal(metrics), 66);
  assert.equal(engagementRate(metrics), 0.055);
});

test("metricsFromTexts extracts Chinese X engagement labels", () => {
  const metrics = metricsFromTexts([
    "7 条回复",
    "5 转发",
    "31 喜欢",
    "2 收藏",
    "1.1万 次查看",
  ]);

  assert.equal(metrics.replies, 7);
  assert.equal(metrics.reposts, 5);
  assert.equal(metrics.likes, 31);
  assert.equal(metrics.bookmarks, 2);
  assert.equal(metrics.views, 11000);
});

test("canonicalStatusUrl normalizes X and Twitter status URLs", () => {
  assert.equal(
    canonicalStatusUrl("https://twitter.com/_example_/status/1234567890?s=20"),
    "https://x.com/_example_/status/1234567890",
  );
  assert.equal(
    statusUrlFromSnapshot({ statusLinks: ["https://x.com/_example_/status/42/photo/1"] }),
    "https://x.com/_example_/status/42",
  );
});
