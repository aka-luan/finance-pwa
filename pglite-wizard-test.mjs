import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { ensureAdditiveTables } from './src/db/additive.mjs';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { splitSchema } from './src/db/schema.mjs';
import {
  confirmPlanning,
  getHoje,
  getMonthlyBudget,
  listRecurrences,
  needsFirstRun,
  roundHalfUpDiv,
} from './src/db/queries.mjs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

async function freshDb() {
  const db = await PGlite.create({ parsers: pgliteParsers });
  await db.exec(schemaSql);
  return db;
}

const today = '2026-08-12';

// ---------------------------------------------------------------------
// Gate (#18)
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  assert.equal(await needsFirstRun(db), true);

  await db.exec(`
    insert into account_anchor (id, date, amount_cents)
    values ('a0000000-0000-0000-0000-000000000001', '${today}', 100000);
  `);
  assert.equal(await needsFirstRun(db), true, 'anchor alone is still first-run');

  await db.exec(`
    insert into daily_estimate (id, amount_cents, effective_from)
    values ('d0000000-0000-0000-0000-000000000001', 5000, '${today}');
  `);
  assert.equal(await needsFirstRun(db), false);

  // Composition is optional for the gate.
  const emptyComp = await freshDb();
  await emptyComp.exec(`
    insert into account_anchor (id, date, amount_cents)
    values ('a0000000-0000-0000-0000-0000000000aa', '${today}', 1);
    insert into daily_estimate (id, amount_cents, effective_from)
    values ('d0000000-0000-0000-0000-0000000000aa', 100, '${today}');
  `);
  assert.equal(await needsFirstRun(emptyComp), false);
  assert.equal(await getMonthlyBudget(emptyComp, today), null);
}

// ---------------------------------------------------------------------
// Additive boot (#19): v1-only tables + ensureAdditiveTables
// ---------------------------------------------------------------------
{
  const db = await PGlite.create({ parsers: pgliteParsers });
  // Apply only the pre-monthly_budget half by creating core tables manually
  // then additive — mirrors an IndexedDB install that never saw the new DDL.
  const tablesHalf = splitSchema(schemaSql).tables;
  // Strip monthly_budget* from the tables half to simulate old schema.
  const v1Tables = tablesHalf
    .replace(/create table monthly_budget [\s\S]*?;\n\n/m, '')
    .replace(/create table monthly_budget_line [\s\S]*?;\n\n/m, '');
  assert.ok(!v1Tables.includes('monthly_budget'), 'fixture stripped new tables');
  await db.exec(v1Tables);
  await db.exec(splitSchema(schemaSql).replaceable);

  const before = await db.query(
    "select to_regclass('public.monthly_budget') as t",
  );
  assert.equal(before.rows[0].t, null);

  await ensureAdditiveTables(db);
  const after = await db.query(
    "select to_regclass('public.monthly_budget') as t, to_regclass('public.monthly_budget_line') as l",
  );
  assert.ok(after.rows[0].t);
  assert.ok(after.rows[0].l);

  // Idempotent.
  await ensureAdditiveTables(db);
}

// ---------------------------------------------------------------------
// Atomic confirm + fixos reconcile (#18 / #20)
// ---------------------------------------------------------------------
{
  const db = await freshDb();
  assert.equal(roundHalfUpDiv(150n, 30n), 5n);
  assert.equal(roundHalfUpDiv(149n, 30n), 5n);

  const catId = 'c0000000-0000-0000-0000-000000000001';
  const salarioId = 'b0000000-0000-0000-0000-000000000001';
  const aluguelId = 'b0000000-0000-0000-0000-000000000002';

  const result = await confirmPlanning(db, today, {
    balanceCents: 312_450n,
    categories: [
      { id: catId, name: 'Mercado', plannedCents: 90_000n },
      { name: 'Transporte', plannedCents: 30_000n },
    ],
    fixos: [
      {
        id: salarioId,
        kind: 'entrada',
        label: 'Salário',
        amountCents: 420_000n,
        dayOfMonth: 5,
      },
      {
        id: aluguelId,
        kind: 'saida',
        label: 'Aluguel',
        amountCents: 180_000n,
        dayOfMonth: 10,
      },
      {
        kind: 'saida',
        label: 'Zeroed',
        amountCents: 0n,
        dayOfMonth: 1,
      },
    ],
  });

  assert.equal(result.monthlyTotal, 120_000n);
  assert.equal(result.estimateCents, 4_000n); // 120000/30
  assert.equal(await needsFirstRun(db), false);

  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 312_450n);
  assert.equal(hoje.podeGastarCents, 4_000n);

  const budget = await getMonthlyBudget(db, today);
  assert.ok(budget);
  assert.equal(budget.lines.length, 2);
  assert.equal(budget.effective_from, today);

  const recs = await listRecurrences(db, today);
  assert.equal(recs.filter((r) => r.active).length, 2);
  const salario = recs.find((r) => r.id === salarioId);
  assert.ok(salario);
  assert.equal(salario.amount_cents, 420_000n);
  assert.equal(salario.day_of_month, 5);

  // Recalibrate: update salario, remove aluguel, add internet.
  const internetId = 'b0000000-0000-0000-0000-000000000003';
  await confirmPlanning(db, today, {
    balanceCents: 300_000n,
    categories: [
      { id: catId, name: 'Mercado', plannedCents: 60_000n },
    ],
    fixos: [
      {
        id: salarioId,
        kind: 'entrada',
        label: 'Salário',
        amountCents: 450_000n,
        dayOfMonth: 5,
      },
      {
        id: internetId,
        kind: 'saida',
        label: 'Internet',
        amountCents: 12_000n,
        dayOfMonth: 8,
      },
    ],
  });

  const after = await listRecurrences(db, today);
  const active = after.filter((r) => r.active);
  assert.equal(active.length, 2);
  assert.equal(active.find((r) => r.id === salarioId).amount_cents, 450_000n);
  assert.ok(active.find((r) => r.id === internetId));
  const aluguel = after.find((r) => r.id === aluguelId);
  assert.ok(aluguel);
  assert.equal(aluguel.active, false);

  const budget2 = await getMonthlyBudget(db, today);
  assert.equal(budget2.lines.length, 1);
  assert.equal(budget2.lines[0].amount_cents, 60_000n);

  // Card recurrence is never touched.
  await db.exec(`
    insert into card (id, name, closing_day, due_day) values
      ('ca000000-0000-0000-0000-000000000001', 'Nubank', 20, 5);
    insert into recurrence (id, kind, target, card_id, amount_cents, day_of_month,
                            label, start_date) values
      ('b0000000-0000-0000-0000-000000000099', 'saida', 'card',
       'ca000000-0000-0000-0000-000000000001', 4990, 1, 'Streaming', '2026-01-01');
  `);
  await confirmPlanning(db, today, {
    balanceCents: 300_000n,
    categories: [{ id: catId, name: 'Mercado', plannedCents: 30_000n }],
    fixos: [
      {
        id: salarioId,
        kind: 'entrada',
        label: 'Salário',
        amountCents: 450_000n,
        dayOfMonth: 5,
      },
    ],
  });
  const cardRec = await db.query(
    "select end_date from recurrence where id = 'b0000000-0000-0000-0000-000000000099'",
  );
  assert.equal(cardRec.rows[0].end_date, null, 'card recurrence must stay intact');
}

// Reject empty cotidiano.
{
  const db = await freshDb();
  await assert.rejects(
    () =>
      confirmPlanning(db, today, {
        balanceCents: 0n,
        categories: [{ name: 'Mercado', plannedCents: 0n }],
        fixos: [],
      }),
    /maior que zero/i,
  );
  assert.equal(await needsFirstRun(db), true, 'failed confirm leaves gate on');
}

console.log('pglite-wizard-test: ok');
