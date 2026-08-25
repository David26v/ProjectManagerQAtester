'use strict';

// Jira-style bug reporting (spec section 17). Generates a plain-text ticket
// from a failed Run report, and a Ticket object (Shared Data Model) for the
// kanban board. Never `require('electron')`.

const SEVERE_STEP_PATTERN = /login|checkout|payment/i;

function findFailingStep(run) {
  return run.steps.find((s) => s.status === 'failed');
}

function stepsUpToFailure(run) {
  const failIndex = run.steps.findIndex((s) => s.status === 'failed');
  const end = failIndex === -1 ? run.steps.length : failIndex + 1;
  return run.steps.slice(0, end);
}

function deriveSeverity(run, override) {
  if (override) return override;
  const failingStep = findFailingStep(run);
  if (failingStep && SEVERE_STEP_PATTERN.test(failingStep.name)) return 'high';
  return 'medium';
}

function hostFromUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function attachmentNames(run) {
  const media = (run.capturedMedia || []).filter((m) => {
    if (!run.reportSelection) return true;
    return run.reportSelection.selectedMediaIds.includes(m.id);
  });
  return media.map((m) => m.path.split(/[\\/]/).pop());
}

function generateTicketText(run, project, { severity, reporter } = {}) {
  const failingStep = findFailingStep(run);
  const resolvedSeverity = deriveSeverity(run, severity);
  const steps = stepsUpToFailure(run);
  const host = hostFromUrl(run.targetUrl);

  const lines = [
    `Summary: [${run.suiteName}] ${failingStep ? `${failingStep.name} fails` : 'Run failed'}`,
    `Environment: ${project.name} — ${run.environment || ''} (${host})`,
    `Severity: ${resolvedSeverity}`,
    `Reporter: ${reporter || 'QA'}`,
    `Status: Open`,
    '',
    'Steps to reproduce:',
    ...steps.map((s, i) => `${i + 1}. ${s.name}`),
    '',
    `Expected: "${failingStep ? failingStep.name : 'the step'}" to succeed`,
    `Actual: ${failingStep ? failingStep.error : 'Unknown error'}`,
    '',
    `Attachments: ${attachmentNames(run).join(', ')}`,
  ];

  return lines.join('\n');
}

function ticketFromRun(run, project, { reporter } = {}) {
  const failingStep = findFailingStep(run);
  const now = new Date().toISOString();

  return {
    title: `[${run.suiteName}] ${failingStep ? `${failingStep.name} fails` : 'Run failed'}`,
    description: generateTicketText(run, project),
    severity: deriveSeverity(run),
    status: 'backlog',
    projectId: project.id,
    runId: run.runId,
    labels: [],
    assignee: null,
    reporter: reporter || 'QA',
    reproductionSteps: stepsUpToFailure(run).map((s) => s.name),
    attachments: (run.capturedMedia || [])
      .filter((m) => !run.reportSelection || run.reportSelection.selectedMediaIds.includes(m.id))
      .map((m) => ({ mediaId: m.id, path: m.path, type: m.type })),
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
}

module.exports = { generateTicketText, ticketFromRun };
