// BigInt is well within Number's safe range for personal-finance amounts,
// so converting to format is fine — the bigint discipline (SPEC.md §5)
// matters for storage/arithmetic, not for this final display step.
export function formatCents(cents: bigint): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

// "quarta, 5 de agosto" — explicit, not "Hoje" (SPEC.md §7). Builds the
// Date from the 'YYYY-MM-DD' string's parts via Date.UTC and formats with
// timeZone: 'UTC' so the day never shifts, matching the parser contract in
// src/db/pglite-config.mjs (dates stay text until this final step).
export function formatDateHeader(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));

  const parts = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).formatToParts(date);

  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? '').replace(/-feira$/, '');
  const dayPart = parts.find((p) => p.type === 'day')?.value ?? '';
  const monthPart = parts.find((p) => p.type === 'month')?.value ?? '';

  return `${weekday}, ${dayPart} de ${monthPart}`;
}
