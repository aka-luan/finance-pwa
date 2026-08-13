# Resolução #20 — Como o wizard grava entradas e saídas fixas

> Canal do mapa: #14 → filho #20. Encaixa no confirm atômico de #18.

## Decisão em uma frase

Cada linha de **entrada/saída fixa** do wizard é uma `recurrence` com
`target = 'account'`; a recalibração reconcilia por **id** (criar /
atualizar / desativar) dentro da mesma transação do confirm.

## Mapeamento de campos

| Wizard (`FixedRow`) | `recurrence` |
|---|---|
| bloco Entradas | `kind = 'entrada'` |
| bloco Saídas | `kind = 'saida'` |
| `name` (trim) | `label` |
| `cents` (> 0) | `amount_cents` |
| `dayOfMonth` (1–31) | `day_of_month` |
| — | `target = 'account'` (sempre) |
| — | `card_id = NULL` |
| — | `category_id = NULL` |
| — (só no create) | `start_date = hoje` (`America/Belem`) |
| — (só no create) | `end_date = NULL` |

Não há tabela nova nem coluna de “origem wizard”. O passo Fixos **é** a
visão de planejamento das recorrências de conta.

## O que o Fixos coleta (emenda fina ao #15)

A sequência em quatro passos do #15 permanece. O controle de cada linha
fixa deixa de ser só nome+valor: passa a incluir **dia do mês** (1–31).

Motivo: o schema exige `day_of_month`, e a timeline projeta no dia certo.
Default das sugestões novas = **1**; na recalibração o valor vem da
recorrência existente. Ajustes contínuos são o **Planejamento**
(ADR 0006), não a tela Recorrências.

## Linhas que não viram recorrência

- `cents = 0` → não cria. Se a linha já tinha `id` de recorrência ativa,
  **desativa** no confirm (`end_date = hoje`, mesma semântica de
  `deactivateRecurrence`).
- `label` vazio após trim com `cents > 0` → **bloqueia** o confirm
  (mesma regra da UI de Recorrências).
- Sugestões iniciais deixadas em zero no primeiro uso simplesmente
  somem — zero continua ok no planejamento.

## Recalibração — carregar

`listRecurrences(hoje)` (já filtra `target = 'account'`):

- `kind = 'entrada'` e `active` → lista de entradas
- `kind = 'saida'` e `active` → lista de saídas
- `FixedRow.id = recurrence.id`
- Inativas não aparecem; o wizard **não** reativa
- Recorrências `target = 'card'` **nunca** entram no wizard e **nunca**
  são tocadas no confirm

## Confirm — reconciliação (mesmo `db.transaction` de #18)

Seja `W` o conjunto de linhas do wizard com `cents > 0` e label ok, e
`A` o conjunto de ids de recorrências de conta **ativas** antes do
confirm:

1. Para cada linha em `W` com `id ∈ A` → `UPDATE` de `kind`,
   `amount_cents`, `day_of_month`, `label`. **Não** altera `start_date`
   nem `end_date` (editar só muda o futuro; exceções já gravadas
   continuam ligadas ao mesmo `recurrence_id`).
2. Para cada linha em `W` com `id ∉ A` (linha nova) → `INSERT` com
   `start_date = hoje`.
3. Para cada `id ∈ A` ausente de `W` (usuário removeu a linha, ou zerou)
   → desativar com `hoje`.

Identidade é sempre o **uuid**, nunca o label (dois “Freelas” são
linhas distintas).

O mesmo reconcile roda no Planejamento (`savePlanningAssumptions`),
sem gravar âncora.

## O que isto não é

- Não versiona fixos por `effective_from` (diferente de
  `monthly_budget` / `daily_estimate`). Recorrência já é regra vigente
  com `start_date`/`end_date`.
- Não mistura fixos com o orçamento mensal de gastos cotidianos.
- Não grava recorrência de cartão pelo wizard.
- Não preenche `category_id` nos fixos — categoria é vocabulário do
  cotidiano/diário (#17).

## Critérios de aceitação

Implementados no wizard (`confirmPlanning`) e no Planejamento
(`savePlanningAssumptions` — sem âncora, sem rollback de tela: o
autosave é a transação).

- Confirm do primeiro uso com N entradas/saídas > 0 cria exatamente N
  recorrências de conta; zeros não aparecem em `listRecurrences`.
- Recalibrar, mudar valor/dia/nome de uma linha existente, confirmar →
  mesmo `id`, campos atualizados; `transaction` com aquele
  `recurrence_id` intacta.
- Remover (ou zerar) uma linha na recalibração → `active = false` a
  partir de hoje; deixa de projetar.
- Rollback do confirm (#18) reverte também creates/updates/deactivates
  de recorrência.
- Recorrência de cartão pré-existente permanece inalterada após o
  wizard.

## Próximo nevoeiro afiado

Com #15–#20 fechados, o mapa #14 tem as decisões necessárias para a
especificação de implementação. Fog restante é só redação operacional
(textos finos de erro já apontados no #15) — não bloqueia começar a
implementar.
