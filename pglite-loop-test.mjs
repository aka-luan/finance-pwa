import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getHoje, insertDiario, deleteTransactions, settleDay } from './src/db/queries.mjs';

const db = await PGlite.create({ parsers: pgliteParsers });
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const today = '2026-08-09';

// Empty database: no anchor, no estimate — should render as zero/null, not throw.
{
  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 0n);
  assert.equal(hoje.podeGastarCents, null);
}

await db.exec(`
  insert into account_anchor (id, date, amount_cents)
  values ('11111111-1111-1111-1111-111111111111', '2026-08-01', 100000);
  insert into daily_estimate (id, amount_cents, effective_from)
  values ('22222222-2222-2222-2222-222222222222', 6290, '2026-01-01');
`);

// Saldo starts from the anchor with nothing lançado since.
{
  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 100000n);
  assert.equal(hoje.podeGastarCents, 6290n);
}

// Salvar: multiple items, one row each, saldo and pode-gastar both move.
const ids = await insertDiario(db, today, [
  { amountCents: 1500n },
  { amountCents: 2000n },
]);
assert.equal(ids.length, 2);

{
  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 100000n - 3500n);
  assert.equal(hoje.podeGastarCents, 6290n - 3500n);
}

const rows = await db.query('select count(*) as n from transaction where id = any($1::uuid[])', [ids]);
assert.equal(rows.rows[0].n, 2n);

// Desfazer: deleting the saved ids reverts saldo and pode-gastar exactly.
await deleteTransactions(db, ids);
{
  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 100000n);
  assert.equal(hoje.podeGastarCents, 6290n);
}

// Não gastei nada: marks the day settled, writes no transaction.
await settleDay(db, today);
const settled = await db.query('select count(*) as n from day_settled where day = $1::date', [today]);
assert.equal(settled.rows[0].n, 1n);
const txCount = await db.query('select count(*) as n from transaction');
assert.equal(txCount.rows[0].n, 0n);

// settleDay is idempotent (re-entering "não gastei nada" on the same day).
await settleDay(db, today);
const settledAgain = await db.query('select count(*) as n from day_settled where day = $1::date', [today]);
assert.equal(settledAgain.rows[0].n, 1n);

console.log('pglite-loop-test: ok');
