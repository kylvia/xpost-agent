"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const relay = require("../src/browser-relay");
const {
  bodyWithTags,
  clickPublishButton,
  publishSucceeded,
} = require("../src/rednote");

test("bodyWithTags appends Xiaohongshu tags once", () => {
  const body = bodyWithTags({
    body: "工具不是方向盘。",
    tags: ["AI工具", "#个人成长", "AI工具"],
  });

  assert.equal(body, "工具不是方向盘。\n\n#AI工具 #个人成长");
});

test("clickPublishButton clicks the exact Xiaohongshu publish action", async () => {
  const originalEvalJs = relay.evalJs;
  const originalClickAt = relay.clickAt;
  let tabIdSeen;
  let expressionSeen;
  let clickAtSeen;

  relay.evalJs = async (expression, tabId) => {
    tabIdSeen = tabId;
    expressionSeen = expression;
    return { ok: true, mode: "coordinate", x: 744.4, y: 574.2 };
  };
  relay.clickAt = async (x, y, tabId) => {
    clickAtSeen = { x, y, tabId };
    return { ok: true, clicked: true };
  };

  try {
    const result = await clickPublishButton("tab-rednote");

    assert.deepEqual(result, {
      ok: true,
      fallback: "xhs-publish-btn-coordinate",
      x: 744.4,
      y: 574.2,
    });
    assert.equal(tabIdSeen, "tab-rednote");
    assert.deepEqual(clickAtSeen, { x: 744.4, y: 574.2, tabId: "tab-rednote" });
    assert.match(expressionSeen, /button, \[role="button"\], div, span/);
    assert.match(expressionSeen, /^\s*\(\(\) =>/);
    assert.match(expressionSeen, /\}\)\(\)\s*$/);
    assert.match(expressionSeen, /xhs-publish-btn/);
    assert.match(expressionSeen, /mode: 'coordinate'/);
    assert.match(expressionSeen, /updated\.width \* 0\.66/);
    assert.match(expressionSeen, /text === '发布'/);
    assert.match(expressionSeen, /sort\(\(a, b\) => b\.rect\.bottom - a\.rect\.bottom\)/);
    assert.doesNotMatch(expressionSeen, /\/发布\/\.test\(text\)/);
  } finally {
    relay.evalJs = originalEvalJs;
    relay.clickAt = originalClickAt;
  }
});

test("clickPublishButton prefers the Xiaohongshu publish custom event", async () => {
  const originalEvalJs = relay.evalJs;
  const originalClickAt = relay.clickAt;
  let expressionSeen;
  let clickAtCalls = 0;

  relay.evalJs = async (expression) => {
    expressionSeen = expression;
    return { ok: true, mode: "xhs-publish-btn-event" };
  };
  relay.clickAt = async () => {
    clickAtCalls += 1;
    return { ok: true, clicked: true };
  };

  try {
    const result = await clickPublishButton("tab-rednote");

    assert.deepEqual(result, { ok: true, mode: "xhs-publish-btn-event" });
    assert.equal(clickAtCalls, 0);
    assert.match(expressionSeen, /host\._onPublish/);
    assert.match(expressionSeen, /host\.shadowRoot \|\| host\._sr/);
    assert.match(expressionSeen, /xhs-publish-btn-shadow-button/);
  } finally {
    relay.evalJs = originalEvalJs;
    relay.clickAt = originalClickAt;
  }
});

test("publishSucceeded rejects editor states where the publish button remains visible", () => {
  assert.equal(publishSucceeded({ hasPublishButton: true, hasFileInput: true }), false);
  assert.equal(publishSucceeded({ hasPublishButton: false, hasFileInput: false }), true);
});

test("publishSucceeded accepts transient and redirected Xiaohongshu success states", () => {
  assert.equal(publishSucceeded({ publishSuccess: true, hasFileInput: true, hasPublishButton: false }), true);
  assert.equal(publishSucceeded({
    hasFileInput: true,
    hasPublishButton: false,
    url: "https://creator.xiaohongshu.com/publish/publish?source=&published=true",
  }), true);
});

test("draftNote still publishes when worker disables draft saving", async () => {
  const rednotePath = require.resolve("../src/rednote");
  const relayPath = require.resolve("../src/browser-relay");
  const storePath = require.resolve("../src/rednote-store");
  const imagePath = require.resolve("../src/rednote-image");
  const originalRednoteModule = require.cache[rednotePath];
  const originalRelayModule = require.cache[relayPath];
  const originalStoreModule = require.cache[storePath];
  const originalImageModule = require.cache[imagePath];
  let publishClicks = 0;

  delete require.cache[rednotePath];
  require.cache[relayPath] = {
    id: relayPath,
    filename: relayPath,
    loaded: true,
    exports: {
      tabs: async () => [{ id: "tab-rednote", url: "https://creator.xiaohongshu.com/publish/publish" }],
      navigate: async () => undefined,
      uploadFile: async () => ({ ok: true }),
      screenshot: async () => undefined,
      clickAt: async () => {
        publishClicks += 1;
        return { ok: true, clicked: true };
      },
      evalJs: async (expression) => {
        if (expression.includes("xhs-publish-btn") && expression.includes("mode: 'coordinate'")) {
          return { ok: true, mode: "coordinate", x: 744, y: 574 };
        }
        if (expression.includes("titleOk")) return { titleOk: true, bodyOk: true };
        if (expression.includes("fields")) return { hasFileInput: true, fields: [] };
        if (expression.includes("autoSavedDraft")) {
          return publishClicks
            ? { hasFileInput: false, hasPublishButton: false }
            : { hasFileInput: true, hasPublishButton: true };
        }
        throw new Error(`Unexpected eval: ${expression.slice(0, 80)}`);
      },
    },
  };
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      coverPath: () => "/tmp/rednote-cover.png",
      screenshotPath: (noteId, phase) => `/tmp/${noteId}-${phase}.png`,
    },
  };
  require.cache[imagePath] = {
    id: imagePath,
    filename: imagePath,
    loaded: true,
    exports: {
      renderRednoteImage: async (note, file) => ({ file, provider: "liao" }),
    },
  };

  try {
    const freshRednote = require("../src/rednote");
    const result = await freshRednote.draftNote(
      { title: "自动化不是偷懒", body: "先把流程想清楚。", tags: [] },
      { noteId: "note-1", publish: true, save: false },
    );

    assert.equal(publishClicks, 1);
    assert.equal(result.posted, true);
    assert.equal(result.postedScreenshot, "/tmp/note-1-posted.png");
  } finally {
    delete require.cache[rednotePath];
    if (originalRednoteModule) require.cache[rednotePath] = originalRednoteModule;
    if (originalRelayModule) require.cache[relayPath] = originalRelayModule;
    else delete require.cache[relayPath];
    if (originalStoreModule) require.cache[storePath] = originalStoreModule;
    else delete require.cache[storePath];
    if (originalImageModule) require.cache[imagePath] = originalImageModule;
    else delete require.cache[imagePath];
  }
});

test("renderCover delegates image provider options to the Rednote image layer", async () => {
  const rednotePath = require.resolve("../src/rednote");
  const imagePath = require.resolve("../src/rednote-image");
  const originalRednoteModule = require.cache[rednotePath];
  const originalImageModule = require.cache[imagePath];
  const calls = [];

  delete require.cache[rednotePath];
  require.cache[imagePath] = {
    id: imagePath,
    filename: imagePath,
    loaded: true,
    exports: {
      renderRednoteImage: async (...args) => {
        calls.push(args);
        return { file: args[1], provider: "liao" };
      },
    },
  };

  try {
    const freshRednote = require("../src/rednote");
    const result = await freshRednote.renderCover(
      { title: "今天的自动化", body: "把文案写进图片里。" },
      "/tmp/rednote-cover.png",
      { provider: "liao", model: "gpt-image-2" },
    );

    assert.deepEqual(result, { file: "/tmp/rednote-cover.png", provider: "liao" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "/tmp/rednote-cover.png");
    assert.deepEqual(calls[0][2], { provider: "liao", model: "gpt-image-2" });
  } finally {
    delete require.cache[rednotePath];
    if (originalRednoteModule) require.cache[rednotePath] = originalRednoteModule;
    if (originalImageModule) require.cache[imagePath] = originalImageModule;
    else delete require.cache[imagePath];
  }
});
