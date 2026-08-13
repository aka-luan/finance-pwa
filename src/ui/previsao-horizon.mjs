// Horizonte da Previsão: o resumo mensal derivado da timeline diária.
// Um fetch de timeline() alimenta as duas camadas — o horizonte diz para
// onde o saldo vai; a lista embaixo explica o porquê. Sem query extra.

export const HORIZON_RANGES = [3, 6, 12];

export function monthKey(day) {
  return day.slice(0, 7);
}

// Um mês do horizonte: o saldo que interessa é o do último dia presente
// na janela (fim do mês civil, ou o último dia da projeção se o mês
// ainda não fechou / foi cortado pelo alcance de 12 meses).
export function buildHorizonMonths(dias, count) {
  const months = [];
  let current = null;

  for (const dia of dias) {
    const key = monthKey(dia.day);
    if (!current || current.key !== key) {
      current = {
        key,
        firstDay: dia.day,
        lastDay: dia.day,
        endBalanceCents: dia.balance_cents,
      };
      months.push(current);
    } else {
      current.lastDay = dia.day;
      current.endBalanceCents = dia.balance_cents;
    }
  }

  // 12 meses é a janela inteira da timeline (hoje → hoje+12 meses), que
  // costuma cobrir 13 meses civis — o último, parcial, não se corta.
  return count >= 12 ? months : months.slice(0, count);
}

export function daysInMonths(dias, months) {
  const keys = new Set(months.map((month) => month.key));
  return dias.filter((dia) => keys.has(monthKey(dia.day)));
}

// Mesmo desempate de worst_point(): menor saldo, dia mais cedo.
export function lowestBalanceDay(dias) {
  const first = dias[0];
  if (!first) return null;
  let best = first;
  for (const dia of dias) {
    if (dia.balance_cents < best.balance_cents) best = dia;
  }
  return best;
}

export function horizonSummary(dias) {
  const first = dias[0];
  if (!first) return null;
  const lowest = lowestBalanceDay(dias);
  if (!lowest) return null;
  return {
    currentBalanceCents: first.balance_cents,
    lowestBalanceCents: lowest.balance_cents,
    lowestDay: lowest.day,
  };
}
