-- =====================================================================
-- Termômetro — schema
-- Postgres 16 / PGlite. Valores em centavos (bigint). Datas sem hora.
--
-- Duas metades, separadas pelo marcador lá embaixo: primeiro tipos,
-- tabelas e índices, que só rodam num banco novo; depois funções e views,
-- todas `create or replace`. O banco do PWA vive no IndexedDB e não roda
-- schema.sql de novo depois do primeiro boot, então a segunda metade é
-- reaplicada toda vez (src/db/schema.mjs) e uma correção de cálculo
-- alcança quem já tem dados. Só cálculo se propaga assim — mexer em
-- coluna vai precisar de migração de verdade.
-- =====================================================================

create type tx_kind as enum ('entrada', 'saida', 'diario');
create type rec_target as enum ('account', 'card');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table category (
  id    uuid primary key,
  name  text not null unique
);

create table card (
  id           uuid primary key,
  name         text not null,
  closing_day  int  not null check (closing_day between 1 and 31),
  due_day      int  not null check (due_day     between 1 and 31),
  archived_at  date
);

-- Saldo conhecido no *início* de uma data. Ponto de partida do cálculo:
-- o que for lançado nesse mesmo dia ainda conta por cima dele.
create table account_anchor (
  id            uuid primary key,
  date          date   not null unique,
  amount_cents  bigint not null
);

-- Regra pura: nunca vira registro até acontecer.
create table recurrence (
  id            uuid primary key,
  kind          tx_kind    not null,
  target        rec_target not null default 'account',
  card_id       uuid references card(id),
  amount_cents  bigint     not null check (amount_cents > 0),
  day_of_month  int        not null check (day_of_month between 1 and 31),
  label         text       not null,
  category_id   uuid references category(id),
  start_date    date       not null,
  end_date      date,
  check (end_date is null or end_date >= start_date),
  check ((target = 'card') = (card_id is not null)),
  -- recorrência no cartão é sempre despesa
  check (target = 'account' or kind = 'saida')
);

-- O que de fato aconteceu.
create table transaction (
  id               uuid primary key,      -- gerado no cliente
  date             date    not null,
  kind             tx_kind not null,
  amount_cents     bigint  not null check (amount_cents > 0),
  category_id      uuid    references category(id),
  note             text,

  -- exceção de recorrência: substitui a projeção daquele dia
  recurrence_id    uuid references recurrence(id),
  occurrence_date  date,

  -- pagamento real de fatura: substitui a fatura calculada
  card_id          uuid references card(id),
  cycle_month      date,

  created_at       timestamptz not null default now(),

  check ((recurrence_id is null) = (occurrence_date is null)),
  check ((card_id       is null) = (cycle_month     is null)),
  check (not (recurrence_id is not null and card_id is not null)),
  check (cycle_month is null or cycle_month = date_trunc('month', cycle_month))
);

-- Uma exceção por ocorrência, um pagamento por fatura.
create unique index transaction_recurrence_uq
  on transaction (recurrence_id, occurrence_date)
  where recurrence_id is not null;

create unique index transaction_bill_uq
  on transaction (card_id, cycle_month)
  where card_id is not null;

create index transaction_date_idx on transaction (date);

-- Compra no cartão. Não toca o saldo: alimenta a fatura.
create table purchase (
  id            uuid   primary key,
  card_id       uuid   not null references card(id),
  date          date   not null,
  amount_cents  bigint not null check (amount_cents > 0),
  installments  int    not null default 1 check (installments between 1 and 48),
  description   text,
  category_id   uuid   references category(id),
  created_at    timestamptz not null default now()
);

create index purchase_card_date_idx on purchase (card_id, date);

-- Estimativa de gasto diário, versionada por data de vigência.
create table daily_estimate (
  id              uuid   primary key,
  amount_cents    bigint not null check (amount_cents >= 0),
  effective_from  date   not null unique
);

-- Composição do orçamento mensal de gastos cotidianos (wizard / ADR 0002).
-- Versionada por effective_from; a estimativa diária continua em daily_estimate.
create table monthly_budget (
  id              uuid primary key,
  effective_from  date not null unique
);

create table monthly_budget_line (
  budget_id     uuid   not null references monthly_budget(id) on delete cascade,
  category_id   uuid   not null references category(id),
  amount_cents  bigint not null check (amount_cents >= 0),
  primary key (budget_id, category_id)
);

-- Meses em que o aviso de desvio foi dispensado.
create table estimate_dismissal (
  month         date primary key check (month = date_trunc('month', month)),
  dismissed_at  timestamptz not null default now()
);

-- Marca um dia como conferido. Sem linha aqui, o dia é "pendente" —
-- é o que distingue "não gastei nada" de "esqueci de lançar".
create table day_settled (
  day          date primary key,
  settled_at   timestamptz not null default now()
);

-- >>> funções e views: reaplicadas a cada boot >>>

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Dia N do mês de M, limitado ao último dia do mês.
-- clamp_day('2026-02-01', 31) -> 2026-02-28
create or replace function clamp_day(month_start date, day int)
returns date language sql immutable as $$
  select month_start
       + (least(day, extract(day from (month_start + interval '1 month - 1 day'))::int) - 1);
$$;

-- Ciclo de fatura em que uma compra cai.
-- Compra até o fechamento entra no ciclo do próprio mês; depois, no seguinte.
create or replace function bill_cycle(purchase_date date, closing_day int)
returns date language sql immutable as $$
  select date_trunc('month', purchase_date)::date
       + (case when extract(day from purchase_date)::int <= closing_day
               then 0 else 1 end * interval '1 month');
$$;

-- Vencimento de um ciclo de fatura. Mesmo mês do ciclo se due_day cair
-- depois do closing_day; senão, mês seguinte. Extraído de card_bill para
-- que a prévia de parcelamento em Lançar (issue #7) use a mesma fórmula em
-- vez de duplicá-la.
create or replace function bill_due_date(cycle_month date, closing_day int, due_day int)
returns date language sql immutable as $$
  select case when due_day > closing_day
              then clamp_day(cycle_month, due_day)
              else clamp_day((cycle_month + interval '1 month')::date, due_day)
         end;
$$;

-- Prévia de uma compra ainda não gravada: mesma divisão de parcelas e
-- mesmo ciclo/vencimento de `installment`/`card_bill`, calculados antes do
-- insert para a tela de Lançar mostrar o efeito (SPEC.md §7).
create or replace function preview_installments(
  p_card_id      uuid,
  p_date         date,
  p_amount_cents bigint,
  p_installments int
)
returns table (
  installment_no  int,
  amount_cents    bigint,
  cycle_month     date,
  due_date        date
)
language sql stable as $$
  select
    n::int as installment_no,
    p_amount_cents / p_installments
      + case when n = 1 then p_amount_cents % p_installments else 0 end
                    as amount_cents,
    (bill_cycle(p_date, c.closing_day) + ((n - 1) * interval '1 month'))::date as cycle_month,
    bill_due_date(
      (bill_cycle(p_date, c.closing_day) + ((n - 1) * interval '1 month'))::date,
      c.closing_day, c.due_day
    ) as due_date
  from card c
  cross join lateral generate_series(1, p_installments) as n
  where c.id = p_card_id;
$$;

-- ---------------------------------------------------------------------
-- Views derivadas
-- ---------------------------------------------------------------------

-- Parcelas expandidas. O resto da divisão vai na primeira.
create or replace view installment as
select
  p.id            as purchase_id,
  p.card_id,
  n               as installment_no,
  p.installments  as installment_count,
  p.amount_cents / p.installments
    + case when n = 1 then p.amount_cents % p.installments else 0 end
                  as amount_cents,
  (bill_cycle(p.date, c.closing_day)
     + ((n - 1) * interval '1 month'))::date as cycle_month
from purchase p
join card c on c.id = p.card_id
cross join lateral generate_series(1, p.installments) as n;

-- Fatura por cartão e ciclo: parcelas + recorrências no cartão.
create or replace view card_bill as
with parts as (
  select card_id, cycle_month, amount_cents from installment
  union all
  select r.card_id, m.cycle_month, r.amount_cents
  from recurrence r
  cross join lateral generate_series(
      date_trunc('month', r.start_date),
      date_trunc('month', coalesce(r.end_date, current_date + interval '24 months')),
      interval '1 month') as g(m)
  cross join lateral (select g.m::date) as m(cycle_month)
  where r.target = 'card'
)
select
  p.card_id,
  p.cycle_month,
  sum(p.amount_cents) as amount_cents,
  bill_due_date(p.cycle_month, c.closing_day, c.due_day) as due_date
from parts p
join card c on c.id = p.card_id
group by p.card_id, p.cycle_month, c.due_day, c.closing_day;

-- ---------------------------------------------------------------------
-- Linha do tempo
-- ---------------------------------------------------------------------
-- Retorna um registro por dia entre p_from e p_to, com o saldo acumulado.
-- Dias <= p_today usam apenas o real. Dias > p_today somam as projeções.
create or replace function timeline(p_from date, p_to date, p_today date default current_date)
returns table (
  day             date,
  real_cents      bigint,
  projected_cents bigint,
  balance_cents   bigint,
  is_projection   boolean
)
language sql stable as $$
with anchor as (
  select date, amount_cents
  from account_anchor
  where date <= p_from
  order by date desc
  limit 1
),
-- começa no dia do anchor, não depois dele: o anchor é o saldo no início
-- daquele dia, então o que foi lançado nele ainda conta. O span pode
-- começar antes de p_from — é assim que o acumulado chega até lá.
span as (
  select generate_series(
           coalesce((select date from anchor), p_from),
           p_to, interval '1 day')::date as day
),
-- movimento real: entrada positiva, saída e diário negativos
real_mov as (
  select t.date as day,
         sum(case when t.kind = 'entrada' then t.amount_cents
                  else -t.amount_cents end) as cents
  from transaction t
  group by t.date
),
-- recorrências de conta, sem exceção gravada naquele dia
proj_rec as (
  select s.day,
         sum(case when r.kind = 'entrada' then r.amount_cents
                  else -r.amount_cents end) as cents
  from span s
  join recurrence r
    on r.target = 'account'
   and s.day >= r.start_date
   and (r.end_date is null or s.day <= r.end_date)
   and s.day = clamp_day(date_trunc('month', s.day)::date, r.day_of_month)
  where s.day > p_today
    and not exists (
      select 1 from transaction t
      where t.recurrence_id = r.id and t.occurrence_date = s.day)
  group by s.day
),
-- faturas com vencimento no dia, sem pagamento real gravado
proj_bill as (
  select b.due_date as day, -sum(b.amount_cents) as cents
  from card_bill b
  where b.due_date > p_today
    and not exists (
      select 1 from transaction t
      where t.card_id = b.card_id and t.cycle_month = b.cycle_month)
  group by b.due_date
),
-- estimativa diária vigente naquele dia
proj_daily as (
  select s.day, -e.amount_cents as cents
  from span s
  cross join lateral (
    select amount_cents from daily_estimate d
    where d.effective_from <= s.day
    order by d.effective_from desc
    limit 1
  ) e
  where s.day > p_today
    -- se já existe diário lançado nesse dia futuro, não estima por cima
    and not exists (
      select 1 from transaction t
      where t.date = s.day and t.kind = 'diario')
),
merged as (
  select s.day,
         coalesce(rm.cents, 0) as real_cents,
         coalesce(pr.cents, 0) + coalesce(pb.cents, 0) + coalesce(pd.cents, 0)
           as projected_cents
  from span s
  left join real_mov  rm on rm.day = s.day
  left join proj_rec  pr on pr.day = s.day
  left join proj_bill pb on pb.day = s.day
  left join proj_daily pd on pd.day = s.day
),
-- o acumulado tem que rodar sobre o span inteiro: filtrar por p_from aqui
-- dentro deixaria de fora tudo que se moveu entre o anchor e p_from.
running as (
  select m.day,
         m.real_cents,
         m.projected_cents,
         coalesce((select amount_cents from anchor), 0)
           + sum(m.real_cents + m.projected_cents) over (order by m.day)
           as balance_cents,
         m.day > p_today as is_projection
  from merged m
)
select r.day, r.real_cents, r.projected_cents, r.balance_cents, r.is_projection
from running r
where r.day >= p_from
order by r.day;
$$;

-- Saldo de um dia só.
create or replace function balance_on(p_day date, p_today date default current_date)
returns bigint language sql stable as $$
  select balance_cents from timeline(p_day, p_day, p_today);
$$;

-- Compara o mês fechado anterior a p_today com a estimativa que estava
-- vigente no início daquele mês, para o aviso de desvio da Tela Hoje
-- (SPEC.md §9). Só retorna linha quando há o que avisar: mês com diário
-- lançado, estimativa para comparar, desvio acima de ~15% e mês ainda não
-- dispensado em estimate_dismissal — o resto (mostrar o card, escrever a
-- nova estimativa ou a dispensa) é responsabilidade da UI.
create or replace function estimate_deviation(p_today date default current_date)
returns table (month date, actual_cents bigint, estimate_cents bigint)
language sql stable as $$
  with last_month as (
    select date_trunc('month', p_today - interval '1 month')::date as month_start,
           (date_trunc('month', p_today) - interval '1 day')::date as month_end
  ),
  actual as (
    select lm.month_start,
           round(sum(t.amount_cents)::numeric
                 / extract(day from lm.month_end)::int)::bigint as actual_cents
    from last_month lm
    join transaction t
      on t.kind = 'diario' and t.date between lm.month_start and lm.month_end
    group by lm.month_start, lm.month_end
  ),
  estimate as (
    select lm.month_start, d.amount_cents as estimate_cents
    from last_month lm
    cross join lateral (
      select amount_cents from daily_estimate d
      where d.effective_from <= lm.month_start
      order by d.effective_from desc
      limit 1
    ) d
  )
  select a.month_start as month, a.actual_cents, e.estimate_cents
  from actual a
  join estimate e on e.month_start = a.month_start
  where abs(a.actual_cents - e.estimate_cents)::numeric / nullif(e.estimate_cents, 0) > 0.15
    and not exists (select 1 from estimate_dismissal ed where ed.month = a.month_start);
$$;

-- Dias pendentes: do último anchor (ou do primeiro dia com dado) até
-- ontem, sem transação e sem marca de conferido. O dia do anchor entra na
-- conta — o anchor afirma o saldo no início dele, não o que se gastou nele.
create or replace function pending_days(p_today date default current_date)
returns setof date language sql stable as $$
  with base as (
    select coalesce(
             (select max(date) from account_anchor where date <= p_today),
             (select min(date) from transaction),
             p_today
           ) as from_day
  )
  select d::date
  from base, generate_series(base.from_day, p_today - 1, interval '1 day') d
  where not exists (select 1 from transaction t where t.date = d::date)
    and not exists (select 1 from day_settled s where s.day = d::date)
  order by 1;
$$;

-- ---------------------------------------------------------------------
-- Simulação: lançamentos hipotéticos, nunca gravados.
-- Passe um jsonb: '[{"date":"2026-08-08","kind":"saida","amount_cents":120000}]'
-- ---------------------------------------------------------------------
create or replace function timeline_sim(
  p_from   date,
  p_to     date,
  p_today  date   default current_date,
  p_what_if jsonb default '[]'::jsonb
)
returns table (
  day             date,
  real_cents      bigint,
  projected_cents bigint,
  sim_cents       bigint,
  balance_cents   bigint,
  is_projection   boolean
)
language sql stable as $$
with sim as (
  select (w->>'date')::date as day,
         sum(case when w->>'kind' = 'entrada' then (w->>'amount_cents')::bigint
                  else -(w->>'amount_cents')::bigint end) as cents
  from jsonb_array_elements(p_what_if) w
  group by 1
),
base as (
  select * from timeline(p_from, p_to, p_today)
)
select
  b.day,
  b.real_cents,
  b.projected_cents,
  coalesce(s.cents, 0) as sim_cents,
  b.balance_cents + coalesce(sum(s.cents) over (order by b.day), 0) as balance_cents,
  b.is_projection
from base b
left join sim s on s.day = b.day
order by b.day;
$$;

-- Marcos da tela inicial: fim do mês, +3, +6, +12 meses.
create or replace function milestones(p_today date default current_date,
                                      p_what_if jsonb default '[]'::jsonb)
returns table (label text, day date, balance_cents bigint)
language sql stable as $$
  with pts as (
    select 'fim do mês' as label, 1 as ord,
           (date_trunc('month', p_today) + interval '1 month - 1 day')::date as day
    union all select '3 meses',  2, (p_today + interval '3 months')::date
    union all select '6 meses',  3, (p_today + interval '6 months')::date
    union all select '12 meses', 4, (p_today + interval '12 months')::date
  ),
  tl as (
    select * from timeline_sim(p_today, (p_today + interval '12 months')::date,
                               p_today, p_what_if)
  )
  select p.label, p.day, t.balance_cents
  from pts p join tl t on t.day = p.day
  order by p.ord;
$$;

-- Pior momento da janela: menor saldo e quando.
create or replace function worst_point(p_today date default current_date,
                                       p_what_if jsonb default '[]'::jsonb)
returns table (day date, balance_cents bigint)
language sql stable as $$
  select day, balance_cents
  from timeline_sim(p_today, (p_today + interval '12 months')::date,
                    p_today, p_what_if)
  order by balance_cents asc, day asc
  limit 1;
$$;
