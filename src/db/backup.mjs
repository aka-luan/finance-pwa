// Backup e restauração (SPEC.md §5). Plain .mjs so the UI and the node test
// script share one implementation, same seam as pglite-config.mjs and
// queries.mjs.
//
// Format and trigger were left open in SPEC.md §11 and are resolved in
// docs/adr/0001-backup-json-manual.md: a manual, human-readable JSON dump of
// every table, restorable into an empty database.
//
// Version 2 (ADR 0004): adds monthly_budget / monthly_budget_line. parseBackup
// still accepts v1 by filling those tables with [].

export const BACKUP_FORMAT = 'termometro-backup';
export const BACKUP_VERSION = 2;

/** Tables that did not exist in backup v1 — filled with [] when reading v1. */
export const BACKUP_V1_MISSING_TABLES = ['monthly_budget', 'monthly_budget_line'];

// Parents before children. Import inserts in this order because foreign keys
// are checked immediately, not deferred; the wipe truncates the whole list in
// one statement so the FKs between them are satisfied at the same instant.
export const BACKUP_TABLES = [
  'category',
  'monthly_budget',
  'monthly_budget_line',
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

  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error(
      `Backup na versão ${parsed.version}; este app lê as versões 1 e 2.`,
    );
  }

  if (typeof parsed.exported_at !== 'string') {
    throw new Error('Backup sem data de exportação.');
  }

  if (parsed.tables === null || typeof parsed.tables !== 'object') {
    throw new Error('Backup sem tabelas.');
  }

  // Tables the file's version already knew must be present. Tables introduced
  // later (v1 → monthly_budget*) are injected as [] so restore stays safe
  // without inventing a composition from daily_estimate (ADR 0004).
  const required =
    parsed.version === 1
      ? BACKUP_TABLES.filter((t) => !BACKUP_V1_MISSING_TABLES.includes(t))
      : BACKUP_TABLES;

  for (const table of required) {
    if (!Array.isArray(parsed.tables[table])) {
      throw new Error(`Backup incompleto: falta a tabela ${table}.`);
    }
  }

  if (parsed.version === 1) {
    for (const table of BACKUP_V1_MISSING_TABLES) {
      parsed.tables[table] = [];
    }
  }

  return parsed;
}

// Replaces all data with the backup's. Merging would need a conflict rule this
// app has no basis for — one user, one device, and a restore means "this file
// is the truth now" (SPEC.md §2).
export async function importBackup(db, backup) {
  await db.transaction(async (tx) => {
    await tx.query(`truncate table ${BACKUP_TABLES.join(', ')}`);

    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table];
      if (rows.length === 0) continue;

      await tx.query(
        `insert into ${table}
         select * from json_populate_recordset(null::${table}, $1::json)`,
        [JSON.stringify(rows, bigintToString)],
      );
    }
  });
}
