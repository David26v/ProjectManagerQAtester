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
  // Re-entrancy guard: a run kicked off from one tick can easily outlast the
  // 60s poll interval. Without this, the next tick's checkNow() sees the
  // same schedule (its bookkeeping only happens *after* the run finishes,
  // below) and launches a duplicate run of it.
  let checking = false;

  async function checkNow() {
    if (checking) return;
    checking = true;
    try {
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

        // Re-read the schedule fresh rather than reusing the pre-run
        // `schedule` object — a run can take long enough that the schedule
        // was deleted or edited (e.g. toggled off) while it was in flight.
        // Writing back the stale object would resurrect a deleted schedule
        // via upsert, or clobber whatever changed mid-run.
        const fresh = store.listSchedules().find((s) => s.id === schedule.id);
        if (!fresh) continue;

        const lastRunAt = new Date().toISOString();
        const nextRunAt = computeNextRunAt(fresh, lastRunAt);
        const saved = store.saveSchedule({
          ...fresh,
          lastRunAt,
          nextRunAt,
          enabled: fresh.recurrence === 'once' ? false : fresh.enabled,
        });

        notify(saved, status);
      }
    } finally {
      checking = false;
    }
  }

  // Sweep once at startup for schedules that lapsed while the app was shut
  // down — recompute their next run without executing them, matching the
  // documented "missed runs are skipped, not fired at next launch" behavior.
  // For a 'once' schedule that has no next occurrence, disable it so it
  // doesn't linger as perpetually "due".
  function sweepLapsed() {
    const now = new Date().toISOString();
    const lapsed = store.listSchedules().filter((s) => s.enabled && s.nextRunAt && s.nextRunAt <= now);
    for (const schedule of lapsed) {
      const nextRunAt = computeNextRunAt(schedule, now);
      store.saveSchedule({
        ...schedule,
        nextRunAt,
        enabled: schedule.recurrence === 'once' && nextRunAt == null ? false : schedule.enabled,
      });
    }
  }

  function start() {
    if (timer) return;
    sweepLapsed();
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
