"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDraft } = require("../src/draft");

test("createDraft returns realist style text", () => {
  const draft = createDraft({ style: "realist", topic: "自动化" });
  assert.equal(draft.style, "realist");
  assert.equal(draft.topic, "自动化");
  assert.match(draft.text, /自动化/);
  assert.ok(draft.text.length > 20);
});
