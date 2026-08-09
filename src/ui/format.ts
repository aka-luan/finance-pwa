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

// "5 de ago" — compact form for marcos rows, where the label ("3 meses")
// already disambiguates the year and four dates sit side by side, so the
// full weekday from formatDateHeader would wrap. Pass withYear for pior
// momento, which has no label and whose 12-month window routinely crosses
// into the next year ("5 de ago de 2027").
export function formatDateShort(dateStr: string, options: { withYear?: boolean } = {}): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));

  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    ...(options.withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(date);
}

// "julho" — nome do mês por extenso, para o card de desvio da estimativa
// (SPEC.md §9), que se refere ao mês inteiro, não a um dia específico. Pass
// withYear for the linha do tempo completa (issue #9), cuja janela de 12
// meses rotineiramente cruza pra o ano seguinte — "julho de 2027".
export function formatMonthName(dateStr: string, options: { withYear?: boolean } = {}): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));

  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    ...(options.withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(date);
}

// For an ISO instant — a real point in time, unlike the schema's date columns,
// so it goes through Date and is shown in America/Belem. Used for the
// exported_at stamp a backup file carries. Tolerates a malformed string
// because that value comes from a file the user picked, not from the schema.
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'data desconhecida';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Belem',
  }).format(date);
}
