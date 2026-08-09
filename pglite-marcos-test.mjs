// Marcos, pior momento e simulação (SPEC.md §6). Same seam as
// pglite-pending-test.mjs: exercises the query layer (getMarcos,
// getWorstPoint) that renderHoje calls, not just the raw SQL functions
// already covered by pglite-sim-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getMarcos, getWorstPoint } from './src/db/queries.mjs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const today = '2026-08-09';

async function freshDb() {
  const db = await PGlite.create({ parsers: pgliteParsers });
  await db.exec(schemaSql);
  return db;
}

async function anchor(db, date, amountCents) {
  await db.query('insert into account_anchor (id, date, amount_cents) values (gen_random_uuid(), $1::date, $2)', [
    date,
    amountCents,
  ]);
}

// Sem simulação, os quatro marcos batem com o saldo parado no anchor (sem
// lançamentos nem recorrências no caminho).
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);

  const marcos = await getMarcos(db, today);
  assert.deepEqual(
    marcos.map((m) => m.label),
    ['fim do mês', '3 meses', '6 meses', '12 meses'],
  );
  for (const m of marcos) assert.equal(m.balance_cents, 100000n);

  const pior = await getWorstPoint(db, today);
  assert.equal(pior.balance_cents, 100000n);
}

// A simulação desloca marcos e pior momento pelo valor hipotético, sem
// gravar nada — uma segunda chamada sem what_if volta ao saldo original.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);

  const whatIf = [{ date: today, kind: 'saida', amount_cents: 30000 }];
  const simMarcos = await getMarcos(db, today, whatIf);
  for (const m of simMarcos) assert.equal(m.balance_cents, 70000n);

  const simPior = await getWorstPoint(db, today, whatIf);
  assert.equal(simPior.balance_cents, 70000n);

  const marcos = await getMarcos(db, today);
  for (const m of marcos) assert.equal(m.balance_cents, 100000n);

  const transactions = await db.query('select count(*) as n from transaction');
  assert.equal(transactions.rows[0].n, 0n, 'nada deveria ter sido gravado pela simulação');
}

console.log('pglite-marcos-test: ok');
