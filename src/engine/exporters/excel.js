'use strict';

// Excel exporter (spec section 16). Summary sheet — one row per run; Step
// detail sheet — one row per step across all runs, with failure screenshots
// embedded via workbook.addImage. Never `require('electron')`.

const path = require('node:path');
const ExcelJS = require('exceljs');

function isSelected(run, mediaPath) {
  if (!run.reportSelection) return true;
  const media = (run.capturedMedia || []).find((m) => m.path === mediaPath);
  if (!media) return true;
  return run.reportSelection.selectedMediaIds.includes(media.id);
}

function durationSeconds(run) {
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  return Math.round((end - start) / 1000);
}

async function exportRunsToExcel(runs, runDirResolver, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Summary');
  const detail = workbook.addWorksheet('Step detail');

  summary.columns = [
    { header: 'Suite', key: 'suite', width: 24 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Duration (s)', key: 'duration', width: 14 },
    { header: 'Failed steps', key: 'failedCount', width: 14 },
  ];

  detail.columns = [
    { header: 'Suite', key: 'suite', width: 24 },
    { header: 'Step', key: 'step', width: 26 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Error', key: 'error', width: 40 },
    { header: 'Screenshot', key: 'screenshot', width: 20 },
  ];

  for (const run of runs) {
    summary.addRow({
      suite: run.suiteName,
      status: run.status,
      date: run.startedAt,
      duration: durationSeconds(run),
      failedCount: run.steps.filter((s) => s.status === 'failed').length,
    });

    const runDir = runDirResolver(run);

    for (const step of run.steps) {
      const row = detail.addRow({
        suite: run.suiteName,
        step: step.name,
        status: step.status,
        error: step.error || '',
        screenshot: step.screenshot || '',
      });

      if (step.screenshot && isSelected(run, step.screenshot)) {
        const imageId = workbook.addImage({
          filename: path.join(runDir, step.screenshot),
          extension: 'png',
        });
        detail.addImage(imageId, {
          tl: { col: 5, row: row.number - 1 },
          ext: { width: 160, height: 100 },
        });
      }
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}

module.exports = { exportRunsToExcel };
