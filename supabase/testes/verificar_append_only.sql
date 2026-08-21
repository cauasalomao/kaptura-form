-- =====================================================================
-- Kaptura · Fase 6, teste 6 · Provar que kaptura_aceites e append-only
-- ---------------------------------------------------------------------
-- ATENCAO: o SQL Editor do Supabase roda como `postgres`, que e DONO da
-- tabela e IGNORA RLS. Rodar o UPDATE/DELETE direto ali daria falso
-- negativo (o comando funcionaria) e voce concluiria que a protecao
-- falhou -- ou pior, apagaria dados achando que seria bloqueado.
--
-- Por isso cada bloco abaixo usa `set local role kaptura_app` dentro de
-- uma transacao: assim as grants e as policies passam a valer de fato.
-- Rodar UM BLOCO POR VEZ (um erro aborta a transacao inteira).
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 1 · INSERT deve FUNCIONAR
-- Esperado: "INSERT 0 1" e commit sem erro.
-- ---------------------------------------------------------------------
begin;
  set local role kaptura_app;
  insert into kaptura_aceites (
    versao_contrato, razao_social, documento, tipo_documento,
    responsavel, email, whatsapp, ip, user_agent, origem_pagina, hash_payload
  ) values (
    'TESTE-append-only', 'Teste Append Only LTDA', '11222333000181', 'cnpj',
    'Teste', 'teste@example.com', '(11) 90000-0000', '127.0.0.1',
    'sql-test', 'sql-test', 'sha256-teste'
  );
commit;


-- ---------------------------------------------------------------------
-- BLOCO 2 · SELECT deve FUNCIONAR
-- Esperado: a linha de teste aparece.
-- ---------------------------------------------------------------------
begin;
  set local role kaptura_app;
  select id, criado_em, razao_social
  from kaptura_aceites
  where versao_contrato = 'TESTE-append-only';
commit;


-- ---------------------------------------------------------------------
-- BLOCO 3 · UPDATE deve SER NEGADO
-- Esperado: ERRO "permission denied for table kaptura_aceites".
-- Se rodar sem erro, a protecao NAO esta valendo -- me avise.
-- ---------------------------------------------------------------------
begin;
  set local role kaptura_app;
  update kaptura_aceites
  set razao_social = 'Alterado indevidamente'
  where versao_contrato = 'TESTE-append-only';
rollback;


-- ---------------------------------------------------------------------
-- BLOCO 4 · DELETE deve SER NEGADO
-- Esperado: ERRO "permission denied for table kaptura_aceites".
-- ---------------------------------------------------------------------
begin;
  set local role kaptura_app;
  delete from kaptura_aceites
  where versao_contrato = 'TESTE-append-only';
rollback;


-- ---------------------------------------------------------------------
-- BLOCO 5 · Conferencia declarativa (roda como postgres mesmo)
-- Esperado:
--   grants   -> apenas INSERT e SELECT para kaptura_app
--   policies -> apenas as de INSERT e SELECT
-- ---------------------------------------------------------------------
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'kaptura_aceites'
  and grantee = 'kaptura_app'
order by privilege_type;

select policyname, cmd, roles
from pg_policies
where tablename = 'kaptura_aceites'
order by policyname;


-- ---------------------------------------------------------------------
-- LIMPEZA · rodar como postgres (o kaptura_app, corretamente, nao consegue)
-- ---------------------------------------------------------------------
-- delete from kaptura_aceites where versao_contrato = 'TESTE-append-only';
