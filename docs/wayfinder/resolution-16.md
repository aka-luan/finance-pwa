# Resolução #16 — Regras de cálculo para o planejamento (30 dias)

> Canal do mapa: #14 (wizard de planejamento financeiro) → filho #16.

## 1) Arredondamento da divisão mensal por 30

- Todos os valores monetários são inteiros em **centavos** (`bigint`).
- A **estimativa diária** do planejamento deriva do **total mensal planejado** dividido por **30 dias corridos**.
- Regra de arredondamento: **round half up** (empate para cima) — em BigInt:
  - considere `n = total_mensal_cents` e `d = 30`;
  - incrementa o quociente quando o `resto` for **maior ou igual** a `d/2`;
  - em valores negativos, o empate também vai **para longe de zero** (ties away from 0).

Formalmente (intenção):

```
daily_estimate = round_half_up(total_mensal_cents / 30)
```

## 2) Vigência da nova estimativa

Quando o usuário confirma/recalibra o planejamento:

- o novo `daily_estimate` passa a valer **a partir de “hoje”** (no fuso `America/Belem`).
- o cálculo e a prévia (“estimativa diária” mostrada na UI do wizard) usam a mesma regra acima, consistente com o que será gravado.

## 3) Janela dos 30 dias realizados (recalibração)

Para a comparação “o que mudou nos últimos 30 dias”:

- “realizados” = somatório dos lançamentos de **diário** (`kind = diario`) em uma **janela fixa de 30 dias**:
  - do dia **(hoje - 29)** até o dia **hoje**, **inclusive**.
- Essa janela não usa “quantos dias tem o mês”; é sempre exatamente 30 dias corridos para manter a comparabilidade com a regra do item (1).

## 4) Tratamento de lançamentos sem categoria

- `transaction.category_id` pode ser `NULL`.
- Para apresentação na recalibração, agrupar `NULL` como a categoria de UI:
  - **“Sem categoria”**
- “Sem categoria”:
  - participa das somas de realizado na janela de 30 dias;
  - a UI deve exibir o **delta** (realizado − planejado) para transparência;
  - não precisa (nesta etapa do wayfinding) ser editável, desde que o valor realizado apareça de forma explicável.

## 5) Apresentação de diferenças entre planejado e realizado

Para cada categoria (inclusive “Sem categoria”):

- `planejado` = total mensal planejado (coerente com o wizard; equivale a “30d planejados”)
- `realizado` = total de diário realizado nos últimos 30 dias (janela do item 3)
- `delta = realizado - planejado`

Como apresentar:

- se `delta == 0`: mostrar “no alvo”
- se `delta > 0`: mostrar “{valor} acima” (onde `{valor}` é `abs(delta)`)
- se `delta < 0`: mostrar “{valor} abaixo” (onde `{valor}` é `abs(delta)`)

> Observação: como tudo é em centavos inteiros, a diferença já é “exata” — não há arredondamento adicional entre `realizado` e `planejado`.

