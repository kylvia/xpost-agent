"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { imageCompletionsEndpoint } = require("./liaobots");
const { buildCoverSvg } = require("./rednote-cover");

const DEFAULT_IMAGE_ENDPOINT = "https://ai.liaobots1.work/v1/chat/completions";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const execFileAsync = promisify(execFile);

function authCode(options = {}) {
  return options.authCode || process.env.XPOST_LIAOBOTS_AUTHCODE || process.env.LIAOBOTS_AUTHCODE || "";
}

function buildLiaoImagePrompt(note = {}) {
  const title = String(note.title || "").trim();
  const body = String(note.body || "").trim();
  const tags = Array.isArray(note.tags) ? note.tags.filter(Boolean).map((tag) => `#${String(tag).replace(/^#+/, "")}`).join(" ") : "";
  return [
    "生成一张适合小红书图文笔记上传的 1:1 方图。",
    "画面要求：温柔、清爽、信纸内背景，有浅色纸张、横线、左侧竖线或打孔细节。",
    "必须把下面的标题和正文排版到图片里，中文必须清晰可读，不要乱码，不要截断核心信息。",
    "不要添加真实品牌 logo，不要添加二维码、水印、头像、用户名或引流字样。",
    "整体像一张可收藏的手写信纸/便签纸排版，但文字用清晰印刷体。",
    "",
    `标题：${title}`,
    "",
    "正文：",
    body,
    tags ? ["", `标签参考：${tags}`].join("\n") : "",
  ].filter(Boolean).join("\n");
}

function buildLiaoImageRequest(note = {}, options = {}) {
  return {
    model: options.model || DEFAULT_IMAGE_MODEL,
    messages: [
      {
        role: "user",
        content: buildLiaoImagePrompt(note),
      },
    ],
    temperature: options.temperature === undefined ? 1 : Number(options.temperature),
    stream: false,
  };
}

function extractImageUrl(data) {
  const message = data
    && data.choices
    && data.choices[0]
    && data.choices[0].message;
  if (!message) return "";

  function urlFromImage(image) {
    return image
      && (image.url
        || image.b64_json
        || image.image_url && (image.image_url.url || image.image_url.b64_json || image.image_url));
  }

  const images = Array.isArray(message.images) ? message.images : [];
  for (const image of images) {
    const url = urlFromImage(image);
    if (url) return url;
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = urlFromImage(part);
      if (url) return url;
    }
  }

  const content = String(message.content || "").trim();
  if (/^data:image\//.test(content) || /^https?:\/\//.test(content)) return content;
  const match = content.match(/(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/);
  if (match) return match[1];
  const httpMatch = content.match(/(https?:\/\/[^\s)]+)/);
  return httpMatch ? httpMatch[1] : "";
}

async function writeImageUrl(imageUrl, file, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const value = String(imageUrl || "").trim();
  const dataUrlMatch = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  if (dataUrlMatch) {
    fs.writeFileSync(file, Buffer.from(dataUrlMatch[1], "base64"));
    return { file };
  }

  if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 32) {
    fs.writeFileSync(file, Buffer.from(value, "base64"));
    return { file };
  }

  if (/^https?:\/\//.test(value)) {
    const fetchImpl = options.fetch || fetch;
    const response = await fetchImpl(value);
    if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return { file };
  }

  throw new Error("API response did not contain an image URL or base64 image");
}

async function generateLiaoImage(note, file, options = {}) {
  const token = authCode(options);
  if (!token) {
    throw new Error("Missing API auth code. Set XPOST_LIAOBOTS_AUTHCODE or pass --auth-code.");
  }

  const endpoint = imageCompletionsEndpoint(options);
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildLiaoImageRequest(note, {
      model: options.model,
      temperature: options.temperature,
    })),
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`Image API returned non-JSON response: ${raw.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : `Image API request failed with HTTP ${response.status}`);
  }

  const imageUrl = extractImageUrl(data);
  await writeImageUrl(imageUrl, file, { fetch: fetchImpl });
  if (!fs.existsSync(file)) throw new Error(`Generated image was not written: ${file}`);
  return { file, provider: "liao" };
}

async function renderLocalImage(note, file) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-rednote-cover-"));
  const svgFile = path.join(tmpDir, "cover.svg");
  fs.writeFileSync(svgFile, buildCoverSvg(note), "utf8");
  try {
    await execFileAsync("qlmanage", ["-t", "-s", "1080", "-o", tmpDir, svgFile], {
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const rendered = `${svgFile}.png`;
    if (!fs.existsSync(rendered)) throw new Error(`Quick Look did not render cover: ${rendered}`);
    fs.copyFileSync(rendered, file);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(file)) throw new Error(`Cover screenshot was not created: ${file}`);
  return { file, provider: "local" };
}

async function renderRednoteImage(note, file, options = {}) {
  if (options.provider === "liao") {
    try {
      return await generateLiaoImage(note, file, {
        authCode: options.authCode,
        endpoint: options.endpoint,
        fetch: options.fetch,
        model: options.model,
        temperature: options.temperature,
      });
    } catch (error) {
      if (options.fallback === false) throw error;
      const result = await renderLocalImage(note, file);
      return { ...result, fallbackFrom: "liao", fallbackError: error.message };
    }
  }
  return renderLocalImage(note, file);
}

module.exports = {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_IMAGE_MODEL,
  buildLiaoImagePrompt,
  buildLiaoImageRequest,
  extractImageUrl,
  generateLiaoImage,
  renderLocalImage,
  renderRednoteImage,
  writeImageUrl,
};
