// Horizonte da Previsão: agregação mensal sobre a timeline diária —
// saldo de fim de mês, recorte 3/6/12 e o resumo (saldo atual + menor).
import assert from 'node:assert/strict';
import {
  buildHorizonMonths,
  daysInMonths,
  horizonSummary,
  lowestBalanceDay,
  monthKey,
} from './src/ui/previsao-horizon.mjs';

function day(date, cents) {
  return { day: date, balance_cents: cents, is_projection: true };
}

const agosto = [
  day('2026-08-13', 100000n),
  day('2026-08-14', 80000n),
  day('2026-08-31', -52500n),
];
const setembro = [
  day('2026-09-01', -40000n),
  day('2026-09-30', 83000n),
];
const outubro = [
  day('2026-10-01', 90000n),
  day('2026-10-31', 142000n),
];
const novembro = [
  day('2026-11-01', 150000n),
  day('2026-11-15', 50000n),
  day('2026-11-30', 211000n),
];
const dezembro = [day('2026-12-01', 200000n), day('2026-12-31', 180000n)];
const janeiro = [day('2027-01-01', 170000n), day('2027-01-31', 160000n)];

const dias = [...agosto, ...setembro, ...outubro, ...novembro, ...dezembro, ...janeiro];

assert.equal(monthKey('2026-08-13'), '2026-08');

{
  const months = buildHorizonMonths(dias, 3);
  assert.equal(months.length, 3);
  assert.deepEqual(
    months.map((m) => m.key),
    ['2026-08', '2026-09', '2026-10'],
  );
  assert.equal(months[0].firstDay, '2026-08-13');
  assert.equal(months[0].lastDay, '2026-08-31');
  assert.equal(months[0].endBalanceCents, -52500n);
  assert.equal(months[1].endBalanceCents, 83000n);
  assert.equal(months[2].endBalanceCents, 142000n);
}

{
  const months = buildHorizonMonths(dias, 6);
  assert.equal(months.length, 6);
  assert.equal(months[5].key, '2027-01');
  assert.equal(months[5].endBalanceCents, 160000n);
}

{
  const months = buildHorizonMonths(dias, 12);
  assert.equal(months.length, 6, 'não inventa meses além dos que a timeline tem');
}

{
  const treze = [];
  for (let i = 0; i < 13; i++) {
    const month = i < 5 ? `2026-${String(8 + i).padStart(2, '0')}` : `2027-${String(i - 4).padStart(2, '0')}`;
    treze.push(day(`${month}-01`, 100n), day(`${month}-28`, BigInt(i)));
  }
  assert.equal(buildHorizonMonths(treze, 3).length, 3);
  assert.equal(buildHorizonMonths(treze, 6).length, 6);
  assert.equal(
    buildHorizonMonths(treze, 12).length,
    13,
    '12 meses é a janela inteira da timeline, inclusive o mês parcial no fim',
  );
}

{
  const parcial = buildHorizonMonths(
    [day('2026-08-13', 10n), day('2027-08-01', 20n), day('2027-08-13', 30n)],
    12,
  );
  assert.equal(parcial.length, 2);
  assert.equal(parcial[1].key, '2027-08');
  assert.equal(parcial[1].lastDay, '2027-08-13');
  assert.equal(parcial[1].endBalanceCents, 30n, 'mês cortado pela janela usa o último dia disponível');
}

{
  const months = buildHorizonMonths(dias, 3);
  const recorte = daysInMonths(dias, months);
  assert.equal(recorte[0].day, '2026-08-13');
  assert.equal(recorte[recorte.length - 1].day, '2026-10-31');
  assert.equal(
    recorte.some((d) => d.day.startsWith('2026-11')),
    false,
  );
}

{
  const lowest = lowestBalanceDay(dias);
  assert.equal(lowest?.day, '2026-08-31');
  assert.equal(lowest?.balance_cents, -52500n);
}

{
  const empate = lowestBalanceDay([day('2026-08-13', 10n), day('2026-08-14', 10n), day('2026-08-15', 20n)]);
  assert.equal(empate?.day, '2026-08-13', 'empate no menor saldo fica com o dia mais cedo');
}

{
  const summary = horizonSummary(dias);
  assert.equal(summary?.currentBalanceCents, 100000n);
  assert.equal(summary?.lowestBalanceCents, -52500n);
  assert.equal(summary?.lowestDay, '2026-08-31');
}

{
  assert.equal(horizonSummary([]), null);
  assert.equal(lowestBalanceDay([]), null);
  assert.deepEqual(buildHorizonMonths([], 3), []);
}

console.log('previsao-horizon-test: ok');
