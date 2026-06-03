"use strict";

const DEFAULT_X_ANGLES = [
  "strong judgment",
  "counterintuitive reframe",
  "mechanism",
  "hidden cost",
  "micro practice",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function excerpt(value, max = 80) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function firstChunk(value, max = 18) {
  return normalizeText(value).slice(0, max);
}

function trimTrailingClosers(value) {
  return normalizeText(value).replace(/[”’"')）】》」』\]]+$/g, "").trim();
}

function finalSentence(value) {
  const text = trimTrailingClosers(value).replace(/[。！？!?]+$/g, "");
  const parts = text.split(/[。！？!?]+/)
    .map((item) => trimTrailingClosers(item))
    .filter(Boolean);
  const finalPart = parts.length ? parts[parts.length - 1] : text;
  const fragments = finalPart.split(/[：“‘"'(（【《「『\[]+/).map((item) => item.trim()).filter(Boolean);
  return fragments.length ? fragments[fragments.length - 1] : finalPart;
}

function assignAngles(angles = [], count = 5) {
  const candidates = Array.isArray(angles) ? angles : [];
  const chosen = [];
  for (const angle of candidates) {
    const value = normalizeText(angle);
    if (value && !chosen.includes(value)) chosen.push(value);
  }
  for (const angle of DEFAULT_X_ANGLES) {
    if (chosen.length >= Number(count || 5)) break;
    if (!chosen.includes(angle)) chosen.push(angle);
  }
  return chosen.slice(0, Number(count || 5));
}

function duplicateValues(items) {
  const seen = new Map();
  for (const item of items.filter(Boolean)) {
    seen.set(item, (seen.get(item) || 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function analyzeBatchRepetition(posts = [], options = {}) {
  const items = posts.map((post, index) => ({
    index,
    text: normalizeText(post && post.text !== undefined ? post.text : post),
  })).filter((item) => item.text);
  const warnings = [];

  for (const duplicate of duplicateValues(items.map((item) => firstChunk(item.text)))) {
    warnings.push({ type: "duplicate-start", ...duplicate });
  }
  for (const duplicate of duplicateValues(items.map((item) => finalSentence(item.text)))) {
    warnings.push({ type: "duplicate-ending", ...duplicate });
  }

  const practice = normalizeText(options.practice);
  if (practice) {
    const core = practice.length > 16 ? practice.slice(0, 16) : practice;
    const hits = items.filter((item) => item.text.includes(core) || item.text.includes(practice)).length;
    if (hits > 1) {
      warnings.push({ type: "practice-overuse", value: excerpt(practice, 40), count: hits });
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    checked: items.length,
  };
}

module.exports = {
  DEFAULT_X_ANGLES,
  analyzeBatchRepetition,
  assignAngles,
  excerpt,
  finalSentence,
  normalizeText,
};
