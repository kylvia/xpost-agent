"use strict";

const relay = require("./browser-relay");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseMetricCount(value) {
  const text = normalizeText(value).replace(/,/g, "");
  if (!text) return null;

  const cjk = text.match(/(\d+(?:\.\d+)?)\s*([万億亿])/);
  if (cjk) {
    const multiplier = cjk[2] === "万" ? 10000 : 100000000;
    return Math.round(Number(cjk[1]) * multiplier);
  }

  const latin = text.match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!latin) return null;
  const multipliers = { K: 1000, M: 1000000, B: 1000000000 };
  const suffix = latin[2] ? latin[2].toUpperCase() : "";
  return Math.round(Number(latin[1]) * (multipliers[suffix] || 1));
}

const METRIC_PATTERNS = {
  replies: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:repl(?:y|ies)|comments?|条?回复|评论)/i,
    /(?:repl(?:y|ies)|comments?|回复|评论)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
  reposts: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:reposts?|retweets?|转帖|转发|转推)/i,
    /(?:reposts?|retweets?|转帖|转发|转推)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
  quotes: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:quotes?|引用)/i,
    /(?:quotes?|引用)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
  likes: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:likes?|喜欢|赞)/i,
    /(?:likes?|喜欢|赞)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
  bookmarks: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:bookmarks?|收藏|书签)/i,
    /(?:bookmarks?|收藏|书签)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
  views: [
    /([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])\s*(?:views?|impressions?|次查看|查看|浏览|展示)/i,
    /(?:views?|impressions?|查看|浏览|展示)\s*([0-9][0-9,]*(?:\.\d+)?\s*[KMB]?|[0-9]+(?:\.\d+)?\s*[万億亿])/i,
  ],
};

function metricFromText(kind, text) {
  const value = normalizeText(text);
  for (const pattern of METRIC_PATTERNS[kind] || []) {
    const match = value.match(pattern);
    if (!match) continue;
    const parsed = parseMetricCount(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function engagementTotal(metrics = {}) {
  return ["replies", "reposts", "quotes", "likes", "bookmarks"]
    .reduce((total, key) => total + Number(metrics[key] || 0), 0);
}

function engagementRate(metrics = {}) {
  const views = Number(metrics.views || 0);
  if (!views) return null;
  return Number((engagementTotal(metrics) / views).toFixed(6));
}

function metricsFromTexts(texts = []) {
  const metrics = {};
  for (const raw of texts) {
    const text = normalizeText(raw);
    if (!text) continue;
    for (const kind of Object.keys(METRIC_PATTERNS)) {
      if (metrics[kind] !== undefined) continue;
      const value = metricFromText(kind, text);
      if (Number.isFinite(value)) metrics[kind] = value;
    }
  }

  metrics.engagements = engagementTotal(metrics);
  const rate = engagementRate(metrics);
  if (rate !== null) metrics.engagementRate = rate;
  return metrics;
}

function canonicalStatusUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)(?:[/?#]|$)/i);
  if (!match) return "";
  return `https://x.com/${match[1]}/status/${match[2]}`;
}

function statusUrlFromSnapshot(snapshot = {}) {
  const direct = canonicalStatusUrl(snapshot.url);
  if (direct) return direct;
  for (const href of snapshot.statusLinks || []) {
    const url = canonicalStatusUrl(href);
    if (url) return url;
  }
  return "";
}

function pageSnapshotScript(text) {
  return `
(() => {
  const target = ${JSON.stringify(normalizeText(text).slice(0, 120))};
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const visible = (node) => Boolean(node && (node.offsetParent !== null || node.getClientRects().length));
  const articles = [...document.querySelectorAll("article")].filter(visible);
  const article = articles.find((node) => target && normalize(node.innerText || node.textContent).includes(target.slice(0, Math.min(40, target.length))))
    || articles[0]
    || document.body;
  const nodes = [...article.querySelectorAll("[aria-label], [role='button'], a, span, div")].slice(0, 900);
  const labels = nodes.map((node) => ({
    ariaLabel: normalize(node.getAttribute("aria-label")),
    text: normalize(node.innerText || node.textContent),
    testId: normalize(node.getAttribute("data-testid")),
    href: node.href || node.getAttribute("href") || "",
  })).filter((item) => item.ariaLabel || item.text || item.href);
  const statusLinks = [...article.querySelectorAll("a[href*='/status/']")]
    .map((node) => node.href || node.getAttribute("href") || "")
    .filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    articleText: normalize(article.innerText || article.textContent),
    labels,
    statusLinks,
  };
})()
`;
}

function textsFromSnapshot(snapshot = {}) {
  const texts = [snapshot.articleText, snapshot.title];
  for (const item of snapshot.labels || []) {
    texts.push(item.ariaLabel, item.text);
    if (item.ariaLabel && item.text) {
      texts.push(`${item.text} ${item.ariaLabel}`, `${item.ariaLabel} ${item.text}`);
    }
  }
  return texts;
}

async function captureXPostMetrics(options = {}) {
  let tab = options.tabId ? { id: options.tabId } : await relay.findXTab();

  if (options.url) {
    if (!tab || !tab.id) {
      await relay.openChromeTab(options.url);
      await sleep(1500);
      tab = await relay.findXTab();
    } else {
      await relay.navigate(options.url, tab.id);
    }
    await sleep(Number(options.waitMs || 2500));
  }

  if (!tab || !tab.id) throw new Error("No Browser Relay tab available for X metrics capture");

  const snapshot = await relay.evalJs(pageSnapshotScript(options.text), tab.id);
  const metrics = metricsFromTexts(textsFromSnapshot(snapshot));
  return {
    ...metrics,
    capturedAt: new Date().toISOString(),
    source: "browser-relay",
    url: statusUrlFromSnapshot(snapshot) || options.url || snapshot.url || null,
  };
}

module.exports = {
  canonicalStatusUrl,
  captureXPostMetrics,
  engagementRate,
  engagementTotal,
  metricFromText,
  metricsFromTexts,
  parseMetricCount,
  statusUrlFromSnapshot,
};
