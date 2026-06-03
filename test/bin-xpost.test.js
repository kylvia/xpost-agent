"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}

function runNode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test("command failure notification redacts content and secret args", async (t) => {
  let resolveBody;
  const bodyPromise = new Promise((resolve) => {
    resolveBody = resolve;
  });
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      resolveBody(raw);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{\"StatusCode\":0}");
    });
  });
  t.after(() => server.close());

  await listen(server);
  const { port } = server.address();
  const repoRoot = path.join(__dirname, "..");
  const childPromise = runNode([
    path.join(repoRoot, "bin", "xpost.js"),
    "definitely-not-a-command",
    "--text",
    "do not leak post body",
    "--body=full note body",
    "--cover-text",
    "cover secret",
    "--source-text=source secret",
    "--title",
    "private title",
    "--auth-code",
    "auth secret",
    "--model",
    "safe-model",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      XPOST_FEISHU_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`,
    },
  });

  const [result, rawBody] = await withTimeout(Promise.all([childPromise, bodyPromise]), 5000);
  assert.equal(result.status, 1);

  const notificationText = JSON.parse(rawBody).content.text;
  assert.match(notificationText, /command\.failed/);
  assert.match(notificationText, /--model safe-model/);
  assert.doesNotMatch(notificationText, /do not leak post body|full note body|cover secret|source secret|private title|auth secret/);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /do not leak post body|full note body|cover secret|source secret|private title|auth secret/);
});
