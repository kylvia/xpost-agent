"use strict";

const relay = require("./browser-relay");
const { screenshotPath } = require("./store");
const { canonicalStatusUrl } = require("./x-metrics");

const COMPOSER_URL = "https://x.com/compose/post";
const POST_BUTTON_TEXT_PATTERN = "^(发帖|帖子|Post)(\\s+(帖子|Post))?$";
const TEXTBOX_SELECTOR = 'div[role="textbox"][aria-label="帖子文本"], div[role="textbox"][aria-label="Post text"], div[data-testid="tweetTextarea_0"]';
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutUrl = raw
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .split(/[/?#]/)[0];
  return withoutUrl.replace(/^@+/, "").toLowerCase();
}

function expectedAccount(options = {}) {
  return normalizeHandle(
    options.account
      || options.expectedAccount
      || process.env.XPOST_ACCOUNT
      || process.env.XPOST_EXPECTED_ACCOUNT
      || process.env.XPOST_EXPECTED_HANDLE,
  );
}

function accountMatches(actual, expected) {
  const actualHandle = normalizeHandle(actual && actual.handle ? actual.handle : actual);
  const expectedHandle = normalizeHandle(expected);
  return Boolean(actualHandle && expectedHandle && actualHandle === expectedHandle);
}

function postButtonTextMatches(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return new RegExp(POST_BUTTON_TEXT_PATTERN).test(normalized);
}

async function liveComposerTab(previousIds = new Set(), options = {}) {
  const allTabs = await relay.tabs();
  const candidates = allTabs
    .map((tab, index) => ({ ...tab, index }))
    .filter((tab) => !options.onlyNew || !previousIds.has(tab.id))
    .sort((a, b) => b.index - a.index);

  for (const tab of candidates) {
    try {
      const url = await relay.evalJs("location.href", tab.id);
      if (/https:\/\/(x|twitter)\.com\/compose\/post/i.test(url || "")) {
        return { id: tab.id, url };
      }
    } catch (error) {
      // Browser Relay can retain stale target ids after extension reloads.
    }
  }

  return null;
}

async function liveXTab() {
  const allTabs = await relay.tabs();
  const candidates = allTabs
    .map((tab, index) => ({ ...tab, index }))
    .filter((tab) => /https:\/\/(x|twitter)\.com\//i.test(tab.url || ""))
    .sort((a, b) => b.index - a.index);

  for (const tab of candidates) {
    try {
      const url = await relay.evalJs("location.href", tab.id);
      if (/https:\/\/(x|twitter)\.com\//i.test(url || "")) {
        return { id: tab.id, url };
      }
    } catch (error) {
      // Browser Relay can retain stale target ids after extension reloads.
    }
  }

  return null;
}

async function waitForTextbox(tabId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await relay.evalJs(`
(() => {
  const boxes = [...document.querySelectorAll('${TEXTBOX_SELECTOR}')];
  const textbox = boxes.find((node) => node.offsetParent !== null) || boxes[0];
  return Boolean(textbox);
})()
`, tabId);
    if (state) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForComposerTab(tabId) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const url = await relay.evalJs("location.href", tabId);
    if (/https:\/\/(x|twitter)\.com\/compose\/post/i.test(url || "") && await waitForTextbox(tabId)) {
      return { id: tabId, url };
    }
    await sleep(1000);
  }

  throw new Error("Unable to open a live X compose tab");
}

async function openComposer(options = {}) {
  const previousIds = new Set((await relay.tabs()).map((tab) => tab.id));

  if (options.tabId) {
    await relay.navigate(COMPOSER_URL, options.tabId);
    return waitForComposerTab(options.tabId);
  } else if (options.newTab === true) {
    await relay.openChromeTab(COMPOSER_URL);
  } else {
    const existing = await liveComposerTab(previousIds);
    if (existing) return existing;
    const xTab = await liveXTab();
    if (!xTab) throw new Error("No live X tab available. Open x.com in Chrome first.");
    if (/https:\/\/(x|twitter)\.com\/compose\/post/i.test(xTab.url || "") && await waitForTextbox(xTab.id)) {
      return xTab;
    }
    await relay.navigate(COMPOSER_URL, xTab.id);
    return waitForComposerTab(xTab.id);
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const tab = await liveComposerTab(previousIds, { onlyNew: options.newTab === true });
    if (tab && await waitForTextbox(tab.id)) return tab;
    await sleep(1000);
  }

  throw new Error("Unable to open a live X compose tab");
}

async function currentAccount(tabId) {
  return relay.evalJs(`
(() => {
  function normalize(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const withoutUrl = raw
      .replace(/^https?:\\/\\/(www\\.)?(x|twitter)\\.com\\//i, "")
      .split(/[/?#]/)[0];
    return withoutUrl.replace(/^@+/, "").toLowerCase();
  }

  const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"][href]');
  if (profile) {
    const handle = normalize(profile.getAttribute("href") || profile.href);
    if (handle) {
      return {
        displayName: (profile.innerText || profile.getAttribute("aria-label") || "").trim(),
        handle,
        href: profile.href,
        source: "profile-link"
      };
    }
  }

  const accountButton = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  const text = accountButton ? (accountButton.innerText || accountButton.getAttribute("aria-label") || "") : "";
  const match = text.match(/@([A-Za-z0-9_]+)/);
  if (match) {
    return {
      displayName: text.replace(/@([A-Za-z0-9_]+)/, "").trim(),
      handle: normalize(match[1]),
      href: "",
      source: "account-switcher"
    };
  }

  return { displayName: "", handle: "", href: "", source: "not-found" };
})()
`, tabId);
}

async function assertExpectedAccount(tabId, options = {}) {
  const expected = expectedAccount(options);
  if (!expected) return null;
  const account = await currentAccount(tabId);
  if (!accountMatches(account, expected)) {
    const actual = account && account.handle ? `@${account.handle}` : "unknown";
    throw new Error(`X account mismatch: expected @${expected}, current ${actual}`);
  }
  return account;
}

async function discardCurrentComposer(tabId) {
  const closed = await relay.evalJs(`
(() => {
  const buttons = [...document.querySelectorAll('[role="button"], button')];
  const close = buttons.find((button) => {
    const text = (button.innerText || button.getAttribute("aria-label") || "").trim();
    return button.offsetParent !== null
      && (button.getAttribute("data-testid") === "app-bar-close" || /^(关闭|Close)$/.test(text));
  });
  if (!close) return { ok: false, reason: "close button not found" };
  close.click();
  return { ok: true };
})()
`, tabId);
  if (!closed || !closed.ok) return closed;

  await sleep(600);

  const discarded = await relay.evalJs(`
(() => {
  const buttons = [...document.querySelectorAll('[role="button"], button')];
  const discard = buttons.find((button) => {
    const text = (button.innerText || button.getAttribute("aria-label") || "").trim();
    return button.offsetParent !== null
      && (button.getAttribute("data-testid") === "confirmationSheetCancel" || /^(放弃|Discard)$/.test(text));
  });
  if (!discard) return { ok: true, discarded: false };
  discard.click();
  return { ok: true, discarded: true };
})()
`, tabId);

  await sleep(1000);
  return { ok: true, closed: true, discarded: Boolean(discarded && discarded.discarded) };
}

async function clearComposer(tabId) {
  await relay.evalJs(`
(() => {
  const boxes = [...document.querySelectorAll('${TEXTBOX_SELECTOR}')];
  const el = boxes.find((node) => node.offsetParent !== null) || boxes[0];
  if (!el) return { ok: false, reason: "textbox not found" };
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("delete");
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, text: el.innerText };
})()
`, tabId);
}

async function typePostText(text, tabId) {
  const draftResult = await relay.evalJs(`
(() => {
  const text = ${JSON.stringify(text)};
  const boxes = [...document.querySelectorAll('${TEXTBOX_SELECTOR}')];
  const el = boxes.find((node) => node.offsetParent !== null) || boxes[0];
  if (!el) return { ok: false, reason: "textbox not found" };

  const fiberKey = Object.keys(el).find((key) => key.startsWith("__reactFiber"));
  let fiber = fiberKey ? el[fiberKey] : null;
  for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps || {};
    if (props.editorState && typeof props.onChange === "function") {
      const EditorState = props.editorState.constructor;
      const ContentState = props.editorState.getCurrentContent().constructor;
      const next = EditorState.moveFocusToEnd(
        EditorState.createWithContent(ContentState.createFromText(text))
      );
      props.onChange(next);
      return { ok: true, method: "draft-editor-state" };
    }
  }

  return { ok: false, reason: "draft editor state not found" };
})()
`, tabId);

  for (let attempt = 0; draftResult && draftResult.ok && attempt < 10; attempt += 1) {
    const state = await relay.evalJs(`
(() => {
  const boxes = [...document.querySelectorAll('${TEXTBOX_SELECTOR}')];
  const el = boxes.find((node) => node.offsetParent !== null) || boxes[0];
  if (!el) return { domText: "", editorText: "" };
  let editorText = "";
  const fiberKey = Object.keys(el).find((key) => key.startsWith("__reactFiber"));
  let fiber = fiberKey ? el[fiberKey] : null;
  for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps || {};
    if (props.editorState && props.editorState.getCurrentContent) {
      editorText = props.editorState.getCurrentContent().getPlainText();
      break;
    }
  }
  return { domText: el.innerText || el.textContent || "", editorText };
})()
`, tabId);
    if (state && (state.domText.includes(text) || state.editorText.includes(text))) {
      await sleep(700);
      return;
    }
    await sleep(250);
  }

  await relay.clickElement(TEXTBOX_SELECTOR, tabId);
  await sleep(250);
  await relay.typeText(text, TEXTBOX_SELECTOR, tabId, { clear: false });
  await sleep(700);
}

async function composerState(tabId) {
  return relay.evalJs(`
(() => {
  const boxes = [...document.querySelectorAll('${TEXTBOX_SELECTOR}')].map((node) => ({
    node,
    active: document.activeElement === node,
    text: (() => {
      const fiberKey = Object.keys(node).find((key) => key.startsWith("__reactFiber"));
      let fiber = fiberKey ? node[fiberKey] : null;
      for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
        const props = fiber.memoizedProps || {};
        if (props.editorState && props.editorState.getCurrentContent) {
          return props.editorState.getCurrentContent().getPlainText();
        }
      }
      return node.innerText || node.textContent || "";
    })(),
    visible: node.offsetParent !== null
  }));
  const textbox = boxes.find((item) => item.active)
    || boxes.find((item) => item.visible && item.text.trim())
    || boxes.find((item) => item.visible)
    || boxes[0];
  const buttons = [...document.querySelectorAll('[role="button"], button')].map((button) => ({
    text: button.innerText || button.getAttribute("aria-label") || "",
    testId: button.getAttribute("data-testid"),
    ariaDisabled: button.getAttribute("aria-disabled"),
    disabled: Boolean(button.disabled),
    visible: button.offsetParent !== null
  }));
  const postButtonTextPattern = new RegExp(${JSON.stringify(POST_BUTTON_TEXT_PATTERN)});
  const postButtons = buttons.filter((button) => {
    const normalizedText = String(button.text || "").trim().replace(/\\s+/g, " ");
    return button.testId === "tweetButton"
      || button.testId === "tweetButtonInline"
      || postButtonTextPattern.test(normalizedText);
  });
  const enabledPostButton = postButtons.find((button) => button.visible && button.ariaDisabled !== "true" && !button.disabled);
  const negativeCounter = [...document.querySelectorAll('span, div')]
    .map((node) => ({
      text: (node.innerText || node.textContent || "").trim().replace(/,/g, ""),
      visible: node.offsetParent !== null
    }))
    .filter((item) => item.visible && /^-\\d+$/.test(item.text))
    .sort((a, b) => a.text.length - b.text.length)[0];
  return {
    text: textbox ? textbox.text : "",
    hasTextbox: Boolean(textbox && textbox.node),
    postButtons,
    canPost: Boolean(enabledPostButton),
    remainingChars: negativeCounter ? Number(negativeCounter.text) : null
  };
})()
`, tabId);
}

function shouldDiscardStaleDraft(state, text) {
  if (!state || !state.hasTextbox || state.canPost) return false;
  if (!state.text || !state.text.includes(text)) return false;
  if (!Number.isInteger(state.remainingChars) || state.remainingChars >= 0) return false;
  return Math.abs(state.remainingChars) > text.length;
}

async function clickPostButton(tabId) {
  return relay.evalJs(`
(() => {
  const buttons = [...document.querySelectorAll('[role="button"], button')];
  const postButtonTextPattern = new RegExp(${JSON.stringify(POST_BUTTON_TEXT_PATTERN)});
  const button = buttons.find((node) => {
    const text = (node.innerText || node.getAttribute("aria-label") || "").trim();
    const normalizedText = text.replace(/\\s+/g, " ");
    const testId = node.getAttribute("data-testid");
    return node.offsetParent !== null
      && node.getAttribute("aria-disabled") !== "true"
      && !node.disabled
      && (
        testId === "tweetButton"
        || postButtonTextPattern.test(normalizedText)
      );
  });
  if (!button) return { ok: false, reason: "enabled post button not found" };
  button.click();
  return { ok: true };
})()
`, tabId);
}

async function findPostedStatusUrl(text, tabId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const found = await relay.evalJs(`
(() => {
  const target = ${JSON.stringify(String(text || "").replace(/\s+/g, " ").trim().slice(0, 120))};
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const visible = (node) => Boolean(node && (node.offsetParent !== null || node.getClientRects().length));
  const articles = [...document.querySelectorAll("article")].filter(visible);
  const article = articles.find((node) => target && normalize(node.innerText || node.textContent).includes(target.slice(0, Math.min(40, target.length))))
    || articles[0];
  const roots = article ? [article, document] : [document];
  for (const root of roots) {
    const links = [...root.querySelectorAll("a[href*='/status/']")]
      .map((node) => node.href || node.getAttribute("href") || "")
      .filter(Boolean);
    if (links.length) return links[0];
  }
  return "";
})()
`, tabId);
    const url = canonicalStatusUrl(found);
    if (url) return url;
    await sleep(1000);
  }
  return null;
}

async function fillComposer(text, options = {}) {
  const tab = await openComposer({ newTab: options.newTab === true });
  const tabId = tab.id;
  const account = await assertExpectedAccount(tabId, options);

  let state;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clearComposer(tabId);
    await typePostText(text, tabId);
    state = await composerState(tabId);
    if (state.hasTextbox && state.text.includes(text) && state.canPost) break;
    if (shouldDiscardStaleDraft(state, text)) {
      await discardCurrentComposer(tabId);
      await openComposer({ tabId });
    }
    await sleep(750);
  }

  if (!state.hasTextbox) throw new Error("X composer textbox not found");
  if (!state.text.includes(text)) throw new Error("X composer text was not inserted");
  if (!state.canPost) throw new Error("X post button is not enabled after typing");

  const shot = screenshotPath(options.postId, "filled");
  await relay.screenshot(shot, tabId);
  return { tabId, account, state, screenshot: shot };
}

async function publish(text, options = {}) {
  const filled = await fillComposer(text, options);
  if (!options.yes) {
    return { ...filled, posted: false, skipped: "pass --yes to click the post button" };
  }

  const clicked = await clickPostButton(filled.tabId);
  if (!clicked || !clicked.ok) {
    throw new Error(clicked && clicked.reason ? clicked.reason : "Failed to click post button");
  }

  await sleep(3000);
  const url = await findPostedStatusUrl(text, filled.tabId);
  const shot = screenshotPath(options.postId, "posted");
  await relay.screenshot(shot, filled.tabId);
  return { ...filled, posted: true, postedScreenshot: shot, url };
}

module.exports = {
  accountMatches,
  assertExpectedAccount,
  clearComposer,
  composerState,
  currentAccount,
  discardCurrentComposer,
  fillComposer,
  findPostedStatusUrl,
  normalizeHandle,
  openComposer,
  publish,
  postButtonTextMatches,
  shouldDiscardStaleDraft,
};
