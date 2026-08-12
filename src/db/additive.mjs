// DDL for tables introduced after the original schema. Duplicated from
// schema.sql so already-initialized IndexedDB installs pick them up on boot
// without a migration runner (ADR 0004). Keep in sync with schema.sql.
export const ADDITIVE_TABLE_DDL = `
create table if not exists monthly_budget (
  id              uuid primary key,
  effective_from  date not null unique
);

create table if not exists monthly_budget_line (
  budget_id     uuid   not null references monthly_budget(id) on delete cascade,
  category_id   uuid   not null references category(id),
  amount_cents  bigint not null check (amount_cents >= 0),
  primary key (budget_id, category_id)
);
`;

export async function ensureAdditiveTables(db) {
  await db.exec(ADDITIVE_TABLE_DDL);
}
