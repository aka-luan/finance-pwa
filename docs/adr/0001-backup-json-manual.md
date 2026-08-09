# ADR 0001 — Backup manual em JSON

**Status:** aceita (2026-08-09) · Resolve o item "Backup: formato do dump e
gatilho" de `SPEC.md` §11.

## Contexto

`SPEC.md` §5 trata o backup como **obrigatório** enquanto o ElectricSQL não
entra: o banco vive em IndexedDB no aparelho e o navegador pode limpá-lo sob
pressão de espaço, levando junto os anos de histórico que vieram da planilha.

§11 deixou em aberto duas coisas: o formato do dump e o gatilho.

## Decisão

**Formato: JSON, uma matriz por tabela, identado.** Um objeto com `format`,
`version`, `exported_at` e `tables`. Valores em centavos vão como *string*,
não como número JSON — `JSON.parse` devolveria float e perderia precisão
acima de 2^53, contra a regra de `SPEC.md` §5 de que dinheiro é `bigint`.
Datas já são texto `YYYY-MM-DD`; timestamps saem em ISO.

**Gatilho: manual, na tela Configurações.** Um botão exporta, outro restaura.

**Restaurar substitui tudo.** Não há mesclagem: é um usuário e um aparelho
(`SPEC.md` §2), então um arquivo restaurado é a nova verdade. O arquivo é
validado inteiro antes de o banco ser tocado, e a troca acontece dentro de uma
transação.

## Alternativas consideradas

**`dumpDataDir()` do PGlite** (tar.gz do diretório de dados). Restauração
exata e sem código de serialização, mas o arquivo é opaco, alguns megabytes de
catálogo do Postgres, e preso à versão do PGlite que o gerou. Um backup que
só a versão certa do app consegue abrir protege menos anos de histórico do que
um texto legível.

**Dump SQL.** Legível, mas exigiria gerar e reaplicar `INSERT`s à mão, com
escaping próprio, para ganhar o mesmo que o JSON já dá.

**Backup automático (periódico ou ao fechar).** Adiado, mas não porque não
adiantaria: o arquivo baixado sai do IndexedDB, então automatizar protegeria
de verdade. O impedimento é outro — o navegador só entrega um arquivo dentro
de um gesto do usuário, então exportação de fundo não existe num PWA. O que
sobra é o *lembrete* ("faz um mês desde o último backup"), e o ticket autoriza
revisitar isso depois. Quando o Electric entrar, o dump periódico para o
servidor previsto em §5 substitui esta tela como caminho principal.

## Consequências

- O arquivo é inspecionável: o usuário abre e vê o próprio histórico.
- Ele carrega no Postgres do servidor quando o Electric chegar, porque o
  schema é o mesmo dos dois lados (`SPEC.md` §5).
- `BACKUP_TABLES`, em `src/db/backup.mjs`, tem de acompanhar o `schema.sql`.
  Uma tabela nova esquecida ali sumiria de todo backup em silêncio — o pior
  defeito possível numa função de backup. `findTablesOutsideBackup` compara a
  lista com o `information_schema` e a tela diz o que ficou de fora, mas o
  arquivo sai assim mesmo: um backup sem uma tabela nova ainda guarda os anos
  de histórico que motivam a funcionalidade, e recusar deixaria o usuário sem
  nada. Restaurar não destrói o que está fora da lista — o `truncate` só
  alcança as tabelas que ela nomeia.
- O teste compara **todas as colunas de todas as tabelas**, não só a linha do
  tempo. `timeline()` não lê `day_settled`, `estimate_dismissal`,
  `category.name`, `recurrence.label` nem `purchase.description`, então um
  round-trip que corrompesse qualquer um deles ainda mostraria uma linha do
  tempo idêntica. `pending_days()` entra pelo mesmo motivo (§8).
- `created_at`/`settled_at`/`dismissed_at` voltam com precisão de
  milissegundo, não de microssegundo. Nenhum cálculo os lê (`timeline`,
  `card_bill`, `pending_days` e as demais olham só `date`), então saldo e
  linha do tempo se reproduzem exatamente.
- Exportar depende de o navegador aceitar `<a download>`. Se no iOS em modo
  standalone isso se mostrar frágil, o caminho é `navigator.share` com o
  arquivo — não feito agora porque o Safari exige que a chamada aconteça
  dentro do gesto do usuário, e a exportação passa por um `await` no banco.
