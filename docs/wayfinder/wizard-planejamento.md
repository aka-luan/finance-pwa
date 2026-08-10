# Mapa: wizard de planejamento financeiro

> Artefato local temporário. O repositório usa GitHub Issues, mas o GitHub CLI e o plugin GitHub não estavam disponíveis durante o mapeamento. Cada seção em **Tickets abertos** foi escrita para virar uma issue.

## Destino

Produzir uma especificação pronta para implementar um wizard que configure o saldo em conta e derive a estimativa diária de um orçamento mensal de gastos cotidianos, tanto no primeiro uso quanto em uma recalibração pelas Configurações.

## Notas

- Domínio: PWA financeira pessoal, local-first, com dinheiro persistido em centavos e datas no fuso `America/Belem`.
- Skills a consultar ao trabalhar os tickets: `domain-modeling`; `prototype` no ticket de experiência; `codebase-design` nos tickets de persistência e estado.
- O primeiro uso deve preservar o caminho de restauração de backup.
- Compras no cartão de crédito e despesas fixas não compõem o orçamento de gastos cotidianos.
- A implementação não faz parte deste mapa; o mapa termina quando as decisões necessárias para uma especificação estiverem resolvidas.

## Decisões até aqui

- O wizard é obrigatório quando o banco está vazio; o usuário conclui o planejamento ou restaura um backup.
- O mesmo fluxo pode ser reaberto em **Configurações → Recalibrar planejamento**.
- O wizard recebe o saldo atual, inclusive negativo.
- O usuário planeja valores mensais por categorias editáveis. Sugestões iniciais: Mercado, Transporte, Lanches e passeios, Farmácia e saúde, Cuidados pessoais e Pequenos imprevistos.
- Categorias individuais podem ter valor zero, mas o orçamento mensal total precisa ser maior que zero.
- A estimativa diária é o orçamento mensal total dividido por 30 dias corridos.
- A prévia de hoje é a estimativa diária menos os gastos diários já lançados hoje e pode ficar negativa.
- Apenas gastos cotidianos pagos diretamente pelo saldo em conta, como Pix ou débito, entram no cálculo; compras no cartão ficam fora.
- A composição por categoria é persistida e reaparece preenchida na recalibração.
- Com 30 dias de histórico, a recalibração compara planejado e realizado por categoria, mas nunca substitui o planejamento automaticamente.
- A confirmação mostra saldo atual, categorias, total mensal, estimativa diária e prévia de hoje.
- Saldo, composição e estimativa são gravados juntos na confirmação.

## Tickets abertos

### Definir a experiência do wizard de planejamento

**Rótulo:** `wayfinder:prototype`  
**Estado:** aberto, não atribuído  
**Bloqueado por:** ninguém — fronteira inicial

#### Pergunta

Qual sequência de etapas, conteúdo, controles e estados de interface torna compreensível o primeiro planejamento e a recalibração, incluindo saldo negativo, categorias editáveis, restauração de backup, comparação com o realizado e confirmação final?

#### Restrições conhecidas

- A UI é mobile-first, em português do Brasil, com DOM imperativo e sem roteador.
- A tela Hoje é renderizada imediatamente na inicialização atual; o protótipo precisa contemplar o estado enquanto o banco decide entre Hoje e wizard.
- O primeiro uso não pode ser pulado.
- A recalibração deve preencher os valores vigentes.

---

### Fechar as regras de cálculo e comparação do planejamento

**Rótulo:** `wayfinder:grilling`  
**Estado:** aberto, não atribuído  
**Bloqueado por:** ninguém — fronteira inicial

#### Pergunta

Quais são as regras exatas de arredondamento da divisão mensal por 30, vigência da nova estimativa, janela dos 30 dias realizados, tratamento de lançamentos sem categoria e apresentação de diferenças entre planejado e realizado?

#### Restrições conhecidas

- Valores monetários são inteiros em centavos.
- A prévia diária pode ser negativa.
- A comparação real é informativa e não altera o planejamento automaticamente.
- A recalibração não pode reescrever estimativas históricas.

---

### Definir o modelo persistente do orçamento mensal

**Rótulo:** `wayfinder:grilling`  
**Estado:** aberto, não atribuído  
**Bloqueado por:** ninguém — fronteira inicial

#### Pergunta

Como representar a composição mensal por categoria e sua vigência, relacioná-la às categorias dos lançamentos e preservar explicabilidade histórica sem duplicar conceitos do domínio?

#### Restrições conhecidas

- `category` guarda hoje somente `id` e nome.
- `daily_estimate` guarda somente o total diário e a data de vigência.
- A composição vigente precisa ser recuperada na recalibração.
- O total diário histórico precisa continuar reproduzível.

---

### Definir a detecção, retomada e conclusão do primeiro uso

**Rótulo:** `wayfinder:grilling`  
**Estado:** aberto, não atribuído  
**Bloqueado por:** **Definir o modelo persistente do orçamento mensal**

#### Pergunta

Qual estado persistido distingue banco novo, wizard incompleto, planejamento concluído e backup restaurado, e como o app escolhe a primeira tela sem exibir dados enganosos ou deixar gravações parciais?

#### Restrições conhecidas

- Ausência de saldo e estimativa, isoladamente, não identifica todos os estados.
- A conclusão deve gravar saldo, orçamento e estimativa atomicamente.
- Restaurar backup substitui todo o conteúdo conhecido do banco.

---

### Definir migração e compatibilidade dos backups

**Rótulo:** `wayfinder:grilling`  
**Estado:** aberto, não atribuído  
**Bloqueado por:** **Definir o modelo persistente do orçamento mensal**

#### Pergunta

Como introduzir as novas estruturas em bancos existentes e no backup JSON, mantendo restauração de arquivos anteriores e impedindo perda silenciosa da composição do planejamento?

#### Restrições conhecidas

- Uma tabela persistente nova precisa entrar em `BACKUP_TABLES`.
- Alterar o conjunto obrigatório de tabelas exige nova versão do backup e leitura compatível da versão anterior.
- O bootstrap atual não possui um mecanismo geral de migrações de tabelas para instalações existentes.

## Dependências

```text
Definir a experiência do wizard de planejamento ───────────────┐
Fechar as regras de cálculo e comparação do planejamento ─────┼─→ especificação pronta
Definir o modelo persistente do orçamento mensal ──────────────┤
  ├─→ Definir a detecção, retomada e conclusão do primeiro uso ┤
  └─→ Definir migração e compatibilidade dos backups ──────────┘
```

## Ainda não especificado

- Critérios finais de aceitação e cobertura de testes: tornam-se precisos depois que experiência, cálculo, persistência e primeiro uso forem decididos.
- Textos exatos, mensagens de erro e estados vazios: dependem do protótipo da experiência.
- Como apresentar valores realizados sem categoria: depende das regras de comparação e do modelo persistente.

## Fora de escopo

- Implementar o wizard neste esforço de wayfinding.
- Calcular um valor diário “seguro” a partir de renda, despesas fixas, faturas futuras ou reserva mínima.
- Incluir compras no cartão de crédito no orçamento mensal de gastos cotidianos.
- Substituir automaticamente o planejamento pelos gastos reais.
