import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  exportBackup,
  findTablesOutsideBackup,
  importBackup,
  parseBackup,
  serializeBackup,
} from './src/db/backup.mjs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// A wiped IndexedDB is exactly this: a fresh database with the schema applied
// and nothing in it. Every restore assertion below imports into one.
async function freshDb() {
  const db = await PGlite.create({ parsers: pgliteParsers });
  await db.exec(schemaSql);
  return db;
}

const today = '2026-08-09';

// Deep-compares timeline output across databases. bigint doesn't survive
// assert's diff rendering well, so normalize to strings first.
async function timelineOf(db) {
  const { rows } = await db.query(
    'select * from timeline($1::date, ($1::date + interval \'12 months\')::date, $1::date)',
    [today],
  );
  return JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

async function rowCounts(db) {
  const counts = {};
  for (const table of BACKUP_TABLES) {
    const { rows } = await db.query(`select count(*) as n from ${table}`);
    counts[table] = rows[0].n.toString();
  }
  return counts;
}

// Every column of every table, as the export sees them. The timeline alone is
// too weak an oracle: it reads none of day_settled, estimate_dismissal,
// category.name, recurrence.label or purchase.description, so a round-trip
// that mangled any of those would still produce an identical timeline and an
// identical row count.
async function tablesOf(db) {
  const { tables } = await exportBackup(db);
  return JSON.stringify(tables, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// day_settled is what separates "não gastei nada" from "esqueci" (SPEC.md §8)
// and is invisible to the timeline, so it gets its own check.
async function pendingDaysOf(db) {
  const { rows } = await db.query('select pending_days::text as day from pending_days($1::date)', [
    today,
  ]);
  return rows.map((r) => r.day).join(',');
}

// ---------------------------------------------------------------------
// The guard that matters most: a table missing from BACKUP_TABLES would be
// silently dropped by every export, which is worse than having no backup.
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  const { rows } = await db.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const inSchema = rows.map((r) => r.table_name).sort();
  assert.deepEqual([...BACKUP_TABLES].sort(), inSchema, 'BACKUP_TABLES must cover every base table');
}

// The same drift is reported at runtime, so it reaches the user even if this
// test is never run again — and the export still happens, because a backup
// missing one new table is worth more than no backup at all.
{
  const db = await freshDb();
  assert.deepEqual(await findTablesOutsideBackup(db), []);

  await db.exec('create table stray (id uuid primary key)');
  assert.deepEqual(await findTablesOutsideBackup(db), ['stray']);

  const backup = await exportBackup(db);
  assert.deepEqual(
    Object.keys(backup.tables).sort(),
    [...BACKUP_TABLES].sort(),
    'a stray table must not stop the known ones from being exported',
  );
}

// ---------------------------------------------------------------------
// Empty database: a valid, complete, restorable file — not an error.
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  const backup = await exportBackup(db);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.match(backup.exported_at, /^\d{4}-\d{2}-\d{2}T/);
  for (const table of BACKUP_TABLES) {
    assert.deepEqual(backup.tables[table], [], `${table} should export as an empty array`);
  }

  const restored = await freshDb();
  await importBackup(restored, parseBackup(serializeBackup(backup)));
  assert.deepEqual(await rowCounts(restored), await rowCounts(db));
}

// ---------------------------------------------------------------------
// The acceptance criterion: export, wipe, import reproduces the timeline.
// The fixture touches every table and every CHECK-constrained shape.
// ---------------------------------------------------------------------
const seeded = await freshDb();
await seeded.exec(`
  insert into category (id, name) values
    ('c0000000-0000-0000-0000-000000000001', 'Mercado');

  insert into card (id, name, closing_day, due_day, archived_at) values
    ('ca000000-0000-0000-0000-000000000001', 'Nubank', 20, 5, null),
    ('ca000000-0000-0000-0000-000000000002', 'Antigo', 10, 15, '2026-03-01');

  insert into account_anchor (id, date, amount_cents) values
    ('a0000000-0000-0000-0000-000000000001', '2026-07-01', 250000),
    ('a0000000-0000-0000-0000-000000000002', '2026-08-01', 312345);

  insert into daily_estimate (id, amount_cents, effective_from) values
    ('d0000000-0000-0000-0000-000000000001', 5000, '2026-01-01'),
    ('d0000000-0000-0000-0000-000000000002', 6290, '2026-07-15');

  -- account recurrence, plus a card recurrence (must be 'saida' with a card)
  insert into recurrence (id, kind, target, card_id, amount_cents, day_of_month,
                          label, category_id, start_date, end_date) values
    ('b0000000-0000-0000-0000-000000000001', 'saida', 'account', null, 180000, 10,
     'Financiamento', null, '2026-01-01', null),
    ('b0000000-0000-0000-0000-000000000002', 'entrada', 'account', null, 700000, 5,
     'Salário', null, '2026-01-01', '2027-12-31'),
    ('b0000000-0000-0000-0000-000000000003', 'saida', 'card',
     'ca000000-0000-0000-0000-000000000001', 4990, 1, 'Streaming', null, '2026-01-01', null);

  -- plain diário, an entrada, a recurrence exception, and a real bill payment
  insert into transaction (id, date, kind, amount_cents, category_id, note,
                           recurrence_id, occurrence_date, card_id, cycle_month) values
    ('70000000-0000-0000-0000-000000000001', '2026-08-05', 'diario', 4200,
     'c0000000-0000-0000-0000-000000000001', 'padaria', null, null, null, null),
    ('70000000-0000-0000-0000-000000000002', '2026-08-06', 'entrada', 150000,
     null, null, null, null, null, null),
    ('70000000-0000-0000-0000-000000000003', '2026-08-10', 'saida', 179000,
     null, 'parcela renegociada', 'b0000000-0000-0000-0000-000000000001', '2026-08-10', null, null),
    ('70000000-0000-0000-0000-000000000004', '2026-08-05', 'saida', 88000,
     null, null, null, null, 'ca000000-0000-0000-0000-000000000001', '2026-07-01');

  -- a 7x purchase: 100000 / 7 leaves a remainder that lands on parcela 1
  insert into purchase (id, card_id, date, amount_cents, installments, description, category_id) values
    ('90000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
     '2026-08-03', 100000, 7, 'Geladeira', null),
    ('90000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001',
     '2026-08-25', 4599, 1, null, 'c0000000-0000-0000-0000-000000000001');

  insert into day_settled (day) values ('2026-08-04'), ('2026-08-07');
  insert into estimate_dismissal (month) values ('2026-07-01');
`);

const seededTimeline = await timelineOf(seeded);
const seededCounts = await rowCounts(seeded);
const seededTables = await tablesOf(seeded);
const seededPending = await pendingDaysOf(seeded);

// Sanity: the fixture actually produces a moving balance and some pendências,
// so the equality assertions below are real and not two empty lists matching.
assert.ok(seededTimeline.length > 1000, 'fixture should produce a substantial timeline');
assert.ok(seededPending.length > 0, 'fixture should leave some dias pendentes');

const file = serializeBackup(await exportBackup(seeded));
assert.equal(typeof file, 'string');

{
  const restored = await freshDb();
  await importBackup(restored, parseBackup(file));

  assert.deepEqual(await rowCounts(restored), seededCounts);
  assert.equal(await timelineOf(restored), seededTimeline, 'timeline must survive the round-trip');
  assert.equal(await tablesOf(restored), seededTables, 'every column of every table must survive');
  assert.equal(await pendingDaysOf(restored), seededPending, 'dias pendentes must survive');

  // Spot-check the values the timeline is built from, not just its total.
  const bill = await restored.query(
    `select amount_cents, due_date from card_bill
     where card_id = 'ca000000-0000-0000-0000-000000000001' and cycle_month = '2026-08-01'`,
  );
  const seededBill = await seeded.query(
    `select amount_cents, due_date from card_bill
     where card_id = 'ca000000-0000-0000-0000-000000000001' and cycle_month = '2026-08-01'`,
  );
  assert.deepEqual(bill.rows, seededBill.rows);

  // Text, enums, dates and nullable columns, not just the numbers.
  const tx = await restored.query(
    `select date, kind, note, category_id, occurrence_date, cycle_month
     from transaction order by id`,
  );
  const seededTx = await seeded.query(
    `select date, kind, note, category_id, occurrence_date, cycle_month
     from transaction order by id`,
  );
  assert.deepEqual(tx.rows, seededTx.rows);
  assert.equal(tx.rows[0].note, 'padaria');
  assert.equal(tx.rows[0].date, '2026-08-05', 'dates must stay YYYY-MM-DD strings');

  const card = await restored.query('select archived_at from card order by id');
  assert.equal(card.rows[1].archived_at, '2026-03-01', 'nullable date column preserved');
}

// ---------------------------------------------------------------------
// Cents are bigint end to end (SPEC.md §5) — a float round-trip would
// corrupt values above 2^53 silently.
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  await db.exec(`
    insert into account_anchor (id, date, amount_cents)
    values ('a0000000-0000-0000-0000-0000000000ff', '2026-08-01', 9007199254740993);
  `);
  const backup = await exportBackup(db);
  assert.equal(backup.tables.account_anchor[0].amount_cents, 9007199254740993n);

  const text = serializeBackup(backup);
  assert.ok(text.includes('"9007199254740993"'), 'bigint must serialize as a JSON string');

  const restored = await freshDb();
  await importBackup(restored, parseBackup(text));
  const { rows } = await db.query('select amount_cents from account_anchor');
  const back = await restored.query('select amount_cents from account_anchor');
  assert.equal(back.rows[0].amount_cents, 9007199254740993n);
  assert.equal(back.rows[0].amount_cents, rows[0].amount_cents);
}

// ---------------------------------------------------------------------
// Restore replaces, it never merges: whatever was there before is gone.
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  await db.exec(`
    insert into account_anchor (id, date, amount_cents)
    values ('a0000000-0000-0000-0000-0000000000aa', '2026-06-01', 999999);
    insert into transaction (id, date, kind, amount_cents)
    values ('70000000-0000-0000-0000-0000000000aa', '2026-06-02', 'diario', 1234);
    insert into day_settled (day) values ('2026-06-03');
  `);

  await importBackup(db, parseBackup(file));
  assert.deepEqual(await rowCounts(db), seededCounts);
  assert.equal(await tablesOf(db), seededTables);
  assert.equal(await pendingDaysOf(db), seededPending);

  const stale = await db.query(
    "select count(*) as n from transaction where id = '70000000-0000-0000-0000-0000000000aa'",
  );
  assert.equal(stale.rows[0].n, 0n, 'pre-existing rows must not survive a restore');
}

// Importing the same file twice is idempotent — no duplicate-key explosion.
{
  const db = await freshDb();
  await importBackup(db, parseBackup(file));
  await importBackup(db, parseBackup(file));
  assert.equal(await tablesOf(db), seededTables);
}

// importBackup also accepts an exportBackup result directly (bigints and all),
// not only a parsed file.
{
  const db = await freshDb();
  await importBackup(db, await exportBackup(seeded));
  assert.equal(await tablesOf(db), seededTables);
}

// ---------------------------------------------------------------------
// A bad file is rejected before anything is touched — the user must never
// lose live data to a failed restore.
// ---------------------------------------------------------------------
{
  assert.throws(() => parseBackup('not json at all'), /JSON/i);
  assert.throws(() => parseBackup('[]'), /backup do Termômetro/i);
  assert.throws(() => parseBackup('null'), /backup do Termômetro/i);
  assert.throws(() => parseBackup(JSON.stringify({ hello: 'world' })), /backup do Termômetro/i);
  assert.throws(
    () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, tables: {} })),
    /vers/i,
  );
  assert.throws(
    () => parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, tables: {} }),
    ),
    /data de exporta/i,
  );

  const missing = JSON.parse(file);
  delete missing.tables.purchase;
  assert.throws(() => parseBackup(JSON.stringify(missing)), /purchase/);

  // Rejection happens in parseBackup, so the database is never reached.
  const db = await freshDb();
  await importBackup(db, parseBackup(file));
  assert.throws(() => parseBackup('{"format":"other"}'), /backup do Termômetro/i);
  assert.deepEqual(await rowCounts(db), seededCounts, 'a rejected file leaves data intact');
}

console.log('pglite-backup-test: ok');
