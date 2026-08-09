import { PGlite } from '@electric-sql/pglite';
import schemaSql from '../../schema.sql?raw';
import { DATA_DIR, pgliteParsers } from './pglite-config.mjs';
import { splitSchema } from './schema.mjs';

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

  // The tables half of schema.sql has no `if not exists` guards, so
  // re-running it against an already-initialized database throws. A
  // database persisted in IndexedDB keeps its tables between releases but
  // would otherwise keep its old functions too, so the functions/views
  // half — all `create or replace` — is re-applied on every boot instead.
  const { rows } = await db.query<{ to_regclass: string | null }>(
    "select to_regclass('public.transaction') as to_regclass",
  );
  if (rows[0]?.to_regclass === null) {
    await db.exec(schemaSql);
  } else {
    await db.exec(splitSchema(schemaSql).replaceable);
  }

  return db;
}
