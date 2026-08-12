# Resolução #18 — Detecção, retomada e conclusão do primeiro uso

> Canal do mapa: #14 → filho #18. Depende de #17.

## Decisão em uma frase

O domínio **só é tocado na confirmação** (transação atômica). Até lá o app não entra em Hoje. “Wizard incompleto” **não** é um estado no Postgres — é UI/sessão — justamente para não deixar gravações parciais.

## Estados (o que existe de verdade)

| Situação | Como reconhecer | Primeira tela |
|---|---|---|
| **Banco novo / não pronto** | `needsFirstRun` = verdadeiro | Wizard (modo primeiro uso) |
| **Wizard incompleto** | Wizard aberto; progresso só em memória (ou `sessionStorage` opcional). **Nenhuma** linha de `account_anchor` / `monthly_budget` / `daily_estimate` / recorrências do confirm | Continua no wizard; refresh sem draft → wizard do zero |
| **Planejamento concluído** | `needsFirstRun` = falso (após confirm atômico do wizard **ou** backup que já deixa o app pronto) | Hoje |
| **Backup restaurado** | Não é flag: `importBackup` substitui as tabelas conhecidas; em seguida reaplica-se o mesmo `needsFirstRun` | Hoje se pronto; senão wizard |

Não inventamos tabela `app_setup` / `planning_status`. Os artefatos de domínio (#17) já bastam para o gate.

## Predicado `needsFirstRun`

```text
needsFirstRun ⇔
  NÃO (EXISTS account_anchor
       AND EXISTS daily_estimate)
```

Por quê **não** exigir `monthly_budget` no gate:

- Backups v1 / instalações atuais podem ter saldo + estimativa sem composição (#19). Forçar wizard esconderia um Hoje já honesto.
- Composição ausente com estimativa presente → Hoje ok; **Recalibrar** cria a primeira `monthly_budget`.
- Confirm **novo** (pós-#17) sempre grava os três; o gate mínimo evita mentir no hero/saldo.

Ausência **só** de saldo ou **só** de estimativa → ainda `needsFirstRun` (não dá para montar Hoje sem os dois).

## Boot / escolha de tela

1. Shell DOM imediato (como hoje: `main` não espera PGlite).
2. `await getDb()`.
3. Se `needsFirstRun` → **não** chama `renderHoje`. Renderiza o wizard em modo primeiro uso (obrigatório; sem pular).
4. Senão → `renderHoje`.
5. Enquanto o gate não resolveu: UI neutra (vazio / “carregando”), **nunca** saldo `R$ 0,00` fingindo conta zerada nem hero “Sem estimativa” como se fosse uso normal.

Recalibrar (`Configurações → Recalibrar planejamento`) só existe quando `NOT needsFirstRun`.

## Conclusão (confirm) — atômica

Uma única `db.transaction` no confirm do primeiro uso / recalibrar:

1. Categorias necessárias (`category` upsert por nome/id do wizard).
2. `account_anchor` com o saldo informado, data = hoje (`America/Belem`) — mesma semântica de “Acertar saldo”: saldo no **início** do dia; no primeiro uso o banco está vazio, então o valor digitado é o ponto de partida.
3. `monthly_budget` + `monthly_budget_line` com `effective_from = hoje` (#17).
4. `daily_estimate` com o mesmo `effective_from` e `amount_cents = round_half_up(Σ/30)` (#16).
5. Entradas/saídas fixas → recorrências, conforme #20 (mesmo commit quando #20 fechar).

Falha em qualquer passo → rollback inteiro → `needsFirstRun` permanece verdadeiro. **Proibido** gravar âncora ou estimativa “para ir adiantando” entre passos do wizard.

No primeiro uso, ao sucesso → vai para Hoje. Na recalibração → volta para Configurações ou Hoje (detalhe de navegação da implementação).

## Retomada

- **Dentro da sessão:** o stepper (#15) guarda o passo em memória; Voltar/Continuar não persiste domínio.
- **Opcional de UX:** espelhar o draft em `sessionStorage` para sobreviver a reload da aba; apagar no confirm ou ao restaurar backup. Não é fonte de verdade.
- **Não** há retomada de wizard incompleto via Postgres: matar o app a meio caminho deixa o banco ainda “não pronto” e o próximo open reabre o wizard do início (ou do draft de sessão, se houver).

Isso atende “sem gravações parciais” sem um segundo modelo de rascunho no schema.

## Restaurar backup (caminho do passo Saldo)

1. Usuário escolhe arquivo → `parseBackup` / `importBackup` (já substitui tudo conhecido).
2. Após restore, recalcular `needsFirstRun`:
   - pronto → Hoje (sai do wizard);
   - ainda não pronto (arquivo vazio/estranho) → permanece no wizard.
3. Não marcar “restaurado” em lugar nenhum: o conteúdo do banco **é** o estado.

## O que isto não decide

- Schema/`BACKUP_TABLES` para `monthly_budget*` (#19).
- Mapeamento fino fixos → `recurrence` (#20), só que entra no **mesmo** commit.
- Textos de loading / erro de restore (tom já no #15).

## Próximo nevoeiro afiado

#19: ao acrescentar `monthly_budget*`, backups v1 sem essas tabelas precisam continuar restauráveis e cair em Hoje quando já tiverem âncora + estimativa — alinhado a este gate.
