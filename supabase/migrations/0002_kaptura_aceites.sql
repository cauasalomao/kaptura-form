-- =====================================================================
-- Kaptura · Fase 1 (parte 2 de 2) · Tabelas de aceite e pagamentos
-- ---------------------------------------------------------------------
-- Rodar DEPOIS de 0001_role_kaptura_app.sql.
--
-- Regra permanente: kaptura_aceites e APPEND-ONLY. O usuario do n8n
-- pode inserir e ler, nunca alterar ou apagar. Um aceite gravado e a
-- prova do contrato; se ele puder ser editado, deixa de ser prova.
-- =====================================================================

-- ---------------------------------------------------------------------
-- kaptura_aceites
-- ---------------------------------------------------------------------
create table if not exists kaptura_aceites (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  versao_contrato text not null,
  razao_social    text not null,
  documento       text not null,
  tipo_documento  text not null check (tipo_documento in ('cnpj','cpf')),
  responsavel     text not null,
  email           text not null,
  whatsapp        text not null,
  ip              text,
  user_agent      text,
  origem_pagina   text,
  hash_payload    text not null
);

create index if not exists idx_aceites_documento on kaptura_aceites (documento);
create index if not exists idx_aceites_email     on kaptura_aceites (email);

alter table kaptura_aceites enable row level security;

-- Nada acessivel via anon key do Supabase.
revoke all on kaptura_aceites from anon, authenticated;

-- Append-only para o n8n: so insert e select, sem update e sem delete.
grant insert, select on kaptura_aceites to kaptura_app;

-- IMPORTANTE: com RLS ligada, GRANT sozinho nao basta. kaptura_app nao e
-- dono da tabela, entao sem policy TODO insert e select dele seria negado
-- e o no 3 do workflow falharia sempre. As duas policies abaixo liberam
-- exatamente o que a grant ja permite -- e nada mais. Continua sem
-- policy de update/delete de proposito: mesmo que alguem conceda a grant
-- por engano no futuro, a RLS ainda barra.
drop policy if exists aceites_n8n_insert on kaptura_aceites;
create policy aceites_n8n_insert on kaptura_aceites
  for insert to kaptura_app with check (true);

drop policy if exists aceites_n8n_select on kaptura_aceites;
create policy aceites_n8n_select on kaptura_aceites
  for select to kaptura_app using (true);


-- ---------------------------------------------------------------------
-- kaptura_pagamentos
-- Ja criada agora, usada na fase futura (webhook da Hypercash).
-- Na v1 a conferencia de pagamento e manual (ver README, Fase 7).
-- ---------------------------------------------------------------------
create table if not exists kaptura_pagamentos (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  origem     text not null default 'hypercash',
  evento     text not null,
  documento  text,
  email      text,
  valor      numeric,
  payload    jsonb
);

create index if not exists idx_pagamentos_documento on kaptura_pagamentos (documento);
create index if not exists idx_pagamentos_email     on kaptura_pagamentos (email);

alter table kaptura_pagamentos enable row level security;

revoke all on kaptura_pagamentos from anon, authenticated;

grant insert, select on kaptura_pagamentos to kaptura_app;

drop policy if exists pagamentos_n8n_insert on kaptura_pagamentos;
create policy pagamentos_n8n_insert on kaptura_pagamentos
  for insert to kaptura_app with check (true);

drop policy if exists pagamentos_n8n_select on kaptura_pagamentos;
create policy pagamentos_n8n_select on kaptura_pagamentos
  for select to kaptura_app using (true);
