const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

test('cloud db connectivity and schema', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');
  const { createPrisma } = require('../src/engine/cloud/db.js');
  const prisma = createPrisma();
  try {
    await prisma.$queryRaw`SELECT 1`;
    for (const model of ['project', 'suite', 'run', 'ticket', 'credentialProfile', 'ticketCounter']) {
      assert.ok(Number.isInteger(await prisma[model].count()));
    }
  } finally {
    await prisma.$disconnect();
  }
});
