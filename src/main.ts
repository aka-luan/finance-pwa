import { registerSW } from 'virtual:pwa-register';
import { getDb } from './db';

registerSW({ immediate: true });

async function main() {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  try {
    const db = await getDb();

    // Boot-time proof of the two SPEC.md §5 traps: bigint arrives usable
    // without manual parseInt, and date stays a plain 'YYYY-MM-DD' string.
    const check = await db.query<{ cents: bigint; today: string }>(
      "select 9007199254740993::bigint as cents, current_date as today",
    );
    const row = check.rows[0];

    app.textContent =
      row === undefined
        ? 'Banco iniciado, mas a consulta de verificação não retornou linhas.'
        : `Banco pronto. cents=${row.cents.toString()} (${typeof row.cents}), ` +
          `today=${row.today} (${typeof row.today})`;
  } catch (err) {
    app.textContent = `Falha ao iniciar o banco: ${(err as Error).message}`;
    throw err;
  }
}

void main();
