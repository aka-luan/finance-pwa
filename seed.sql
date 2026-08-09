-- Cartão 1: fecha dia 20, vence dia 5 (mês seguinte)
insert into card values ('11111111-1111-1111-1111-111111111111','Geral',20,5,null);
-- Cartão 2 (assinaturas): fecha dia 10, vence dia 25 (mesmo mês)
insert into card values ('22222222-2222-2222-2222-222222222222','Assinaturas',10,25,null);

-- Saldo conhecido no início de 31/07/2026
insert into account_anchor values ('aaaaaaaa-0000-0000-0000-000000000001','2026-07-31', 100000);

-- Salário dia 15, financiamento dia 10
insert into recurrence (id,kind,target,card_id,amount_cents,day_of_month,label,start_date)
values ('bbbb0000-0000-0000-0000-000000000001','entrada','account',null, 443357,15,'Salário','2026-01-01'),
       ('bbbb0000-0000-0000-0000-000000000002','saida','account',null,  265080,10,'Financiamento','2026-01-01'),
       -- assinatura no cartão 2
       ('bbbb0000-0000-0000-0000-000000000003','saida','card','22222222-2222-2222-2222-222222222222', 4990,1,'Streaming','2026-01-01');

-- Estimativa diária: 62,90
insert into daily_estimate values ('cccc0000-0000-0000-0000-000000000001', 6290, '2026-01-01');

-- Real em agosto: gastei 50,00 no dia 3
insert into transaction (id,date,kind,amount_cents)
values ('dddd0000-0000-0000-0000-000000000001','2026-08-03','diario',5000);

-- Compra parcelada: 1000,01 em 3x no cartão 1, dia 25/08 (depois do fechamento -> ciclo setembro)
insert into purchase (id,card_id,date,amount_cents,installments,description)
values ('eeee0000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','2026-08-25',100001,3,'Notebook');
