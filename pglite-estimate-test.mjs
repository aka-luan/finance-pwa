// Aviso de desvio da estimativa (issue #8, SPEC.md §9): estimate_deviation
// compara o último mês fechado com a estimativa vigente naquele mês, e a
// camada de query (getEstimateDeviation/updateEstimate/dismissEstimateDeviation/
// clearEstimateDismissals) é o que a Tela Hoje e Configurações chamam.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import {
  clearEstimateDismissals,
  dismissEstimateDeviation,
  getEstimateDeviation,
  updateEstimate,
} from './src/db/queries.mjs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const today = '2026-08-09'; // último mês fechado: julho/2026 (31 dias)

async function freshDb() {
  const db = await PGlite.create({ parsers: pgliteParsers });
  await db.exec(schemaSql);
  return db;
}

async function setEstimate(db, amountCents, effectiveFrom) {
  await db.query('insert into daily_estimate (id, amount_cents, effective_from) values (gen_random_uuid(), $1, $2)', [
    amountCents,
    effectiveFrom,
  ]);
}

async function diario(db, date, amountCents) {
  await db.query(
    `insert into transaction (id, date, kind, amount_cents) values (gen_random_uuid(), $1::date, 'diario', $2)`,
    [date, amountCents],
  );
}

// Sem estimativa nenhuma: nada a comparar, sem card.
{
  const db = await freshDb();
  await diario(db, '2026-07-15', 241800n); // 78/dia * 31 dias em julho
  assert.equal(await getEstimateDeviation(db, today), null);
}

// Sem diário lançado no mês fechado: nada a comparar, sem card.
{
  const db = await freshDb();
  await setEstimate(db, 6290n, '2026-01-01');
  assert.equal(await getEstimateDeviation(db, today), null);
}

// Desvio grande (78 vs 62,90 ~ 24%) aparece com os dois números.
{
  const db = await freshDb();
  await setEstimate(db, 6290n, '2026-01-01');
  await diario(db, '2026-07-05', 100000n);
  await diario(db, '2026-07-20', 141800n); // soma 241800 / 31 dias = 7800 (78,00)

  const dev = await getEstimateDeviation(db, today);
  assert.ok(dev);
  assert.equal(dev.month, '2026-07-01');
  assert.equal(dev.actual_cents, 7800n);
  assert.equal(dev.estimate_cents, 6290n);
}

// Desvio pequeno (dentro de ~15%) não aparece.
{
  const db = await freshDb();
  await setEstimate(db, 7000n, '2026-01-01');
  await diario(db, '2026-07-10', 217000n); // 7000/dia * 31 dias, sem desvio nenhum
  assert.equal(await getEstimateDeviation(db, today), null);
}

// "Atualizar": grava a nova estimativa com effective_from = hoje, sem
// retroagir — a estimativa vigente em julho continua sendo a antiga.
{
  const db = await freshDb();
  await setEstimate(db, 6290n, '2026-01-01');
  await diario(db, '2026-07-05', 241800n);

  const dev = await getEstimateDeviation(db, today);
  await updateEstimate(db, dev.actual_cents, today);

  const { rows } = await db.query(
    `select amount_cents from daily_estimate where effective_from <= $1::date
     order by effective_from desc limit 1`,
    [today],
  );
  assert.equal(rows[0].amount_cents, 7800n);

  const { rows: julyRows } = await db.query(
    `select amount_cents from daily_estimate where effective_from <= '2026-07-01'::date
     order by effective_from desc limit 1`,
  );
  assert.equal(julyRows[0].amount_cents, 6290n, 'julho não pode retroagir');
}

// "Manter": dispensa o mês e o card não reaparece; limpar dispensas o traz de volta.
{
  const db = await freshDb();
  await setEstimate(db, 6290n, '2026-01-01');
  await diario(db, '2026-07-05', 241800n);

  assert.ok(await getEstimateDeviation(db, today));

  await dismissEstimateDeviation(db, '2026-07-01');
  assert.equal(await getEstimateDeviation(db, today), null);

  await clearEstimateDismissals(db);
  assert.ok(await getEstimateDeviation(db, today));
}

console.log('pglite-estimate-test: ok');
