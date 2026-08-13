# ADR 0006 — Três superfícies da previsão

**Status:** aceita (2026-08-13) · Consolida o que #39–#43 entregaram.
Emenda as consequências de ADR 0003 e 0005 que ainda apontavam para
Recorrências / Recalibrar planejamento.

## Contexto

O SPEC original descrevia Hoje + Lançar como as duas telas, com a
linha do tempo completa como acesso secundário e Recorrências como
CRUD em Configurações. O wizard (#15–#20) previa o mesmo fluxo em
**Configurações → Recalibrar planejamento**.

O código hoje é uma previsão de caixa com três superfícies
informacionais e Lançar como ação. Recorrências de conta e o
orçamento cotidiano já escrevem nas tabelas que `timeline` lê; um
editor separado só duplicava o destino.

## Decisão

1. **Termômetro, Previsão e Planejamento** são as três superfícies da
   previsão (`src/ui/destinations.ts`). Termômetro é a casa. Previsão
   e Planejamento saem dele (`push`) e trocam entre si (`replace`).
2. **Lançar** continua o FAB do Termômetro — transação, não destino
   analítico.
3. **Planejamento** é o editor operacional de `recurrence`
   (`target = 'account'`) e de `monthly_budget*` + `daily_estimate`,
   via `savePlanningAssumptions`. Não grava `account_anchor`.
4. O **wizard** (`confirmPlanning`) é só o primeiro uso
   (`needsFirstRun`). O modo `recalibrar` no módulo do wizard não é
   navegação do produto.
5. **Recorrências** deixa de ser destino. O módulo permanece como
   editor pontual (numpad, inativas) sem entrada na navegação.
6. Configurações fica com cartões, atalho ao Planejamento, rever
   estimativa e backup.

Cálculo inalterado: Termômetro lê `balance_on` / `milestones` /
`worst_point`; Previsão lê `timeline` / `timeline_movements`.

## Alternativas consideradas

**Manter Recorrências e Planejamento lado a lado.** Os dois
escreveriam as mesmas linhas de `recurrence`. O usuário teria que
adivinhar qual tela é a verdade da previsão.

**Reabrir o wizard de quatro passos para recalibrar.** Honraria o
contrato do mapa #14, mas o Planejamento já é a lista viva das
premissas; um stepper com âncora e resumo compete com Acertar saldo e
com o autosave.

**Quatro abas, Lançar incluído.** Mistura registrar o que aconteceu
com ler o que vai acontecer. Lançar precisa continuar sendo o caminho
de <5s.

## Consequências

- SPEC.md §6 descreve estas superfícies, não "Tela 1 Hoje / Tela 2
  Lançar / linha do tempo secundária".
- ADR 0005: o par wizard+Recorrências cede ao par wizard (1º uso) +
  Planejamento (o resto).
- ADR 0003: Recalibrar não é `Configurações → Recalibrar
  planejamento`; é a superfície Planejamento, só quando o gate está
  falso.
- `sessionStorage` de rascunho do wizard, previsto como opcional em
  ADR 0003, **não** foi implementado.
