# Termômetro Financeiro

Contexto pessoal de acompanhamento do dinheiro disponível e dos gastos cotidianos.

## Linguagem

**Saldo em conta**:
Dinheiro disponível na conta bancária em uma data, sem incluir limite ou compras no cartão de crédito.
_Evitar_: Saldo total, patrimônio

**Gasto diário**:
Gasto cotidiano pago diretamente com o saldo em conta, como débito ou Pix; compras no cartão de crédito não entram.
_Evitar_: Despesa diária, compra diária

**Orçamento mensal de gastos cotidianos**:
Soma dos valores que a pessoa pretende gastar no mês em categorias cotidianas pagas diretamente pelo saldo em conta. Persistido como composição versionada por vigência (`monthly_budget` + linhas por `category`); ver ADR 0002.
_Evitar_: Média mensal, despesas fixas

**Estimativa diária**:
Valor diário de referência obtido ao dividir por 30 o orçamento mensal de gastos cotidianos. Persistida em `daily_estimate` (vigência por `effective_from`); é a entrada da projeção — distinta da composição por categoria.
_Evitar_: Média de gasto diário, limite diário

**Entrada/saída fixa**:
Valor que se repete todo mês na conta (salário, aluguel, contas). No primeiro uso sai do wizard; depois, do **Planejamento**. Persistido como `recurrence` com `target = 'account'`. Não compõe o orçamento mensal de gastos cotidianos nem a estimativa diária; ver ADR 0005.
_Evitar_: Despesa fixa no diário, recorrência de cartão, custo fixo

**Termômetro**:
Tela inicial. Fatia acionável da previsão: quanto posso gastar hoje, mais um resumo curto (saldo, marcos, menor saldo) e o "e se eu gastar". No código: `renderHoje`.
_Evitar_: Tela Hoje como nome de produto, dashboard

**Previsão**:
Ledger da mesma timeline — horizonte mensal e dia a dia, com as causas nomeadas. Sem simulação.
_Evitar_: Linha do tempo, extrato

**Planejamento**:
Editor das premissas que alimentam a previsão (entradas/contas fixas e orçamento mensal de gastos cotidianos). Autosave; não grava âncora de saldo. Recalibrar **é** esta tela, não um segundo wizard.
_Evitar_: Recorrências (como destino), Recalibrar planejamento (como fluxo separado em Configurações)
