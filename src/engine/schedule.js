'use strict';

// Pure next-run-at math for scheduled suite runs. No I/O, no `electron`
// import — ISO strings in, ISO strings (or null) out, so it stays testable
// with plain `node --test` and safe to call from both the Electron main
// process and a background scheduler.

function computeNextRunAt(schedule, fromIso) {
  const from = new Date(fromIso);
  const at = new Date(schedule.at);

  if (schedule.recurrence === 'once') {
    return at.getTime() > from.getTime() ? at.toISOString() : null;
  }

  // Anchor a candidate on "today" (relative to `from`) at `at`'s time-of-day,
  // then roll forward until it's strictly after `from` (and, for weekly,
  // also lands on `at`'s weekday).
  const candidate = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    at.getUTCHours(),
    at.getUTCMinutes(),
    at.getUTCSeconds(),
    at.getUTCMilliseconds()
  ));

  if (schedule.recurrence === 'daily') {
    while (candidate.getTime() <= from.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate.toISOString();
  }

  if (schedule.recurrence === 'weekly') {
    const targetDay = at.getUTCDay();
    while (candidate.getTime() <= from.getTime() || candidate.getUTCDay() !== targetDay) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return candidate.toISOString();
  }

  throw new Error(`Unknown recurrence: ${schedule.recurrence}`);
}

module.exports = { computeNextRunAt };
