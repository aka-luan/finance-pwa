import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getHoje, insertTransactions } from './src/db/queries.mjs';

const db = await PGlite.create({ parsers: pgliteParsers });
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const today = '2026-08-09';

await db.exec(`
  insert into account_anchor (id, date, amount_cents)
  values ('11111111-1111-1111-1111-111111111111', '2026-08-01', 100000);
`);

// Saída manual (issue #12): writes kind = 'saida', moves saldo down like a
// recorrência would, but does not touch podeGastarCents — that's diario-only.
{
  const ids = await insertTransactions(db, today, 'saida', [{ amountCents: 4000n }]);
  assert.equal(ids.length, 1);

  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 100000n - 4000n);

  const rows = await db.query('select kind from transaction where id = $1::uuid', [ids[0]]);
  assert.equal(rows.rows[0].kind, 'saida');
}

// Entrada manual: writes kind = 'entrada', moves saldo up.
{
  const ids = await insertTransactions(db, today, 'entrada', [{ amountCents: 2500n }]);
  assert.equal(ids.length, 1);

  const hoje = await getHoje(db, today);
  assert.equal(hoje.saldoCents, 100000n - 4000n + 2500n);

  const rows = await db.query('select kind from transaction where id = $1::uuid', [ids[0]]);
  assert.equal(rows.rows[0].kind, 'entrada');
}

console.log('pglite-manual-kinds-test: ok');
