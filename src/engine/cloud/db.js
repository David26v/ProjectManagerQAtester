const { PrismaClient } = require('@prisma/client');

// SHARED-PROJECT ISOLATION: the target Postgres also hosts a live ERP in its
// `public` schema. Astreus must only ever touch the `astreus` schema, and
// Prisma confines itself (tables + internal bookkeeping) to whatever schema
// is named in the connection string's `schema=` param. Refuse to construct a
// client unless that param is explicitly present.
function createPrisma() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!/[?&]schema=astreus(&|$)/.test(url)) {
    throw new Error('DATABASE_URL must include schema=astreus (shared-project isolation)');
  }
  return new PrismaClient();
}

module.exports = { createPrisma };
