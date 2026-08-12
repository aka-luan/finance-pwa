# ADR 0003 — Gate de primeiro uso sem gravação parcial

**Status:** aceita (2026-08-11) · Resolve [#18](https://github.com/aka-luan/finance-pwa/issues/18).
Detalhe em `docs/wayfinder/resolution-18.md`.

## Contexto

Hoje o boot pinta `renderHoje` imediatamente; sem estimativa o hero vira
“Sem estimativa diária ainda” e o saldo sem âncora aparece como `R$ 0,00`.
O wizard de planejamento precisa ser obrigatório no banco novo, concluir de
forma atômica (saldo + composição + estimativa, #17), e o restore de backup
tem de cair no lugar certo sem um flag extra.

## Decisão

1. **`needsFirstRun`** ⇔ não existem **ao mesmo tempo** um `account_anchor` e
   um `daily_estimate`. Se verdadeiro, o app renderiza o wizard (primeiro
   uso) e **não** entra em Hoje.
2. **Confirm atômico** — uma `db.transaction` grava âncora, `monthly_budget*`
   e `daily_estimate` (e fixos/#20) juntos; rollback deixa o gate ligado.
3. **Sem rascunho no Postgres.** Progresso do wizard é memória /
   `sessionStorage` opcional. “Incompleto” não é linha de domínio.
4. **Backup restaurado** não é estado: após `importBackup`, reaplica-se o
   mesmo predicado.

`monthly_budget` **não** entra no gate: backups v1 podem ter saldo +
estimativa sem composição e ainda assim merecem Hoje (#19).

## Alternativas consideradas

**Flag `planning_status` / tabela de setup.** Duplica o que âncora +
estimativa já dizem e precisa ser mantida no restore.

**Exigir `monthly_budget` no gate.** Quebraria restores e bancos atuais
com estimativa já vigente.

**Gravar âncora/estimativa passo a passo.** Viola a restrição de não deixar
gravações parciais e deixaria Hoje mentir no meio do fluxo.

## Consequências

- `main` / boot passam a ramificar após `getDb()` conforme `needsFirstRun`.
- Recalibrar só quando o gate está falso.
- Implementação do wizard de produção e #19/#20 devem respeitar o commit
  único na confirmação.
