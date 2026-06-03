"use strict";

const DEFAULT_ENDPOINT = "https://ai.liaobots1.work/v1/chat/completions";

function normalizeChatCompletionsEndpoint(value = DEFAULT_ENDPOINT) {
  const raw = String(value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(raw)) return raw;
  if (/\/v\d+(?:\.\d+)?$/i.test(raw)) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
}

function chatCompletionsEndpoint(options = {}, env = process.env) {
  return normalizeChatCompletionsEndpoint(
    options.endpoint
      || env.XPOST_LIAOBOTS_ENDPOINT
      || env.XPOST_LIAOBOTS_BASE_URL
      || env.LIAOBOTS_BASE_URL
      || DEFAULT_ENDPOINT,
  );
}

function imageCompletionsEndpoint(options = {}, env = process.env) {
  return normalizeChatCompletionsEndpoint(
    options.endpoint
      || env.XPOST_LIAOBOTS_IMAGE_ENDPOINT
      || env.XPOST_LIAOBOTS_IMAGE_BASE_URL
      || env.XPOST_LIAOBOTS_ENDPOINT
      || env.XPOST_LIAOBOTS_BASE_URL
      || env.LIAOBOTS_BASE_URL
      || DEFAULT_ENDPOINT,
  );
}

module.exports = {
  DEFAULT_ENDPOINT,
  chatCompletionsEndpoint,
  imageCompletionsEndpoint,
  normalizeChatCompletionsEndpoint,
};
