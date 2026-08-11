## Resolução

Variante A (um passo por tela). Sequência e tom fechados com o humano.

### Sequência

1. **Saldo** — “Quanto você tem na conta agora?” Pode ser negativo. Não inclui limite nem fatura. No primeiro uso, caminho de restaurar backup.
2. **Fixos** — “O que entra e sai todo mês?” Dois blocos:
   - Entradas fixas (salário, freelas…)
   - Saídas fixas (aluguel, internet, contas…)
   Viram entrada/saída (recorrência). **Não** entram no diário. Zero ok.
3. **Cotidiano** — “Quanto você geralmente gasta por categoria?” Por alto. Nome da categoria em linha própria (legível). A **média do mês** vira **prévia do diário**, não “o valor do dia”. Zero por categoria ok; total do mês > 0. Na recalibração, a comparação dos 30 dias fica neste passo, sem passo extra.
4. **Resumo** — saldo, entradas fixas, saídas fixas, cotidiano no mês, prévia do diário, prévia de hoje, sobra após o mês planejado (saldo + entradas − saídas − cotidiano; informativo).

### O que isso não é

- Diário não é saldo − fixos.
- Fixos não misturam com cotidiano.

### Protótipo

`src/ui/prototype-wizard*` — abrir em dev: `/?prototype=wizard&variant=A` (barra troca A/B/C; chip troca primeiro uso / recalibrar). Throwaway; não promover como está.

### Próximo nevoeiro agora afiado

Como a confirmação grava essas entradas/saídas nas recorrências existentes (dia do mês, reconciliação na recalibração).
