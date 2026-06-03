"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDailyRandomSchedule,
  parseClock,
} = require("../src/schedule");

test("parseClock accepts HH:MM values", () => {
  assert.equal(parseClock("00:00"), 0);
  assert.equal(parseClock("06:00"), 360);
  assert.equal(parseClock("23:59"), 1439);
});

test("buildDailyRandomSchedule returns sorted random times inside the same-day window", () => {
  const values = [0.9, 0.1, 0.5, 0.25, 0.75];
  const now = new Date(2026, 4, 29, 0, 0, 0);
  const times = buildDailyRandomSchedule({
    count: 5,
    now,
    rng: () => values.shift(),
    windowStart: "00:00",
    windowEnd: "06:00",
  });

  assert.equal(times.length, 5);
  assert.deepEqual(times.map((time) => time.getHours()), [0, 1, 3, 4, 5]);
  assert.deepEqual(times.map((time) => time.getMinutes()), [36, 30, 0, 30, 24]);
  assert.ok(times.every((time) => time.getDate() === 29));
});

test("buildDailyRandomSchedule moves to tomorrow after the window has passed", () => {
  const now = new Date(2026, 4, 29, 7, 0, 0);
  const times = buildDailyRandomSchedule({
    count: 1,
    now,
    rng: () => 0,
    windowStart: "00:00",
    windowEnd: "06:00",
  });

  assert.equal(times[0].getDate(), 30);
  assert.equal(times[0].getHours(), 0);
  assert.equal(times[0].getMinutes(), 0);
});
