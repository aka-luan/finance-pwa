// Backup e restauração (SPEC.md §5). Plain .mjs so the UI and the node test
// script share one implementation, same seam as pglite-config.mjs and
// queries.mjs.
//
// Format and trigger were left open in SPEC.md §11 and are resolved in
// docs/adr/0001-backup-json-manual.md: a manual, human-readable JSON dump of
// every table, restorable into an empty database.

export const BACKUP_FORMAT = 'termometro-backup';
export const BACKUP_VERSION = 1;

// Parents before children. Import inserts in this order because foreign keys
// are checked immediately, not deferred; the wipe truncates the whole list in
// one statement so the FKs between them are satisfied at the same instant.
//
// Adding a table here breaks older files: parseBackup requires every name in
// this list to be present, so a backup exported before the addition would be
// rejected. When this list grows, bump BACKUP_VERSION and teach parseBackup to
// accept the older version by filling the tables it predates with [].
export const BACKUP_TABLES = [
  'category',
  'card',
  'account_anchor',
  'recurrence',
  'transaction',
  'purchase',
  'daily_estimate',
  'estimate_dismissal',
  'day_settled',
];

// JSON has no bigint, and cents are bigint everywhere (SPEC.md §5). Writing
// them as strings keeps values exact — as numbers they would come back
// through JSON.parse as floats and silently lose precision above 2^53.
// Timestamps need no branch here: Date#toJSON has already turned them into
// ISO strings before a replacer ever sees them.
function bigintToString(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

// Reads every table into a plain object. Table names come from the constant
// above, never from input, so interpolating them into SQL is safe.
export async function exportBackup(db) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    // order by 1 is the primary key in every one of these tables, which makes
    // the file stable across exports and therefore diffable.
    const { rows } = await db.query(`select * from ${table} order by 1`);
    tables[table] = rows;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tables,
  };
}

// A table added to schema.sql but not to BACKUP_TABLES would be absent from
// every export, and nothing in the file would say so. The caller checks and
// tells the user which tables were left out.
//
// Exporting the rest anyway is deliberate: a backup missing one new table
// still holds the years of history this feature exists to protect, whereas
// refusing outright would leave the user with nothing. Restoring is safe
// either way — it only truncates the tables it knows about, so a table
// outside the list is never destroyed by a restore.
export async function findTablesOutsideBackup(db) {
  const { rows } = await db.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return rows
    .map((row) => row.table_name)
    .filter((name) => !BACKUP_TABLES.includes(name))
    .sort();
}

// Pretty-printed: the point of a text format over a binary datadir dump is
// that the user can open the file and see their history in it.
export function serializeBackup(backup) {
  return JSON.stringify(backup, bigintToString, 2);
}

// Validates before the database is touched. Restoring replaces everything, so
// a file that turns out to be unreadable halfway through would destroy live
// data — every rejection has to happen here, not during the import.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é JSON válido.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.format !== BACKUP_FORMAT) {
    throw new Error('O arquivo não é um backup do Termômetro.');
  }

  if (parsed.version !== BACKUP_VERSION) {
    throw new Error(
      `Backup na versão ${parsed.version}; este app lê a versão ${BACKUP_VERSION}.`,
    );
  }

  if (typeof parsed.exported_at !== 'string') {
    throw new Error('Backup sem data de exportação.');
  }

  if (parsed.tables === null || typeof parsed.tables !== 'object') {
    throw new Error('Backup sem tabelas.');
  }

  // Every table has to be there. Treating a missing one as empty would let a
  // file with `tables: {}` pass validation and wipe the database — the exact
  // failure this function exists to prevent. The cost is that growing
  // BACKUP_TABLES invalidates older files, which is why that list carries the
  // instruction to bump BACKUP_VERSION and fill the new tables with [] here.
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(parsed.tables[table])) {
      throw new Error(`Backup incompleto: falta a tabela ${table}.`);
    }
  }

  return parsed;
}

// Replaces all data with the backup's. Merging would need a conflict rule this
// app has no basis for — one user, one device, and a restore means "this file
// is the truth now" (SPEC.md §2).
export async function importBackup(db, backup) {
  await db.transaction(async (tx) => {
    // One statement for every table: truncating a subset is rejected outright
    // when a table left out references one being truncated.
    await tx.query(`truncate table ${BACKUP_TABLES.join(', ')}`);

    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table];
      if (rows.length === 0) continue;

      // json_populate_recordset applies each column's own input function, so
      // Postgres converts the strings back to bigint/date/uuid/enum itself and
      // no per-column casting has to be maintained here. It matches by name,
      // so column order in the file doesn't matter.
      await tx.query(
        `insert into ${table}
         select * from json_populate_recordset(null::${table}, $1::json)`,
        [JSON.stringify(rows, bigintToString)],
      );
    }
  });
}
