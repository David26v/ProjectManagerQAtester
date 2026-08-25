'use strict';

// Pure Node storage layer — no `electron` import. Receives a base directory
// as a parameter so it is usable both from the Electron main process
// (userData/qaflow-data) and from `node --test` against a temp dir.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createStore(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'suites'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'credentials'), { recursive: true });

  const projectsFile = path.join(baseDir, 'projects.json');
  const suitesDir = path.join(baseDir, 'suites');
  const runsDir = path.join(baseDir, 'runs');
  const credentialsDir = path.join(baseDir, 'credentials');
  const credentialsIndexFile = path.join(credentialsDir, 'index.json');
  const ticketsFile = path.join(baseDir, 'tickets.json');
  const settingsFile = path.join(baseDir, 'settings.json');

  // ---- projects ----

  function listProjects() {
    return readJson(projectsFile, []);
  }

  function getProject(id) {
    return listProjects().find((p) => p.id === id);
  }

  function saveProject(p) {
    const projects = listProjects();
    const now = new Date().toISOString();
    const idx = projects.findIndex((existing) => existing.id === p.id);

    let saved;
    if (idx === -1) {
      saved = { ...p, id: p.id || crypto.randomUUID(), createdAt: p.createdAt || now, updatedAt: now };
      projects.push(saved);
    } else {
      saved = { ...projects[idx], ...p, createdAt: projects[idx].createdAt, updatedAt: now };
      projects[idx] = saved;
    }

    writeJson(projectsFile, projects);
    return saved;
  }

  function deleteProject(id) {
    const projects = listProjects().filter((p) => p.id !== id);
    writeJson(projectsFile, projects);
  }

  // ---- suites ----

  function suiteFile(id) {
    return path.join(suitesDir, `${id}.json`);
  }

  function listSuites(projectId) {
    const files = fs.readdirSync(suitesDir).filter((f) => f.endsWith('.json'));
    const suites = files.map((f) => readJson(path.join(suitesDir, f), null)).filter(Boolean);
    return projectId ? suites.filter((s) => s.projectId === projectId) : suites;
  }

  function getSuite(id) {
    return readJson(suiteFile(id), undefined);
  }

  function saveSuite(s) {
    const now = new Date().toISOString();
    const existing = s.id ? getSuite(s.id) : undefined;
    const saved = {
      ...existing,
      ...s,
      id: s.id || crypto.randomUUID(),
      createdAt: (existing && existing.createdAt) || s.createdAt || now,
      updatedAt: now,
    };
    writeJson(suiteFile(saved.id), saved);
    return saved;
  }

  function deleteSuite(id) {
    const file = suiteFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // ---- runs ----

  function runDir(runId) {
    return path.join(runsDir, runId);
  }

  function reportFile(runId) {
    return path.join(runDir(runId), 'report.json');
  }

  function listRuns(filter) {
    const projectId = typeof filter === 'string' ? filter : (filter && typeof filter === 'object' ? filter.projectId : undefined);
    const suiteId = filter && typeof filter === 'object' ? filter.suiteId : undefined;

    const dirs = fs.readdirSync(runsDir).filter((name) => {
      return fs.statSync(path.join(runsDir, name)).isDirectory();
    });

    let runs = dirs
      .map((runId) => readJson(reportFile(runId), null))
      .filter(Boolean);

    if (projectId) runs = runs.filter((r) => r.projectId === projectId);
    if (suiteId) runs = runs.filter((r) => r.suiteId === suiteId);

    runs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return runs;
  }

  function getRun(runId) {
    return readJson(reportFile(runId), undefined);
  }

  function saveRun(report) {
    const runId = report.runId || crypto.randomUUID();
    const saved = { ...report, runId };
    writeJson(reportFile(runId), saved);
    return saved;
  }

  // ---- credentials ----

  function credentialBlobFile(id) {
    return path.join(credentialsDir, `${id}.bin`);
  }

  function listCredentials(projectId) {
    const index = readJson(credentialsIndexFile, []);
    return projectId ? index.filter((c) => c.projectId === projectId) : index;
  }

  function saveCredential(meta, encryptedBuffer) {
    const index = readJson(credentialsIndexFile, []);
    const now = new Date().toISOString();
    const idx = index.findIndex((existing) => existing.id === meta.id);

    let saved;
    if (idx === -1) {
      saved = { ...meta, id: meta.id || crypto.randomUUID(), createdAt: meta.createdAt || now };
      index.push(saved);
    } else {
      saved = { ...index[idx], ...meta };
      index[idx] = saved;
    }

    writeJson(credentialsIndexFile, index);

    if (encryptedBuffer) {
      fs.writeFileSync(credentialBlobFile(saved.id), encryptedBuffer);
    }

    return saved;
  }

  function readCredentialBlob(id) {
    const file = credentialBlobFile(id);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  function deleteCredential(id) {
    const index = readJson(credentialsIndexFile, []).filter((c) => c.id !== id);
    writeJson(credentialsIndexFile, index);
    const file = credentialBlobFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // ---- tickets ----

  function listTickets() {
    return readJson(ticketsFile, []);
  }

  function nextTicketId(tickets) {
    const max = tickets.reduce((m, t) => {
      const n = Number(String(t.id).replace('BUG-', ''));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `BUG-${max + 1}`;
  }

  function saveTicket(t) {
    const tickets = listTickets();
    const now = new Date().toISOString();
    const idx = tickets.findIndex((existing) => existing.id === t.id);

    let saved;
    if (idx === -1) {
      saved = { ...t, id: t.id || nextTicketId(tickets), createdAt: t.createdAt || now, updatedAt: now };
      tickets.push(saved);
    } else {
      saved = { ...tickets[idx], ...t, createdAt: tickets[idx].createdAt, updatedAt: now };
      tickets[idx] = saved;
    }

    writeJson(ticketsFile, tickets);
    return saved;
  }

  function deleteTicket(id) {
    const tickets = listTickets().filter((t) => t.id !== id);
    writeJson(ticketsFile, tickets);
  }

  // ---- settings ----

  function getSettings() {
    return readJson(settingsFile, {});
  }

  function saveSettings(patch) {
    const merged = { ...getSettings(), ...patch };
    writeJson(settingsFile, merged);
    return merged;
  }

  return {
    listProjects,
    getProject,
    saveProject,
    deleteProject,
    listSuites,
    getSuite,
    saveSuite,
    deleteSuite,
    listRuns,
    getRun,
    runDir,
    saveRun,
    listCredentials,
    saveCredential,
    readCredentialBlob,
    deleteCredential,
    listTickets,
    saveTicket,
    deleteTicket,
    getSettings,
    saveSettings,
  };
}

module.exports = { createStore };
