"use strict";

const { execFile } = require("node:child_process");

function relayUrl() {
  return (process.env.BROWSER_RELAY_URL || "http://127.0.0.1:18795").replace(/\/$/, "");
}

function runBrowserRelay(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "browser-relay",
      args,
      {
        timeout: options.timeoutMs || 30000,
        maxBuffer: options.maxBuffer || 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || stdout.trim() || error.message;
          reject(new Error(`browser-relay ${args.join(" ")} failed: ${message}`));
          return;
        }
        resolve(stdout);
      },
    );

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

async function jsonCommand(args, options = {}) {
  const stdout = await runBrowserRelay([...args, "--json"], options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse browser-relay JSON: ${stdout.slice(0, 500)}`);
  }
}

async function version() {
  return (await runBrowserRelay(["--version"])).trim();
}

async function status() {
  return (await runBrowserRelay(["status"])).trim();
}

async function tabs() {
  const data = await jsonCommand(["tabs"]);
  return data.tabs || [];
}

function openChromeTab(url) {
  return new Promise((resolve, reject) => {
    const escapedUrl = String(url).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `
tell application "Google Chrome"
  if (count of windows) = 0 then make new window
  tell front window
    make new tab at end of tabs with properties {URL:"${escapedUrl}"}
    set active tab index to (count of tabs)
  end tell
  activate
end tell
`;

    execFile("osascript", ["-e", script], { timeout: 10000 }, (scriptError) => {
      if (!scriptError) {
        resolve();
        return;
      }

      execFile("open", ["-a", "Google Chrome", url], { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || stdout.trim() || error.message;
          reject(new Error(`open Google Chrome failed: ${message}`));
          return;
        }
        resolve();
      });
    });
  });
}

async function findXTab() {
  const allTabs = await tabs();
  const xTabs = allTabs.filter((tab) => /https:\/\/(x|twitter)\.com\//i.test(tab.url || ""));
  return (
    xTabs.find((tab) => /\/compose\/post/i.test(tab.url || ""))
    || xTabs.find((tab) => !/\/status\//i.test(tab.url || ""))
    || xTabs[0]
    || allTabs[0]
  );
}

async function navigate(url, tabId) {
  const args = ["navigate", url];
  if (tabId) args.push("--tab", tabId);
  try {
    await runBrowserRelay(args, { timeoutMs: 45000 });
  } catch (error) {
    if (!tabId) {
      throw error;
    }
    await runBrowserRelay(["navigate", url], { timeoutMs: 45000 });
  }
}

async function evalJs(expression, tabId) {
  const args = ["eval", "--stdin", "--json"];
  if (tabId) args.push("--tab", tabId);
  const stdout = await runBrowserRelay(args, { input: expression, timeoutMs: 30000 });
  const data = JSON.parse(stdout);
  if (data.exceptionDetails) {
    throw new Error(`Browser eval failed: ${JSON.stringify(data.exceptionDetails)}`);
  }
  return data.result && Object.prototype.hasOwnProperty.call(data.result, "value")
    ? data.result.value
    : data.result;
}

async function clickElement(selector, tabId) {
  const body = { selector, tabId };
  const response = await fetch(`${relayUrl()}/api/click`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || `Browser Relay click failed with HTTP ${response.status}`);
  }
  return data;
}

async function clickAt(x, y, tabId, options = {}) {
  const body = {
    x,
    y,
    tabId,
    button: options.button || "left",
    doubleClick: Boolean(options.doubleClick),
  };
  const response = await fetch(`${relayUrl()}/api/click`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || `Browser Relay click-at failed with HTTP ${response.status}`);
  }
  return data;
}

async function typeText(text, selector, tabId, options = {}) {
  const body = {
    tabId,
    text,
    clear: Boolean(options.clear),
    submit: false,
  };
  if (selector) body.selector = selector;

  const response = await fetch(`${relayUrl()}/api/type`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || `Browser Relay type failed with HTTP ${response.status}`);
  }
  return data;
}

async function uploadFile(file, selector, tabId) {
  const body = {
    tabId,
    selector,
    files: [file],
  };

  const response = await fetch(`${relayUrl()}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || `Browser Relay upload failed with HTTP ${response.status}`);
  }
  return data;
}

async function screenshot(file, tabId, options = {}) {
  const args = ["screenshot", file];
  if (tabId) args.push("--tab", tabId);
  if (options.fullPage) args.push("--full-page");
  await runBrowserRelay(args, { timeoutMs: 30000 });
}

module.exports = {
  clickAt,
  clickElement,
  evalJs,
  findXTab,
  navigate,
  openChromeTab,
  runBrowserRelay,
  screenshot,
  status,
  tabs,
  typeText,
  uploadFile,
  version,
};
