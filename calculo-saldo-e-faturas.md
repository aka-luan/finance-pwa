# Cálculo de saldo e faturas

Spec do núcleo. Tudo aqui é derivado — nada de linha do tempo materializada.

Datas são `date` puro (sem hora), fuso fixo `America/Belem`.
Valores em centavos, inteiros. Nunca float.

---

## 1. Ciclo do cartão

Cada cartão tem `closing_day` e `due_day`.

### Em qual fatura cai uma compra

```
faturaDe(compra, cartao):
  if dia(compra.date) <= cartao.closing_day:
      ciclo = mês(compra.date)
  else:
      ciclo = mês(compra.date) + 1
  return ciclo
```

### Quando essa fatura vence

```
vencimentoDe(ciclo, cartao):
  if cartao.due_day > cartao.closing_day:
      # fecha e vence no mesmo mês
      return data(ciclo, cartao.due_day)
  else:
      # vence no mês seguinte ao fechamento
      return data(ciclo + 1, cartao.due_day)
```

**Clamp de dia inválido.** `due_day = 31` em fevereiro, `day_of_month = 30`
em fevereiro: sempre usar `min(dia, últimoDiaDoMês)`. Vale para
vencimento, fechamento e recorrência.

### Parcelas

Compra de `amount` em `n` parcelas, caindo na fatura do ciclo `c`:

```
base = amount // n
resto = amount - (base * n)

parcela[1] = base + resto     -> ciclo c
parcela[k] = base             -> ciclo c + (k-1),  k = 2..n
```

O resto vai na primeira parcela: o valor é conhecido no momento da
compra e a soma fecha exata.

À vista é o caso `n = 1`.

---

## 2. Valor de uma fatura

```
fatura(cartao, ciclo) =
    Σ parcelas de purchases que caem em (cartao, ciclo)
  + Σ recorrências vinculadas a esse cartão, ativas no ciclo
```

O segundo termo é o cartão de assinaturas: as recorrências apontam
para o cartão em vez de para a conta.

Uma fatura vira uma **saída da conta** na data `vencimentoDe(ciclo)`.
Nenhuma compra toca o saldo diretamente. É essa regra, e só ela, que
garante a ausência de dupla contagem.

### Fatura paga vs. projetada

Quando a fatura vence e você confere o valor real, grava uma
`transaction` de saída com `card_id` + `cycle`. Ela **substitui** a
fatura calculada naquele dia — mesmo mecanismo das exceções de
recorrência (§4). Diferenças de IOF, anuidade e estorno entram aí sem
precisar corrigir compra por compra.

---

## 3. Saldo de um dia

```
saldo(D):
  a = anchor mais recente com a.date <= D
  s = a.amount

  para cada dia d em (a.date, D]:
      s += movimentoReal(d)
      se d > hoje:
          s += movimentoProjetado(d)

  return s
```

`movimentoReal(d)` = soma das `transactions` do dia
(entradas positivas, saídas e diários negativos).

`movimentoProjetado(d)`, apenas para `d > hoje`:

```
+ recorrências de conta que caem em d, sem exceção gravada
- faturas com vencimento em d, sem pagamento real gravado
- daily_estimate vigente em d
```

### As três regras que evitam contagem dupla

1. **`d <= hoje` nunca projeta.** Hoje parcialmente lançado conta só o
   que foi lançado. Dias passados são fato consumado — se você esqueceu
   de lançar, o saldo está errado e é assim que você percebe.
2. **Real vence projeção.** Existindo `transaction` com
   `recurrence_id + occurrence_date` (ou `card_id + cycle`), a
   projeção correspondente é suprimida naquele dia.
3. **`daily_estimate` é vigente por data**, via `effective_from`.
   Projetar o dia `d` usa a estimativa em vigor em `d`, não a atual.

### Performance

O laço dia a dia é O(dias). Para 12 meses de projeção é irrelevante,
mas ancore agressivamente: grave um `anchor` no primeiro dia de cada
mês fechado. Assim o cálculo nunca varre mais que ~13 meses.

---

## 4. Recorrências e exceções

Uma `recurrence` nunca gera registro. Ela é regra pura:
`kind`, `amount`, `day_of_month`, `start_date`, `end_date?`.

Quando o valor real difere (conta de luz, por exemplo), você grava uma
`transaction` normal carregando `recurrence_id` e `occurrence_date`.
A partir daí a projeção daquele dia some e o real assume.

Editar o `amount` de uma recorrência **não** reescreve o passado: as
exceções gravadas continuam intactas e os dias passados sem exceção já
não eram projetados. Alterar recorrência só muda o futuro, sempre.

---

## 5. Aviso de desvio da estimativa

Roda na abertura do app, sobre o último mês inteiramente fechado:

```
realDiario = Σ transactions kind=diário do mês / dias do mês
vigente    = daily_estimate em vigor naquele mês

se |realDiario - vigente| / vigente > 0.15
   e o mês não foi dispensado:
       mostrar card
```

Um toque em "Atualizar" grava novo `daily_estimate` com
`effective_from = hoje` — não retroage.
"Manter" grava a dispensa daquele mês.

Nas configurações, um botão limpa as dispensas e reexibe a comparação.

---

## 6. O cartão não é projetado

**Decisão: não existe estimativa de compras futuras no cartão.**

A fatura de qualquer mês é exatamente a soma do que foi lançado — nada
mais. Nenhum `card_estimate`, nenhuma média, nenhum chute.

Consequência, e é intencional: a linha de fatura de um mês futuro só
cresce à medida que você compra. O que a projeção mostra não é "quanto
você vai gastar", é **quanto você já se comprometeu a pagar**. Uma
compra em 10x aparece inteira no gráfico no instante em que acontece —
que é justamente a informação que a planilha nunca te deu de graça.

Diferente do `daily_estimate`, que projeta porque o gasto cotidiano é
previsível por natureza, a compra no cartão é um evento discreto. Não
há o que estimar até ela existir.

Na tela, a fatura é uma única célula por mês, no dia do vencimento.


---

## 7. Dias pendentes

Um dia sem lançamento é ambíguo: pode ser "não gastei nada" ou
"esqueci de lançar". `day_settled` desfaz o empate — dia sem
transação **e** sem marca de conferido é **pendente**.

`pending_days(hoje)` lista os pendentes a partir do último `anchor`
(ou do primeiro dado, se não houver anchor) até ontem. Hoje nunca é
pendente: ainda está acontecendo.

Dois caminhos para zerar a lista, e os dois são legítimos:

- **Preencher em sequência** — a tela de lançamento abre no pendente
  mais antigo e avança sozinha para o próximo ao salvar. "Não gastei
  nada" grava só a marca em `day_settled`.
- **Acertar saldo** — grava um `account_anchor` com o saldo real de
  hoje. Todo pendente anterior sai da lista por construção: o cálculo
  não olha para trás do anchor. É o reequilíbrio manual da planilha,
  virado feature.

O saldo nunca fica errado em silêncio. Ou os dias estão lançados, ou
existe um anchor recente afirmando o valor.

---

## 8. Simulação

`timeline_sim(from, to, hoje, what_if)` recebe lançamentos
hipotéticos como `jsonb`:

```json
[{"date": "2026-08-08", "kind": "saida", "amount_cents": 120000}]
```

Nada é gravado. A simulação entra na soma acumulada como uma coluna
própria (`sim_cents`), então dá para mostrar o antes e o depois lado a
lado.

Em cima disso, duas funções servem o Termômetro direto:

- `milestones(hoje, what_if)` — saldo no fim do mês, +3, +6 e +12 meses
- `worst_point(hoje, what_if)` — menor saldo da janela de 12 meses e
  em que dia acontece

Ambas custam uma query de ~11ms com anos de dados, o que permite
recalcular a cada tecla digitada no campo "e se eu gastar ___".
