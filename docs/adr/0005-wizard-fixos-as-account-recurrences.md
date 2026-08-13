# ADR 0005 — Fixos do wizard como recorrências de conta

**Status:** aceita (2026-08-12) · Resolve [#20](https://github.com/aka-luan/finance-pwa/issues/20)
no mapa do wizard de planejamento (#14). Detalhe em
`docs/wayfinder/resolution-20.md`.

## Contexto

O passo Fixos do wizard (#15) coleta entradas e saídas mensais que **não**
entram no diário nem no orçamento mensal de gastos cotidianos (#17). O
schema já tem `recurrence` (`kind`, `target`, `amount_cents > 0`,
`day_of_month`, `label`, `start_date`/`end_date`) e a tela Recorrências
já faz CRUD de `target = 'account'`. O confirm do wizard é atômico (#18)
e precisa gravar esses fixos no mesmo commit.

Faltava travar: mapeamento de campos, o que fazer com valor zero, se o
dia do mês entra no stepper, e como a recalibração reconcilia com
recorrências já existentes (inclusive as criadas fora do wizard).

## Decisão

1. **Reusar `recurrence`**, sem tabela paralela. Entrada/saída fixa do
   wizard ⇔ recorrência de conta (`target = 'account'`, `category_id`
   nulo).
2. **Coletar `day_of_month` no passo Fixos** (emenda de controle ao #15,
   sem mudar a sequência). Default de sugestão = 1.
3. **Valor zero não persiste**; linha zerada ou removida na recalibração
   desativa a recorrência (`end_date = hoje`).
4. **Reconciliação por uuid** no confirm: update in-place, insert das
   novas, deactivate das ausentes. Preserva `recurrence_id` das
   exceções já lançadas.
5. Recorrências de **cartão** ficam fora do wizard e do confirm.

## Alternativas consideradas

**Default silencioso de dia (ex.: sempre 1) sem campo no wizard.**
Respeitaria o protótipo nome+valor à risca, mas a timeline projetaria
no dia errado até o usuário descobrir Recorrências. Aceitável como
atalho; ruim para o destino do mapa (planejamento que alimenta
projeção).

**Substituir todas as recorrências de conta a cada confirm** (end-date
em massa + inserts novos). Mais simples de codificar, mas quebra a
identidade das exceções (`transaction.recurrence_id`) e joga fora o
dia fino que o usuário já ajustou.

**Casar por `label`.** Frágil com renomeação e duplicatas (“Freelas”).

**Coluna `source = 'wizard'` / subset gerenciado.** Schema extra para
um único usuário local-first; o passo Fixos já é a lista completa de
fixos de conta.

## Consequências

- O confirm de #18 ganha o passo concreto “reconciliar recorrências de
  conta” além de âncora / `monthly_budget*` / `daily_estimate`.
- A tela Recorrências e o wizard passam a editar o **mesmo** conjunto
  (conta). Cartão continua só na tela de cartões/recorrência de cartão.
- O protótipo throwaway (`FixedRow`) passa a carregar `dayOfMonth` para
  documentar o contrato; a implementação real reusa as queries de
  recorrência dentro da transação do confirm.
- Backup: nenhuma tabela nova — `recurrence` já está em `BACKUP_TABLES`.

## Atualização

O mapeamento fixo ⇔ `recurrence` de conta permanece. O editor
contínuo **não** é a tela Recorrências: é o **Planejamento**
(ADR 0006). Recorrências de cartão continuam fora; o módulo
`src/ui/recorrencias.ts` não é destino do produto.
