# Termômetro — especificação

App pessoal de controle financeiro, uso individual, substituindo uma
planilha em uso há dois anos.

Artefatos irmãos, já validados e não repetidos aqui:
`schema.sql` (schema completo), `calculo-saldo-e-faturas.md` (regras de
cálculo em detalhe), `pglite-smoke-test.mjs` e `pglite-sim-test.mjs`
(testes executáveis).

---

## 1. Problema

A planilha atual tem uma aba por ano e, dentro dela, um bloco de colunas
por mês: Data, Entrada, Saída, Diário, Saldo. O saldo é acumulado e
atravessa meses e anos. Meses futuros já vêm preenchidos com lançamentos
recorrentes em dias fixos mais um valor diário estimado — é assim que a
previsibilidade é obtida hoje.

O que a planilha custa e o app deve eliminar:

- espalhar parcelas de cartão à mão pelas colunas dos meses seguintes
- somar compras na linha da fatura a cada nova compra
- procurar a célula certa para lançar o gasto do dia
- replicar recorrências ao abrir um ano novo

O que a planilha faz bem e o app **não pode perder**: ver o todo e
simular. O uso real não é acompanhar os próximos dias — é perguntar "se
eu gastar 1.200 hoje, como fica daqui a 3 meses?".

## 2. Escopo

App pessoal, um usuário. Não é produto, não terá múltiplos usuários,
não terá conta compartilhada.

**Dentro:** entradas, saídas, gasto diário, compras no cartão com
parcelamento, recorrências, saldo acumulado, projeção de 12 meses,
simulação, recuperação de dias não lançados.

**Fora:** múltiplas contas bancárias, conciliação bancária, importação
de OFX/extrato, metas de economia, relatórios por categoria,
compartilhamento, multiusuário.

---

## 3. Domínio

Cinco conceitos. Os nomes são os da planilha e devem aparecer na UI
como estão — são o vocabulário do usuário.

| Conceito | Significado |
|---|---|
| **Entrada** | Dinheiro entrando na conta |
| **Saída** | Despesa estrutural: financiamento, fatura de cartão, transferências |
| **Diário** | Gasto cotidiano que sai da conta — comida, farmácia, padaria, passeio |
| **Compra no cartão** | Compra no crédito, à vista ou parcelada |
| **Recorrência** | Entrada ou saída que se repete num dia do mês |

**Saldo é dinheiro em conta.** Não inclui limite de cartão.

**Diário é somente o que sai da conta** (débito/Pix). Compra no crédito
nunca é Diário. Essa separação é o que impede a dupla contagem.

### A regra que não pode ser quebrada

Uma compra no cartão **nunca** toca o saldo. Ela alimenta a fatura do
ciclo correspondente; a fatura é que vira uma saída da conta na data de
vencimento. Qualquer implementação que abata a compra do saldo no ato
está errada.

### O que se projeta e o que não

**Projeta-se** o gasto diário, via `daily_estimate` — é previsível por
natureza.

**Não se projeta** compra futura no cartão. Não existe estimativa de
compras que ainda não aconteceram. A fatura de um mês futuro é
exatamente a soma do que já foi lançado.

Consequência intencional: a curva de 12 meses responde *"quanto já me
comprometi a pagar"*, não *"quanto vou gastar"*. Uma compra em 10x
aparece inteira no gráfico no instante em que acontece.

---

## 4. Regras de cálculo

Detalhe completo em `calculo-saldo-e-faturas.md`. O essencial:

**Ciclo de fatura.** Compra até o `closing_day` entra no ciclo do
próprio mês; depois dele, no seguinte. O vencimento cai no mesmo mês do
ciclo se `due_day > closing_day`, senão no mês seguinte. Dia inválido
(31 em fevereiro) é limitado ao último dia do mês.

**Parcelas.** Valor dividido por N; o resto vai na primeira parcela, de
modo que a soma feche exata. Parcela *k* cai no ciclo base + (k−1)
meses.

**Saldo.** Parte do `account_anchor` mais recente e soma dia a dia.
Três invariantes:

1. Dias até hoje **nunca** projetam. Se um dia passado não foi lançado,
   o saldo fica visivelmente errado — é assim que o usuário percebe.
2. Real vence projeção. Existindo transação com `recurrence_id +
   occurrence_date` (ou `card_id + cycle_month`), a projeção
   correspondente é suprimida naquele dia.
3. `daily_estimate` é versionado por `effective_from`. Projetar o dia
   *d* usa a estimativa vigente em *d*, não a atual.

**Simulação.** `timeline_sim` recebe lançamentos hipotéticos em `jsonb`
e devolve `sim_cents` numa coluna própria, sem gravar nada.
`milestones()` e `worst_point()` são construídas sobre ela.

**Performance medida** em PGlite, com 3 anos de lançamentos diários e
500 compras parceladas: `timeline` de 12 meses em 11ms, `milestones`
com simulação em ~20ms.

---

## 5. Arquitetura

**PGlite no cliente** (Postgres via WASM, persistido em IndexedDB) como
banco principal. Todo o cálculo vive em SQL e roda local — leitura sem
rede, sem estado derivado em JavaScript.

**ElectricSQL** sincronizando com um Postgres no servidor. Como há um
único usuário, não existe conflito de escrita.

**PWA**, sem app nativo. iPhone.

Dinheiro é `bigint` em **centavos**. Nunca float, nunca `Decimal`.

### Duas armadilhas confirmadas em teste

`bigint` volta como **string** em JavaScript. Converter na borda, com
`BigInt` ou parser de tipos configurado — nunca `parseInt` espalhado.

`date` volta como `Date` em UTC meia-noite; formatar em fuso local
(America/Belem) joga a data um dia para trás. Configurar o parser do
PGlite para devolver `date` como string `YYYY-MM-DD` e tratar como
texto até a formatação final.

### Sequenciamento

O Electric pode entrar depois do v1 — o schema é o mesmo dos dois
lados, então adiar não gera retrabalho. Se adiar, um endpoint de
backup (dump periódico para o servidor) é **obrigatório** desde o
início: o navegador pode limpar o IndexedDB sob pressão de espaço e
levar anos de histórico junto.

---

## 6. Tela 1 — Hoje

Responde duas perguntas e oferece uma ferramenta.

**Topo:** quanto posso gastar hoje, em destaque. Abaixo, menor, o saldo
em conta. A hierarquia é deliberada: o saldo o usuário consulta no
banco; o outro número, não.

**Marcos:** fim deste mês, 3 meses, 6 meses, 12 meses, cada um com o
saldo projetado. É o "olhar o todo" da planilha condensado.

**Pior momento:** menor saldo da janela de 12 meses e em que dia
ocorre. Responde "eu furo em algum ponto?", que hoje exige varrer
colunas.

**Campo "e se eu gastar ___":** o coração da tela. Digitar um valor
atualiza marcos e pior momento ao vivo, mostrando o delta. Nada é
gravado; sair da tela descarta. Debounce de ~150ms, pela latência
medida.

**Aviso de dias pendentes:** discreto, tocável, leva ao modo de
recuperação. Sem contador de ofensiva, sem vermelho de cobrança — se o
app fizer o usuário se sentir devedor, ele para de abrir.

**Acesso secundário:** a linha do tempo completa dos 12 meses, dia a
dia, fora da tela principal.

## 7. Tela 2 — Lançar

Abre com o campo de valor focado e o numpad já visível.

**Data no topo, grande e explícita** — "quarta, 5 de agosto", não
"Hoje". Em modo de recuperação, mostra a posição: "2 de 4". Esse é o
maior risco de erro da tela: lançar vários dias seguidos e confundir
qual era.

**Valor por lista, não por expressão.** Cada valor digitado entra numa
lista visível, com total abaixo e um × por item. Conferindo contra a
fatura, o usuário vê o que já lançou e corrige um item sem reescrever
o resto.

**Numpad próprio, em HTML.** Três colunas (`1–9`, `00`, `0`, apagar),
entrada em centavos, sem vírgula. Abaixo dele, o botão de largura
total *+ Adicionar R$ …* põe o valor digitado na lista — o total acima
é só o que já entrou. *Salvar* ainda grava um valor digitado que não
foi adicionado, para o caminho rápido de um lançamento só. O teclado
próprio evita o do sistema empurrar o layout no iOS e serve as duas
telas. Input `readonly` para suprimir o teclado nativo.

**Tipo:** `Diário` pré-selecionado — é a maioria dos lançamentos.
`Saída`, `Entrada`, `Cartão` a um toque. Uma linha sob as pills diz o
que cada tipo é (gasto cotidiano, despesa estrutural, dinheiro na
conta, compra no crédito).

**Categoria:** opcional, por item, atrás de um link discreto.

**Rodapé:** *Salvar* em largura total. *Não gastei nada* fica abaixo,
terciário, e só aparece com a lista vazia — não compete com gravar.
Ambos avançam direto para o próximo dia pendente sem voltar à tela
inicial; quando acabam, retorna a Hoje com o saldo atualizado.

**Modo cartão:** ao escolher `Cartão`, a data dá lugar a cartão +
parcelas, e a tela informa o efeito — "3x de R$ 333,34 — primeira vence
05/10". É a conta que hoje o usuário faz de cabeça antes de decidir
parcelar.

**Desfazer** disponível por alguns segundos após salvar. Lançamento
rápido só é seguro se errar for barato.

### Lançar é o teste do produto

Registrar um gasto precisa ser mais rápido que abrir a planilha. Acima
de ~5 segundos do toque no ícone ao valor salvo, o desenho falhou.

---

## 8. Dias pendentes

Dia sem lançamento é ambíguo: pode ser "não gastei nada" ou "esqueci".
`day_settled` desfaz o empate — sem transação **e** sem marca, o dia é
pendente. Hoje nunca é pendente.

O usuário retoma do dia mais antigo pendente, não da data atual.

Dois caminhos para zerar, ambos legítimos:

- **Preencher em sequência** — a tela avança sozinha entre pendentes.
- **Acertar saldo** — grava um `account_anchor` com o valor real de
  hoje; todo pendente anterior sai da lista, porque o cálculo não olha
  atrás do anchor. É o reequilíbrio manual da planilha, virado feature,
  e fica **visível**, não escondido em configurações.

O saldo nunca fica errado em silêncio: ou os dias estão lançados, ou
existe um anchor recente afirmando o valor.

## 9. Estimativa diária

`daily_estimate` nasce da média de 30 dias de gasto cotidiano. Só
recalcula quando o usuário mandar.

Para que não envelheça em silêncio, na abertura do app compara-se o
último mês fechado com a estimativa vigente naquele mês. Desvio acima
de ~15% mostra um card: "Em julho você gastou 78/dia, sua estimativa é
62,90. Atualizar?". Um toque grava nova estimativa com `effective_from`
= hoje, sem retroagir. "Manter" registra a dispensa do mês.

Configurações têm um botão para limpar dispensas e rever a comparação.

---

## 10. Primeira fatia vertical

Ordem sugerida — cada item entrega algo utilizável:

1. PGlite no PWA, schema aplicado no boot, persistência em IndexedDB
2. Numpad + tela de lançamento de Diário
3. Tela Hoje: saldo e quanto posso gastar
4. Backup/exportação (sem ela, limpar o navegador apaga tudo)
5. Dias pendentes e modo de recuperação
6. Recorrências e "Acertar saldo"
7. Marcos e simulação
8. Cartões, compras e parcelamento
9. Aviso de desvio da estimativa
10. Linha do tempo completa de 12 meses

O item 8 é o de maior valor sobre a planilha, mas depende de haver
hábito de uso estabelecido — vem depois do laço básico funcionar.

## 11. Em aberto

- Backup: formato do dump e gatilho (periódico, manual, ao fechar).
- Se um cenário simulado pode ser salvo em vez de descartado.
- Categorias: lista fixa ou livre, e se herdam do último uso.
