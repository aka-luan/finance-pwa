// BigInt is well within Number's safe range for personal-finance amounts,
// so converting to format is fine — the bigint discipline (SPEC.md §5)
// matters for storage/arithmetic, not for this final display step.
export function formatCents(cents: bigint): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

// Só os dígitos — "4.812,30", "−340,00" — porque no design as telas Hoje e
// Lançar trazem o "R$" como rótulo próprio, em tamanho e cor diferentes do
// número, e é ele que fica alinhado à coluna. Difere de formatCents em dois
// pontos que importam: nada de símbolo embutido (nem do espaço rígido que a
// opção `currency` insere) e o sinal negativo é o glifo − (U+2212), não o
// hífen que o Intl usa. As telas secundárias, onde "R$" não é elemento
// separado, seguem em formatCents.
export function formatAmount(cents: bigint): string {
  const digits = (Number(cents < 0n ? -cents : cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return cents < 0n ? `−${digits}` : digits;
}

// Sinal explícito nos dois lados — o horizonte da Previsão precisa que
// "+830,00" e "−525,00" se distingam no mesmo relance, não só o negativo.
export function formatSignedAmount(cents: bigint): string {
  if (cents > 0n) return `+${formatAmount(cents)}`;
  return formatAmount(cents);
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

// Datas curtas do design da Tela Hoje. São três formas distintas porque cada
// uma vive num espaço diferente: o cabeçalho tem a linha inteira, os marcos
// têm um quarto da largura e o aviso de pendentes resume um intervalo.

// "sáb, 8 ago" — cabeçalho da Tela Hoje, ao lado do wordmark.
export function formatDateHeaderShort(dateStr: string): string {
  const parts = dateParts(dateStr, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

// "31/ago" — coluna de marco, onde "31 de ago" não caberia em 1/4 da tela.
export function formatDateSlash(dateStr: string): string {
  const parts = dateParts(dateStr, { day: '2-digit', month: 'short' });
  return `${parts.day}/${parts.month}`;
}

// "4–7 ago" para dias do mesmo mês, "28 jul – 3 ago" quando ele vira. O mês
// só se repete quando muda: o aviso é uma nota discreta, não um relatório.
export function formatDayRange(first: string, last: string): string {
  const a = dateParts(first, { day: 'numeric', month: 'short' });
  const b = dateParts(last, { day: 'numeric', month: 'short' });

  if (first === last) return `${a.day} ${a.month}`;
  if (a.month === b.month) return `${a.day}–${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

// Mesma construção Date.UTC + timeZone: 'UTC' das funções acima, pela mesma
// razão: 'YYYY-MM-DD' é uma data civil, e deixar o fuso local entrar aqui
// deslocaria o dia. Devolve as partes já sem o ponto que o pt-BR põe no mês
// abreviado ("ago." → "ago"), que o design não usa em nenhuma das três.
function dateParts(
  dateStr: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));

  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).formatToParts(date)) {
    parts[part.type] = part.value.replace(/\.$/, '').replace(/-feira$/, '');
  }
  return parts;
}

// "julho" — nome do mês por extenso, para o card de desvio da estimativa
// (SPEC.md §9), que se refere ao mês inteiro, não a um dia específico. Pass
// withYear when the window can cross into the next year — "julho de 2027".
export function formatMonthName(dateStr: string, options: { withYear?: boolean } = {}): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day));

  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    ...(options.withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(date);
}

// "agosto 2026" — cabeçalho de mês da Previsão. Sem "de": o rótulo já é
// uppercase via .secao-label, e "AGOSTO 2026" é o que cabe na coluna.
export function formatMonthYear(dateStr: string): string {
  const parts = dateParts(dateStr, { month: 'long', year: 'numeric' });
  return `${parts.month} ${parts.year}`;
}

// "ago" — coluna do horizonte, onde o nome por extenso não cabe. O CSS
// do rótulo põe em uppercase; o ponto do pt-BR ("ago.") já sai em dateParts.
export function formatMonthAbbrev(dateStr: string): string {
  return dateParts(dateStr, { month: 'short' }).month ?? '';
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
