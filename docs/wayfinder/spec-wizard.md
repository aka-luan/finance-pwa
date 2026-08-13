# Spec: wizard de planejamento financeiro

> Destino do mapa [#14](https://github.com/aka-luan/finance-pwa/issues/14).
> Consolida #15–#20. Implementado: wizard no **primeiro uso**;
> recalibração contínua é o **Planejamento** (ADR 0006), não este
> stepper.

## Objetivo

No primeiro uso (banco sem âncora+estimativa) um wizard configura saldo
em conta, entradas/saídas fixas, orçamento mensal de gastos cotidianos
por categoria e a estimativa diária derivada. Depois disso, as mesmas
premissas (exceto a âncora) editam-se no Planejamento.

## Experiência (#15)

Quatro passos (Variante A): **Saldo → Fixos → Cotidiano → Resumo**.

- Saldo pode ser negativo; no primeiro uso, caminho de restaurar backup.
- Fixos: entradas e saídas (nome, dia do mês, valor). Zero ok.
- Cotidiano: categorias editáveis; total do mês > 0.
- Resumo: saldo, fixos, cotidiano, prévia do diário, prévia de hoje,
  sobra informativa (saldo + entradas − saídas − cotidiano).
- A comparação planejado vs realizado dos últimos 30 dias (#16) existe
  no modo `recalibrar` do wizard; o Planejamento **não** a mostra.

Protótipo throwaway: `/?prototype=wizard&variant=A`.

## Cálculo (#16)

- `daily_estimate = round_half_up(Σ cotidiano / 30)` (centavos, half-up).
- Vigência nova a partir de hoje (`America/Belem`).
- Realizado na janela `[hoje−29, hoje]` (query `spentByCategoryLast30Days`);
  o Planejamento não exibe esses deltas. `NULL` → “Sem categoria”.

## Persistência do cotidiano (#17 / ADR 0002)

- `monthly_budget` + `monthly_budget_line` → `category`.
- `daily_estimate` continua sendo a única entrada da projeção.
- Confirm grava composição e estimativa com o **mesmo** `effective_from`.
- Fixos **não** entram nessas tabelas.

## Primeiro uso (#18 / ADR 0003)

- `needsFirstRun` ⇔ falta `account_anchor` **ou** `daily_estimate`
  (não exige `monthly_budget`).
- Sem rascunho no Postgres nem em `sessionStorage`.
- Confirm = uma `db.transaction`: categorias → âncora →
  `monthly_budget*` → `daily_estimate` → reconciliar fixos (#20).
- Restore de backup reusa o mesmo gate.
- Recalibrar no produto **não** reabre este wizard: é o Planejamento
  (`savePlanningAssumptions`, sem âncora). O modo `recalibrar` no
  módulo do wizard não tem entrada na navegação.

## Migração / backup (#19 / ADR 0004)

- Boot: `CREATE TABLE IF NOT EXISTS` para tabelas pós-v1.
- Backup v2 inclui `monthly_budget*`; v1 restaura com `[]`.
- Sem backfill de composição a partir da estimativa.

## Fixos → recorrências (#20 / ADR 0005)

- Entrada/saída fixa ⇔ `recurrence` com `target = 'account'`.
- Campos: `kind`, `label`, `amount_cents`, `day_of_month`;
  `category_id` nulo; `start_date = hoje` no create.
- Zero / removida → desativa (`end_date = hoje`).
- Recalibração reconcilia por **uuid** (update / insert / deactivate).
- Recorrências de cartão fora do escopo do wizard e do Planejamento.

## Fora de escopo (mapa)

- Diário “seguro” a partir de renda/fixos/faturas.
- Cotidiano no cartão; auto-substituir plano pelo realizado.

O wizard de produção (#27) e o Planejamento (ADR 0006) já saíram do
mapa: o mapa #14 terminou na spec; a implementação não é retrabalho
deste wayfinding.
