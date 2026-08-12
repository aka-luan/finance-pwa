# Spec: wizard de planejamento financeiro

> Destino do mapa [#14](https://github.com/aka-luan/finance-pwa/issues/14).
> Consolida #15–#20. **Não implementa** — só trava o contrato para a
> implementação.

## Objetivo

No primeiro uso (banco sem âncora+estimativa) e em
**Configurações → Recalibrar planejamento**, um wizard configura saldo em
conta, entradas/saídas fixas, orçamento mensal de gastos cotidianos por
categoria e a estimativa diária derivada.

## Experiência (#15)

Quatro passos (Variante A): **Saldo → Fixos → Cotidiano → Resumo**.

- Saldo pode ser negativo; no primeiro uso, caminho de restaurar backup.
- Fixos: entradas e saídas (nome, dia do mês, valor). Zero ok.
- Cotidiano: categorias editáveis; total do mês > 0; na recalibração,
  comparação dos últimos 30 dias no mesmo passo.
- Resumo: saldo, fixos, cotidiano, prévia do diário, prévia de hoje,
  sobra informativa (saldo + entradas − saídas − cotidiano).

Protótipo throwaway: `/?prototype=wizard&variant=A`.

## Cálculo (#16)

- `daily_estimate = round_half_up(Σ cotidiano / 30)` (centavos, half-up).
- Vigência nova a partir de hoje (`America/Belem`).
- Realizado na recalibração: diários em `[hoje−29, hoje]`; `NULL` →
  “Sem categoria”; deltas só informativos.

## Persistência do cotidiano (#17 / ADR 0002)

- `monthly_budget` + `monthly_budget_line` → `category`.
- `daily_estimate` continua sendo a única entrada da projeção.
- Confirm grava composição e estimativa com o **mesmo** `effective_from`.
- Fixos **não** entram nessas tabelas.

## Primeiro uso (#18 / ADR 0003)

- `needsFirstRun` ⇔ falta `account_anchor` **ou** `daily_estimate`
  (não exige `monthly_budget`).
- Sem rascunho no Postgres; draft opcional em `sessionStorage`.
- Confirm = uma `db.transaction`: categorias → âncora →
  `monthly_budget*` → `daily_estimate` → reconciliar fixos (#20).
- Restore de backup reusa o mesmo gate.

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
- Recorrências de cartão fora do escopo do wizard.

## Fora de escopo (mapa)

- Implementar o wizard de produção.
- Diário “seguro” a partir de renda/fixos/faturas.
- Cotidiano no cartão; auto-substituir plano pelo realizado.
