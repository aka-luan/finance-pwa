# Resolução #17 — Modelo persistente do orçamento mensal

> Canal do mapa: #14 → filho #17.

## Decisão

Dois artefatos distintos, sem fundir conceitos:

1. **`daily_estimate`** continua sendo a **única** entrada da projeção de gasto diário (timeline, Hoje, desvio). Versionada por `effective_from`, como hoje.
2. **Composição do orçamento mensal** (novo) guarda os valores mensais **por categoria** que o wizard planeja. Também versionada por `effective_from`, no mesmo padrão.

`category` permanece o vocabulário compartilhado (`id` + nome). Linhas do orçamento e lançamentos apontam para o mesmo `category_id` — não há segunda lista de categorias.

## Tabelas propostas

```text
monthly_budget
  id               uuid PK
  effective_from   date NOT NULL UNIQUE

monthly_budget_line
  budget_id        uuid FK → monthly_budget(id) ON DELETE CASCADE
  category_id      uuid FK → category(id)
  amount_cents     bigint NOT NULL CHECK (>= 0)
  PRIMARY KEY (budget_id, category_id)
```

- O **orçamento mensal de gastos cotidianos** de uma vigência = `Σ monthly_budget_line.amount_cents` daquele `monthly_budget`.
- A **estimativa diária** gravada no wizard = `round_half_up(Σ / 30)` (#16), num `daily_estimate` com o **mesmo** `effective_from`.
- Linhas com valor **zero** são persistidas: a recalibração reabre as categorias editáveis, não só as que tinham valor.
- **"Sem categoria"** não vira linha de `category` nem de orçamento: continua sendo o agrupamento de UI para `transaction.category_id IS NULL` (#16).

## Como se relacionam no tempo

| Evento | `monthly_budget` (+ lines) | `daily_estimate` |
|---|---|---|
| Confirmar wizard (1º uso) | Nova vigência `effective_from = hoje` | Nova vigência `effective_from = hoje`, derivada da soma |
| Planejamento autosave (total cotidiano > 0) | Nova vigência `effective_from = hoje` | Nova vigência `effective_from = hoje`, derivada da soma |
| Planejamento autosave (total cotidiano = 0) | Inalterado | Inalterado (fixos ainda reconciliam) |
| Card de desvio → "Atualizar" | Inalterado | Nova vigência só da estimativa |
| Card de desvio → "Manter" | Inalterado | Inalterado |

Assim:

- o **total diário histórico** continua reproduzível só por `daily_estimate` (timeline não muda de regra);
- a **composição vigente** no Planejamento = `monthly_budget` com maior `effective_from <= hoje`;
- dá para explicar "de onde veio este plano" sem inventar um segundo diário.

Não há FK obrigatória entre as duas tabelas: o card de desvio pode avançar a estimativa sem reescrever o plano por categoria.

## Recalibração — o que carregar

O **Planejamento** carrega (1) e as recorrências de conta ativas. Não
mostra (2) nem (3). A query de (3) existe (`spentByCategoryLast30Days`);
só o modo `recalibrar` do wizard — sem entrada na navegação — a usa.

1. Composição vigente (linhas + nomes via `category`).
2. Estimativa vigente (já existente).
3. Realizado dos últimos 30 dias por `category_id` (#16), unindo categorias do plano com categorias que tenham gasto na janela (planejado 0 se só existirem no realizado).

## O que isto não é

- Não substitui `daily_estimate` por um cálculo on-the-fly a partir do orçamento (evita reescrever timeline e o aviso de desvio).
- Não materializa "orçamento realizado" — comparação é query sobre `transaction` kind `diario`.
- Não modela entradas/saídas fixas (isso é recorrência; #20).
- Não define migração de backup / schema em instalações existentes (#19).

## Próximo nevoeiro afiado

Com a composição versionada, #18 pode tratar "planejamento concluído" como existência de composição + estimativa (e saldo) gravados atomicamente; #19 acrescenta as tabelas a `BACKUP_TABLES` com bump de versão.
