"use strict";

const fs = require("node:fs");
const path = require("node:path");

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function parseDotEnv(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*?)\s*$/);
    if (!match) continue;
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

function loadDotEnv(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const envPath = options.path || path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath, values: {} };

  const values = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (options.override || env[key] === undefined) env[key] = value;
  }
  return { loaded: true, path: envPath, values };
}

module.exports = {
  loadDotEnv,
  parseDotEnv,
};
