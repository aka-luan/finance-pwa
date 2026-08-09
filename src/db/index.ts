import { PGlite } from '@electric-sql/pglite';
import schemaSql from '../../schema.sql?raw';
import { DATA_DIR, pgliteParsers } from './pglite-config.mjs';

let dbPromise: Promise<PGlite> | null = null;

// Boots once per page load and reuses the same connection everywhere else
// in the app.
export function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = boot();
  }
  return dbPromise;
}

async function boot(): Promise<PGlite> {
  const db = await PGlite.create(DATA_DIR, { parsers: pgliteParsers });

  // schema.sql has no `if not exists` guards, so re-running it against an
  // already-initialized database throws. Applying it only when the schema
  // is missing keeps boot idempotent across reloads.
  const { rows } = await db.query<{ to_regclass: string | null }>(
    "select to_regclass('public.transaction') as to_regclass",
  );
  if (rows[0]?.to_regclass === null) {
    await db.exec(schemaSql);
  }

  return db;
}
