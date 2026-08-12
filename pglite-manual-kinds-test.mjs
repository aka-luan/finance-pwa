import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getHoje, insertTransactions, pendingDays } from './src/db/queries.mjs';

const db = await PGlite.create({ parsers: pgliteParsers });
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const today = '2026-08-09';
const estimate = 6290n;
const anchor = 100000n;

await db.exec(`
  insert into account_anchor (id, date, amount_cents)
  values ('11111111-1111-1111-1111-111111111111', '2026-08-01', 100000);
  insert into daily_estimate (id, amount_cents, effective_from)
  values ('22222222-2222-2222-2222-222222222222', 6290, '2026-01-01');
`);

// Saída manual (issue #12): writes kind = 'saida', moves saldo down like a
// recorrência would, but does not touch podeGastarCents — that's diario-only.
{
  const ids = await insertTransactions(db, today, 'saida', [{ amountCents: 4000n }]);
  assert.equal(ids.length, 1);

  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, anchor - 4000n);
  assert.equal(hoje.podeGastarCents, estimate);

  const rows = await db.query('select kind from transaction where id = $1::uuid', [ids[0]]);
  assert.equal(rows.rows[0].kind, 'saida');
}

// Entrada manual: writes kind = 'entrada', moves saldo up, still leaves
// podeGastarCents on the estimativa (no diário launched today).
{
  const ids = await insertTransactions(db, today, 'entrada', [{ amountCents: 2500n }]);
  assert.equal(ids.length, 1);

  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, anchor - 4000n + 2500n);
  assert.equal(hoje.podeGastarCents, estimate);

  const rows = await db.query('select kind from transaction where id = $1::uuid', [ids[0]]);
  assert.equal(rows.rows[0].kind, 'entrada');
}

// Salvar Saída/Entrada num dia passado tira esse dia da fila de recuperação,
// o mesmo critério de pending_days que o Diário já usa (qualquer transaction).
{
  await insertTransactions(db, '2026-08-05', 'saida', [{ amountCents: 1000n }]);
  await insertTransactions(db, '2026-08-06', 'entrada', [{ amountCents: 2000n }]);

  const pending = await pendingDays(db, today);
  assert.equal(pending.includes('2026-08-05'), false);
  assert.equal(pending.includes('2026-08-06'), false);
  assert.deepEqual(pending, [
    '2026-08-01',
    '2026-08-02',
    '2026-08-03',
    '2026-08-04',
    '2026-08-07',
    '2026-08-08',
  ]);
}

console.log('pglite-manual-kinds-test: ok');
