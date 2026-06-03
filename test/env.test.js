"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadDotEnv } = require("../src/env");

test("loadDotEnv loads project auth code and base URL without overriding existing env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xpost-env-"));
  fs.writeFileSync(path.join(dir, ".env"), [
    "XPOST_LIAOBOTS_AUTHCODE=from-file",
    "XPOST_LIAOBOTS_BASE_URL=https://ai.liaobots1.work/v1",
    "EXISTING=from-file",
    "",
  ].join("\n"));
  const env = { EXISTING: "from-env" };

  const result = loadDotEnv({ cwd: dir, env });

  assert.equal(result.loaded, true);
  assert.equal(env.XPOST_LIAOBOTS_AUTHCODE, "from-file");
  assert.equal(env.XPOST_LIAOBOTS_BASE_URL, "https://ai.liaobots1.work/v1");
  assert.equal(env.EXISTING, "from-env");
});
