// Query layer for the Hoje/Lançar loop. Plain .mjs so it can be imported
// both by the UI (src/main.ts, allowJs is on) and by the node test script
// (pglite-loop-test.mjs) without duplicating SQL — same seam as
// pglite-config.mjs.

// PGlite's current_date resolves in the WASM runtime's timezone, not
// America/Belem — computing "today" here and passing it explicitly avoids
// writing a late-night lançamento to the wrong day. See SPEC.md §5.
export function todayBelem() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date());
}

// Saldo em conta and quanto posso gastar hoje (SPEC.md §6). "Posso gastar"
// is the daily_estimate vigente hoje minus what's already been lançado
// today — the only in-scope material for it, since marcos/pior-momento
// (worst_point/milestones) are ticket #6, not this one. It's allowed to go
// negative: §4's invariant is that wrongness must be visible, not clamped.
export async function getHoje(db, today) {
  const saldoResult = await db.query(
    'select balance_on($1::date, $1::date) as saldo_cents',
    [today],
  );
  const saldoCents = saldoResult.rows[0]?.saldo_cents ?? 0n;

  const estimateResult = await db.query(
    `select amount_cents from daily_estimate
     where effective_from <= $1::date
     order by effective_from desc
     limit 1`,
    [today],
  );
  const estimateCents = estimateResult.rows[0]?.amount_cents ?? null;

  const spentResult = await db.query(
    `select coalesce(sum(amount_cents), 0) as spent_cents
     from transaction
     where date = $1::date and kind = 'diario'`,
    [today],
  );
  const spentCents = spentResult.rows[0]?.spent_cents ?? 0n;

  const podeGastarCents = estimateCents === null ? null : estimateCents - spentCents;

  return { saldoCents, podeGastarCents };
}

// Marcos da Tela Hoje (SPEC.md §6): saldo projetado em fim do mês, +3, +6
// e +12 meses. what_if espelha o parâmetro jsonb de timeline_sim — o mesmo
// array alimenta getMarcos e getWorstPoint a partir do campo "e se eu
// gastar ___", sem gravar nada.
export async function getMarcos(db, today, whatIf = []) {
  const { rows } = await db.query('select label, day, balance_cents from milestones($1::date, $2::jsonb)', [
    today,
    JSON.stringify(whatIf),
  ]);
  return rows;
}

// Pior momento da janela de 12 meses (SPEC.md §6): menor saldo e o dia em
// que ocorre.
export async function getWorstPoint(db, today, whatIf = []) {
  const { rows } = await db.query('select day, balance_cents from worst_point($1::date, $2::jsonb)', [
    today,
    JSON.stringify(whatIf),
  ]);
  return rows[0];
}

// Linha do tempo completa (issue #9, SPEC.md §6): acesso secundário aos 12
// meses dia a dia, direto de timeline() — milestones/worst_point já usam
// timeline_sim para os resumos da Tela Hoje; esta tela mostra a janela
// inteira, sem simulação.
export async function getTimeline(db, today) {
  const { rows } = await db.query(
    `select day, balance_cents, is_projection
     from timeline($1::date, ($1::date + interval '12 months')::date, $1::date)`,
    [today],
  );
  return rows;
}

// One transaction row per item (not a summed total) — §7's list exists so
// the user can check line-by-line against the fatura, and categoria is per
// item. Returns the generated ids so a save can be undone.
export async function insertDiario(db, date, items) {
  const rows = items.map((item) => ({ id: crypto.randomUUID(), item }));

  await db.transaction(async (tx) => {
    for (const { id, item } of rows) {
      await tx.query(
        `insert into transaction (id, date, kind, amount_cents, category_id, note)
         values ($1, $2, 'diario', $3, $4, $5)`,
        [id, date, item.amountCents, item.categoryId ?? null, item.note ?? null],
      );
    }
  });

  return rows.map((r) => r.id);
}

// Undo for a just-saved Diário entry: delete the rows by id.
export async function deleteTransactions(db, ids) {
  if (ids.length === 0) return;
  await db.query('delete from transaction where id = any($1::uuid[])', [ids]);
}

// "Não gastei nada": marks the day settled so it doesn't show up as
// pending later (SPEC.md §8), without writing any transaction.
export async function settleDay(db, date) {
  await db.query(
    'insert into day_settled (day) values ($1::date) on conflict (day) do nothing',
    [date],
  );
}

// Dias sem lançamento e sem marca de conferido, do mais antigo para o mais
// recente (SPEC.md §8). O usuário retoma do primeiro da lista, não da data
// atual — hoje nunca aparece aqui.
export async function pendingDays(db, today) {
  const { rows } = await db.query('select d as day from pending_days($1::date) d', [today]);
  return rows.map((row) => row.day);
}

// Aviso de desvio da estimativa (issue #8, SPEC.md §9): compara o último
// mês fechado com a estimativa vigente naquele mês. null quando não há
// nada a avisar (sem desvio, sem dado, ou mês já dispensado) — estimate_deviation
// já filtra tudo isso.
export async function getEstimateDeviation(db, today) {
  const { rows } = await db.query('select month, actual_cents, estimate_cents from estimate_deviation($1::date)', [
    today,
  ]);
  return rows[0] ?? null;
}

// "Atualizar": grava a nova estimativa a partir de hoje, sem retroagir —
// effective_from é único, então um segundo toque no mesmo dia (ex.: depois
// de recarregar a tela) substitui o valor em vez de falhar.
export async function updateEstimate(db, amountCents, today) {
  await db.query(
    `insert into daily_estimate (id, amount_cents, effective_from)
     values ($1, $2, $3::date)
     on conflict (effective_from) do update set amount_cents = excluded.amount_cents`,
    [crypto.randomUUID(), amountCents, today],
  );
}

// "Manter": dispensa o aviso para aquele mês.
export async function dismissEstimateDeviation(db, month) {
  await db.query(
    'insert into estimate_dismissal (month) values ($1::date) on conflict (month) do nothing',
    [month],
  );
}

// Configurações: limpa todas as dispensas para a comparação rodar de novo.
export async function clearEstimateDismissals(db) {
  await db.query('delete from estimate_dismissal');
}

// Recorrências (issue #5): entrada ou saída num dia fixo do mês. Só
// target = 'account' aqui — recorrência no cartão alimenta card_bill e é
// gerenciada em outro lugar, fora do escopo desta tela.
export async function listRecurrences(db, today) {
  const { rows } = await db.query(
    `select id, kind, amount_cents, day_of_month, label, start_date, end_date,
            (end_date is null or end_date > $1::date) as active
     from recurrence
     where target = 'account'
     order by day_of_month, label`,
    [today],
  );
  return rows;
}

export async function createRecurrence(db, { kind, dayOfMonth, amountCents, label, startDate }) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into recurrence (id, kind, target, amount_cents, day_of_month, label, start_date)
     values ($1, $2, 'account', $3, $4, $5, $6)`,
    [id, kind, amountCents, dayOfMonth, label, startDate],
  );
  return id;
}

export async function updateRecurrence(db, id, { kind, dayOfMonth, amountCents, label }) {
  await db.query(
    `update recurrence set kind = $2, amount_cents = $3, day_of_month = $4, label = $5
     where id = $1`,
    [id, kind, amountCents, dayOfMonth, label],
  );
}

// Desativar não apaga: a recorrência continua existindo para as exceções já
// gravadas contra ela (transaction.recurrence_id), só para de projetar a
// partir de hoje. end_date = today basta para isso (proj_rec exige
// s.day > p_today e s.day <= end_date, e as duas não podem valer juntas);
// puxar start_date para trás também garante que uma recorrência que ainda
// nem começou não deixe escapar sua primeira ocorrência.
export async function deactivateRecurrence(db, id, today) {
  await db.query(
    `update recurrence set start_date = least(start_date, $2::date), end_date = $2::date
     where id = $1`,
    [id, today],
  );
}

// Cartões (issue #7): CRUD simples de closing_day/due_day. Arquivar em vez
// de apagar — installment/card_bill leem o card por id, então compras já
// lançadas continuam válidas mesmo depois do cartão sair de uso.
export async function listCards(db) {
  const { rows } = await db.query(
    `select id, name, closing_day, due_day, archived_at
     from card
     order by archived_at nulls first, name`,
  );
  return rows;
}

export async function createCard(db, { name, closingDay, dueDay }) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into card (id, name, closing_day, due_day) values ($1, $2, $3, $4)`,
    [id, name, closingDay, dueDay],
  );
  return id;
}

// Edição vale para trás: installment/card_bill leem closing_day/due_day
// atuais do cartão, então mudar aqui recicla o ciclo/vencimento de compras
// já gravadas, não só das futuras. Aceitável para corrigir um cadastro
// errado; não há versão histórica do card.
export async function updateCard(db, id, { name, closingDay, dueDay }) {
  await db.query(
    `update card set name = $2, closing_day = $3, due_day = $4 where id = $1`,
    [id, name, closingDay, dueDay],
  );
}

export async function archiveCard(db, id, today) {
  await db.query(`update card set archived_at = $2 where id = $1`, [id, today]);
}

// Prévia de parcelamento antes de salvar (SPEC.md §7): mesma fórmula de
// preview_installments/card_bill em schema.sql, sem gravar nada.
export async function previewInstallments(db, cardId, date, amountCents, installments) {
  const { rows } = await db.query(
    `select installment_no, amount_cents, cycle_month, due_date
     from preview_installments($1::uuid, $2::date, $3::bigint, $4::int)
     order by installment_no`,
    [cardId, date, amountCents, installments],
  );
  return rows;
}

// Compra no cartão. Não toca o saldo: só insere em `purchase`, e
// installment/card_bill fazem o resto (SPEC.md §3).
export async function insertPurchase(db, { cardId, date, amountCents, installments, description, categoryId }) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into purchase (id, card_id, date, amount_cents, installments, description, category_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, cardId, date, amountCents, installments, description ?? null, categoryId ?? null],
  );
  return id;
}

export async function deletePurchase(db, id) {
  await db.query('delete from purchase where id = $1', [id]);
}

// "Acertar saldo": o usuário digita o saldo real que o banco mostra agora,
// e a partir daqui o cálculo não olha mais atrás desta data.
//
// account_anchor guarda o saldo no *início* do dia, para que o que for
// lançado nesse mesmo dia continue contando (um lançamento que some do
// saldo é o único erro que o app não teria como mostrar). O valor digitado
// é o de agora e já inclui o que foi lançado hoje, então o que se grava é
// ele menos o movimento do dia.
export async function setAnchor(db, date, amountCents) {
  await db.query(
    `insert into account_anchor (id, date, amount_cents)
     select $1::uuid, $2::date, $3::bigint - coalesce((
              select sum(case when kind = 'entrada' then amount_cents else -amount_cents end)
              from transaction where date = $2::date), 0)
     on conflict (date) do update set amount_cents = excluded.amount_cents`,
    [crypto.randomUUID(), date, amountCents],
  );
}
