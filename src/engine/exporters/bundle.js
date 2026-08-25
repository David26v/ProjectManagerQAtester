'use strict';

// "Send to David" zip bundler (spec section 5 delivery + section 21
// selection). Zips report.json + selected media from a run directory into a
// single file named with the suite and date. Never `require('electron')`.

const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'run';
}

function bundleFileName(run) {
  const date = (run.startedAt || new Date().toISOString()).slice(0, 10);
  return `bugreport_${slug(run.suiteName)}_${date}.zip`;
}

function mediaToInclude(run, includeMediaIds) {
  const media = run.capturedMedia || [];
  if (includeMediaIds) {
    return media.filter((m) => includeMediaIds.includes(m.id));
  }
  if (run.reportSelection) {
    return media.filter((m) => run.reportSelection.selectedMediaIds.includes(m.id));
  }
  return media;
}

async function createBundle(run, runDirPath, outputPath, { includeMediaIds = null, fileName = null } = {}) {
  fs.mkdirSync(outputPath, { recursive: true });
  // `fileName` carries the user's chosen filename through from the save
  // dialog (ipc.js) — falls back to the engine-derived name only when the
  // caller doesn't have one (e.g. no dialog involved).
  const finalPath = path.join(outputPath, fileName || bundleFileName(run));

  const reportFile = path.join(runDirPath, 'report.json');
  const reportBuffer = fs.existsSync(reportFile)
    ? fs.readFileSync(reportFile)
    : Buffer.from(JSON.stringify(run, null, 2));

  const media = mediaToInclude(run, includeMediaIds);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(finalPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.append(reportBuffer, { name: 'report.json' });

    for (const item of media) {
      const filePath = path.join(runDirPath, item.path);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: item.path.split(/[\\/]/).pop() });
      }
    }

    archive.finalize();
  });

  return finalPath;
}

module.exports = { createBundle };
