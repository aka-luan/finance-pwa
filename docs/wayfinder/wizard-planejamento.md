# Mapa: wizard de planejamento financeiro

> Canonical map: [#14](https://github.com/aka-luan/finance-pwa/issues/14). This file mirrors the chart for local reading; open tickets live as child issues of that map.

## Destination

Produzir uma especificação pronta para implementar um wizard que configure o saldo em conta e derive a estimativa diária de um orçamento mensal de gastos cotidianos no primeiro uso. Recalibração contínua ficou no **Planejamento** (ADR 0006), não neste stepper.

**Status:** destino atingido — spec em `docs/wayfinder/spec-wizard.md` (#15–#20); wizard de produção em #27; editor contínuo em ADR 0006.

## Notes

- Domínio: PWA financeira pessoal, local-first, com dinheiro persistido em centavos e datas no fuso `America/Belem`.
- Skills a consultar ao trabalhar os tickets: `domain-modeling`; `prototype` no ticket de experiência; `codebase-design` nos tickets de persistência e estado.
- O primeiro uso deve preservar o caminho de restauração de backup.
- Compras no cartão de crédito e despesas fixas não compõem o orçamento de gastos cotidianos.
- A implementação não faz parte deste mapa; o mapa termina quando as decisões necessárias para uma especificação estiverem resolvidas.

## Decisions so far

- O wizard é obrigatório quando o banco está vazio; o usuário conclui o planejamento ou restaura um backup.
- Recalibrar **não** reabre o wizard: é a superfície Planejamento (ADR 0006). Configurações só tem um atalho para ela.
- O wizard recebe o saldo atual, inclusive negativo.
- O usuário planeja valores mensais por categorias editáveis. Sugestões iniciais: Mercado, Transporte, Lanches e passeios, Farmácia e saúde, Cuidados pessoais e Pequenos imprevistos.
- Categorias individuais podem ter valor zero, mas o orçamento mensal total precisa ser maior que zero.
- A estimativa diária é o orçamento mensal total dividido por 30 dias corridos.
- A prévia de hoje é a estimativa diária menos os gastos diários já lançados hoje e pode ficar negativa.
- Apenas gastos cotidianos pagos diretamente pelo saldo em conta, como Pix ou débito, entram no cálculo; compras no cartão ficam fora.
- A composição por categoria é persistida e reaparece preenchida no Planejamento.
- Com 30 dias de histórico, a query de comparação planejado/realizado existe; o Planejamento não a mostra na UI, e nunca substitui o plano automaticamente.
- No primeiro uso a confirmação grava saldo, fixos, composição cotidiana e estimativa juntos. No Planejamento, autosave grava fixos sempre e composição+estimativa só com total cotidiano > 0 (sem âncora).
- [Definir a experiência do wizard de planejamento](https://github.com/aka-luan/finance-pwa/issues/15) — Variante A em quatro passos: saldo → fixos (entradas vs saídas) → cotidiano por alto (média do mês = prévia do diário) → resumo. Protótipo em `src/ui/prototype-wizard*` (`/?prototype=wizard&variant=A`).
- [Fechar as regras de cálculo e comparação do planejamento](https://github.com/aka-luan/finance-pwa/issues/16) — estimativa = `round_half_up(Σ/30)`; janela realizada = 30 dias corridos até hoje; `NULL` → “Sem categoria”; deltas informativos. Ver `docs/wayfinder/resolution-16.md`.
- [Definir o modelo persistente do orçamento mensal](https://github.com/aka-luan/finance-pwa/issues/17) — composição versionada (`monthly_budget` + lines → `category`); `daily_estimate` permanece a entrada da projeção; mesmo `effective_from` no confirm do wizard. ADR 0002 / `docs/wayfinder/resolution-17.md`.
- [Definir a detecção, retomada e conclusão do primeiro uso](https://github.com/aka-luan/finance-pwa/issues/18) — `needsFirstRun` ⇔ falta âncora ou estimativa; confirm atômico; sem rascunho no Postgres; restore reusa o gate. ADR 0003 / `docs/wayfinder/resolution-18.md`.
- [Definir migração e compatibilidade dos backups](https://github.com/aka-luan/finance-pwa/issues/19) — boot aditivo (`CREATE TABLE IF NOT EXISTS`); backup v2; v1 restaura com `monthly_budget*` = `[]`; sem backfill da estimativa. ADR 0004 / `docs/wayfinder/resolution-19.md`.
- [Definir como o wizard grava entradas e saídas fixas](https://github.com/aka-luan/finance-pwa/issues/20) — fixo ⇔ `recurrence` `target=account`; dia no Fixos; reconciliar por uuid no confirm atômico. ADR 0005 / `docs/wayfinder/resolution-20.md`.

## Children

- [x] [#15 Definir a experiência do wizard de planejamento](https://github.com/aka-luan/finance-pwa/issues/15) — resolvido
- [x] [#16 Fechar as regras de cálculo e comparação do planejamento](https://github.com/aka-luan/finance-pwa/issues/16) — resolvido
- [x] [#17 Definir o modelo persistente do orçamento mensal](https://github.com/aka-luan/finance-pwa/issues/17) — resolvido
- [x] [#18 Definir a detecção, retomada e conclusão do primeiro uso](https://github.com/aka-luan/finance-pwa/issues/18) — resolvido
- [x] [#19 Definir migração e compatibilidade dos backups](https://github.com/aka-luan/finance-pwa/issues/19) — resolvido
- [x] [#20 Definir como o wizard grava entradas e saídas fixas](https://github.com/aka-luan/finance-pwa/issues/20) — resolvido

## Dependências

```text
#15 experiência (fechado) ─────────────────────────────────┐
#16 regras de cálculo (fechado) ───────────────────────────┼─→ especificação pronta
#17 modelo persistente (fechado) ──────────────────────────┤
  ├─→ #18 detecção / primeiro uso (fechado) ───────────────┤
  └─→ #19 migração / backups (fechado) ────────────────────┤
#20 fixos → recorrências (fechado) ────────────────────────┘
```

## Not yet specified

- Mensagens de erro e estados vazios finos (o tom e a sequência já estão no #15; critérios de aceitação dos fixos em `resolution-20.md`).

## Out of scope

- Calcular um valor diário “seguro” a partir de renda, despesas fixas, faturas futuras ou reserva mínima. (Renda e contas entram como recorrência; não alimentam a média do diário.)
- Incluir compras no cartão de crédito no orçamento mensal de gastos cotidianos.
- Substituir automaticamente o planejamento pelos gastos reais.
