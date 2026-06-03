"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildContentIntentPrompt,
  extractContentIntent,
  generateContentIntent,
} = require("../src/content-intent");

test("buildContentIntentPrompt uses creator systems as thinking layer and Rednote history as surface strategy", () => {
  const prompt = buildContentIntentPrompt({
    avoidWords: ["成年人", "清醒"],
    skillText: "creator systems skill: goals, focus, writing, systems.",
    strategyText: "高表现方向：台阶意识、关系注意力、睡眠。弱方向：AI工具、自动化。",
  });

  assert.match(prompt, /creator systems skill/);
  assert.match(prompt, /台阶意识/);
  assert.match(prompt, /弱方向：AI工具/);
  assert.match(prompt, /成年人/);
  assert.match(prompt, /contentIntent/);
  assert.match(prompt, /audience/);
  assert.match(prompt, /pointOfView/);
  assert.match(prompt, /mechanism/);
  assert.match(prompt, /practice/);
  assert.match(prompt, /angles/);
  assert.match(prompt, /micro practice/);
});

test("extractContentIntent parses fenced JSON and normalizes required fields", () => {
  const intent = extractContentIntent("```json\n{\"contentIntent\":{\"audience\":\"总是秒回消息的人\",\"situation\":\"关系里急着解释\",\"tension\":\"以为热情能换来安全感，真正问题是太快交出注意力\",\"pointOfView\":\"关系里太快交出注意力会让自己变被动\",\"practice\":\"今天晚十分钟再回一条不急的消息\",\"avoidWords\":[\"成年人\",\"清醒\"]}}\n```");

  assert.deepEqual(intent, {
    audience: "总是秒回消息的人",
    situation: "关系里急着解释",
    tension: "以为热情能换来安全感，真正问题是太快交出注意力",
    pointOfView: "关系里太快交出注意力会让自己变被动",
    mechanism: "",
    practice: "今天晚十分钟再回一条不急的消息",
    angles: [],
    avoidWords: ["成年人", "清醒"],
  });
  assert.equal("action" in intent, false);
});

test("extractContentIntent supports mechanism, practice, and angles", () => {
  const intent = extractContentIntent(JSON.stringify({
    contentIntent: {
      audience: "睡前还在刷手机的人",
      situation: "明明很累却不肯睡",
      tension: "以为是自律差，真正问题是白天没有留给自己",
      pointOfView: "睡眠不是休息，是重新拿回身体节奏",
      mechanism: "白天注意力被切碎，晚上用刷手机讨回掌控感",
      practice: "睡前写下明天最重要的一件事",
      angles: ["strong judgment", "mechanism", "micro practice"],
      avoidWords: ["自律"],
    },
  }));

  assert.equal(intent.mechanism, "白天注意力被切碎，晚上用刷手机讨回掌控感");
  assert.equal(intent.practice, "睡前写下明天最重要的一件事");
  assert.deepEqual(intent.angles, ["strong judgment", "mechanism", "micro practice"]);
});

test("generateContentIntent sends an OpenAI-compatible request and returns the parsed intent", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            contentIntent: {
              audience: "睡前还在刷手机的人",
              situation: "明明很累却不肯睡",
              tension: "以为是自律差，真正问题是白天没有留给自己",
              pointOfView: "睡眠不是休息，是成年人重新拿回身体节奏",
              practice: "今晚提前二十分钟把手机放到桌外",
              avoidWords: ["自律"],
            },
          }),
        },
      }],
    }), { status: 200 });
  };

  try {
    const intent = await generateContentIntent({
      authCode: "test-token",
      endpoint: "https://example.test/v1/chat/completions",
      generator: "api",
      model: "gpt-test",
      skillText: "skill",
      strategyText: "strategy",
    });

    assert.equal(intent.pointOfView, "睡眠不是休息，是成年人重新拿回身体节奏");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
    assert.equal(JSON.parse(calls[0].init.body).model, "gpt-test");
    assert.equal(calls[0].init.headers.authorization, "Bearer test-token");
  } finally {
    global.fetch = originalFetch;
  }
});
