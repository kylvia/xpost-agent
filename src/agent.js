"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  fetchWithTimeout,
  generateWithFallback,
  runCodexPrompt,
  withApiModelFallback,
} = require("./codex-generator");
const { chatCompletionsEndpoint, DEFAULT_ENDPOINT } = require("./liaobots");

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_VOICE_SKILL = "realist-perspective";
const DEFAULT_SKILL_MAX_CHARS = 12000;

function bundledSkillPath(skill) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(skill)) return null;
  return path.join(__dirname, "..", "skills", skill, "SKILL.md");
}

function skillSearchPaths(skill, options = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(skill)) return [];
  const homeDir = options.homeDir || os.homedir();
  return [
    bundledSkillPath(skill),
    path.join(homeDir, ".codex", "skills", skill, "SKILL.md"),
    path.join(homeDir, ".agents", "skills", skill, "SKILL.md"),
  ].filter(Boolean);
}

function readBundledSkillText(skill, maxChars = DEFAULT_SKILL_MAX_CHARS, options = {}) {
  const skillPath = skillSearchPaths(skill, options).find((candidate) => fs.existsSync(candidate));
  if (!skillPath) return "";
  const text = fs.readFileSync(skillPath, "utf8").trim();
  const limit = Number(maxChars || DEFAULT_SKILL_MAX_CHARS);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}\n\n[skill truncated]`;
}

function describePostBrief(brief = {}) {
  const lines = [];
  const role = String(brief.role || "").trim();
  const material = String(brief.material || "").trim();
  const pressure = String(brief.pressure || "").trim();
  const voice = String(brief.voice || "").trim();
  const landing = String(brief.landing || "").trim();
  const avoidPhrases = Array.isArray(brief.avoidPhrases) ? brief.avoidPhrases.map((phrase) => String(phrase || "").trim()).filter(Boolean) : [];

  if (role) lines.push(`说话状态：${role}`);
  if (material) lines.push(`可用材料：${material}`);
  if (pressure) lines.push(`不对劲的地方：${pressure}`);
  if (voice) lines.push(`语气：${voice}`);
  if (landing) lines.push(`落点：${landing}`);
  if (avoidPhrases.length) lines.push(`禁区：${avoidPhrases.join("、")}`);
  return lines;
}

function buildPostPrompt(options = {}) {
  const topic = options.topic || "random";
  const skill = options.skill || DEFAULT_VOICE_SKILL;
  const skillText = options.skillText === undefined
    ? readBundledSkillText(skill, options.skillMaxChars)
    : String(options.skillText || "").trim();
  const briefLines = describePostBrief(options.brief);
  return [
    `请使用本地 ${skill} skill 写一条适合发布到 X 的中文单帖。`,
    "",
    skillText ? [
      "本地 skill 内容如下，必须参考其思维框架和表达 DNA：",
      "```text",
      skillText,
      "```",
    ].join("\n") : "本地 skill 内容不可用时，按现实主义、短句、先结论后拆解的风格写。",
    "",
    `话题：${topic}`,
    "",
    "这条只保留一个说话状态，不要同时承担场景、原因、方法和总结。",
    briefLines.length ? [
      "本条松散 brief：",
      "```text",
      briefLines.join("\n"),
      "```",
    ].join("\n") : "",
    "",
    "要求：",
    "- 只输出帖子正文",
    "- 不要 Markdown",
    "- 不要解释生成过程",
    "- 不要标题",
    "- 不要加引号",
    "- 像一个人刚看见一点东西后说出来，不要像在完成内容模板",
    "- 可以只说准一个感受、代价、边界或判断，不必解释完整",
    "- 默认不要给建议，不要用“今天先”“你只需要”“试着”这类教学口吻",
    "- 不要出现 skill、公开帖、不代表某人、免责声明、模仿某人风格等元信息",
    "- 可以有停顿、留白和半句收尾，但不要装腔",
    "- 每 1-2 句换行，段落之间用一个空行",
    "- 控制在 60-120 个中文字符，宁可留白，不要为了完整解释而超长",
  ].join("\n");
}

function buildChatMessages(options = {}) {
  return [
    {
      role: "user",
      content: buildPostPrompt(options),
    },
  ];
}

function buildChatRequest(options = {}) {
  return {
    model: options.model || DEFAULT_MODEL,
    messages: buildChatMessages(options),
    temperature: options.temperature === undefined ? 1 : Number(options.temperature),
    stream: false,
  };
}

function stripFence(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function extractChatCompletionText(data) {
  const content = data
    && data.choices
    && data.choices[0]
    && data.choices[0].message
    && data.choices[0].message.content;
  return stripFence(content || "");
}

function formatPostTextForX(text) {
  const raw = stripFence(text).replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  if (raw.includes("\n")) {
    return raw
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const compact = raw.replace(/\s+/g, " ");
  const sentences = compact.match(/[^。！？!?；;]+[。！？!?；;]?/g);
  if (!sentences || sentences.length <= 1) return compact;
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).join("\n\n");
}

function xPostWeightedLength(text) {
  return [...String(text || "")].reduce((total, char) => {
    const code = char.codePointAt(0);
    return total + (code <= 0x10ff ? 1 : 2);
  }, 0);
}

function authCode(options = {}) {
  return options.authCode || process.env.XPOST_LIAOBOTS_AUTHCODE || process.env.LIAOBOTS_AUTHCODE || "";
}

function containsSkillMetaText(text) {
  return /公开帖|不代表(本人|某人)|免责声明|模仿[^。！？\n]*(风格|语气)|本地\s*skill|\bskill\b|我按[^。！？\n]*(视角|公开帖|提炼)/i.test(String(text || ""));
}

function validateGeneratedPost(text, options = {}, source = "API") {
  if (!text) throw new Error(`${source} returned empty post text`);
  if (containsSkillMetaText(text)) {
    throw new Error(`${source} post contains skill meta text`);
  }
  if (text.length > Number(options.maxChars || 320)) {
    throw new Error(`${source} post is too long: ${text.length} chars`);
  }
  const weightedLength = xPostWeightedLength(text);
  const weightedLimit = Number(options.maxWeightedChars || 260);
  if (weightedLimit && weightedLength > weightedLimit) {
    throw new Error(`${source} post is too long for X: weighted length ${weightedLength}/${weightedLimit}`);
  }
  return text;
}

async function generatePostFromApi(options = {}) {
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
      body: JSON.stringify(buildChatRequest({ ...options, model })),
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

    const text = formatPostTextForX(extractChatCompletionText(data));
    return validateGeneratedPost(text, options, "API");
  }, "post API generation");
}

async function generatePostFromCodex(options = {}) {
  const text = formatPostTextForX(await runCodexPrompt(buildPostPrompt(options), options));
  return validateGeneratedPost(text, options, "Codex");
}

async function generatePost(options = {}) {
  return generateWithFallback(
    options,
    () => generatePostFromApi(options),
    () => generatePostFromCodex(options),
    "post generation",
  );
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_VOICE_SKILL,
  buildChatMessages,
  buildChatRequest,
  buildPostPrompt,
  extractChatCompletionText,
  formatPostTextForX,
  generatePost,
  generatePostFromCodex,
  containsSkillMetaText,
  readBundledSkillText,
  skillSearchPaths,
  xPostWeightedLength,
};
