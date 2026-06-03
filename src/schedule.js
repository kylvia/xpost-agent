"use strict";

const MINUTES_PER_DAY = 24 * 60;

function parseClock(value) {
  const match = String(value || "").match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Invalid clock value: ${value}. Use HH:MM.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function localDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function windowForDay(day, startMinutes, endMinutes) {
  const start = addMinutes(day, startMinutes);
  const endOffset = endMinutes <= startMinutes ? endMinutes + MINUTES_PER_DAY : endMinutes;
  const end = addMinutes(day, endOffset);
  return { start, end };
}

function activeWindow({ now, windowStart, windowEnd, minLeadMinutes }) {
  const startMinutes = parseClock(windowStart || "00:00");
  const endMinutes = parseClock(windowEnd || "06:00");
  let day = localDay(now);
  let window = windowForDay(day, startMinutes, endMinutes);
  const earliest = addMinutes(now, Number(minLeadMinutes || 0));

  if (earliest.getTime() >= window.end.getTime()) {
    day = addMinutes(day, MINUTES_PER_DAY);
    window = windowForDay(day, startMinutes, endMinutes);
    return window;
  }

  if (earliest.getTime() > window.start.getTime()) {
    return { start: earliest, end: window.end };
  }

  return window;
}

function buildDailyRandomSchedule(options = {}) {
  const count = Number(options.count || 5);
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");

  const rng = options.rng || Math.random;
  const now = options.now || new Date();
  const window = activeWindow({
    minLeadMinutes: options.minLeadMinutes,
    now,
    windowEnd: options.windowEnd || "06:00",
    windowStart: options.windowStart || "00:00",
  });
  const span = window.end.getTime() - window.start.getTime();
  if (span <= 0) throw new Error("schedule window must be positive");

  return Array.from({ length: count }, () => {
    const value = Math.min(Math.max(Number(rng()), 0), 0.999999999);
    return new Date(window.start.getTime() + Math.floor(value * span));
  }).sort((a, b) => a.getTime() - b.getTime());
}

module.exports = {
  buildDailyRandomSchedule,
  parseClock,
};
