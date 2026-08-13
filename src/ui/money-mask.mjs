export const MONEY_MAX_DIGITS = 8;

/** @param {bigint} cents */
function displayAmount(cents) {
  const digits = (Number(cents < 0n ? -cents : cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0n ? `\u2212${digits}` : digits;
}

/**
 * @param {string} raw
 * @param {{ allowNegative?: boolean }} [options]
 * @returns {{ cents: bigint, display: string }}
 */
export function maskTypedMoney(raw, options = {}) {
  const allowNegative = options.allowNegative === true;
  const negative = allowNegative && /[-−]/.test(raw);
  const digits = raw.replace(/\D/g, '').slice(0, MONEY_MAX_DIGITS);
  if (digits === '') return { cents: 0n, display: '' };
  const cents = negative ? -BigInt(digits) : BigInt(digits);
  return { cents, display: displayAmount(cents) };
}
