"use strict";

const {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_VOICE_SKILL,
  readBundledSkillText,
} = require("./agent");
const {
  fetchWithTimeout,
  generateWithFallback,
  runCodexPrompt,
  withApiModelFallback,
} = require("./codex-generator");
const { chatCompletionsEndpoint } = require("./liaobots");

function buildRednotePrompt(options = {}) {
  const count = Number(options.count || 2);
  const topic = options.topic || "random";
  const skill = options.skill || DEFAULT_VOICE_SKILL;
  const skillText = options.skillText === undefined
    ? readBundledSkillText(skill, options.skillMaxChars)
    : String(options.skillText || "").trim();
  const strategyText = String(options.strategyText || "").trim();
  const intent = options.intent || null;
  const sourceTexts = Array.isArray(options.sourceTexts) ? options.sourceTexts : [];
  const noteRoles = Array.isArray(options.noteRoles) ? options.noteRoles : [];
  const sourceBlock = sourceTexts.length
    ? sourceTexts.map((text, index) => `${index + 1}. ${text}`).join("\n")
    : "无现成 X 帖时，从话题直接生成。";
  const intentBlock = intent ? [
    `受众：${intent.audience || ""}`,
    `场景：${intent.situation || ""}`,
    `张力：${intent.tension || ""}`,
    `观点：${intent.pointOfView || ""}`,
    intent.practice ? `可选微实践：${intent.practice}` : "",
    Array.isArray(intent.avoidWords) && intent.avoidWords.length ? `避免重复词：${intent.avoidWords.join("、")}` : "",
  ].filter(Boolean).join("\n") : "无";

  return [
    `请使用本地 ${skill} skill，把同一批观点改写成适合小红书的中文笔记。`,
    "",
    skillText ? [
      "本地 skill 内容如下，必须参考其思维框架和表达 DNA：",
      "```text",
      skillText,
      "```",
    ].join("\n") : "本地 skill 内容不可用时，按清醒、短句、先系统后工具的表达生成。",
    "",
    strategyText ? [
      "账号策略与历史表现：",
      "```text",
      strategyText,
      "```",
      "",
    ].join("\n") : "",
    "今日 content intent：",
    intentBlock,
    "",
    `话题：${topic}`,
    "",
    "可复用的 X 观点：",
    sourceBlock,
    "",
    `请生成 ${count} 条小红书笔记。`,
    "",
    noteRoles.length ? [
      "每条笔记要承担不同角色，不要写成同一种语气。",
      noteRoles.map((role, index) => {
        const lines = [
          `第 ${index + 1} 条角色：${role.role || ""}`,
          role.focus ? `focus：${role.focus}` : "",
          role.opening ? `开头：${role.opening}` : "",
          role.avoidPhrases && role.avoidPhrases.length ? `避开：${role.avoidPhrases.join("、")}` : "",
        ].filter(Boolean);
        return lines.join("\n");
      }).join("\n\n"),
      "",
    ].join("\n") : "",
    "每条笔记必须包含：",
    "- title：20 个中文字符左右，像小红书标题，不要标题党",
    "- body：120-260 个中文字符，短段落，适合收藏",
    "- tags：4-6 个中文标签，不要带 #",
    "- coverText：10-18 个中文字符，适合放在 1:1 封面图中央",
    "",
    "要求：",
    "- 只输出 JSON",
    "- JSON 形状必须是 {\"notes\":[{\"title\":\"...\",\"body\":\"...\",\"tags\":[\"...\"],\"coverText\":\"...\"}]}",
    "- 不要 Markdown",
    "- 不要解释生成过程",
    "- 不要出现 skill、公开帖、不代表某人、免责声明、模仿某人风格等元信息",
    "- 不要包含公开发布、点赞、引流诱导话术",
    "- 不要直译 X，要把观点翻译成中文成年人生活洞察",
    "- 标题和正文尽量少出现 AI、工具、自动化、一人公司、效率系统",
  ].join("\n");
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function cleanTag(tag) {
  return String(tag || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "");
}

function containsSkillMetaText(text) {
  return /公开帖|不代表(本人|某人)|免责声明|模仿[^。！？\n]*(风格|语气)|本地\s*skill|\bskill\b|我按[^。！？\n]*(视角|公开帖|提炼)/i.test(String(text || ""));
}

function normalizeRednoteNote(note) {
  const title = String(note && note.title || "").trim();
  const body = String(note && note.body || "").trim();
  const coverText = String(note && note.coverText || note && note.cover || "").trim();
  const tags = Array.isArray(note && note.tags)
    ? note.tags.map(cleanTag).filter(Boolean)
    : String(note && note.tags || "").split(/[#,，,\s]+/).map(cleanTag).filter(Boolean);

  if (!title) throw new Error("title is required");
  if (!body) throw new Error("body is required");
  if (!coverText) throw new Error("coverText is required");
  if (!tags.length) throw new Error("tags are required");
  if (containsSkillMetaText(`${title}\n${body}\n${coverText}\n${tags.join("\n")}`)) {
    throw new Error("Rednote note contains skill meta text");
  }

  return { title, body, tags, coverText };
}

function extractRednoteNotes(text) {
  const raw = stripFence(text);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse Rednote JSON: ${raw.slice(0, 200)}`);
  }

  const notes = Array.isArray(data) ? data : data.notes;
  if (!Array.isArray(notes)) throw new Error("Rednote JSON must contain a notes array");
  return notes.map(normalizeRednoteNote);
}

function buildRednoteChatRequest(options = {}) {
  return {
    model: options.model || DEFAULT_MODEL,
    messages: [
      {
        role: "user",
        content: buildRednotePrompt(options),
      },
    ],
    temperature: options.temperature === undefined ? 0.9 : Number(options.temperature),
    stream: false,
  };
}

function authCode(options = {}) {
  return options.authCode || process.env.XPOST_LIAOBOTS_AUTHCODE || process.env.LIAOBOTS_AUTHCODE || "";
}

async function generateRednoteNotesFromApi(options = {}) {
  const token = authCode(options);
  if (!token) {
    throw new Error("Missing API auth code. Set XPOST_LIAOBOTS_AUTHCODE or pass --auth-code.");
  }

  const endpoint = chatCompletionsEndpoint(options);
  return withApiModelFallback({ ...options, defaultModel: DEFAULT_MODEL }, async (model) => {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRednoteChatRequest({ ...options, model })),
    }, options);

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (error) {
      throw new Error(`API returned non-JSON response: ${raw.slice(0, 300)}`);
    }

    if (!response.ok) {
      const message = data.error && data.error.message ? `: ${data.error.message}` : "";
      throw new Error(`API request failed with HTTP ${response.status}${message}`);
    }

    const content = data
      && data.choices
      && data.choices[0]
      && data.choices[0].message
      && data.choices[0].message.content;
    const notes = extractRednoteNotes(content || "");
    const expected = Number(options.count || 2);
    return notes.slice(0, expected);
  }, "Rednote API generation");
}

async function generateRednoteNotesFromCodex(options = {}) {
  const notes = extractRednoteNotes(await runCodexPrompt(buildRednotePrompt(options), options));
  const expected = Number(options.count || 2);
  return notes.slice(0, expected);
}

async function generateRednoteNotes(options = {}) {
  return generateWithFallback(
    options,
    () => generateRednoteNotesFromApi(options),
    () => generateRednoteNotesFromCodex(options),
    "Rednote generation",
  );
}

module.exports = {
  buildRednoteChatRequest,
  buildRednotePrompt,
  containsSkillMetaText,
  extractRednoteNotes,
  generateRednoteNotes,
  generateRednoteNotesFromCodex,
  normalizeRednoteNote,
};
