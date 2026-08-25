'use strict';

// Background scheduler loop — polls `store.listSchedules()` every 60s and
// fires any schedule whose `nextRunAt` has arrived. All the actual next-run
// math lives in the pure, already-tested `engine/schedule.js`; this module
// is just the I/O shell around it (timer + store reads/writes + calling
// `executeRun`), which is why there's no dedicated test file for it — see
// task report for the reasoning trace.

const { computeNextRunAt } = require('../engine/schedule.js');

const POLL_INTERVAL_MS = 60_000;

function createScheduler({ store, executeRun, notify }) {
  let timer = null;

  async function checkNow() {
    const now = new Date().toISOString();
    const due = store.listSchedules().filter((s) => s.enabled && s.nextRunAt && s.nextRunAt <= now);

    // Sequential, not Promise.all — these launch real browser runs and
    // share the one-headed-browser assumption the recorder/run paths rely
    // on elsewhere in this app.
    for (const schedule of due) {
      let status;
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await executeRun(
          schedule.suiteId,
          { environment: schedule.environment, headless: true, credentialProfileId: schedule.credentialProfileId },
          'schedule'
        );
        status = result.status;
      } catch (e) {
        // A single schedule's run blowing up (missing suite, browser
        // launch failure, decrypt error) must not stop the rest of the
        // due schedules from running, and must not skip this schedule's
        // own bookkeeping below — it still gets lastRunAt/nextRunAt so it
        // doesn't spin retrying the same run every poll.
        status = 'error';
      }

      const lastRunAt = new Date().toISOString();
      const nextRunAt = computeNextRunAt(schedule, lastRunAt);
      const saved = store.saveSchedule({
        ...schedule,
        lastRunAt,
        nextRunAt,
        enabled: schedule.recurrence === 'once' ? false : schedule.enabled,
      });

      notify(saved, status);
    }
  }

  function start() {
    if (timer) return;
    // Fire once immediately so a schedule that's already due doesn't sit
    // waiting up to a full minute for the first tick after app launch.
    checkNow().catch((e) => console.error('[qaflow] scheduler checkNow failed:', e));
    timer = setInterval(() => {
      checkNow().catch((e) => console.error('[qaflow] scheduler checkNow failed:', e));
    }, POLL_INTERVAL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, checkNow };
}

module.exports = { createScheduler };
