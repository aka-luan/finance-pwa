export const MONEY_MAX_DIGITS = 8;

/** Current planning-field parse: digits without a comma are whole reais. */
export function maskTypedMoney(
  raw: string,
  options: { allowNegative?: boolean } = {},
): { cents: bigint; display: string } {
  const trimmed = raw.trim().replace(/\s/g, '');
  if (!trimmed) return { cents: 0n, display: '' };
  const neg = trimmed.startsWith('-') || trimmed.startsWith('−');
  const body = trimmed.replace(/^[-−]/, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return { cents: 0n, display: '' };
  const [reais, frac = ''] = body.split('.');
  let cents = BigInt(reais!) * 100n + BigInt((frac + '00').slice(0, 2));
  if (neg && options.allowNegative) cents = -cents;
  if (cents === 0n) return { cents: 0n, display: '' };
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const fracDigits = (abs % 100n).toString().padStart(2, '0');
  const withDots = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return {
    cents,
    display: `${cents < 0n ? '-' : ''}${withDots},${fracDigits}`,
  };
}
