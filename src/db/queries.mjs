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
