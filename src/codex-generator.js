"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_API_FALLBACK_MODELS = ["gemini-3.1-pro-preview"];

function generationMode(options = {}) {
  return String(options.generator || process.env.XPOST_GENERATOR || "api").trim().toLowerCase();
}

function codexBinary(options = {}) {
  return options.codexBin || process.env.XPOST_CODEX_BIN || "codex";
}

function codexModel(options = {}) {
  return options.codexModel || process.env.XPOST_CODEX_MODEL || "";
}

function codexProfile(options = {}) {
  return options.codexProfile || process.env.XPOST_CODEX_PROFILE || "";
}

function isRecoverableApiError(error) {
  const message = String(error && error.message || error || "");
  return /HTTP 5\d\d|fetch failed|network|socket|ECONN|ETIMEDOUT|UND_ERR|abort|timed out|timeout|returned empty|Failed to parse .*JSON|JSON must contain|too long|is required|skill meta/i.test(message);
}

function splitFallbackModels(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitFallbackModels(item));
  }
  return String(value || "")
    .split(/[,\s]+/)
    .map((model) => model.trim())
    .filter(Boolean);
}

function configuredFallbackModels(options = {}) {
  const value = options.fallbackModels !== undefined
    ? options.fallbackModels
    : process.env.XPOST_FALLBACK_MODELS;
  if (value === undefined) return DEFAULT_API_FALLBACK_MODELS;
  if (value === false) return [];
  const text = Array.isArray(value) ? "" : String(value || "").trim();
  if (!Array.isArray(value) && (!text || /^(0|false|none|off)$/i.test(text))) return [];
  return splitFallbackModels(value);
}

function apiModelCandidates(options = {}, defaultModel = "claude-opus-4-8") {
  const primary = String(options.model || defaultModel || "claude-opus-4-8").trim();
  const models = [primary, ...configuredFallbackModels(options)];
  return [...new Set(models.filter(Boolean))];
}

async function withApiModelFallback(options = {}, generateForModel, label = "API generation") {
  const models = apiModelCandidates(options, options.defaultModel || "claude-opus-4-8");
  let lastRecoverableError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      return await generateForModel(model);
    } catch (error) {
      if (!isRecoverableApiError(error)) throw error;
      lastRecoverableError = error;
      if (index === models.length - 1) break;
    }
  }

  const wrapped = new Error(`${label} failed for all API models (${models.join(", ")}): ${lastRecoverableError.message}`);
  wrapped.cause = lastRecoverableError;
  throw wrapped;
}

function apiTimeoutMs(options = {}) {
  const value = options.apiTimeoutMs !== undefined
    ? options.apiTimeoutMs
    : process.env.XPOST_API_TIMEOUT_MS || 60000;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function fetchWithTimeout(url, init = {}, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const timeoutMs = apiTimeoutMs(options);
  if (!timeoutMs || typeof AbortController === "undefined") {
    return fetchImpl(url, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`API request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function codexSystemPrompt(prompt) {
  return [
    "你是 xpost-agent 的本地内容生成器。",
    "只完成内容生成，不要读写文件，不要运行命令，不要发布，不要解释。",
    "严格遵守用户提示里的输出格式。最终回复只能包含要求的正文或 JSON。",
    "",
    prompt,
  ].join("\n");
}

function runExecFile(command, args, options = {}) {
  const execImpl = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    const child = execImpl(command, args, {
      timeout: Number(options.timeoutMs || 300000),
      maxBuffer: Number(options.maxBuffer || 1024 * 1024 * 16),
    }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error((stderr || stdout || error.message).trim());
        wrapped.code = error.code;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        reject(wrapped);
        return;
      }
      resolve({ stdout, stderr });
    });
    if (options.input !== undefined && child && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}

async function runCodexPrompt(prompt, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-codex-"));
  const outputPath = path.join(tmpDir, "last-message.txt");
  const args = [
    "exec",
    "--cd",
    options.cwd || path.resolve(__dirname, ".."),
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
  ];
  const model = codexModel(options);
  if (model) args.push("--model", model);
  const profile = codexProfile(options);
  if (profile) args.push("--profile", profile);
  args.push("-");

  try {
    const result = await runExecFile(codexBinary(options), args, {
      ...options,
      input: codexSystemPrompt(prompt),
    });
    const output = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : result.stdout;
    const text = String(output || "").trim();
    if (!text) throw new Error("Codex returned empty output");
    return text;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function generateWithFallback(options = {}, apiGenerate, codexGenerate, label = "generation") {
  const mode = generationMode(options);
  if (mode === "api") return apiGenerate();
  if (mode === "codex") return codexGenerate();
  throw new Error(`Unknown generator: ${mode}. Use api or codex for ${label}.`);
}

module.exports = {
  DEFAULT_API_FALLBACK_MODELS,
  apiModelCandidates,
  apiTimeoutMs,
  codexSystemPrompt,
  fetchWithTimeout,
  generateWithFallback,
  generationMode,
  isRecoverableApiError,
  runCodexPrompt,
  splitFallbackModels,
  withApiModelFallback,
};
