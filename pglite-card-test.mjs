// Cartões, compras e parcelamento (issue #7). Verifies the query layer
// (createCard/listCards/archiveCard/previewInstallments/insertPurchase)
// and the two invariants SPEC.md §3/§4 require: a purchase never touches
// saldo directly, and the bill lands as a saída on its due date. Same seam
// as pglite-recurrence-test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';
import { pgliteParsers } from './src/db/pglite-config.mjs';
import {
  archiveCard,
  createCard,
  insertPurchase,
  listCards,
  previewInstallments,
  updateCard,
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

// Criar: aparece na listagem como não arquivado.
{
  const db = await freshDb();
  const id = await createCard(db, { name: 'Nubank', closingDay: 20, dueDay: 5 });

  const list = await listCards(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, 'Nubank');
  assert.equal(list[0].closing_day, 20);
  assert.equal(list[0].due_day, 5);
  assert.equal(list[0].archived_at, null);
}

// Editar e arquivar.
{
  const db = await freshDb();
  const id = await createCard(db, { name: 'Nubank', closingDay: 20, dueDay: 5 });
  await updateCard(db, id, { name: 'Nubank Ultravioleta', closingDay: 22, dueDay: 7 });

  let list = await listCards(db);
  assert.equal(list[0].name, 'Nubank Ultravioleta');
  assert.equal(list[0].closing_day, 22);

  await archiveCard(db, id, today);
  list = await listCards(db);
  assert.notEqual(list[0].archived_at, null);
}

// A prévia (preview_installments) bate, parcela a parcela, com a view
// `installment` depois que a compra é de fato gravada — é a checagem que
// pega qualquer divergência entre as duas fórmulas (bigint/int, ciclo,
// vencimento).
{
  const db = await freshDb();
  const cardId = await createCard(db, { name: 'Nubank', closingDay: 20, dueDay: 5 });

  const preview = await previewInstallments(db, cardId, '2026-08-10', 100001n, 3);
  assert.equal(preview.length, 3);

  const purchaseId = await insertPurchase(db, {
    cardId,
    date: '2026-08-10',
    amountCents: 100001n,
    installments: 3,
  });

  const { rows: installments } = await db.query(
    'select installment_no, amount_cents, cycle_month from installment where purchase_id = $1 order by installment_no',
    [purchaseId],
  );

  assert.equal(installments.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(preview[i].amount_cents, installments[i].amount_cents);
    assert.equal(preview[i].cycle_month, installments[i].cycle_month);
  }
  // Resto da divisão vai na primeira parcela.
  assert.equal(preview[0].amount_cents, 33335n);
  assert.equal(preview[1].amount_cents, 33333n);
  assert.equal(preview[2].amount_cents, 33333n);
}

// Compra até o fechamento entra no ciclo do próprio mês, com vencimento no
// mês seguinte quando due_day <= closing_day (o outro ramo do case).
{
  const db = await freshDb();
  const cardId = await createCard(db, { name: 'Cartão', closingDay: 20, dueDay: 5 });

  const preview = await previewInstallments(db, cardId, '2026-08-10', 10000n, 1);
  assert.equal(preview[0].cycle_month, '2026-08-01');
  assert.equal(preview[0].due_date, '2026-09-05');
}

// Dia 31 em fevereiro é limitado ao último dia do mês (clamp_day).
{
  const db = await freshDb();
  const cardId = await createCard(db, { name: 'Cartão', closingDay: 31, dueDay: 31 });

  const preview = await previewInstallments(db, cardId, '2026-01-15', 10000n, 1);
  // due_day (31) > closing_day (31) é falso, então vence no mês seguinte:
  // fevereiro de 2026 não é bissexto, então o vencimento cai em 28.
  assert.equal(preview[0].due_date, '2026-02-28');
}

// A regra que não pode ser quebrada (SPEC.md §3): a compra não mexe no
// saldo no dia em que acontece; a fatura vira saída só no vencimento.
{
  const db = await freshDb();
  await anchor(db, '2026-08-01', 500000n);
  const cardId = await createCard(db, { name: 'Cartão', closingDay: 20, dueDay: 5 });

  const before = await balanceOn(db, '2026-08-10');
  await insertPurchase(db, { cardId, date: '2026-08-10', amountCents: 30000n, installments: 1 });
  const after = await balanceOn(db, '2026-08-10');
  assert.equal(before, after, 'saldo no dia da compra não deve mudar');

  // Ciclo de agosto (compra até dia 20) vence em 05/09.
  const beforeDue = await balanceOn(db, '2026-09-04');
  const onDue = await balanceOn(db, '2026-09-05');
  assert.equal(beforeDue, 500000n);
  assert.equal(onDue, 500000n - 30000n);
}

console.log('pglite-card-test: ok');
