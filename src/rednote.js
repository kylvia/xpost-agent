"use strict";

const relay = require("./browser-relay");
const { renderRednoteImage } = require("./rednote-image");
const rednoteStore = require("./rednote-store");

const REDNOTE_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";
const FILE_INPUT_SELECTOR = 'input[type="file"]';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTag(tag) {
  return String(tag || "").trim().replace(/^#+/, "").replace(/\s+/g, "");
}

function bodyWithTags(note) {
  const body = String(note.body || "").trim();
  const tags = [...new Set((note.tags || []).map(cleanTag).filter(Boolean))];
  if (!tags.length) return body;
  return `${body}\n\n${tags.map((tag) => `#${tag}`).join(" ")}`;
}

async function findTabByTitleOrUrl(previousIds, predicate) {
  const tabs = await relay.tabs();
  return tabs
    .map((tab, index) => ({ ...tab, index }))
    .filter((tab) => !previousIds || !previousIds.has(tab.id))
    .sort((a, b) => b.index - a.index)
    .find(predicate);
}

async function openTabAndWait(url, predicate, options = {}) {
  const previousIds = new Set((await relay.tabs()).map((tab) => tab.id));
  await relay.openChromeTab(url);
  for (let attempt = 0; attempt < Number(options.attempts || 20); attempt += 1) {
    const tab = await findTabByTitleOrUrl(previousIds, predicate);
    if (tab) return tab;
    await sleep(Number(options.intervalMs || 500));
  }
  throw new Error(`Unable to find opened tab for ${url.slice(0, 80)}`);
}

function imageOptions(options = {}) {
  const result = {
    authCode: options.authCode,
    endpoint: options.imageEndpoint || options.endpoint,
    fallback: options.imageFallback,
    fetch: options.fetch,
    model: options.imageModel || options.model,
    provider: options.imageProvider || options.provider,
    temperature: options.imageTemperature === undefined ? options.temperature : options.imageTemperature,
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

async function renderCover(note, file, options = {}) {
  return renderRednoteImage(note, file, imageOptions(options));
}

async function openRednoteEditor() {
  const existing = (await relay.tabs()).find((candidate) => (
    /creator\.xiaohongshu\.com/i.test(candidate.url || "")
    && !/\/login/i.test(candidate.url || "")
  ));
  if (existing) {
    await relay.navigate(REDNOTE_PUBLISH_URL, existing.id);
    return existing.id;
  }

  const tab = await openTabAndWait(
    REDNOTE_PUBLISH_URL,
    (candidate) => /creator\.xiaohongshu\.com/i.test(candidate.url || ""),
    { attempts: 30, intervalMs: 750 },
  );
  return tab.id;
}

async function waitForEditor(tabId) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const state = await relay.evalJs(`
(() => {
  const fileInput = document.querySelector(${JSON.stringify(FILE_INPUT_SELECTOR)});
  const fields = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((node) => ({
      tag: node.tagName,
      placeholder: node.getAttribute('placeholder') || node.getAttribute('data-placeholder') || node.getAttribute('aria-label') || '',
      text: node.innerText || node.value || ''
    }));
  return { hasFileInput: Boolean(fileInput), fields };
})()
`, tabId);
    if (state && state.hasFileInput) return state;
    await sleep(1000);
  }
  throw new Error("Rednote editor file input not found");
}

async function fillFields(tabId, note) {
  const fullBody = bodyWithTags(note);
  return relay.evalJs(`
(() => {
  const title = ${JSON.stringify(note.title)};
  const body = ${JSON.stringify(fullBody)};

  function visible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(node) {
    return [
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.getAttribute('aria-label'),
      node.getAttribute('name'),
      node.className,
      node.id,
      node.innerText
    ].filter(Boolean).join(' ');
  }

  function candidates() {
    return [...document.querySelectorAll('input:not([type="file"]), textarea, [contenteditable="true"]')]
      .filter(visible);
  }

  function findBy(words) {
    const nodes = candidates();
    return nodes.find((node) => words.some((word) => labelOf(node).includes(word)));
  }

  function assign(node, value) {
    if (!node) return false;
    node.focus();
    if ('value' in node) {
      const proto = Object.getPrototypeOf(node);
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(node, value);
      else node.value = value;
    } else {
      const selection = window.getSelection && window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('delete');
      node.textContent = value;
    }
    try {
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch (_) {
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const titleNode = findBy(['标题', 'title']) || candidates()[0];
  const bodyNode = findBy(['正文', '描述', '内容', '分享']) || candidates().find((node) => node !== titleNode);
  const titleOk = assign(titleNode, title);
  const bodyOk = assign(bodyNode, body);

  return {
    titleOk,
    bodyOk,
    titleText: titleNode ? (titleNode.value || titleNode.innerText || titleNode.textContent || '') : '',
    bodyText: bodyNode ? (bodyNode.value || bodyNode.innerText || bodyNode.textContent || '') : '',
  };
})()
`, tabId);
}

async function rednoteState(tabId) {
  return relay.evalJs(`
(() => {
  const pageText = document.body.innerText || '';
  const buttons = [...document.querySelectorAll('button, [role="button"]')]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map((node) => ({
      text: (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim(),
      disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true'
    }));
  const saveDraftButton = buttons.find((button) => /(存|保存).*草稿|草稿箱/.test(button.text) && !/发布/.test(button.text));
  const publishButton = [...document.querySelectorAll('button, [role="button"], div, span, xhs-publish-btn')]
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
        rect: { bottom: rect.bottom, height: rect.height, width: rect.width },
        tag: node.tagName,
        text: (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim(),
      };
    })
    .filter((item) => item.rect.width > 0 && item.rect.height > 0 && (item.text === '发布' || item.tag === 'XHS-PUBLISH-BTN'))
    .sort((a, b) => b.rect.bottom - a.rect.bottom)[0];
  const fileInput = document.querySelector(${JSON.stringify(FILE_INPUT_SELECTOR)});
  return {
    url: location.href,
    hasFileInput: Boolean(fileInput),
    buttons,
    autoSavedDraft: /编辑于|刚刚|草稿箱/.test(pageText),
    canSaveDraft: Boolean(saveDraftButton && !saveDraftButton.disabled),
    canPublish: Boolean(publishButton && !publishButton.disabled),
    hasPublishButton: Boolean(publishButton),
    publishSuccess: /发布成功/.test(pageText) || /[?&]published=true(?:&|$)/.test(location.search),
  };
})()
`, tabId);
}

async function clickSaveDraft(tabId) {
  return relay.evalJs(`
(() => {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const button = buttons.find((node) => {
    const rect = node.getBoundingClientRect();
    const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
    return rect.width > 0
      && rect.height > 0
      && /(存|保存).*草稿|草稿箱/.test(text)
      && !/发布/.test(text)
      && !node.disabled
      && node.getAttribute('aria-disabled') !== 'true';
  });
  if (!button) return { ok: false, reason: 'save draft button not found' };
  button.click();
  return { ok: true };
})()
`, tabId);
}

async function clickPublishButton(tabId) {
  const action = await relay.evalJs(`
(() => {
  const host = document.querySelector('xhs-publish-btn[submit-disabled="false"]') || document.querySelector('xhs-publish-btn');
  if (host) {
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, reason: 'publish button not visible' };
    host.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof host._onPublish === 'function') {
      host._onPublish();
      return { ok: true, mode: 'xhs-publish-btn-event' };
    }
    const root = host.shadowRoot || host._sr;
    const shadowButton = root && [...root.querySelectorAll('button, [role="button"]')]
      .find((node) => {
        const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
        const buttonRect = node.getBoundingClientRect();
        return buttonRect.width > 0
          && buttonRect.height > 0
          && text === '发布'
          && !node.disabled
          && node.getAttribute('aria-disabled') !== 'true';
      });
    if (shadowButton) {
      shadowButton.click();
      return { ok: true, mode: 'xhs-publish-btn-shadow-button' };
    }
    const updated = host.getBoundingClientRect();
    return {
      ok: true,
      mode: 'coordinate',
      // xhs-publish-btn renders "暂存离开" on the left and "发布" on the right.
      // Click the right-side red publish button instead of the host center.
      x: updated.left + updated.width * 0.66,
      y: updated.top + updated.height * 0.5,
    };
  }

  const candidates = [...document.querySelectorAll('button, [role="button"], div, span')]
    .map((node) => {
    const rect = node.getBoundingClientRect();
    const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
      return { node, rect, text };
    })
    .filter(({ node, rect, text }) => rect.width > 0
      && rect.height > 0
      && text === '发布'
      && !node.disabled
      && node.getAttribute('aria-disabled') !== 'true')
    .sort((a, b) => b.rect.bottom - a.rect.bottom);
  const button = candidates[0] && candidates[0].node;
  if (!button) return { ok: false, reason: 'publish button not found' };
  button.scrollIntoView({ block: 'center', inline: 'center' });
  button.click();
  return { ok: true };
})()
`, tabId);
  if (action && action.mode === "coordinate") {
    await relay.clickAt(action.x, action.y, tabId);
    return { ok: true, fallback: "xhs-publish-btn-coordinate", x: action.x, y: action.y };
  }
  return action;
}

function publishSucceeded(state = {}) {
  if (state.publishSuccess) return true;
  if (/[?&]published=true(?:&|$)/.test(String(state.url || ""))) return true;
  return !state.hasPublishButton && !state.hasFileInput;
}

async function waitForPublishCompletion(tabId, options = {}) {
  let state = await rednoteState(tabId);
  for (let attempt = 0; attempt < Number(options.attempts || 20); attempt += 1) {
    if (publishSucceeded(state)) return state;
    await sleep(Number(options.intervalMs || 2000));
    state = await rednoteState(tabId);
  }
  return state;
}

async function draftNote(note, options = {}) {
  const noteId = options.noteId || note.id || "manual";
  const cover = options.coverPath || rednoteStore.coverPath(noteId);
  const coverResult = await renderCover(note, cover, options);
  const tabId = await openRednoteEditor();
  await waitForEditor(tabId);
  await relay.uploadFile(cover, FILE_INPUT_SELECTOR, tabId);
  await sleep(2500);

  const fill = await fillFields(tabId, note);
  if (!fill || !fill.titleOk || !fill.bodyOk) {
    throw new Error("Rednote title/body fields were not filled");
  }

  const state = await rednoteState(tabId);
  const filledScreenshot = rednoteStore.screenshotPath(noteId, "filled");
  await relay.screenshot(filledScreenshot, tabId);

  if (options.save === false && !options.publish) {
    return {
      tabId,
      cover,
      coverProvider: coverResult.provider,
      coverFallbackError: coverResult.fallbackError,
      coverFallbackFrom: coverResult.fallbackFrom,
      screenshot: filledScreenshot,
      state,
      savedDraft: false,
    };
  }

  if (options.publish) {
    const published = await clickPublishButton(tabId);
    const afterPublishState = await waitForPublishCompletion(tabId);
    const postedScreenshot = rednoteStore.screenshotPath(noteId, "posted");
    await relay.screenshot(postedScreenshot, tabId);
    const posted = Boolean(published && published.ok && publishSucceeded(afterPublishState));
    return {
      tabId,
      cover,
      coverProvider: coverResult.provider,
      coverFallbackError: coverResult.fallbackError,
      coverFallbackFrom: coverResult.fallbackFrom,
      screenshot: filledScreenshot,
      posted,
      postedScreenshot,
      publishError: posted ? null : published && published.reason ? published.reason : "publish did not complete",
      savedDraft: false,
      state: afterPublishState,
    };
  }

  const saved = await clickSaveDraft(tabId);
  await sleep(2000);
  const afterSaveState = await rednoteState(tabId);
  if ((!saved || !saved.ok) && !afterSaveState.autoSavedDraft) {
    return {
      tabId,
      cover,
      coverProvider: coverResult.provider,
      coverFallbackError: coverResult.fallbackError,
      coverFallbackFrom: coverResult.fallbackFrom,
      screenshot: filledScreenshot,
      state: afterSaveState,
      savedDraft: false,
      saveError: saved && saved.reason ? saved.reason : "save draft failed",
    };
  }

  const draftedScreenshot = rednoteStore.screenshotPath(noteId, "drafted");
  await relay.screenshot(draftedScreenshot, tabId);
  return {
    tabId,
    cover,
    coverProvider: coverResult.provider,
    coverFallbackError: coverResult.fallbackError,
    coverFallbackFrom: coverResult.fallbackFrom,
    screenshot: filledScreenshot,
    draftedScreenshot,
    state: afterSaveState,
    savedDraft: true,
  };
}

module.exports = {
  FILE_INPUT_SELECTOR,
  REDNOTE_PUBLISH_URL,
  bodyWithTags,
  clickPublishButton,
  clickSaveDraft,
  draftNote,
  fillFields,
  publishSucceeded,
  rednoteState,
  renderCover,
  waitForEditor,
};
