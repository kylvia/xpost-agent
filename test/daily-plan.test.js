"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  planDailyContent,
  selectRednoteSourcePosts,
} = require("../src/daily-plan");

test("selectRednoteSourcePosts favors life-insight posts over tool-heavy posts", () => {
  const posts = [
    { text: "AI 自动化工具会提升效率，但先配置好工作流。" },
    { text: "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回消息。" },
    { text: "睡不好时，很多野心都是假的。先把身体的节奏找回来。" },
  ];

  const selected = selectRednoteSourcePosts(posts, 2);

  assert.deepEqual(selected.map((post) => post.text), [
    "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回消息。",
    "睡不好时，很多野心都是假的。先把身体的节奏找回来。",
  ]);
});

test("planDailyContent generates one intent, queues X posts, and rewrites selected X posts into Rednote notes", async () => {
  const enqueuedPosts = [];
  const enqueuedNotes = [];
  const generatedPosts = [];
  const intentOptionCalls = [];
  const rednoteSourceCalls = [];
  const rednoteOptionCalls = [];
  const rngValues = [0, 0.5, 0.9, 0.25, 0.75];

  const result = await planDailyContent({
    apiTimeoutMs: 20000,
    count: 3,
    enqueueNote: (note) => {
      enqueuedNotes.push(note);
      return { id: `n${enqueuedNotes.length}`, ...note };
    },
    enqueuePost: (post) => {
      enqueuedPosts.push(post);
      return { id: `p${enqueuedPosts.length}`, ...post };
    },
    existingNotes: () => [],
    existingPosts: () => [],
    codexModel: "gpt-test",
    fallbackModels: "claude-test,gemini-test",
    generateIntent: async (options) => {
      intentOptionCalls.push(options);
      return {
        audience: "总是秒回消息的人",
        situation: "关系里急着解释",
        tension: "以为热情能换来安全感，真正问题是太快交出注意力",
        pointOfView: "关系里太快交出注意力会让自己变被动",
        practice: "今天晚十分钟再回一条不急的消息",
        avoidWords: ["成年人"],
      };
    },
    generatePost: async ({ index, apiTimeoutMs, brief, fallbackModels, generator, codexModel }) => {
      generatedPosts.push({ index, apiTimeoutMs, brief, codexModel, fallbackModels, generator });
      assert.ok(brief);
      assert.ok(brief.role);
      assert.ok(brief.material);
      return [
        "AI 自动化工具会提升效率，但先配置好工作流。",
        "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回消息。",
        "睡不好时，很多野心都是假的。先把身体的节奏找回来。",
      ][index];
    },
    generateRednoteNotes: async (options) => {
      rednoteOptionCalls.push(options);
      const { sourceTexts } = options;
      rednoteSourceCalls.push(sourceTexts);
      return [
        {
          title: "别太快交出注意力",
          body: "有些关系让你累，不是因为对方多重要，是你太快把注意力交出去。",
          tags: ["关系", "注意力", "边界感", "生活洞察"],
          coverText: "别太快回应",
        },
        {
          title: "睡不好时别谈自律",
          body: "精力差的时候，很多计划都会变形。先睡觉，再谈努力。",
          tags: ["睡眠", "精力管理", "少内耗", "生活方式"],
          coverText: "先把觉睡好",
        },
      ];
    },
    generator: "codex",
    now: new Date(2026, 4, 29, 9, 0, 0),
    rednoteCount: 2,
    rednoteWindowEnd: "21:30",
    rednoteWindowStart: "11:00",
    rng: () => rngValues.shift(),
    xWindowEnd: "23:00",
    xWindowStart: "10:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.rednoteCount, 2);
  assert.equal(result.planDate, "2026-05-29");
  assert.equal(enqueuedPosts.length, 3);
  assert.equal(enqueuedPosts[0].source, "daily-plan");
  assert.equal(enqueuedPosts[0].planDate, "2026-05-29");
  assert.equal(enqueuedPosts[0].contentIntent.pointOfView, "关系里太快交出注意力会让自己变被动");
  assert.equal(intentOptionCalls[0].generator, "codex");
  assert.equal(intentOptionCalls[0].codexModel, "gpt-test");
  assert.equal(intentOptionCalls[0].fallbackModels, "claude-test,gemini-test");
  assert.equal(intentOptionCalls[0].apiTimeoutMs, 20000);
  assert.equal(generatedPosts[0].brief.role, "一个场景");
  assert.equal(generatedPosts[1].brief.role, "一句不好听的判断");
  assert.equal(generatedPosts[2].brief.role, "一个隐藏代价");
  assert.equal(generatedPosts[0].generator, "codex");
  assert.equal(generatedPosts[0].codexModel, "gpt-test");
  assert.equal(generatedPosts[0].fallbackModels, "claude-test,gemini-test");
  assert.equal(generatedPosts[0].apiTimeoutMs, 20000);
  assert.equal(enqueuedNotes.length, 2);
  assert.equal(enqueuedNotes[0].source, "daily-plan");
  assert.equal(enqueuedNotes[0].planDate, "2026-05-29");
  assert.equal(enqueuedNotes[0].contentIntent.pointOfView, "关系里太快交出注意力会让自己变被动");
  assert.equal(rednoteOptionCalls[0].generator, "codex");
  assert.equal(rednoteOptionCalls[0].codexModel, "gpt-test");
  assert.equal(rednoteOptionCalls[0].fallbackModels, "claude-test,gemini-test");
  assert.equal(rednoteOptionCalls[0].apiTimeoutMs, 20000);
  assert.deepEqual(rednoteOptionCalls[0].noteRoles.map((role) => role.role), ["收藏型", "生活型"]);
  assert.deepEqual(enqueuedNotes[0].sourceTexts, [
    "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回消息。",
    "睡不好时，很多野心都是假的。先把身体的节奏找回来。",
  ]);
  assert.deepEqual(rednoteSourceCalls[0], [
    "关系里太快交出注意力的人，很容易变被动。今天晚十分钟再回消息。",
    "睡不好时，很多野心都是假的。先把身体的节奏找回来。",
  ]);
});

test("planDailyContent passes distinct angles and limits practice endings", async () => {
  const topics = [];
  const enqueuedPosts = [];
  const result = await planDailyContent({
    count: 5,
    enqueueNote: (note) => ({ id: "n1", ...note }),
    enqueuePost: (post) => {
      enqueuedPosts.push(post);
      return { id: `p${enqueuedPosts.length}`, ...post };
    },
    existingNotes: () => [],
    existingPosts: () => [],
    generateIntent: async () => ({
      audience: "睡前还在刷手机的人",
      situation: "明明很累却不肯睡",
      tension: "以为是自律差，真正问题是白天没有留给自己",
      pointOfView: "睡眠不是休息，是重新拿回身体节奏",
      mechanism: "白天注意力被切碎，晚上用刷手机讨回掌控感",
      practice: "睡前写下明天最重要的一件事",
      angles: ["strong judgment", "counterintuitive reframe", "mechanism", "hidden cost", "micro practice"],
      avoidWords: ["自律"],
    }),
    generatePost: async ({ topic, index }) => {
      topics.push(topic);
      return `第${index + 1}条 ${topic.match(/内容角度：(.+)/)[1]}`;
    },
    generateRednoteNotes: async () => [],
    now: new Date(2026, 5, 2, 9, 0, 0),
    rednoteCount: 0,
    rng: () => 0,
  });

  assert.equal(result.count, 5);
  assert.deepEqual(result.angles, [
    "strong judgment",
    "counterintuitive reframe",
    "mechanism",
    "hidden cost",
    "micro practice",
  ]);
  assert.match(topics[0], /内容角度：strong judgment/);
  assert.match(topics[4], /micro practice 也只是可以轻轻带到生活细节/);
  assert.equal(enqueuedPosts[0].contentAngle, "strong judgment");
  assert.equal(enqueuedPosts[4].contentAngle, "micro practice");
  assert.equal(result.quality.checked, 5);
});

test("planDailyContent honors rednoteCount zero without generating Rednote notes", async () => {
  const enqueuedNotes = [];
  const result = await planDailyContent({
    count: 1,
    enqueueNote: (note) => {
      enqueuedNotes.push(note);
      return { id: "n1", ...note };
    },
    enqueuePost: (post) => ({ id: "p1", ...post }),
    existingNotes: () => [],
    existingPosts: () => [],
    generateIntent: async () => ({
      audience: "拖到深夜的人",
      situation: "越累越想刷手机",
      tension: "以为是在放松，其实是在补偿白天失控",
      pointOfView: "睡前刷手机不是休息，是延迟交还身体",
      practice: "把手机放到床够不到的地方",
    }),
    generatePost: async () => "越累越刷，不是自律差，是白天太少属于自己。",
    generateRednoteNotes: async () => {
      throw new Error("should not generate Rednote notes");
    },
    now: new Date(2026, 5, 2, 9, 0, 0),
    rednoteCount: 0,
    rng: () => 0,
  });

  assert.equal(result.rednoteCount, 0);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.rednoteSourceTexts, []);
  assert.deepEqual(enqueuedNotes, []);
});

test("planDailyContent does not enqueue partial batches when later generation fails", async () => {
  const enqueuedPosts = [];
  const enqueuedNotes = [];

  await assert.rejects(
    planDailyContent({
      count: 2,
      enqueueNote: (note) => {
        enqueuedNotes.push(note);
        return { id: "n1", ...note };
      },
      enqueuePost: (post) => {
        enqueuedPosts.push(post);
        return { id: `p${enqueuedPosts.length}`, ...post };
      },
      existingNotes: () => [],
      existingPosts: () => [],
      generateIntent: async () => ({
        audience: "睡前还在刷手机的人",
        situation: "明明很累却不肯睡",
        tension: "以为是自律差，真正问题是白天没有留给自己",
        pointOfView: "睡眠不是休息，是重新拿回身体节奏",
        practice: "白天留十五分钟给自己",
      }),
      generatePost: async ({ index }) => `第${index + 1}条`,
      generateRednoteNotes: async () => {
        throw new Error("Rednote API failed");
      },
      now: new Date(2026, 5, 2, 9, 0, 0),
      rednoteCount: 1,
      rng: () => 0,
    }),
    /Rednote API failed/,
  );

  assert.deepEqual(enqueuedPosts, []);
  assert.deepEqual(enqueuedNotes, []);
});

test("planDailyContent creates deterministic angle variants for batches over five", async () => {
  const enqueuedPosts = [];
  const result = await planDailyContent({
    count: 7,
    enqueueNote: () => {
      throw new Error("should not enqueue note");
    },
    enqueuePost: (post) => {
      enqueuedPosts.push(post);
      return { id: `p${enqueuedPosts.length}`, ...post };
    },
    existingNotes: () => [],
    existingPosts: () => [],
    generateIntent: async () => ({
      audience: "总想多做一点的人",
      situation: "每天都把计划塞满",
      tension: "以为忙就是进步，真正问题是没有主线",
      pointOfView: "精力管理的核心不是塞满，是排序",
      practice: "今天只保留一个最重要任务",
    }),
    generatePost: async ({ index }) => `第${index + 1}条`,
    generateRednoteNotes: async () => {
      throw new Error("should not generate Rednote notes");
    },
    now: new Date(2026, 5, 2, 9, 0, 0),
    rednoteCount: 0,
    rng: () => 0,
  });

  assert.equal(result.count, 7);
  assert.equal(result.angles.length, 7);
  assert.equal(enqueuedPosts.length, 7);
  assert.deepEqual(result.angles, [
    "strong judgment",
    "counterintuitive reframe",
    "mechanism",
    "hidden cost",
    "micro practice",
    "strong judgment variant 2",
    "counterintuitive reframe variant 2",
  ]);
  assert.equal(enqueuedPosts[5].contentAngle, "strong judgment variant 2");
  assert.equal(enqueuedPosts[6].contentAngle, "counterintuitive reframe variant 2");
  assert.notEqual(enqueuedPosts[5].contentAngle, "micro practice");
  assert.notEqual(enqueuedPosts[6].contentAngle, "micro practice");
});

test("planDailyContent skips duplicate daily batches", async () => {
  let generateCalls = 0;
  const result = await planDailyContent({
    enqueueNote: () => {
      throw new Error("should not enqueue note");
    },
    enqueuePost: () => {
      throw new Error("should not enqueue post");
    },
    existingNotes: () => [],
    existingPosts: () => [{
      source: "daily-plan",
      planDate: "2026-05-29",
      status: "scheduled",
    }],
    generateIntent: async () => {
      generateCalls += 1;
      return {};
    },
    now: new Date(2026, 4, 29, 9, 0, 0),
    rng: () => 0,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.count, 0);
  assert.equal(generateCalls, 0);
});

test("planDailyContent does not treat ignored daily batches as active", async () => {
  let generateCalls = 0;
  const enqueuedPosts = [];
  const result = await planDailyContent({
    count: 1,
    enqueueNote: () => {
      throw new Error("should not enqueue note");
    },
    enqueuePost: (post) => {
      enqueuedPosts.push(post);
      return { id: "p1", ...post };
    },
    existingNotes: () => [],
    existingPosts: () => [{
      source: "daily-plan",
      planDate: "2026-05-29",
      status: "ignored",
    }],
    generateIntent: async () => {
      generateCalls += 1;
      return {
        audience: "总在等合适时机的人",
        situation: "想做但迟迟不开始",
        tension: "以为缺计划，其实是害怕第一版很粗糙",
        pointOfView: "开始不是证明自己，是制造反馈",
        practice: "写下一个十分钟能完成的版本",
      };
    },
    generatePost: async () => "先做一个十分钟版本，反馈会比计划诚实。",
    generateRednoteNotes: async () => {
      throw new Error("should not generate Rednote notes");
    },
    now: new Date(2026, 4, 29, 9, 0, 0),
    rednoteCount: 0,
    rng: () => 0,
  });

  assert.equal(result.skipped, undefined);
  assert.equal(result.count, 1);
  assert.equal(generateCalls, 1);
  assert.equal(enqueuedPosts.length, 1);
});

test("planDailyContent dry-run previews without reading or writing queues", async () => {
  const result = await planDailyContent({
    count: 1,
    dryRun: true,
    enqueueNote: () => {
      throw new Error("should not write Rednote queue");
    },
    enqueuePost: () => {
      throw new Error("should not write X queue");
    },
    existingNotes: () => {
      throw new Error("should not read Rednote queue");
    },
    existingPosts: () => {
      throw new Error("should not read X queue");
    },
    generateIntent: async () => ({
      audience: "夜里还在等消息的人",
      situation: "凌晨反复点开聊天框",
      tension: "以为自己在等回复，其实是在把注意力交出去",
      pointOfView: "关系里最累的不是没人回，是你一直不肯收回自己",
      practice: "把聊天框关掉十分钟",
    }),
    generatePost: async () => "有些累，不是消息太少。\n\n是你一直把自己放在别人的回复后面。",
    generateRednoteNotes: async () => [{
      title: "别把自己放在回复后面",
      body: "有些等待会慢慢偷走你的注意力。关系里真正要护住的，是你还能不能回到自己身上。",
      tags: ["关系", "注意力", "边界感", "少内耗"],
      coverText: "先回到自己",
    }],
    now: new Date(2026, 5, 3, 21, 0, 0),
    rednoteCount: 1,
    rng: () => 0,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.count, 1);
  assert.equal(result.rednoteCount, 1);
  assert.equal(result.posts[0].post.id, "dry-post-1");
  assert.equal(result.posts[0].post.status, "dry-run");
  assert.equal(result.notes[0].id, "dry-note-1");
  assert.equal(result.notes[0].status, "dry-run");
});
