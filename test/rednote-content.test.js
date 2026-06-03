"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRednotePrompt,
  containsSkillMetaText,
  extractRednoteNotes,
  generateRednoteNotes,
  normalizeRednoteNote,
} = require("../src/rednote-content");

test("buildRednotePrompt asks for two Xiaohongshu notes with cover text", () => {
  const prompt = buildRednotePrompt({
    count: 2,
    skill: "realist-perspective",
    skillText: "表达 DNA：短句、清醒、先系统后工具。",
    sourceTexts: ["AI 会放大你的混乱。"],
    noteRoles: [
      { role: "收藏型", focus: "写成更适合收藏和回看的生活便签。", opening: "先给标题和一个稳定判断。" },
      { role: "生活型", focus: "把观点落到一个具体生活细节里。", opening: "从一个日常细节开始。" },
    ],
    topic: "AI 工具",
  });

  assert.match(prompt, /realist-perspective/);
  assert.match(prompt, /短句、清醒/);
  assert.match(prompt, /AI 会放大你的混乱/);
  assert.match(prompt, /小红书/);
  assert.match(prompt, /2 条/);
  assert.match(prompt, /第 1 条角色：收藏型/);
  assert.match(prompt, /第 2 条角色：生活型/);
  assert.match(prompt, /coverText/);
  assert.match(prompt, /只输出 JSON/);
  assert.match(prompt, /不要出现 skill、公开帖、不代表某人/);
});

test("extractRednoteNotes parses fenced JSON and normalizes tags", () => {
  const raw = "```json\n{\"notes\":[{\"title\":\"AI工具越多，越要先想清楚方向\",\"body\":\"工具不是方向盘。\",\"tags\":[\"#AI工具\",\" 个人成长 \"],\"coverText\":\"工具不是方向盘\"}]}\n```";

  const notes = extractRednoteNotes(raw);

  assert.deepEqual(notes, [
    {
      title: "AI工具越多，越要先想清楚方向",
      body: "工具不是方向盘。",
      tags: ["AI工具", "个人成长"],
      coverText: "工具不是方向盘",
    },
  ]);
});

test("normalizeRednoteNote rejects notes missing required fields", () => {
  assert.throws(
    () => normalizeRednoteNote({ title: "只有标题", tags: ["AI"] }),
    /body is required/,
  );
});

test("normalizeRednoteNote rejects skill meta text", () => {
  assert.throws(
    () => normalizeRednoteNote({
      title: "睡前别再清算旧账",
      body: "我按现实视角和你聊，不代表本人。睡前别再清算旧账。",
      tags: ["睡眠"],
      coverText: "别清算旧账",
    }),
    /skill meta text/,
  );
  assert.equal(containsSkillMetaText("普通生活笔记"), false);
});

test("generateRednoteNotes accepts a liao base URL from env", async () => {
  const originalFetch = global.fetch;
  const previousBaseUrl = process.env.XPOST_LIAOBOTS_BASE_URL;
  const calls = [];
  process.env.XPOST_LIAOBOTS_BASE_URL = "https://example.test/v1";
  global.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            notes: [{
              title: "目标先于工具",
              body: "工具会放大方向，也会放大混乱。",
              tags: ["AI工具", "自动化"],
              coverText: "目标先于工具",
            }],
          }),
        },
      }],
    }), { status: 200 });
  };

  try {
    const notes = await generateRednoteNotes({ authCode: "test-token", count: 1, generator: "api" });
    assert.equal(calls[0], "https://example.test/v1/chat/completions");
    assert.equal(notes[0].title, "目标先于工具");
  } finally {
    global.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.XPOST_LIAOBOTS_BASE_URL;
    else process.env.XPOST_LIAOBOTS_BASE_URL = previousBaseUrl;
  }
});
