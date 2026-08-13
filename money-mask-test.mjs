import assert from 'node:assert/strict';
import { centsFirstMask } from './src/ui/money-mask.mjs';

{
  const steps = [
    ['1', 1n, '0,01'],
    ['15', 15n, '0,15'],
    ['150', 150n, '1,50'],
    ['1500', 1500n, '15,00'],
    ['150000', 150000n, '1.500,00'],
  ];
  for (const [raw, cents, display] of steps) {
    const got = centsFirstMask(raw);
    assert.equal(got.cents, cents, `digits ${raw} → cents`);
    assert.equal(got.display, display, `digits ${raw} → display`);
  }
}

{
  const got = centsFirstMask('');
  assert.equal(got.cents, 0n);
  assert.equal(got.display, '');
}

{
  const pasted = centsFirstMask('1.234,56');
  assert.equal(pasted.cents, 123456n);
  assert.equal(pasted.display, '1.234,56');
}

{
  const got = centsFirstMask('-1500', { allowNegative: true });
  assert.equal(got.cents, -1500n);
  assert.equal(got.display, '\u221215,00');
}

{
  const got = centsFirstMask('-1500', { allowNegative: false });
  assert.equal(got.cents, 1500n);
  assert.equal(got.display, '15,00');
}

{
  const got = centsFirstMask('123456789');
  assert.equal(got.cents, 12345678n);
  assert.equal(got.display, '123.456,78');
}

console.log('money-mask-test: ok');
