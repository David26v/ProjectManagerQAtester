const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

// Table names as Prisma creates them (quoted, PascalCase — matches the model
// names 1:1 since schema.prisma has no @@map overrides).
const ASTREUS_TABLES = ['Project', 'Suite', 'Run', 'Ticket', 'CredentialProfile', 'TicketCounter', 'Schedule'];

test('cloud db connectivity and schema', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set');
  const { createPrisma } = require('../src/engine/cloud/db.js');
  const prisma = createPrisma();
  try {
    await prisma.$queryRaw`SELECT 1`;
    for (const model of ['project', 'suite', 'run', 'ticket', 'credentialProfile', 'ticketCounter', 'schedule']) {
      assert.ok(Number.isInteger(await prisma[model].count()));
    }

    // SHARED-PROJECT ISOLATION: the durable, automated form of "public gained
    // no new tables" — a live before/after row count isn't meaningful in a
    // standalone test (the count reflects whatever the ERP happens to have
    // at test time, not a push delta), so assert the thing that would break
    // isolation instead: none of Astreus's tables leaked into `public`.
    const publicTables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const publicNames = new Set(publicTables.map((r) => r.table_name));
    for (const name of ASTREUS_TABLES) {
      assert.ok(!publicNames.has(name), `astreus table "${name}" must not exist in public schema`);
    }

    // And confirm astreus itself has exactly the 6 expected tables — no more,
    // no fewer — as a schema-drift tripwire.
    const astreusTables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'astreus'
    `;
    assert.strictEqual(astreusTables.length, ASTREUS_TABLES.length);
    const astreusNames = new Set(astreusTables.map((r) => r.table_name));
    for (const name of ASTREUS_TABLES) {
      assert.ok(astreusNames.has(name), `expected table "${name}" in astreus schema`);
    }
  } finally {
    await prisma.$disconnect();
  }
});
