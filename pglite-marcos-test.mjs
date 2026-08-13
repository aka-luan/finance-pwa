// Marcos, menor saldo e simulação do Termômetro. Same seam as
// pglite-pending-test.mjs: exercises the query layer (getMarcos,
// getWorstPoint, getHoje) that renderHoje calls against the same
// timeline() the Previsão lê — not just the raw SQL functions already
// covered by pglite-sim-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getHoje, getMarcos, getTimeline, getWorstPoint } from './src/db/queries.mjs';

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

// Termômetro e Previsão leem o mesmo motor: cada marco e o menor saldo
// batem com timeline() no mesmo dia, e o saldo atual é o do primeiro dia.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  await db.query(
    `insert into daily_estimate (id, amount_cents, effective_from)
     values (gen_random_uuid(), 1000, '2026-08-01')`,
  );
  await db.query(
    `insert into recurrence (id, kind, target, amount_cents, day_of_month, label, start_date)
     values (gen_random_uuid(), 'saida', 'account', 20000, 15, 'aluguel', '2026-01-01')`,
  );

  const [hoje, marcos, pior, dias] = await Promise.all([
    getHoje(db, today),
    getMarcos(db, today),
    getWorstPoint(db, today),
    getTimeline(db, today),
  ]);

  assert.ok(dias[0], 'timeline precisa ter hoje');
  assert.equal(hoje.saldoCents, dias[0].balance_cents);

  assert.deepEqual(
    marcos.map((m) => m.label),
    ['fim do mês', '3 meses', '6 meses', '12 meses'],
  );
  for (const marco of marcos) {
    const dia = dias.find((d) => d.day === marco.day);
    assert.ok(dia, `marco "${marco.label}" (${marco.day}) precisa existir na timeline`);
    assert.equal(marco.balance_cents, dia.balance_cents);
  }

  let lowest = dias[0];
  for (const dia of dias) {
    if (dia.balance_cents < lowest.balance_cents) lowest = dia;
  }
  assert.equal(pior.day, lowest.day);
  assert.equal(pior.balance_cents, lowest.balance_cents);
}

console.log('pglite-marcos-test: ok');
