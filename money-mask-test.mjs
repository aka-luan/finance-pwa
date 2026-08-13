import assert from 'node:assert/strict';
import { maskTypedMoney } from './src/ui/money-mask.mjs';

// Cents-first, like Hoje "e se eu gastar" and Lançar: each typed digit is a
// cent, and the comma appears while typing. "1500" is R$ 15,00, not R$ 1.500,00.

{
  const steps = [
    ['1', 1n, '0,01'],
    ['15', 15n, '0,15'],
    ['150', 150n, '1,50'],
    ['1500', 1500n, '15,00'],
    ['150000', 150000n, '1.500,00'],
  ];
  for (const [raw, cents, display] of steps) {
    const got = maskTypedMoney(raw);
    assert.equal(got.cents, cents, `digits ${raw} → cents`);
    assert.equal(got.display, display, `digits ${raw} → display`);
  }
}

{
  const got = maskTypedMoney('');
  assert.equal(got.cents, 0n);
  assert.equal(got.display, '');
}

{
  const pasted = maskTypedMoney('1.234,56');
  assert.equal(pasted.cents, 123456n);
  assert.equal(pasted.display, '1.234,56');
}

{
  const got = maskTypedMoney('-1500', { allowNegative: true });
  assert.equal(got.cents, -1500n);
  assert.equal(got.display, '\u221215,00');
}

{
  const got = maskTypedMoney('-1500', { allowNegative: false });
  assert.equal(got.cents, 1500n);
  assert.equal(got.display, '15,00');
}

{
  const got = maskTypedMoney('123456789');
  assert.equal(got.cents, 12345678n);
  assert.equal(got.display, '123.456,78');
}

console.log('money-mask-test: ok');
