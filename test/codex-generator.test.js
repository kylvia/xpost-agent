"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  DEFAULT_API_FALLBACK_MODELS,
  apiModelCandidates,
  apiTimeoutMs,
  codexSystemPrompt,
  fetchWithTimeout,
  generateWithFallback,
  isRecoverableApiError,
  runCodexPrompt,
  withApiModelFallback,
} = require("../src/codex-generator");

function withoutEnv(keys, fn) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("codexSystemPrompt forbids file writes and asks for strict output", () => {
  const prompt = codexSystemPrompt("只输出 JSON");

  assert.match(prompt, /本地内容生成器/);
  assert.match(prompt, /不要读写文件/);
  assert.match(prompt, /最终回复只能包含要求的正文或 JSON/);
  assert.match(prompt, /只输出 JSON/);
});

test("runCodexPrompt spawns codex exec and reads the last message file", async () => {
  const calls = [];
  let stdinInput = "";
  const output = await runCodexPrompt("只输出一句话", {
    codexBin: "codex-test",
    codexModel: "gpt-test",
    cwd: "/repo",
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      const outputIndex = args.indexOf("--output-last-message");
      fs.writeFileSync(args[outputIndex + 1], "本地 Codex 输出\n");
      callback(null, "stdout fallback", "");
      return {
        stdin: {
          end(input) {
            stdinInput = input;
          },
        },
      };
    },
  });

  assert.equal(output, "本地 Codex 输出");
  assert.equal(calls[0].command, "codex-test");
  assert.deepEqual(calls[0].args.slice(0, 4), ["exec", "--cd", "/repo", "--sandbox"]);
  assert.ok(calls[0].args.includes("--ephemeral"));
  assert.ok(calls[0].args.includes("--model"));
  assert.ok(calls[0].args.includes("gpt-test"));
  assert.equal(calls[0].args.at(-1), "-");
  assert.match(stdinInput, /只输出一句话/);
});

test("generateWithFallback keeps API and Codex generation modes separate", async () => {
  const apiValue = await generateWithFallback(
    { generator: "api" },
    async () => "api result",
    async () => "codex result",
  );
  const codexValue = await generateWithFallback(
    { generator: "codex" },
    async () => "api result",
    async () => "codex result",
  );

  assert.equal(apiValue, "api result");
  assert.equal(codexValue, "codex result");
});

test("generateWithFallback rejects old auto generator mode", async () => {
  await assert.rejects(
    generateWithFallback(
      { generator: "auto" },
      async () => "api result",
      async () => "codex result",
    ),
    /Use api or codex/,
  );
});

test("apiModelCandidates uses the default API fallback models", () => {
  withoutEnv(["XPOST_FALLBACK_MODELS"], () => {
    assert.deepEqual(apiModelCandidates({ model: "gpt-test" }), [
      "gpt-test",
      ...DEFAULT_API_FALLBACK_MODELS,
    ]);
  });
  assert.deepEqual(apiModelCandidates({ model: "gpt-test", fallbackModels: "claude-test gemini-test" }), [
    "gpt-test",
    "claude-test",
    "gemini-test",
  ]);
  assert.deepEqual(apiModelCandidates({ model: "gpt-test", fallbackModels: "false" }), ["gpt-test"]);
});

test("apiTimeoutMs defaults to a bounded API request timeout", () => {
  withoutEnv(["XPOST_API_TIMEOUT_MS"], () => {
    assert.equal(apiTimeoutMs({}), 60000);
  });
  assert.equal(apiTimeoutMs({ apiTimeoutMs: 0 }), 0);
  assert.equal(apiTimeoutMs({ apiTimeoutMs: 2500 }), 2500);
});

test("fetchWithTimeout aborts slow API requests", async () => {
  let signal = null;

  await assert.rejects(
    fetchWithTimeout("https://example.test", {}, {
      apiTimeoutMs: 1,
      fetch: async (url, init) => new Promise((resolve, reject) => {
        signal = init.signal;
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
    }),
    /timed out/,
  );

  assert.equal(signal.aborted, true);
});

test("withApiModelFallback retries recoverable API failures on fallback models", async () => {
  const calls = [];
  const value = await generateWithFallback(
    { generator: "api" },
    () => withApiModelFallback(
      { model: "primary", fallbackModels: "backup-a backup-b" },
      async (model) => {
        calls.push(model);
        if (model === "primary") throw new Error("API request failed with HTTP 500");
        return `ok:${model}`;
      },
    ),
    async () => "codex result",
  );

  assert.equal(value, "ok:backup-a");
  assert.deepEqual(calls, ["primary", "backup-a"]);
});

test("withApiModelFallback retries model output failures on fallback models", async () => {
  const calls = [];
  const value = await withApiModelFallback(
    { model: "primary", fallbackModels: "backup-a backup-b" },
    async (model) => {
      calls.push(model);
      if (model === "primary") throw new Error("API returned empty post text");
      return `ok:${model}`;
    },
  );

  assert.equal(value, "ok:backup-a");
  assert.deepEqual(calls, ["primary", "backup-a"]);
});

test("withApiModelFallback keeps non-recoverable API failures closed", async () => {
  const calls = [];
  await assert.rejects(
    withApiModelFallback(
      { model: "primary", fallbackModels: "backup-a backup-b" },
      async (model) => {
        calls.push(model);
        throw new Error("API request failed with HTTP 400");
      },
    ),
    /HTTP 400/,
  );
  assert.deepEqual(calls, ["primary"]);
});

test("isRecoverableApiError recognizes server and network failures", () => {
  assert.equal(isRecoverableApiError(new Error("API request failed with HTTP 500")), true);
  assert.equal(isRecoverableApiError(new Error("fetch failed")), true);
  assert.equal(isRecoverableApiError(new Error("API request timed out after 60000ms")), true);
  assert.equal(isRecoverableApiError(new Error("API returned empty post text")), true);
  assert.equal(isRecoverableApiError(new Error("HTTP 400")), false);
});
