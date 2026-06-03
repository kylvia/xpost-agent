"use strict";

const { DEFAULT_MODEL } = require("./agent");
const {
  fetchWithTimeout,
  generateWithFallback,
  runCodexPrompt,
  withApiModelFallback,
} = require("./codex-generator");
const { chatCompletionsEndpoint } = require("./liaobots");
const { DEFAULT_ACCOUNT_STRATEGY } = require("./content-strategy");

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function buildContentIntentPrompt(options = {}) {
  const skillText = String(options.skillText || "").trim();
  const strategyText = String(options.strategyText || DEFAULT_ACCOUNT_STRATEGY).trim();
  const avoidWords = Array.isArray(options.avoidWords) ? options.avoidWords.filter(Boolean) : [];

  return [
    "请为今天的内容批次生成一个 contentIntent，而不是直接写帖子。",
    "",
    "角色分工：",
    "- thinking skill 只作为底层思维引擎：目标、注意力、写作、自我设计、系统化。",
    "- 表层表达必须贴近中文小红书历史数据：成年人生活洞察、关系、睡眠、精力、台阶意识、少内耗。",
    "",
    skillText ? [
      "thinking skill 摘要：",
      "```text",
      skillText,
      "```",
    ].join("\n") : "thinking skill 不可用时，只使用目标、注意力、写作、系统化这些底层逻辑。",
    "",
    "账号策略与历史表现：",
    "```text",
    strategyText,
    "```",
    "",
    avoidWords.length ? `最近要避免重复的高频词：${avoidWords.join("、")}` : "最近没有显式避免词，但不要重复使用模板化标题。",
    "",
    "只输出 JSON，不要 Markdown，不要解释。",
    "JSON 形状必须是：",
    "{\"contentIntent\":{\"audience\":\"...\",\"situation\":\"...\",\"tension\":\"...\",\"pointOfView\":\"...\",\"mechanism\":\"...\",\"practice\":\"...\",\"angles\":[\"...\"],\"avoidWords\":[\"...\"]}}",
    "",
    "字段要求：",
    "- audience：正在遇到这个问题的人。",
    "- situation：具体生活场景，不能是抽象话题。",
    "- tension：他们以为的问题 vs 真正的问题。",
    "- pointOfView：今天要表达的强判断。",
    "- mechanism：真正造成这个问题的心理、注意力或系统机制。",
    "- practice：可选微实践，只在适合时使用，不要让每条内容都像打卡建议。",
    "- angles：今天 5 条 X 的不同切面，优先包含 strong judgment、counterintuitive reframe、mechanism、hidden cost、micro practice。",
    "- avoidWords：今天标题和正文应尽量少重复的 2-5 个词。",
  ].join("\n");
}

function normalizeContentIntent(value) {
  const data = value && value.contentIntent ? value.contentIntent : value;
  const intent = {
    audience: String(data && data.audience || "").trim(),
    situation: String(data && data.situation || "").trim(),
    tension: String(data && data.tension || "").trim(),
    pointOfView: String(data && data.pointOfView || "").trim(),
    mechanism: String(data && data.mechanism || "").trim(),
    practice: String(data && data.practice || "").trim(),
    angles: Array.isArray(data && data.angles)
      ? data.angles.map((angle) => String(angle || "").trim()).filter(Boolean)
      : [],
    avoidWords: Array.isArray(data && data.avoidWords)
      ? data.avoidWords.map((word) => String(word || "").trim()).filter(Boolean)
      : [],
  };

  for (const key of ["audience", "situation", "tension", "pointOfView"]) {
    if (!intent[key]) throw new Error(`contentIntent.${key} is required`);
  }
  return intent;
}

function extractContentIntent(text) {
  const raw = stripFence(text);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse content intent JSON: ${raw.slice(0, 200)}`);
  }
  return normalizeContentIntent(data);
}

function authCode(options = {}) {
  return options.authCode || process.env.XPOST_LIAOBOTS_AUTHCODE || process.env.LIAOBOTS_AUTHCODE || "";
}

async function generateContentIntentFromApi(options = {}) {
  const token = authCode(options);
  if (!token) {
    throw new Error("Missing API auth code. Set XPOST_LIAOBOTS_AUTHCODE or pass --auth-code.");
  }

  return withApiModelFallback({ ...options, defaultModel: DEFAULT_MODEL }, async (model) => {
    const response = await fetchWithTimeout(chatCompletionsEndpoint(options), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildContentIntentPrompt(options) }],
        temperature: options.temperature === undefined ? 0.9 : Number(options.temperature),
        stream: false,
      }),
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
    return extractContentIntent(content || "");
  }, "content intent API generation");
}

async function generateContentIntentFromCodex(options = {}) {
  return extractContentIntent(await runCodexPrompt(buildContentIntentPrompt(options), options));
}

async function generateContentIntent(options = {}) {
  return generateWithFallback(
    options,
    () => generateContentIntentFromApi(options),
    () => generateContentIntentFromCodex(options),
    "content intent generation",
  );
}

module.exports = {
  buildContentIntentPrompt,
  extractContentIntent,
  generateContentIntent,
  generateContentIntentFromCodex,
  normalizeContentIntent,
};
