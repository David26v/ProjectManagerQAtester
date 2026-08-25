'use strict';

// Pure-function coverage for src/renderer/src/lib/format.js — the renderer
// tree is ESM (`export function`), so this CJS test file reaches it via a
// dynamic import rather than `require`.

const test = require('node:test');
const assert = require('node:assert/strict');

test('timeUntil: "Tomorrow" holds across a month boundary (Aug 31 -> Sep 1)', async () => {
  const { timeUntil } = await import('../src/renderer/src/lib/format.js');

  const realDate = Date;
  const fixedNow = new realDate('2026-08-31T10:00:00.000');

  class FixedDate extends realDate {
    constructor(...args) {
      if (args.length === 0) return new realDate(fixedNow);
      return new realDate(...args);
    }
    static now() {
      return fixedNow.getTime();
    }
  }
  global.Date = FixedDate;

  try {
    // 25h out (>= the 24h cutoff for the "in Nh" branch) but still Sep 1 —
    // the calendar day right after Aug 31, i.e. "Tomorrow".
    const target = new realDate('2026-09-01T11:00:00.000').toISOString();
    const result = timeUntil(target);
    assert.match(result, /^Tomorrow /);
  } finally {
    global.Date = realDate;
  }
});
