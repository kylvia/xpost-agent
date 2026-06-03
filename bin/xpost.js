#!/usr/bin/env node

require("../src/env").loadDotEnv();

const { notifyFeishu, redactSecrets } = require("../src/notifier");

const REDACTED_ARG_NAMES = new Set([
  "--auth-code",
  "--body",
  "--cover-text",
  "--feishu-webhook",
  "--feishu-webhook-url",
  "--liaobots-authcode",
  "--source-text",
  "--text",
  "--title",
  "--webhook",
  "--webhook-url",
]);

const REDACTED_ARG_PATTERN = "auth-code|body|cover-text|feishu-webhook|feishu-webhook-url|liaobots-authcode|source-text|text|title|webhook|webhook-url";

function redactCommandArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name] = String(arg).split("=", 1);
    if (REDACTED_ARG_NAMES.has(name)) {
      redacted.push(arg.includes("=") ? `${name}=[redacted]` : arg);
      if (!arg.includes("=") && index + 1 < args.length) {
        redacted.push("[redacted]");
        index += 1;
      }
    } else {
      redacted.push(arg);
    }
  }
  return redacted.map(redactSecrets);
}

function redactFailureText(value) {
  let text = redactSecrets(value);
  text = text.replace(
    new RegExp(`(--(?:${REDACTED_ARG_PATTERN})(?:=|\\s+))(?:"[^"]*"|'[^']*'|\\S+)`, "gi"),
    "$1[redacted]",
  );
  if (process.env.XPOST_FEISHU_WEBHOOK_URL) {
    text = text.split(process.env.XPOST_FEISHU_WEBHOOK_URL).join("[redacted]");
  }
  return text;
}

require("../src/cli").main(process.argv.slice(2)).catch(async (error) => {
  const errorText = redactFailureText(error && error.message ? error.message : error);
  console.error(errorText);

  try {
    await notifyFeishu({
      title: "command.failed",
      lines: [
        `command: ${redactFailureText(`xpost ${redactCommandArgs(process.argv.slice(2)).join(" ")}`)}`,
        `error: ${errorText}`,
      ],
    });
  } catch (notifyError) {
    if (process.env.XPOST_FEISHU_WEBHOOK_URL) {
      console.error(`Notify failed: ${redactFailureText(notifyError && notifyError.message ? notifyError.message : notifyError)}`);
    }
  }

  process.exitCode = 1;
});
