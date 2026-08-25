'use strict';

// contextBridge only — no Node/Electron APIs are exposed beyond the
// `window.qaflow` surface below. Every method is a thin `ipcRenderer.invoke`
// call; every method returns a Promise. Push events (`recorder:step`,
// `run:progress`) are subscribed to via `qaflow.on(channel, cb)`.

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}

const PUSH_CHANNELS = new Set(['recorder:step', 'run:progress', 'schedules:fired', 'browser:status']);

contextBridge.exposeInMainWorld('qaflow', {
  projects: {
    list: invoke('projects:list'),
    get: invoke('projects:get'),
    save: invoke('projects:save'),
    remove: invoke('projects:remove'),
  },
  suites: {
    list: invoke('suites:list'),
    get: invoke('suites:get'),
    save: invoke('suites:save'),
    remove: invoke('suites:remove'),
    importFromFile: invoke('suites:importFromFile'),
  },
  runs: {
    list: invoke('runs:list'),
    get: invoke('runs:get'),
    run: invoke('runs:run'),
    openDir: invoke('runs:openDir'),
  },
  recorder: {
    start: invoke('recorder:start'),
    stop: invoke('recorder:stop'),
    status: invoke('recorder:status'),
  },
  session: {
    capture: invoke('session:capture'),
    saveManual: invoke('session:saveManual'),
    finish: invoke('session:finish'),
    cancel: invoke('session:cancel'),
    list: invoke('session:list'),
    remove: invoke('session:remove'),
  },
  reports: {
    saveSelection: invoke('reports:saveSelection'),
    exportExcel: invoke('reports:exportExcel'),
    exportJson: invoke('reports:exportJson'),
    bundle: invoke('reports:bundle'),
    ticketText: invoke('reports:ticketText'),
    createTicket: invoke('reports:createTicket'),
  },
  tickets: {
    list: invoke('tickets:list'),
    save: invoke('tickets:save'),
    remove: invoke('tickets:remove'),
  },
  settings: {
    get: invoke('settings:get'),
    save: invoke('settings:save'),
  },
  schedules: {
    list: invoke('schedules:list'),
    save: invoke('schedules:save'),
    remove: invoke('schedules:remove'),
  },
  app: {
    version: invoke('app:version'),
    mediaUrl: invoke('app:mediaUrl'),
    revealPath: invoke('app:revealPath'),
  },
  on(channel, callback) {
    if (!PUSH_CHANNELS.has(channel)) throw new Error(`Unknown qaflow event channel "${channel}"`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
