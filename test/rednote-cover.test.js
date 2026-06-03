"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCoverDataUrl,
  buildCoverHtml,
  buildCoverSvg,
  wrapText,
} = require("../src/rednote-cover");

test("buildCoverHtml escapes text and renders a square note cover", () => {
  const html = buildCoverHtml({
    coverText: "AI <工具> 不是方向盘",
    title: "先想清楚方向",
  });

  assert.match(html, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(html, /AI &lt;工具&gt; 不是方向盘/);
  assert.doesNotMatch(html, /AI <工具>/);
  assert.match(html, /先想清楚方向/);
});

test("buildCoverDataUrl returns an encoded HTML data URL", () => {
  const url = buildCoverDataUrl({ coverText: "工具不是方向盘", title: "AI工具" });

  assert.match(url, /^data:text\/html;charset=utf-8,/);
  assert.match(decodeURIComponent(url), /工具不是方向盘/);
});

test("buildCoverSvg returns a 1080 square SVG with escaped text", () => {
  const svg = buildCoverSvg({
    coverText: "AI <工具>",
    title: "先想清楚方向",
    body: "工具不是方向盘。",
  });

  assert.match(svg, /width="1080"/);
  assert.match(svg, /height="1080"/);
  assert.match(svg, /AI &lt;工具&gt;/);
  assert.doesNotMatch(svg, /AI <工具>/);
});

test("buildCoverSvg writes the note body onto a letter-paper background", () => {
  const svg = buildCoverSvg({
    coverText: "自动化测试",
    title: "小红书自动化发帖测试",
    body: "这是一条本地自动化发帖链路测试。\n\n如果你看到这条笔记，说明端到端链路已经跑通。",
  });

  assert.match(svg, /id="letter-paper"/);
  assert.match(svg, /id="ruled-lines"/);
  assert.match(svg, /这是一条本地自动化发帖链路测试。/);
  assert.match(svg, /如果你看到这条笔记，说明端到端链路已经/);
  assert.match(svg, /跑通。/);
});

test("wrapText chunks unicode text by visible characters", () => {
  assert.deepEqual(wrapText("工具不是方向盘", 3, 3), ["工具不", "是方向", "盘"]);
});
