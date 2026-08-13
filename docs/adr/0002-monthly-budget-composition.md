# ADR 0002 — Composição versionada do orçamento mensal

**Status:** aceita (2026-08-11) · Resolve [#17](https://github.com/aka-luan/finance-pwa/issues/17)
no mapa do wizard de planejamento (#14). Detalhe em
`docs/wayfinder/resolution-17.md`.

## Contexto

O wizard de planejamento define um **orçamento mensal de gastos cotidianos**
por categoria e dele deriva a **estimativa diária** (`Σ / 30`, #16). Hoje o
schema só persiste:

- `category` — `id` + nome;
- `daily_estimate` — total diário + `effective_from`.

A recalibração precisa reabrir a composição vigente; a timeline precisa
continuar projetando com a estimativa vigente em cada dia; o card de desvio
(SPEC.md §9) ainda pode gravar uma estimativa nova **sem** reescrever
categorias. Não dá para empilhar tudo numa coluna só sem perder um desses
caminhos.

## Decisão

**Separar composição e estimativa, versionar as duas por `effective_from`.**

1. Manter `daily_estimate` como **única** entrada da projeção (timeline,
   Hoje, desvio). Sem mudança de semântica.
2. Introduzir `monthly_budget` + `monthly_budget_line` (FK para `category`),
   com `effective_from` único no cabeçalho — mesmo padrão de vigência.
3. No confirm do wizard, gravar composição e estimativa com o **mesmo**
   `effective_from = hoje`; a estimativa é `round_half_up(Σ linhas / 30)`.
4. Reusar `category`; não criar catálogo paralelo. "Sem categoria" continua
   sendo só agrupamento de UI para `category_id` nulo.
5. Não amarrar as duas tabelas por FK: o desvio pode avançar só a estimativa.

## Alternativas consideradas

**Derivar a estimativa na leitura a partir do orçamento.** Eliminaria a
duplicação no write do wizard, mas obrigaria a timeline e o card de desvio a
conhecerem composição, e quebraria o caso em que a estimativa muda sem novo
plano por categoria. Custo alto demais para o ganho.

**Guardar só a composição "atual" (sem histórico).** Bastaria para
reabrir a recalibração, mas perderia a explicação de qual plano acompanhou
cada estimativa gravada pelo wizard. O padrão `effective_from` já existe no
domínio; espelhá-lo custa pouco.

**Embutir a composição em JSON numa coluna de `daily_estimate`.** Evita
tabela nova, mas mistura conceitos, dificulta somar por `category_id` e
complica backup/consulta. Tabelas relacionais batem com o resto do schema.

## Consequências

- Explicabilidade histórica do **total diário** permanece em
  `daily_estimate`; a do **plano por categoria**, em `monthly_budget*`.
- Recalibração lê a composição com maior `effective_from <= hoje`.
  (Hoje: o Planejamento faz essa leitura.)
- As tabelas novas entram em `BACKUP_TABLES` com bump de
  `BACKUP_VERSION` e leitura compatível da v1 — detalhe de #19.
- Detecção de primeiro uso / conclusão atômica (#18) pode tratar
  "planejamento concluído" como presença de composição + estimativa (+
  saldo) gravadas juntas.
- Schema ainda não aplicado neste ADR: a decisão trava o modelo; a
  migração e o backup são o próximo mapa (#19).

## Atualização

Tabelas aplicadas (ADR 0004). Recalibração contínua é o **Planejamento**
(`savePlanningAssumptions`), não o wizard de quatro passos — ADR 0006.
