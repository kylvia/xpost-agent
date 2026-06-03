"use strict";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCoverHtml(note = {}) {
  const coverText = escapeHtml(note.coverText || note.title || "保持清醒");
  const title = escapeHtml(note.title || "");
  const body = escapeHtml(note.body || "");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rednote Cover</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 1080px;
      min-height: 1080px;
      background: #eef2ec;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #18211f;
    }
    .cover {
      width: 1080px;
      aspect-ratio: 1 / 1;
      padding: 64px 70px;
      display: grid;
      background: #eef2ec;
    }
    .paper {
      position: relative;
      height: 100%;
      padding: 76px 78px 70px;
      border: 2px solid #dfd2bf;
      border-radius: 34px;
      background:
        repeating-linear-gradient(to bottom, transparent 0 54px, rgba(89, 122, 130, 0.22) 55px 57px, transparent 58px),
        linear-gradient(90deg, transparent 0 70px, rgba(194, 85, 78, 0.34) 71px 73px, transparent 74px),
        #fffdf6;
      box-shadow: 0 28px 70px rgba(72, 58, 40, 0.12);
    }
    .kicker {
      display: inline-block;
      padding: 10px 18px;
      border: 1.5px solid #8b7762;
      border-radius: 999px;
      color: #6f604f;
      font-size: 24px;
      line-height: 1;
    }
    h1 {
      margin: 46px 0 40px;
      font-size: 54px;
      line-height: 1.18;
      font-weight: 800;
      letter-spacing: 0;
    }
    .body {
      white-space: pre-wrap;
      font-size: 35px;
      line-height: 1.66;
      letter-spacing: 0;
      color: #27312f;
    }
  </style>
</head>
<body>
  <main class="cover">
    <section class="paper">
      <div class="kicker">${coverText}</div>
      <h1>${title}</h1>
      <div class="body">${body}</div>
    </section>
  </main>
</body>
</html>`;
}

function buildCoverDataUrl(note = {}) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildCoverHtml(note))}`;
}

function wrapText(value, maxChars = 8, maxLines = 4) {
  const chars = Array.from(String(value || "").trim());
  const lines = [];
  for (let index = 0; index < chars.length && lines.length < maxLines; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(""));
  }
  return lines.length ? lines : [""];
}

function wrapBodyText(value, maxChars = 24, maxLines = 12) {
  const paragraphs = String(value || "").trim().split(/\n\s*\n/).filter(Boolean);
  const lines = [];
  for (const paragraph of paragraphs) {
    if (lines.length >= maxLines) break;
    const wrapped = wrapText(paragraph.replace(/\s+/g, " "), maxChars, maxLines - lines.length);
    lines.push(...wrapped);
    if (lines.length < maxLines) lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) return [""];
  if (paragraphs.join("").length > lines.join("").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\.*$/, "")}...`;
  }
  return lines.slice(0, maxLines);
}

function svgText(lines, { x, y, size, color, weight = 700, lineHeight = 1.14 }) {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="-apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : size * lineHeight}">${escapeHtml(line)}</tspan>`).join("")}</text>`;
}

function ruledLines() {
  const lines = [];
  for (let y = 330; y <= 910; y += 56) {
    lines.push(`<line x1="150" y1="${y}" x2="930" y2="${y}" stroke="#9ab0af" stroke-width="2" opacity="0.22"/>`);
  }
  return lines.join("\n  ");
}

function buildCoverSvg(note = {}) {
  const coverText = note.coverText || note.title || "保持清醒";
  const title = note.title || "";
  const titleLines = wrapText(title, 16, 2);
  const bodyLines = wrapBodyText(note.body || coverText, 24, 11);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#483a28" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="#eef2ec"/>
  <circle cx="90" cy="90" r="180" fill="#9bb7b2" opacity="0.14"/>
  <circle cx="1010" cy="970" r="210" fill="#c98c78" opacity="0.13"/>
  <g id="letter-paper" filter="url(#paper-shadow)">
    <rect x="70" y="64" width="940" height="952" rx="34" fill="#fffdf6" stroke="#dfd2bf" stroke-width="2"/>
    <line x1="132" y1="110" x2="132" y2="962" stroke="#c2554e" stroke-width="3" opacity="0.34"/>
    <g id="ruled-lines">
      ${ruledLines()}
    </g>
    <circle cx="112" cy="186" r="9" fill="#eef2ec" stroke="#dfd2bf" stroke-width="2"/>
    <circle cx="112" cy="540" r="9" fill="#eef2ec" stroke="#dfd2bf" stroke-width="2"/>
    <circle cx="112" cy="894" r="9" fill="#eef2ec" stroke="#dfd2bf" stroke-width="2"/>
  </g>
  <rect x="150" y="126" width="${Math.min(420, Math.max(160, Array.from(coverText).length * 24 + 46))}" height="48" rx="24" fill="none" stroke="#8b7762" stroke-width="1.5"/>
  ${svgText([coverText], { x: 174, y: 158, size: 24, color: "#6f604f", weight: 600 })}
  ${svgText(titleLines, { x: 150, y: 250, size: 54, color: "#18211f", weight: 800, lineHeight: 1.2 })}
  ${svgText(bodyLines, { x: 150, y: 376, size: 35, color: "#27312f", weight: 500, lineHeight: 1.6 })}
</svg>`;
}

module.exports = {
  buildCoverDataUrl,
  buildCoverHtml,
  buildCoverSvg,
  escapeHtml,
  wrapBodyText,
  wrapText,
};
