"use strict";

const fs = require("node:fs");
const { generatePost, readBundledSkillText } = require("./agent");
const { DEFAULT_ACCOUNT_STRATEGY } = require("./content-strategy");
const { generateContentIntent } = require("./content-intent");
const { analyzeBatchRepetition, assignAngles } = require("./content-quality");
const { generateRednoteNotes } = require("./rednote-content");
const { localPlanDate } = require("./planner");
const { buildDailyRandomSchedule } = require("./schedule");

const DAILY_SOURCE = "daily-plan";
const DEFAULT_THINKING_SKILL = "creator-systems";
const DEFAULT_VOICE_SKILL = "realist-perspective";

const LIFE_TERMS = [
  "关系", "注意力", "睡", "身体", "台阶", "人情", "边界", "精力", "写作", "表达",
  "内耗", "消息", "情绪", "恢复", "节奏", "分寸", "解释", "健康",
];

const TOOL_TERMS = [
  "AI", "工具", "自动化", "效率", "工作流", "模型", "公众号", "一人公司", "创业", "产品",
];

function scoreRednoteSource(text) {
  const value = String(text || "");
  let score = 0;
  for (const term of LIFE_TERMS) {
    if (value.includes(term)) score += 2;
  }
  for (const term of ["今天", "先", "少", "别", "写下", "放下", "晚", "关掉"]) {
    if (value.includes(term)) score += 1;
  }
  for (const term of TOOL_TERMS) {
    if (value.includes(term)) score -= 3;
  }
  return score;
}

function selectRednoteSourcePosts(posts = [], count = 2) {
  return posts
    .map((post, index) => ({ post, index, score: scoreRednoteSource(post && post.text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Number(count || 2))
    .map((item) => item.post);
}

function hasDailyPlan(items = [], planDate) {
  return items.some((item) => (
    item.source === DAILY_SOURCE
    && item.planDate === planDate
    && item.status !== "failed"
    && item.status !== "ignored"
  ));
}

function readSkillText(options = {}, defaultSkill = DEFAULT_THINKING_SKILL) {
  if (options.skillText !== undefined) return String(options.skillText || "").trim();
  if (options.skillPath) return fs.readFileSync(options.skillPath, "utf8").trim();
  return readBundledSkillText(options.skill || defaultSkill, options.skillMaxChars);
}

function buildPostBriefs(intent, count) {
  const base = [
    {
      role: "一个场景",
      material: intent.situation || "一个很具体的日常瞬间",
      pressure: "读者心里那个说不出口的消耗，不急着解释原因。",
      voice: "像刚从这个场景里反应过来，轻一点，别像教学。",
      landing: "落在一个判断或停顿，不给方法。",
      avoidPhrases: ["今天先", "你只需要", "试着", "方法是", "解决方案"],
    },
    {
      role: "一句不好听的判断",
      material: intent.pointOfView || intent.tension,
      pressure: "把关系、精力或自我欺骗里最别扭的地方说破。",
      voice: "冷静、短句、现实一点，但不要故意刻薄。",
      landing: "落在判断，不要转成安慰或鸡汤。",
      avoidPhrases: ["不是X，而是Y", "你以为", "别把", "真正的问题是"],
    },
    {
      role: "一个隐藏代价",
      material: intent.tension || intent.mechanism,
      pressure: "讲这个习惯长期偷走了什么，比如睡眠、注意力、边界、心情。",
      voice: "像提醒自己，也像提醒读者，不要展开成论文。",
      landing: "落在代价或边界，不急着给解法。",
      avoidPhrases: ["今晚只做一件事", "先", "建议你", "可以从"],
    },
    {
      role: "一点边界感",
      material: intent.mechanism || intent.pointOfView,
      pressure: "指出什么不该继续付出、解释、证明或消耗。",
      voice: "平静一点，像把台阶递出去，但手不再伸太长。",
      landing: "落在边界感，不要变成步骤。",
      avoidPhrases: ["先把", "不要", "很多人", "你要学会"],
    },
    {
      role: "一点余味",
      material: intent.audience || intent.situation,
      pressure: "像当天最后想留下的一句话，有没说完的感觉。",
      voice: "更轻、更慢，可以像自言自语。",
      landing: "落在停顿、反问或一句朴素判断。",
      avoidPhrases: ["总结一下", "所以", "最后", "真正值得"],
    },
  ];

  return Array.from({ length: count }, (_, index) => base[index % base.length]);
}

function intentTopic(intent, index, count, strategyText, angle, brief) {
  return [
    "账号方向：成年人清醒生活 + 内容创作者的自我管理。",
    "",
    "今日 content intent：",
    `受众：${intent.audience}`,
    `场景：${intent.situation}`,
    `张力：${intent.tension}`,
    `观点：${intent.pointOfView}`,
    intent.mechanism ? `机制：${intent.mechanism}` : "",
    intent.practice ? `可选微实践：${intent.practice}` : "",
    `内容角度：${angle}`,
    "角度规则：不要为了闭环而给建议；micro practice 也只是可以轻轻带到生活细节，不强制写成步骤化建议。",
    intent.avoidWords && intent.avoidWords.length ? `避免重复词：${intent.avoidWords.join("、")}` : "",
    "",
    "策略摘要：",
    strategyText,
    "",
    `这是今日第 ${index + 1}/${count} 条 X，必须和同一天其他帖不重复。`,
    brief ? [
      "本条 brief：",
      `角色：${brief.role || ""}`,
      `材料：${brief.material || ""}`,
      `不对劲：${brief.pressure || ""}`,
      `语气：${brief.voice || ""}`,
      `落点：${brief.landing || ""}`,
      brief.avoidPhrases && brief.avoidPhrases.length ? `禁区：${brief.avoidPhrases.join("；")}` : "",
    ].filter(Boolean).join("\n") : "",
  ].filter(Boolean).join("\n");
}

function resolveNumber(value, fallback) {
  return Number(value ?? fallback);
}

function dryRunPost(post, index) {
  const now = new Date().toISOString();
  return {
    id: `dry-post-${index + 1}`,
    ...post,
    status: "dry-run",
    attempts: 0,
    screenshots: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    postedAt: null,
  };
}

function dryRunNote(note, index) {
  const now = new Date().toISOString();
  return {
    id: `dry-note-${index + 1}`,
    ...note,
    status: "dry-run",
    attempts: 0,
    screenshots: [],
    assets: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    draftedAt: null,
    postedAt: null,
  };
}

function dailyAngles(intentAngles, count) {
  const desiredCount = Number(count || 5);
  const assigned = assignAngles(intentAngles, desiredCount);
  if (assigned.length >= desiredCount) return assigned;

  const baseAngles = assigned.length ? assigned : assignAngles([], Math.min(desiredCount, 5));
  const angles = assigned.slice();
  while (angles.length < desiredCount) {
    const baseIndex = angles.length % baseAngles.length;
    const variantNumber = Math.floor(angles.length / baseAngles.length) + 1;
    angles.push(`${baseAngles[baseIndex]} variant ${variantNumber}`);
  }
  return angles;
}

async function planDailyContent(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const count = resolveNumber(options.count, 5);
  const rednoteCount = resolveNumber(options.rednoteCount ?? options.rednote_count, 2);
  let dryPostCount = 0;
  let dryNoteCount = 0;
  const enqueuePost = dryRun
    ? (post) => dryRunPost(post, dryPostCount++)
    : options.enqueuePost;
  const enqueueNote = dryRun
    ? (note) => dryRunNote(note, dryNoteCount++)
    : options.enqueueNote;
  if (typeof enqueuePost !== "function") throw new Error("enqueuePost function is required");
  if (typeof enqueueNote !== "function") throw new Error("enqueueNote function is required");

  const xTimes = buildDailyRandomSchedule({
    count,
    minLeadMinutes: options.minLeadMinutes || options.xMinLeadMinutes,
    now: options.now,
    rng: options.rng,
    windowEnd: options.xWindowEnd || "23:00",
    windowStart: options.xWindowStart || "10:00",
  });
  const planDate = localPlanDate(xTimes[0]);
  const existingPosts = dryRun ? [] : (typeof options.existingPosts === "function" ? options.existingPosts() : []);
  const existingNotes = dryRun ? [] : (typeof options.existingNotes === "function" ? options.existingNotes() : []);
  if (hasDailyPlan(existingPosts, planDate) || hasDailyPlan(existingNotes, planDate)) {
    return {
      ok: true,
      count: 0,
      rednoteCount: 0,
      planDate,
      skipped: true,
      posts: [],
      notes: [],
    };
  }

  const thinkingSkill = options.thinkingSkill || options.intentSkill || DEFAULT_THINKING_SKILL;
  const thinkingSkillText = readSkillText({
    skill: thinkingSkill,
    skillMaxChars: options.skillMaxChars,
    skillPath: options.thinkingSkillPath || options.intentSkillPath,
    skillText: options.thinkingSkillText || options.intentSkillText,
  }, DEFAULT_THINKING_SKILL);
  const xSkill = options.xSkill || options.voiceSkill || options.skill || DEFAULT_VOICE_SKILL;
  const xSkillText = readSkillText({
    skill: xSkill,
    skillMaxChars: options.skillMaxChars,
    skillPath: options.xSkillPath || options.voiceSkillPath || options.skillPath,
    skillText: options.xSkillText || options.voiceSkillText || options.skillText,
  }, DEFAULT_VOICE_SKILL);
  const rednoteSkill = options.rednoteSkill || xSkill;
  const rednoteSkillText = readSkillText({
    skill: rednoteSkill,
    skillMaxChars: options.skillMaxChars,
    skillPath: options.rednoteSkillPath || options.xSkillPath || options.voiceSkillPath || options.skillPath,
    skillText: options.rednoteSkillText || options.xSkillText || options.voiceSkillText || options.skillText,
  }, DEFAULT_VOICE_SKILL);
  const strategyText = String(options.strategyText || DEFAULT_ACCOUNT_STRATEGY).trim();
  const generateIntent = options.generateIntent || ((intentOptions) => generateContentIntent(intentOptions));
  const intent = await generateIntent({
    apiTimeoutMs: options.apiTimeoutMs,
    authCode: options.authCode,
    codexBin: options.codexBin,
    codexModel: options.codexModel,
    codexProfile: options.codexProfile,
    endpoint: options.endpoint,
    fallbackModels: options.fallbackModels,
    generator: options.generator,
    model: options.model,
    skillText: thinkingSkillText,
    strategyText,
    temperature: options.intentTemperature || options.temperature,
  });

  const angles = dailyAngles(intent.angles, count);
  const generateXPost = options.generatePost || ((postOptions) => generatePost(postOptions));
  const postBriefs = buildPostBriefs(intent, count);
  const generatedPosts = await Promise.all(xTimes.map(async (time, index) => {
    const angle = angles[index] || angles[angles.length - 1];
    const brief = postBriefs[index];
    const text = await generateXPost({
      apiTimeoutMs: options.apiTimeoutMs,
      authCode: options.authCode,
      codexBin: options.codexBin,
      codexModel: options.codexModel,
      codexProfile: options.codexProfile,
      endpoint: options.endpoint,
      brief,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      index,
      intent,
      maxChars: options.maxChars,
      maxWeightedChars: options.maxWeightedChars,
      model: options.model,
      skill: xSkill,
      skillText: xSkillText,
      temperature: options.temperature,
      topic: intentTopic(intent, index, count, strategyText, angle, brief),
    });
    return { contentAngle: angle, scheduledAt: time.toISOString(), text };
  }));
  const quality = analyzeBatchRepetition(generatedPosts, { practice: intent.practice });

  let sourceTexts = [];
  let generatedNotes = [];
  let rednoteTimes = [];
  if (rednoteCount > 0) {
    const sourcePosts = selectRednoteSourcePosts(generatedPosts.map((item) => ({ text: item.text })), rednoteCount);
    sourceTexts = sourcePosts.map((item) => item.text);
    rednoteTimes = buildDailyRandomSchedule({
      count: rednoteCount,
      minLeadMinutes: options.rednoteMinLeadMinutes || options.minLeadMinutes,
      now: options.now,
      rng: options.rng,
      windowEnd: options.rednoteWindowEnd || "21:30",
      windowStart: options.rednoteWindowStart || "11:00",
    });

    const generateNotes = options.generateRednoteNotes || ((noteOptions) => generateRednoteNotes(noteOptions));
    generatedNotes = await generateNotes({
      apiTimeoutMs: options.apiTimeoutMs,
      authCode: options.authCode,
      codexBin: options.codexBin,
      codexModel: options.codexModel,
      codexProfile: options.codexProfile,
      count: rednoteCount,
      endpoint: options.endpoint,
      fallbackModels: options.fallbackModels,
      generator: options.generator,
      intent,
      model: options.model,
      noteRoles: [
        {
          role: "收藏型",
          focus: "写成更适合收藏和回看的生活便签。",
          opening: "先给标题和一个稳定判断。",
        },
        {
          role: "生活型",
          focus: "把观点落到一个具体生活细节里，不写成步骤教程。",
          opening: "从一个日常细节开始，再轻轻收住。",
        },
      ],
      skill: rednoteSkill,
      skillText: rednoteSkillText,
      sourceTexts,
      strategyText,
      temperature: options.rednoteTemperature || options.temperature,
      topic: intent.pointOfView,
    });
  }

  const posts = generatedPosts.map((item) => {
    const post = enqueuePost({
      contentAngle: item.contentAngle,
      contentIntent: intent,
      planDate,
      scheduledAt: item.scheduledAt,
      source: DAILY_SOURCE,
      text: item.text,
    });
    return { scheduledAt: item.scheduledAt, text: item.text, post };
  });
  const notes = generatedNotes.map((note, index) => rednoteTimes[index] && enqueueNote({
    ...note,
    contentIntent: intent,
    planDate,
    scheduledAt: rednoteTimes[index].toISOString(),
    source: DAILY_SOURCE,
    sourceTexts,
  })).filter(Boolean);

  return {
    ok: true,
    count: posts.length,
    angles,
    dryRun,
    intent,
    quality,
    planDate,
    posts,
    rednoteCount: notes.length,
    rednoteSourceTexts: sourceTexts,
    notes,
  };
}

module.exports = {
  DAILY_SOURCE,
  DEFAULT_THINKING_SKILL,
  DEFAULT_VOICE_SKILL,
  intentTopic,
  planDailyContent,
  scoreRednoteSource,
  selectRednoteSourcePosts,
};
