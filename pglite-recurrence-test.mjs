// Recorrências (issue #5): CRUD para entrada/saída em dia fixo do mês, e a
// verificação de que create/edit/deactivate refletem corretamente no
// timeline/balance_on — a regra "real vence projeção" em si já é da SQL de
// calculo-saldo-e-faturas.md. Same seam as pglite-pending-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import {
  createRecurrence,
  deactivateRecurrence,
  listRecurrences,
  updateRecurrence,
} from './src/db/queries.mjs';

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

async function balanceOn(db, day) {
  const { rows } = await db.query('select balance_on($1::date, $2::date) as b', [day, today]);
  return rows[0].b;
}

// Criar: aparece na listagem como ativa.
{
  const db = await freshDb();
  const id = await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 15,
    amountCents: 30000n,
    label: 'Financiamento',
    startDate: today,
  });

  const list = await listRecurrences(db, today);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].kind, 'saida');
  assert.equal(list[0].amount_cents, 30000n);
  assert.equal(list[0].day_of_month, 15);
  assert.equal(list[0].label, 'Financiamento');
  assert.equal(list[0].active, true);
}

// Uma recorrência projetada aparece no saldo de um dia futuro; sem ela, não.
{
  const db = await freshDb();
  await anchor(db, today, 100000n);

  const before = await balanceOn(db, '2026-08-15');
  assert.equal(before, 100000n);

  await createRecurrence(db, {
    kind: 'entrada',
    dayOfMonth: 15,
    amountCents: 50000n,
    label: 'Salário extra',
    startDate: today,
  });

  const after = await balanceOn(db, '2026-08-15');
  assert.equal(after, 150000n);
}

// Lançar um real na data da ocorrência substitui a projeção daquele dia
// ("real vence projeção") — o saldo passa a refletir o valor real, não
// real + projetado.
{
  const db = await freshDb();
  await anchor(db, today, 100000n);
  const id = await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 20,
    amountCents: 20000n,
    label: 'Assinatura',
    startDate: today,
  });

  assert.equal(await balanceOn(db, '2026-08-20'), 80000n, 'só a projeção, sem real ainda');

  await db.query(
    `insert into transaction (id, date, kind, amount_cents, recurrence_id, occurrence_date)
     values (gen_random_uuid(), $1::date, 'saida', $2, $3, $1::date)`,
    ['2026-08-20', 25000n, id],
  );

  assert.equal(
    await balanceOn(db, '2026-08-20'),
    75000n,
    'saldo deve refletir o real (25000), não real + projeção (20000+25000)',
  );
}

// Editar: kind, valor, dia e rótulo mudam; o saldo projetado acompanha.
{
  const db = await freshDb();
  await anchor(db, today, 100000n);
  const id = await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 10,
    amountCents: 10000n,
    label: 'Antigo',
    startDate: today,
  });

  await updateRecurrence(db, id, {
    kind: 'entrada',
    dayOfMonth: 12,
    amountCents: 40000n,
    label: 'Novo',
  });

  const list = await listRecurrences(db, today);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'entrada');
  assert.equal(list[0].day_of_month, 12);
  assert.equal(list[0].amount_cents, 40000n);
  assert.equal(list[0].label, 'Novo');

  // dia 10 não projeta mais nada; dia 12 projeta a entrada nova.
  assert.equal(await balanceOn(db, '2026-08-10'), 100000n);
  assert.equal(await balanceOn(db, '2026-08-12'), 140000n);
}

// Desativar: some da projeção a partir de hoje e a listagem marca active:false.
{
  const db = await freshDb();
  await anchor(db, today, 100000n);
  const id = await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 15,
    amountCents: 30000n,
    label: 'Financiamento',
    // Depois do dia 15 de agosto, então só a ocorrência de setembro entra
    // no saldo de 2026-09-15 — sem isso o dia 15 de agosto contaria junto.
    startDate: '2026-08-16',
  });

  assert.equal(await balanceOn(db, '2026-09-15'), 70000n);

  await deactivateRecurrence(db, id, today);

  const list = await listRecurrences(db, today);
  assert.equal(list[0].active, false);
  assert.equal(await balanceOn(db, '2026-09-15'), 100000n, 'projeção deve sumir depois de desativar');
}

// Desativar uma recorrência que ainda nem começou (start_date no futuro)
// também não pode deixar nenhuma ocorrência escapar.
{
  const db = await freshDb();
  await anchor(db, today, 100000n);
  const id = await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 20,
    amountCents: 30000n,
    label: 'Ainda não começou',
    startDate: '2026-10-01',
  });

  await deactivateRecurrence(db, id, today);

  assert.equal(await balanceOn(db, '2026-10-20'), 100000n, 'não pode projetar depois de desativada');
  assert.equal(await balanceOn(db, '2026-11-20'), 100000n);
}

// day_of_month = 31 clampeia para o último dia em meses curtos (fevereiro).
{
  const db = await freshDb();
  await anchor(db, today, 100000n);
  await createRecurrence(db, {
    kind: 'saida',
    dayOfMonth: 31,
    amountCents: 10000n,
    label: 'Dia 31',
    // Só a partir de fevereiro, para isolar a ocorrência clampeada sem
    // somar os meses anteriores no caminho.
    startDate: '2027-02-01',
  });

  // 2027 não é bissexto: fevereiro tem 28 dias, clamp_day leva o dia 31 pra lá.
  assert.equal(await balanceOn(db, '2027-02-28'), 90000n);
}

console.log('pglite-recurrence-test: ok');
