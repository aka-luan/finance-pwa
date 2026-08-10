// Dias pendentes e "Acertar saldo" (SPEC.md §8). Same seam as
// pglite-loop-test.mjs: the SQL and the query layer are exercised directly,
// so the UI on top stays thin enough to read.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { splitSchema } from './src/db/schema.mjs';
import { getHoje, insertTransactions, pendingDays, setAnchor, settleDay } from './src/db/queries.mjs';

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

// Um dia é pendente quando não tem transação nem marca de conferido. Hoje
// nunca é pendente, e o cálculo não olha atrás do anchor.
{
  const db = await freshDb();
  assert.deepEqual(await pendingDays(db, today), [], 'banco vazio não tem pendências');

  await anchor(db, '2026-08-02', 100000n);
  await insertTransactions(db, '2026-08-05', 'diario', [{ amountCents: 5000n }]);
  await settleDay(db, '2026-08-06');

  assert.deepEqual(await pendingDays(db, today), [
    '2026-08-02',
    '2026-08-03',
    '2026-08-04',
    '2026-08-07',
    '2026-08-08',
  ]);
}

// Lançar um dia pendente move o saldo de hoje. Sem isso o modo de
// recuperação não teria efeito visível nenhum.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  assert.equal((await getHoje(db, today)).saldoCents, 100000n);

  await insertTransactions(db, '2026-08-05', 'diario', [{ amountCents: 5000n }]);
  assert.equal((await getHoje(db, today)).saldoCents, 95000n);

  await insertTransactions(db, '2026-08-07', 'diario', [{ amountCents: 2500n }]);
  assert.equal((await getHoje(db, today)).saldoCents, 92500n);
}

// Acertar saldo: grava o anchor de hoje, tira todo pendente anterior da
// lista e passa a valer como saldo.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  await insertTransactions(db, '2026-08-05', 'diario', [{ amountCents: 5000n }]);
  assert.equal((await pendingDays(db, today)).length, 7); // 08-01 a 08-08, menos o 05

  await setAnchor(db, today, 250000n);

  assert.deepEqual(await pendingDays(db, today), []);
  assert.equal((await getHoje(db, today)).saldoCents, 250000n);

  // Acertar de novo no mesmo dia sobrescreve, não duplica.
  await setAnchor(db, today, 260000n);
  const anchors = await db.query('select count(*) as n from account_anchor where date = $1::date', [today]);
  assert.equal(anchors.rows[0].n, 1n);
  assert.equal((await getHoje(db, today)).saldoCents, 260000n);
}

// O valor digitado é o saldo do banco agora, então já inclui o que foi
// lançado hoje: acertar não pode descontar de novo, e o que for lançado
// depois tem que continuar mexendo no saldo.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  await insertTransactions(db, today, 'diario', [{ amountCents: 3000n }]);
  assert.equal((await getHoje(db, today)).saldoCents, 97000n);

  await setAnchor(db, today, 45000n);
  assert.equal((await getHoje(db, today)).saldoCents, 45000n);

  await insertTransactions(db, today, 'diario', [{ amountCents: 1000n }]);
  assert.equal((await getHoje(db, today)).saldoCents, 44000n);
}

// Um banco já persistido no IndexedDB não roda schema.sql de novo, então a
// metade de funções/views tem que alcançá-lo por conta própria no boot.
{
  const { tables, replaceable } = splitSchema(schemaSql);

  const db = await PGlite.create({ parsers: pgliteParsers });
  await db.exec(tables);
  await db.exec(`
    create function pending_days(p_today date default current_date)
    returns setof date language sql stable as $$ select p_today $$;
  `);
  assert.deepEqual(await pendingDays(db, today), [today], 'stub deveria estar valendo antes do replace');

  await db.exec(replaceable);

  await anchor(db, '2026-08-07', 100000n);
  assert.deepEqual(await pendingDays(db, today), ['2026-08-07', '2026-08-08']);
}

// Marcador ausente é erro de programação, não silêncio.
assert.throws(() => splitSchema('select 1;'), /marcador/);

console.log('pglite-pending-test: ok');
