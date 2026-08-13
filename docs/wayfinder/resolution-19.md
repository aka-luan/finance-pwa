# Resolução #19 — Migração e compatibilidade dos backups

> Canal do mapa: #14 → filho #19. Depende de #17. Alinha o restore ao gate de #18.

## Decisão em uma frase

Tabelas novas entram no banco existente com **`CREATE TABLE IF NOT EXISTS` no boot** (sem framework de migrações). O JSON sobe para **backup v2**; arquivos **v1 restauram** preenchendo `monthly_budget*` com `[]` — **não** inventar composição a partir da estimativa.

## 1) Instalações existentes (IndexedDB)

Hoje o boot só aplica a metade de tabelas se `to_regclass('transaction')` é nulo; senão reaplica só funções/views. `monthly_budget` / `monthly_budget_line` nunca nasceriam em quem já usa o app.

**Não** construir um runner versionado agora (um usuário, mudanças raras). **Sim** um passo **aditivo** no boot de banco já inicializado:

```text
se transaction não existe → schema.sql inteiro (banco novo)
senão:
  1. funções/views (como hoje)
  2. ensureAdditiveTables(): CREATE TABLE IF NOT EXISTS
     para cada tabela introduzida depois do schema original
```

`schema.sql` continua a fonte da verdade no banco **novo**. O snippet aditivo duplica só o DDL das tabelas pós-v1 (`monthly_budget`, `monthly_budget_line` + FKs/PK). Quem acrescentar tabela no schema **tem** de acrescentá-la também na lista aditiva — o teste `BACKUP_TABLES` vs `information_schema` pega o buraco no backup; um teste de boot em banco “só com as tabelas v1” pega o buraco na migração.

`IF NOT EXISTS` é idempotente: boot seguinte não falha. **Não** altera colunas de tabelas velhas; mudança de coluna continua precisando de migração explícita (já dito no cabeçalho de `schema.sql`).

Após o create, composição vazia é o estado honesto: a estimativa vigente permanece; o Planejamento grava a primeira `monthly_budget` (#17). `needsFirstRun` **não** exige composição (#18) — o Termômetro continua válido.

## 2) Backup JSON

Contrato já previsto em ADR 0001:

| Peça | Valor |
|---|---|
| `BACKUP_VERSION` de exportação | **2** |
| Tabelas novas em `BACKUP_TABLES` | `monthly_budget`, depois `monthly_budget_line` (pai antes de filho; depois de `category`) |
| `parseBackup` aceita | **1 e 2** |
| Arquivo v1 | tabelas v1 obrigatórias; `monthly_budget` e `monthly_budget_line` = `[]` |
| Arquivo v2 | todas as tabelas da lista atual obrigatórias (incluindo composição) |
| Versão desconhecida | rejeitar, como hoje |

Preencher com `[]` **só** as tabelas que a versão do arquivo **ainda não conhecia**. Falta de uma tabela que a versão **deveria** ter continua erro — senão `tables: {}` apagaria o banco.

Exportar **sempre v2**. Restore v1 → export v2 passa a incluir as chaves de composição (vazias). Assim a composição **não some em silêncio** nos backups seguintes: ou está no arquivo, ou o array vazio declara a ausência.

`findTablesOutsideBackup` permanece o alarme de runtime se o schema ganhar tabela esquecida em `BACKUP_TABLES`.

## 3) Não reconstruir o plano

Restore v1 / banco antigo **não** deriva linhas de orçamento a partir de `daily_estimate`. A estimativa é um total diário; a composição é por categoria. Inventar um único bucket mentiria na comparação. O Planejamento começa com a composição vigente, ou vazia (sugestões só no wizard de primeiro uso).

## 4) Perda silenciosa — o que impede

- Tabela nova fora de `BACKUP_TABLES` → teste de cobertura + aviso na UI (já existe).
- Tabela nova no schema mas não no boot aditivo → instalação antiga quebra ao gravar o wizard; teste de boot “schema v1 + additive”.
- Restore v1 sem chaves novas → `parseBackup` injeta `[]`; truncate/insert só nas tabelas conhecidas, sem apagar o que estiver fora da lista (ADR 0001).
- Restore v2 com composição → round-trip de todas as colunas, como o teste atual.

## O que isto não é

- Não implementa as tabelas neste ticket de wayfinding (só trava o contrato).
- Não é um sistema geral de `schema_migrations`.
- Não mexe no predicado `needsFirstRun` (#18).
- Não mapeia fixos → recorrências (#20).

## Próximo nevoeiro afiado

#20: as recorrências do confirm entram no **mesmo** commit atômico (#18) e já estão em `BACKUP_TABLES` v1 — sem bump extra de backup.
