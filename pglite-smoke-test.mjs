import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { pgliteParsers } from './src/db/pglite-config.mjs';

const db = await PGlite.create({ parsers: pgliteParsers });
const t0 = Date.now();
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('./seed.sql', import.meta.url),'utf8'));
console.log('schema + seed:', Date.now()-t0, 'ms');

const show = async (label, sql) => {
  const r = await db.query(sql);
  console.log('\n== ' + label);
  console.table(r.rows);
};

await show('parcelas', 'select installment_no, amount_cents, cycle_month from installment order by installment_no');
await show('faturas', "select cycle_month, amount_cents, due_date from card_bill where cycle_month between '2026-08-01' and '2026-11-01' order by cycle_month, due_date");
await show('timeline ago', "select day, real_cents, projected_cents, balance_cents, is_projection from timeline('2026-08-01','2026-08-16','2026-08-05')");

// 12 meses: performance
const t1 = Date.now();
const r = await db.query("select count(*) n, min(balance_cents) lo, max(balance_cents) hi from timeline('2026-08-01','2027-08-01','2026-08-05')");
console.log('\ntimeline 12 meses:', Date.now()-t1, 'ms', r.rows[0]);

// carga: 3 anos de lançamentos diários + 500 compras
const t2 = Date.now();
await db.exec(`
insert into transaction (id,date,kind,amount_cents)
select gen_random_uuid(), d::date, 'diario', 3000 + (random()*8000)::int
from generate_series('2023-08-01'::date,'2026-08-04'::date,'1 day') d;
insert into purchase (id,card_id,date,amount_cents,installments)
select gen_random_uuid(),'11111111-1111-1111-1111-111111111111',
       ('2024-01-01'::date + (random()*900)::int), (random()*50000)::int+100, 1+(random()*11)::int
from generate_series(1,500);
`);
console.log('carga inserida:', Date.now()-t2, 'ms');

const t3 = Date.now();
const r2 = await db.query("select count(*) n from timeline('2026-08-01','2027-08-01','2026-08-05')");
console.log('timeline 12m com carga:', Date.now()-t3, 'ms', r2.rows[0]);

const t4 = Date.now();
const r3 = await db.query("select count(*) n from timeline('2023-08-01','2027-08-01','2026-08-05')");
console.log('timeline 4 anos:', Date.now()-t4, 'ms', r3.rows[0]);
