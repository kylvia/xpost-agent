"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildLiaoImagePrompt,
  buildLiaoImageRequest,
  extractImageUrl,
  generateLiaoImage,
} = require("../src/rednote-image");

test("buildLiaoImagePrompt asks for a letter-paper Xiaohongshu image with body copy", () => {
  const prompt = buildLiaoImagePrompt({
    title: "小红书自动化发帖测试",
    body: "这是一条本地自动化发帖链路测试。",
    tags: ["自动化", "AI工具"],
  });

  assert.match(prompt, /1:1/);
  assert.match(prompt, /信纸/);
  assert.match(prompt, /小红书自动化发帖测试/);
  assert.match(prompt, /这是一条本地自动化发帖链路测试。/);
  assert.match(prompt, /不要添加真实品牌 logo/);
});

test("buildLiaoImageRequest targets gpt-image-2 through chat completions", () => {
  const request = buildLiaoImageRequest({
    title: "标题",
    body: "正文",
  });

  assert.equal(request.model, "gpt-image-2");
  assert.equal(request.temperature, 1);
  assert.equal(request.stream, false);
  assert.equal(request.messages[0].role, "user");
  assert.match(request.messages[0].content, /标题/);
});

test("extractImageUrl handles common chat-completions image shapes", () => {
  assert.equal(extractImageUrl({
    choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,abc" } }] } }],
  }), "data:image/png;base64,abc");

  assert.equal(extractImageUrl({
    choices: [{ message: { images: [{ url: "https://example.test/image.png" }] } }],
  }), "https://example.test/image.png");

  assert.equal(extractImageUrl({
    choices: [{ message: { content: "data:image/png;base64,def" } }],
  }), "data:image/png;base64,def");

  assert.equal(extractImageUrl({
    choices: [{ message: { content: [{ type: "image_url", image_url: { url: "https://example.test/part.png" } }] } }],
  }), "https://example.test/part.png");

  assert.equal(extractImageUrl({
    choices: [{ message: { content: "生成完成：![image](https://example.test/markdown.png)" } }],
  }), "https://example.test/markdown.png");
});

test("generateLiaoImage writes a base64 data URL response to disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-image-"));
  const file = path.join(dir, "cover.png");
  const png = Buffer.from("fake-png");
  const calls = [];

  await generateLiaoImage({
    title: "标题",
    body: "正文",
  }, file, {
    authCode: "token",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            images: [{ image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }],
          },
        }],
      }), { status: 200 });
    },
  });

  assert.equal(fs.readFileSync(file, "utf8"), "fake-png");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ai.liaobots1.work/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer token");
  assert.equal(JSON.parse(calls[0].init.body).model, "gpt-image-2");
});

test("generateLiaoImage accepts a liao base URL from env", async () => {
  const previousBaseUrl = process.env.XPOST_LIAOBOTS_BASE_URL;
  const previousImageEndpoint = process.env.XPOST_LIAOBOTS_IMAGE_ENDPOINT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rednote-image-"));
  const file = path.join(dir, "cover.png");
  const calls = [];

  process.env.XPOST_LIAOBOTS_BASE_URL = "https://example.test/v1";
  delete process.env.XPOST_LIAOBOTS_IMAGE_ENDPOINT;

  try {
    await generateLiaoImage({ title: "标题", body: "正文" }, file, {
      authCode: "token",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({
          choices: [{ message: { content: "data:image/png;base64,ZmFrZS1wbmc=" } }],
        }), { status: 200 });
      },
    });

    assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  } finally {
    if (previousBaseUrl === undefined) delete process.env.XPOST_LIAOBOTS_BASE_URL;
    else process.env.XPOST_LIAOBOTS_BASE_URL = previousBaseUrl;
    if (previousImageEndpoint === undefined) delete process.env.XPOST_LIAOBOTS_IMAGE_ENDPOINT;
    else process.env.XPOST_LIAOBOTS_IMAGE_ENDPOINT = previousImageEndpoint;
  }
});
