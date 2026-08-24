#!/usr/bin/env node
'use strict';

// CLI for the local QA Flow REST API. Talks over `fetch` to an already
// running `createApi` server (see src/engine/api.js) — it never touches the
// store or Playwright directly, keeping the engine boundary intact.

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

async function apiFetch(baseUrl, pathname, options) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `Request to ${pathname} failed with status ${res.status}`);
  }
  return body;
}

function findByIdOrName(list, idOrName) {
  const byId = list.find((item) => item.id === idOrName);
  if (byId) return byId;
  const needle = String(idOrName).toLowerCase();
  return list.find((item) => item.name.toLowerCase() === needle);
}

async function resolveProject(baseUrl, idOrName) {
  const projects = await apiFetch(baseUrl, '/projects');
  const project = findByIdOrName(projects, idOrName);
  if (!project) throw new Error(`Project "${idOrName}" not found`);
  return project;
}

async function resolveSuite(baseUrl, project, idOrName) {
  const suites = await apiFetch(baseUrl, `/projects/${project.id}/suites`);
  const suite = findByIdOrName(suites, idOrName);
  if (!suite) throw new Error(`Suite "${idOrName}" not found`);
  return suite;
}

async function cmdRun(args, baseUrl) {
  if (!args.project || !args.suite) {
    throw new Error('Usage: qaflow run --project <idOrName> --suite <idOrName> [--env <name>]');
  }

  const project = await resolveProject(baseUrl, args.project);
  const suite = await resolveSuite(baseUrl, project, args.suite);

  const report = await apiFetch(baseUrl, `/projects/${project.id}/suites/${suite.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ environment: args.env }),
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'failed') process.exitCode = 1;
}

async function cmdStatus(args, baseUrl) {
  if (!args.project) {
    throw new Error('Usage: qaflow status --project <idOrName>');
  }

  const project = await resolveProject(baseUrl, args.project);
  const suites = await apiFetch(baseUrl, `/projects/${project.id}/suites`);
  const runs = await apiFetch(baseUrl, `/runs?projectId=${project.id}`);

  const lastRunBySuite = {};
  for (const run of runs) {
    if (!lastRunBySuite[run.suiteId]) lastRunBySuite[run.suiteId] = run;
  }

  const result = suites.map((suite) => {
    const lastRun = lastRunBySuite[suite.id];
    return {
      id: suite.id,
      name: suite.name,
      archived: !!suite.archived,
      lastRunStatus: lastRun ? lastRun.status : null,
      lastRunAt: lastRun ? lastRun.finishedAt : null,
    };
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function cmdReport(args, baseUrl) {
  const runId = args['run-id'];
  if (!runId) {
    throw new Error('Usage: qaflow report --run-id <id> [--format json]');
  }

  const report = await apiFetch(baseUrl, `/runs/${runId}/report`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'failed') process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const port = args.port || 4317;
  const baseUrl = `http://127.0.0.1:${port}`;

  switch (command) {
    case 'run':
      await cmdRun(args, baseUrl);
      break;
    case 'status':
      await cmdStatus(args, baseUrl);
      break;
    case 'report':
      await cmdReport(args, baseUrl);
      break;
    default:
      process.stderr.write(`Usage: qaflow <run|status|report> [options]\n`);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
});
