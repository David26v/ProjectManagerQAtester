'use strict';

// Local REST API — thin controller layer over the store + runner. Never
// `require('electron')`; binds 127.0.0.1 only so it is never reachable off
// the local machine. Every route stays thin: parse the request, call the
// store / runSuiteFn, translate the result to JSON.

const express = require('express');

function resolveEnvironment(project, environmentName) {
  const envs = project.environments || [];
  if (environmentName) {
    return envs.find((e) => e.name === environmentName) || { name: environmentName, baseUrl: project.baseUrl };
  }
  if (project.defaultEnvironment) {
    return envs.find((e) => e.name === project.defaultEnvironment) || null;
  }
  return envs[0] || null;
}

function createApi({ store, runSuiteFn }) {
  const app = express();
  app.use(express.json());

  app.get('/projects', (req, res) => {
    res.json(store.listProjects());
  });

  app.get('/projects/:id/suites', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: `Project "${req.params.id}" not found` });
    res.json(store.listSuites(project.id));
  });

  app.post('/projects/:id/suites/:suiteId/run', async (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: `Project "${req.params.id}" not found` });

    const suite = store.getSuite(req.params.suiteId);
    if (!suite || suite.projectId !== project.id) {
      return res.status(404).json({ error: `Suite "${req.params.suiteId}" not found` });
    }

    try {
      const environment = resolveEnvironment(project, req.body && req.body.environment);
      const report = await runSuiteFn({ store, suite, project, environment, triggeredBy: 'api' });
      res.status(201).json(report);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/runs', (req, res) => {
    const { projectId, suiteId } = req.query;
    const filter = suiteId ? { suiteId, projectId } : projectId;
    res.json(store.listRuns(filter));
  });

  app.get('/runs/:runId/report', (req, res) => {
    const run = store.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: `Run "${req.params.runId}" not found` });
    res.json(run);
  });

  app.post('/webhooks/deploy-complete', async (req, res) => {
    const { projectId, tag = 'smoke' } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const project = store.getProject(projectId);
    if (!project) return res.status(404).json({ error: `Project "${projectId}" not found` });

    try {
      const suites = store
        .listSuites(project.id)
        .filter((s) => !s.archived && Array.isArray(s.tags) && s.tags.includes(tag));

      const results = [];
      for (const suite of suites) {
        const environment = resolveEnvironment(project, suite.environment);
        const report = await runSuiteFn({ store, suite, project, environment, triggeredBy: 'api' });
        results.push({ runId: report.runId, status: report.status });
      }

      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/projects/:id/auth/status', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: `Project "${req.params.id}" not found` });
    res.json({ profiles: store.listCredentials(project.id) });
  });

  let server = null;

  function listen(port = 4317) {
    return new Promise((resolve, reject) => {
      server = app.listen(port, '127.0.0.1', () => {
        resolve(server.address().port);
      });
      server.on('error', reject);
    });
  }

  function close() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  }

  return { app, listen, close };
}

module.exports = { createApi };
