-- =====================================================================
-- Kaptura · Fase 6, teste 6 · Provar que kaptura_aceites e append-only
-- ---------------------------------------------------------------------
-- Rodar CONECTADO COMO kaptura_n8n (nao como postgres/service_role,
-- senao o teste passa por engano -- dono de tabela ignora RLS).
--
-- Resultado esperado: os dois primeiros blocos passam, os dois ultimos
-- falham com "permission denied for table kaptura_aceites".
-- =====================================================================

-- 1) INSERT deve funcionar
insert into kaptura_aceites (
  versao_contrato, razao_social, documento, tipo_documento,
  responsavel, email, whatsapp, ip, user_agent, origem_pagina, hash_payload
) values (
  'TESTE-append-only', 'Teste Append Only LTDA', '00000000000191', 'cnpj',
  'Teste', 'teste@example.com', '(11) 90000-0000', '127.0.0.1',
  'sql-test', 'sql-test', 'sha256-teste'
);

-- 2) SELECT deve funcionar
select id, criado_em, razao_social
from kaptura_aceites
where versao_contrato = 'TESTE-append-only';

-- 3) UPDATE deve SER NEGADO
update kaptura_aceites
set razao_social = 'Alterado indevidamente'
where versao_contrato = 'TESTE-append-only';

-- 4) DELETE deve SER NEGADO
delete from kaptura_aceites
where versao_contrato = 'TESTE-append-only';

-- Limpeza da linha de teste: rodar como postgres/service_role no SQL
-- Editor do Supabase, ja que kaptura_n8n (corretamente) nao consegue.
--   delete from kaptura_aceites where versao_contrato = 'TESTE-append-only';
