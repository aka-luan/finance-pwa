// Linha do tempo completa (issue #9, SPEC.md §6). Exercises the query layer
// (getTimeline) that renderLinhaDoTempo calls — the underlying timeline()
// SQL itself is already covered by pglite-smoke-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { getTimeline } from './src/db/queries.mjs';

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

// A janela cobre exatamente hoje até hoje + 12 meses, um registro por dia,
// e o primeiro dia (hoje) nunca é projeção — "dias até hoje nunca projetam"
// (SPEC.md §4).
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);

  const dias = await getTimeline(db, today);

  assert.equal(dias[0]?.day, today);
  assert.equal(dias[dias.length - 1]?.day, '2027-08-09');
  assert.equal(dias.length, 366);
  assert.equal(dias[0]?.is_projection, false);
  for (const d of dias) assert.equal(d.balance_cents, 100000n);
}

// Real vence projeção: uma recorrência projeta um dia futuro, e uma
// transação real gravada com recurrence_id + occurrence_date naquele dia
// suprime a projeção correspondente — timeline() já implementa isso,
// getTimeline só expõe o resultado. is_projection continua true (o dia
// segue no futuro; a regra evita é contar o valor em dobro, não muda a
// classificação temporal do dia — SPEC.md §4).
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);

  const recResult = await db.query(
    `insert into recurrence (id, kind, target, amount_cents, day_of_month, label, start_date)
     values (gen_random_uuid(), 'saida', 'account', 20000, 15, 'aluguel', '2026-01-01')
     returning id`,
  );
  const recurrenceId = recResult.rows[0].id;

  const antes = await getTimeline(db, today);
  const projetado = antes.find((d) => d.day === '2026-08-15');
  assert.equal(projetado?.is_projection, true);
  assert.equal(projetado?.balance_cents, 80000n);

  await db.query(
    `insert into transaction (id, date, kind, amount_cents, recurrence_id, occurrence_date)
     values (gen_random_uuid(), '2026-08-15', 'saida', 20000, $1, '2026-08-15')`,
    [recurrenceId],
  );

  const depois = await getTimeline(db, today);
  const real = depois.find((d) => d.day === '2026-08-15');
  assert.equal(real?.is_projection, true);
  assert.equal(real?.balance_cents, 80000n, 'a projeção suprimida não deve dobrar o valor real');
}

console.log('pglite-timeline-test: ok');
