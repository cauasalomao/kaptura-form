-- =====================================================================
-- Kaptura · Fase 1 (parte 1 de 2) · Usuario dedicado do n8n
-- ---------------------------------------------------------------------
-- RODAR ANTES da migration 0002 (as grants dela dependem deste role).
--
-- ATENCAO: este arquivo contem um PLACEHOLDER de senha. Gere uma senha
-- forte, troque o placeholder, rode no SQL Editor do Supabase e NAO
-- comite o arquivo com a senha real preenchida. A senha vive apenas na
-- connection string guardada nas credenciais do n8n.
--
--   Gerar senha (PowerShell):
--     [Convert]::ToBase64String((1..32|%{Get-Random -Maximum 256}))
-- =====================================================================

create role kaptura_n8n with login password 'DEFINIR_SENHA_FORTE_AQUI';

grant usage on schema public to kaptura_n8n;

-- Nada alem disso: cada tabela concede explicitamente o que o n8n pode
-- fazer nela (ver 0002). Uma tabela nova criada no futuro nasce
-- inacessivel para este usuario ate que alguem conceda de proposito.
