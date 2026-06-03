"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildChatMessages,
  buildChatRequest,
  buildPostPrompt,
  containsSkillMetaText,
  extractChatCompletionText,
  formatPostTextForX,
  generatePost,
  readBundledSkillText,
  xPostWeightedLength,
} = require("../src/agent");

test("buildPostPrompt asks for one realist-style X post only", () => {
  const prompt = buildPostPrompt({
    skill: "realist-perspective",
    skillText: "表达 DNA：短句、先结论、看现金流和边界。",
    topic: "本地自动化",
    brief: {
      role: "一个场景",
      material: "一个夜里还在回消息的人",
      pressure: "那种说不清的累",
      voice: "像刚从场景里反应过来",
      landing: "落在判断，不给方法",
    },
  });

  assert.match(prompt, /realist-perspective/);
  assert.match(prompt, /看现金流和边界/);
  assert.match(prompt, /本地自动化/);
  assert.match(prompt, /说话状态：一个场景/);
  assert.match(prompt, /可用材料：一个夜里还在回消息的人/);
  assert.match(prompt, /落点：落在判断，不给方法/);
  assert.match(prompt, /只输出帖子正文/);
  assert.match(prompt, /不要 Markdown/);
  assert.match(prompt, /不要像在完成内容模板/);
  assert.match(prompt, /不要出现 skill、公开帖、不代表某人/);
  assert.match(prompt, /段落之间用一个空行/);
  assert.match(prompt, /60-120 个中文字符/);
});

test("readBundledSkillText can load local private skills by name", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-skill-home-"));
  const skillDir = path.join(homeDir, ".codex", "skills", "private-voice");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "local private voice", "utf8");

  assert.equal(
    readBundledSkillText("private-voice", 1000, { homeDir }),
    "local private voice",
  );
});

test("formatPostTextForX adds blank-line pacing between Chinese sentences", () => {
  const text = "写作最现实的价值不是涨粉。是逼你看清自己到底有没有想法。你无法卖出一个模糊的大脑。先把问题写清楚，再把解决方案变成产品。";

  assert.equal(formatPostTextForX(text), [
    "写作最现实的价值不是涨粉。",
    "",
    "是逼你看清自己到底有没有想法。",
    "",
    "你无法卖出一个模糊的大脑。",
    "",
    "先把问题写清楚，再把解决方案变成产品。",
  ].join("\n"));
});

test("formatPostTextForX preserves intentional multiline posts", () => {
  const text = "第一句。\n\n第二句。";

  assert.equal(formatPostTextForX(text), text);
});

test("buildChatMessages creates an OpenAI-compatible user message", () => {
  const messages = buildChatMessages({ topic: "现金流" });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /现金流/);
});

test("buildChatRequest uses the liaobots chat completions defaults", () => {
  const request = buildChatRequest({ topic: "自动化" });

  assert.equal(request.model, "claude-opus-4-8");
  assert.equal(request.temperature, 1);
  assert.equal(request.stream, false);
  assert.equal(request.messages[0].role, "user");
});

test("extractChatCompletionText handles OpenAI-compatible responses and fences", () => {
  const response = {
    choices: [
      {
        message: {
          content: "```text\nhello\n```",
        },
      },
    ],
  };

  assert.equal(extractChatCompletionText(response), "hello");
});

test("generatePost sends an OpenAI-compatible request with bearer auth", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "一条本地自动化帖子",
          },
        },
      ],
    }), { status: 200 });
  };

  try {
    const text = await generatePost({
      authCode: "test-token",
      endpoint: "https://example.test/v1/chat/completions",
      generator: "api",
      maxChars: 30,
      model: "gpt-test",
      temperature: 0.8,
      topic: "本地自动化",
    });

    assert.equal(text, "一条本地自动化帖子");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "Bearer test-token");
    assert.equal(calls[0].init.headers["content-type"], "application/json");

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "gpt-test");
    assert.equal(body.temperature, 0.8);
    assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /本地自动化/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generatePost retries recoverable API failures with fallback models", async () => {
  const originalFetch = global.fetch;
  const models = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    models.push(body.model);
    if (body.model === "primary-model") {
      return new Response(JSON.stringify({ error: { message: "temporary upstream failure" } }), { status: 500 });
    }
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "备用模型生成的帖子",
          },
        },
      ],
    }), { status: 200 });
  };

  try {
    const text = await generatePost({
      authCode: "test-token",
      endpoint: "https://example.test/v1/chat/completions",
      fallbackModels: "backup-model",
      generator: "api",
      maxChars: 30,
      model: "primary-model",
    });

    assert.equal(text, "备用模型生成的帖子");
    assert.deepEqual(models, ["primary-model", "backup-model"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generatePost formats plain one-paragraph API output for X pacing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: "第一句。第二句。第三句。",
        },
      },
    ],
  }), { status: 200 });

  try {
    const text = await generatePost({
      authCode: "test-token",
      endpoint: "https://example.test/v1/chat/completions",
      generator: "api",
      maxChars: 30,
    });

    assert.equal(text, "第一句。\n\n第二句。\n\n第三句。");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generatePost accepts a liao base URL from env", async () => {
  const originalFetch = global.fetch;
  const previousBaseUrl = process.env.XPOST_LIAOBOTS_BASE_URL;
  const calls = [];
  process.env.XPOST_LIAOBOTS_BASE_URL = "https://example.test/v1";
  global.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "一条帖子" } }],
    }), { status: 200 });
  };

  try {
    await generatePost({ authCode: "test-token", generator: "api", maxChars: 30 });
    assert.equal(calls[0], "https://example.test/v1/chat/completions");
  } finally {
    global.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.XPOST_LIAOBOTS_BASE_URL;
    else process.env.XPOST_LIAOBOTS_BASE_URL = previousBaseUrl;
  }
});

test("generatePost retries when a model leaks skill meta text", async () => {
  const originalFetch = global.fetch;
  const models = [];
  global.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    models.push(model);
    return new Response(JSON.stringify({
      choices: [{ message: { content: model === "primary-model" ? "我按现实视角和你聊，不代表本人。\n\n这是一条坏文案。" : "这是一条正常文案。" } }],
    }), { status: 200 });
  };

  try {
    const text = await generatePost({
      authCode: "test-token",
      endpoint: "https://example.test/v1/chat/completions",
      fallbackModels: "backup-model",
      generator: "api",
      model: "primary-model",
    });

    assert.equal(text, "这是一条正常文案。");
    assert.deepEqual(models, ["primary-model", "backup-model"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("containsSkillMetaText detects perspective disclaimers", () => {
  assert.equal(containsSkillMetaText("我按现实视角和你聊，不代表本人。"), true);
  assert.equal(containsSkillMetaText("深夜不睡，是白天没活成自己。"), false);
});

test("xPostWeightedLength counts CJK text as two X characters", () => {
  assert.equal(xPostWeightedLength("abc"), 3);
  assert.equal(xPostWeightedLength("你好"), 4);
  assert.equal(xPostWeightedLength("AI 你好"), 7);
});

test("generatePost rejects posts over the X weighted length limit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: "这是一条明显过长的中文帖子",
        },
      },
    ],
  }), { status: 200 });

  try {
    await assert.rejects(
      generatePost({
        authCode: "test-token",
        endpoint: "https://example.test/v1/chat/completions",
        generator: "api",
        maxChars: 100,
        maxWeightedChars: 10,
      }),
      /weighted length/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
