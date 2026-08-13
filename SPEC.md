# Termômetro — especificação

App pessoal de controle financeiro, uso individual, substituindo uma
planilha em uso há dois anos. O produto é uma **previsão de caixa**:
Planejamento grava as premissas, Previsão mostra o que acontece com o
dinheiro, Termômetro resume o que dá para gastar hoje.

Artefatos irmãos, já validados e não repetidos aqui:
`schema.sql` (schema completo), `calculo-saldo-e-faturas.md` (regras de
cálculo em detalhe), `docs/adr/` (decisões), os testes `pglite-*.mjs` e
`previsao-horizon-test.mjs`.

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
parcelamento, entradas/saídas fixas, orçamento mensal de gastos
cotidianos, saldo acumulado, projeção de 12 meses, simulação,
recuperação de dias não lançados.

**Fora:** múltiplas contas bancárias, conciliação bancária, importação
de OFX/extrato, metas de economia, relatórios por categoria nos
lançamentos, compartilhamento, multiusuário.

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

**PWA**, sem app nativo. iPhone. ElectricSQL (sync com Postgres no
servidor) **não está no app**; o schema foi pensado para caber depois,
sem retrabalho. Enquanto isso, o backup JSON em Configurações é o
caminho de recuperação (ADR 0001).

Dinheiro é `bigint` em **centavos**. Nunca float, nunca `Decimal`.

### Duas armadilhas confirmadas em teste

`bigint` volta como **string** em JavaScript. Converter na borda, com
`BigInt` ou parser de tipos configurado — nunca `parseInt` espalhado.

`date` volta como `Date` em UTC meia-noite; formatar em fuso local
(America/Belem) joga a data um dia para trás. Configurar o parser do
PGlite para devolver `date` como string `YYYY-MM-DD` e tratar como
texto até a formatação final.

---

## 6. Superfícies

Três telas informacionais da mesma previsão, mais uma ação (ADR 0006).
Código: `src/ui/destinations.ts`. Navegação: Termômetro é a casa
(`reset`); Previsão e Planejamento saem dele com `push` e trocam entre
si com `replace`, para não empilhar. Lançar não entra nesse navigator.

| Superfície | Pergunta | Código |
|---|---|---|
| **Termômetro** | Quanto posso gastar hoje? | `renderHoje` |
| **Previsão** | O que vai acontecer com meu dinheiro? | `renderPrevisao` |
| **Planejamento** | De onde vem essa previsão? | `renderPlanejamento` |
| **Lançar** | O que aconteceu hoje? | `renderLancar` (FAB, não destino) |

Configurações (cartões, atalho ao Planejamento, rever estimativa,
backup) fica atrás de um link discreto no Termômetro — não é uma
quarta leitura do mesmo dinheiro. Recorrências de conta **não** são
destino: o módulo `src/ui/recorrencias.ts` existe, mas a navegação
atual não o abre.

### Termômetro (casa)

Fatia acionável da mesma timeline que a Previsão mostra por completo.
`balance_on` / `milestones` / `worst_point` — o mesmo motor.

**Topo:** wordmark "Termômetro" e a data. **Hero:** quanto posso gastar
hoje (`daily_estimate` vigente − diários já lançados hoje). Pode ficar
negativo. Sem estimativa, o hero diz isso em texto — nunca finge
`R$ 0,00`.

Abaixo, o **resumo da previsão** e o simulador, nesta ordem: o valor
digitado é a pergunta, as linhas são a resposta.

- **saldo atual**, depois marcos (fim deste mês, 3, 6, 12 meses) e
  **menor saldo** com o dia. Label à esquerda, valor à direita.
- **"e se eu gastar":** teclado nativo, centavos, debounce 150ms.
  Atualiza as métricas ao vivo com delta em âmbar. Nada é gravado;
  sair da tela descarta. Atalhos de R$ 200, 500 e 1.200, mais limpar.

**Aviso de dias pendentes:** discreto, tocável, leva ao modo de
recuperação. Sem contador de ofensiva, sem vermelho de cobrança.
"Acertar saldo" fica ao lado do aviso, visível — não escondido em
Configurações.

**Aviso de desvio da estimativa** (§9) entra nesta tela, na abertura.

### Previsão

Ledger da `timeline` de 12 meses (`getTimeline` +
`getTimelineMovements`). Sem simulação.

**Horizonte** no topo: saldo no fim de cada mês civil, com recorte de
3, 6 ou 12 meses (`HORIZON_RANGES`). Um fetch de `timeline()` alimenta
as duas camadas. Resumo: saldo atual e menor saldo da janela visível.

Abaixo, **dia a dia**: saldo de cada dia; dias com movimento que não é
só o diário projetado expandem e nomeiam a causa (lançado vs
projeção). Hoje e o dia do menor saldo levam marca.

### Planejamento

Editor operacional das premissas que a previsão lê. Autosave com
debounce 150ms via `savePlanningAssumptions` — **não** grava
`account_anchor` (isso é o wizard de primeiro uso e o Acertar saldo).

Três blocos: **entradas fixas**, **contas fixas**, **gastos mensais**
(orçamento por categoria). Fixos sempre reconciliam `recurrence` de
conta (ADR 0005). Composição + `daily_estimate` só gravam quando o
total cotidiano é > 0; total zero deixa a estimativa vigente em paz,
assim dá para editar fixos sem apagar o hero do Termômetro.

A estimativa diária mostrada no rodapé é `round_half_up(Σ / 30)`. Não
há "restam N dias" — o divisor é sempre 30.

### Primeiro uso

Com `needsFirstRun` (falta `account_anchor` **ou** `daily_estimate`),
o boot **não** entra no Termômetro: abre o wizard em quatro passos
(Saldo → Fixos → Cotidiano → Resumo). Confirm atômico:
`confirmPlanning` (ADR 0003 + 0005). Restore de backup no passo Saldo
reaplica o mesmo gate. Não há rascunho no Postgres nem em
`sessionStorage`.

O modo `recalibrar` do wizard ainda existe no código; a navegação do
produto não o abre. Recalibrar **é** o Planejamento.

---

## 7. Lançar

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
próprio evita o do sistema empurrar o layout no iOS (Lançar, Acertar
saldo). Input `readonly` para suprimir o teclado nativo.

**Tipo:** `Diário` pré-selecionado — é a maioria dos lançamentos.
`Saída`, `Entrada`, `Cartão` a um toque. Uma linha sob as pills diz o
que cada tipo é (gasto cotidiano, despesa estrutural, dinheiro na
conta, compra no crédito).

**Categoria:** o schema aceita `category_id` em `transaction`; Lançar
**não** pede nem grava. Categoria é vocabulário do orçamento mensal
(Planejamento / wizard), não do lançamento.

**Rodapé:** *Salvar* em largura total. *Não gastei nada* fica abaixo,
terciário, e só aparece com a lista **e** o buffer vazios — não
compete com gravar nem descarta o que já se digitou. Ambos avançam
direto para o próximo dia pendente sem voltar ao Termômetro; quando
acabam, voltam para lá com o saldo atualizado.

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

`daily_estimate` é a **única** entrada da projeção de gasto cotidiano.
Nasce do orçamento mensal: `round_half_up(Σ linhas / 30)` (ADR 0002,
#16). Quem grava:

- wizard de primeiro uso (`confirmPlanning`, mesmo `effective_from`
  da composição);
- Planejamento (`savePlanningAssumptions`, só se o total cotidiano
  for > 0);
- card de desvio → "Atualizar" (só a estimativa; a composição fica).

Não é média dos diários lançados. A comparação com o realizado é
informativa, no card abaixo.

Na abertura do Termômetro compara-se o último mês fechado com a
estimativa vigente naquele mês. Desvio acima de ~15% mostra um card:
"Em julho você gastou 78/dia, sua estimativa é 62,90. Atualizar?". Um
toque grava nova estimativa com `effective_from` = hoje, sem retroagir,
e dispensa o mês para o card não voltar. "Manter" só registra a
dispensa.

Configurações → *Rever estimativa* limpa as dispensas e volta ao
Termômetro, onde a comparação roda de novo.

---

## 10. O que já está no app

O laço básico (PGlite, Lançar, Termômetro, backup, pendentes, fixos,
marcos, cartão, desvio, Previsão, Planejamento, wizard de primeiro
uso) já está entregue. A fatia de maior valor sobre a planilha — ver
o comprometimento futuro das compras parceladas — vive na Previsão.

## 11. Em aberto

- Backup automático / lembrete de exportar (o dump manual em JSON
  está em Configurações; ADR 0001).
- Se um cenário simulado pode ser salvo em vez de descartado
  (`timeline_sim` continua efêmero).
- Categoria em cada lançamento (schema permite; Lançar não grava).
