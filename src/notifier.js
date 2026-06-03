"use strict";

const SECRET_PATTERNS = [
  /https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-z0-9-]+/gi,
  /Bearer\s+[^\s]+/gi,
  /\b((?:XPOST_)?LIAOBOTS_AUTHCODE\s*(?:=>|[=:])\s*)[^\s]+/gi,
  /\b(XPOST_FEISHU_WEBHOOK_URL\s*(?:=>|[=:])\s*)[^\s]+/gi,
];

function redactSecrets(value) {
  let text = String(value || "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => (
      typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]"
    ));
  }
  return text;
}

function redactForWebhook(value, webhook) {
  let text = redactSecrets(value);
  if (webhook) {
    text = text.split(webhook).join("[redacted]");
  }
  return text;
}

function buildFeishuTextPayload({ title, lines = [] }) {
  const body = [`[xpost-agent] ${title}`, ...lines].map(redactSecrets).join("\n");
  return {
    msg_type: "text",
    content: { text: body },
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function feishuBodyOk(body) {
  if (!body || typeof body !== "object") return false;
  const hasStatusCode = Object.prototype.hasOwnProperty.call(body, "StatusCode");
  const hasCode = Object.prototype.hasOwnProperty.call(body, "code");
  if (!hasStatusCode && !hasCode) {
    return false;
  }
  if (hasStatusCode && body.StatusCode !== 0) {
    return false;
  }
  if (hasCode && body.code !== 0) {
    return false;
  }
  return true;
}

async function notifyFeishu(options = {}) {
  const env = options.env || process.env;
  const webhook = env.XPOST_FEISHU_WEBHOOK_URL;
  if (!webhook) {
    return {
      ok: false,
      skipped: true,
      warning: "XPOST_FEISHU_WEBHOOK_URL is not configured.",
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch is not available." };
  }

  try {
    const payload = buildFeishuTextPayload({ title: options.title || "notice", lines: options.lines || [] });
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await response.text().catch(() => "");
    const body = parseJson(raw);
    return {
      ok: Boolean(response.ok) && feishuBodyOk(body),
      status: response.status,
      response: redactForWebhook(raw.slice(0, 300), webhook),
    };
  } catch (error) {
    return {
      ok: false,
      error: redactForWebhook(error && error.message ? error.message : error, webhook),
    };
  }
}

module.exports = {
  buildFeishuTextPayload,
  notifyFeishu,
  redactSecrets,
};
