'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeNextRunAt } = require('../src/engine/schedule.js');

const cases = [
  {
    name: 'once: future at returns the same at',
    schedule: { recurrence: 'once', at: '2026-09-01T10:00:00.000Z' },
    fromIso: '2026-08-25T00:00:00.000Z',
    expected: '2026-09-01T10:00:00.000Z',
  },
  {
    name: 'once: past at returns null',
    schedule: { recurrence: 'once', at: '2026-08-01T10:00:00.000Z' },
    fromIso: '2026-08-25T00:00:00.000Z',
    expected: null,
  },
  {
    name: 'once: at exactly equal to fromIso returns null (not strictly future)',
    schedule: { recurrence: 'once', at: '2026-08-25T00:00:00.000Z' },
    fromIso: '2026-08-25T00:00:00.000Z',
    expected: null,
  },
  {
    name: 'daily: time later today rolls to today',
    schedule: { recurrence: 'daily', at: '2026-01-01T15:00:00.000Z' },
    fromIso: '2026-08-25T10:00:00.000Z',
    expected: '2026-08-25T15:00:00.000Z',
  },
  {
    name: 'daily: time already passed today rolls to tomorrow',
    schedule: { recurrence: 'daily', at: '2026-01-01T09:00:00.000Z' },
    fromIso: '2026-08-25T10:00:00.000Z',
    expected: '2026-08-26T09:00:00.000Z',
  },
  {
    name: 'weekly: same weekday later today',
    schedule: { recurrence: 'weekly', at: '2026-08-18T15:00:00.000Z' }, // Tuesday
    fromIso: '2026-08-25T10:00:00.000Z', // Tuesday
    expected: '2026-08-25T15:00:00.000Z',
  },
  {
    name: 'weekly: same weekday but time already passed rolls to next week',
    schedule: { recurrence: 'weekly', at: '2026-08-18T09:00:00.000Z' }, // Tuesday
    fromIso: '2026-08-25T10:00:00.000Z', // Tuesday
    expected: '2026-09-01T09:00:00.000Z',
  },
  {
    name: 'weekly: different weekday rolls forward to that weekday',
    schedule: { recurrence: 'weekly', at: '2026-08-20T09:00:00.000Z' }, // Thursday
    fromIso: '2026-08-25T10:00:00.000Z', // Tuesday
    expected: '2026-08-27T09:00:00.000Z', // next Thursday
  },
];

for (const c of cases) {
  test(`computeNextRunAt: ${c.name}`, () => {
    const result = computeNextRunAt(c.schedule, c.fromIso);
    assert.equal(result, c.expected);
  });
}
