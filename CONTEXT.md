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
