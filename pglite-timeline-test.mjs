// Previsão (issue #9, SPEC.md §6). Exercises the query layer (getTimeline
// and getTimelineMovements) that renderPrevisao calls — the underlying
// timeline() SQL itself is already covered by pglite-smoke-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import { createCard, getTimeline, getTimelineMovements, insertPurchase } from './src/db/queries.mjs';

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

async function estimate(db, amountCents, from = '2026-08-01') {
  await db.query('insert into daily_estimate (id, amount_cents, effective_from) values (gen_random_uuid(), $1, $2::date)', [
    amountCents,
    from,
  ]);
}

function onDay(rows, day) {
  return rows.filter((row) => row.day === day);
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

  const movAntes = onDay(await getTimelineMovements(db, today), '2026-08-15');
  assert.equal(movAntes.length, 1);
  assert.equal(movAntes[0].source, 'recurrence');
  assert.equal(movAntes[0].kind, 'saida');
  assert.equal(movAntes[0].label, 'aluguel');
  assert.equal(movAntes[0].signed_cents, -20000n);

  await db.query(
    `insert into transaction (id, date, kind, amount_cents, recurrence_id, occurrence_date)
     values (gen_random_uuid(), '2026-08-15', 'saida', 20000, $1, '2026-08-15')`,
    [recurrenceId],
  );

  const depois = await getTimeline(db, today);
  const real = depois.find((d) => d.day === '2026-08-15');
  assert.equal(real?.is_projection, true);
  assert.equal(real?.balance_cents, 80000n, 'a projeção suprimida não deve dobrar o valor real');

  const movDepois = onDay(await getTimelineMovements(db, today), '2026-08-15');
  assert.equal(movDepois.length, 1);
  assert.equal(movDepois[0].source, 'transaction');
  assert.equal(movDepois[0].label, 'aluguel');
  assert.equal(movDepois[0].signed_cents, -20000n);
}

// Estimativa diária: projeta "Diário" nos dias futuros sem lançamento
// daquele kind; hoje nunca recebe projeção.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  await estimate(db, 7n);

  const movs = await getTimelineMovements(db, today);
  const hoje = onDay(movs, today);
  assert.equal(hoje.length, 0, 'hoje não projeta estimativa diária');

  const amanha = onDay(movs, '2026-08-10');
  assert.equal(amanha.length, 1);
  assert.equal(amanha[0].source, 'diario');
  assert.equal(amanha[0].kind, 'diario');
  assert.equal(amanha[0].label, 'Diário');
  assert.equal(amanha[0].signed_cents, -7n);

  await db.query(
    `insert into transaction (id, date, kind, amount_cents)
     values (gen_random_uuid(), '2026-08-10', 'diario', 7)`,
  );
  const depois = onDay(await getTimelineMovements(db, today), '2026-08-10');
  assert.equal(depois.length, 1);
  assert.equal(depois[0].source, 'transaction');
  assert.equal(depois[0].label, 'Diário');
  assert.equal(depois[0].signed_cents, -7n);
}

// Recorrência no dia de hoje não aparece como projeção.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 100000n);
  await db.query(
    `insert into recurrence (id, kind, target, amount_cents, day_of_month, label, start_date)
     values (gen_random_uuid(), 'entrada', 'account', 500000, 9, 'salário', '2026-01-01')`,
  );

  const hoje = onDay(await getTimelineMovements(db, today), today);
  assert.equal(
    hoje.filter((m) => m.source !== 'transaction').length,
    0,
    'hoje não recebe recorrência projetada',
  );

  const proximo = onDay(await getTimelineMovements(db, today), '2026-09-09');
  assert.equal(proximo.length, 1);
  assert.equal(proximo[0].source, 'recurrence');
  assert.equal(proximo[0].kind, 'entrada');
  assert.equal(proximo[0].label, 'salário');
  assert.equal(proximo[0].signed_cents, 500000n);
}

// Fatura projetada no vencimento, com o nome do cartão.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 500000n);
  const cardId = await createCard(db, { name: 'Nubank', closingDay: 20, dueDay: 5 });
  await insertPurchase(db, { cardId, date: '2026-08-10', amountCents: 30000n, installments: 1 });

  const vencimento = onDay(await getTimelineMovements(db, today), '2026-09-05');
  const fatura = vencimento.find((m) => m.source === 'bill');
  assert.ok(fatura, 'fatura deve aparecer no vencimento');
  assert.equal(fatura.kind, 'saida');
  assert.equal(fatura.label, 'Fatura Nubank');
  assert.equal(fatura.signed_cents, -30000n);
}

console.log('pglite-timeline-test: ok');
