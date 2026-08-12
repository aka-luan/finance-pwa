# ADR 0004 — Tabelas aditivas no boot e backup v2

**Status:** aceita (2026-08-12) · Resolve [#19](https://github.com/aka-luan/finance-pwa/issues/19).
Detalhe em `docs/wayfinder/resolution-19.md`. Cumpre o bump previsto em ADR 0001.

## Contexto

`monthly_budget` / `monthly_budget_line` (#17) são tabelas persistentes novas.
O boot atual não reexecuta o DDL de tabelas em IndexedDB já inicializado
(`schema.sql` § cabeçalho; `src/db/index.ts`). ADR 0001 exige: tabela nova
entra em `BACKUP_TABLES`, sobe `BACKUP_VERSION`, e `parseBackup` lê a versão
anterior preenchendo com `[]` o que ela não conhecia. Sem isso, ou a
composição nunca nasce em quem já usa o app, ou some de todo dump.

## Decisão

1. **Boot aditivo, não framework de migrações.** Banco já inicializado:
   além das funções/views, `CREATE TABLE IF NOT EXISTS` das tabelas
   introduzidas depois do schema original. Banco novo: `schema.sql` inteiro.
2. **Backup versão 2.** Exporta v2 com `monthly_budget` e
   `monthly_budget_line` na lista. Aceita v1 injetando essas duas como `[]`.
   Rejeita versão futura. Não inventa linhas de orçamento a partir de
   `daily_estimate`.

## Alternativas consideradas

**Runner `schema_migrations` com scripts numerados.** Correto se o schema
passar a mudar com frequência; para duas tabelas e um usuário, é
infraestrutura sem demanda. O cabeçalho de `schema.sql` já reserva migração
“de verdade” para mudança de coluna.

**`IF NOT EXISTS` em todas as tabelas e reexecutar a metade de tabelas.**
Tipos e índices sem guarda ainda falhariam; não resolve ALTER de coluna.

**Recusar backups v1.** Quebraria o caminho de restore do primeiro uso
(#15 / #18) e anos de histórico que o backup existe para proteger.

**Backfill de um bucket “Sem categoria” com 30 × estimativa.** Mentiria a
composição; a recalibração compararia um plano inventado com o realizado.

## Consequências

- DDL das tabelas novas vive em `schema.sql` **e** no snippet aditivo do
  boot até haver um mecanismo melhor; testes têm de cobrir os dois.
- Restore v1 deixa composição vazia e Hoje utilizável (gate #18 não exige
  `monthly_budget`).
- Recalibrar é o momento em que a composição passa a existir nesses bancos.
- Próxima tabela persistente: mesmo padrão (lista aditiva + bump de backup),
  ou aí sim um runner se o custo da duplicação doer.
