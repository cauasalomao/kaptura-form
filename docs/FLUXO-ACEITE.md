# Kaptura Creators — Fluxo de Aceite e Assinatura

Repositório: `cauasalomao/kaptura-form` · Domínio: `kapturacreators.com.br`

Fluxo de adesão ao Programa Kaptura com registro imutável do aceite contratual.
A página `assinar.html` segue a mesma identidade do `index.html` (Anton + Work
Sans, paleta ciano/amarelo/tinta, skew de -10°) e usa o mesmo GTM (`GTM-PPZ9GFDK`).

## Arquitetura

```
assinar.html
   └─ POST → n8n Webhook (/kaptura-aceite)
                ├─ Code: extrai IP, calcula SHA-256 do payload, descarta bots
                ├─ Postgres (Supabase): INSERT em kaptura_aceites   ← nó crítico
                ├─ Gmail: backup do JSON → caixa interna
                └─ HTTP (Resend): e-mail de confirmação + PDF pro cliente
   └─ redirect → Hypercash (assinatura R$97/mês)
```

O redirect para o pagamento **só acontece depois de um 2xx do webhook**.
Aceite sem registro é contrato sem prova.

## Arquivos

| Arquivo | O que é |
|---|---|
| `assinar.html` | Página de adesão: formulário, clickwrap, honeypot, envio do aceite |
| `index.html` | Página de candidatura, já existente — **não alterada** |
| `contrato-kaptura-hospedagem-v1.pdf` | Contrato anexado no e-mail e linkado no checkbox — **ainda não está no repo** |
| `supabase/migrations/0001_role_kaptura_n8n.sql` | Cria o usuário `kaptura_n8n` |
| `supabase/migrations/0002_kaptura_aceites.sql` | Tabelas, índices, RLS e grants append-only |
| `supabase/testes/verificar_append_only.sql` | Fase 6, teste 6 |
| `n8n/kaptura-aceite.workflow.json` | Workflow "Kaptura · Aceite de Contrato", pronto para importar |

---

## Pendências de configuração

Nada disso vive no código — são valores que só o Cauã tem.

| Item | Onde | Status |
|---|---|---|
| `LINK_PAGAMENTO` (Hypercash) | `assinar.html` | ✅ Configurado — plano "Kaptura Creators · Assinatura", R$97,00/mês |
| `WEBHOOK_ACEITE` | `assinar.html` | Pré-preenchido: `https://webhook.komplexagrowth.com/webhook/kaptura-aceite` — **conferir** contra a URL de produção do nó 1 depois de importar o workflow |
| `WHATSAPP_SUPORTE` | `assinar.html` | **Placeholder** — link `wa.me` usado na mensagem de erro |
| `VERSAO_CONTRATO` | `assinar.html` | `v1.0-ago2026` |
| PDF do contrato | Raiz do repo | **Falta subir** |
| Destinatário do backup | nó 4 do workflow | **Confirmar endereço** (`CONFIRMAR_COM_CAUA@…`) |
| Connection string `kaptura_n8n` | Credenciais n8n | Criar na Fase 1 |
| `RESEND_API_KEY` | Credenciais n8n | Criar na Fase 3 |
| OAuth Gmail | Credenciais n8n | Conta Workspace existente |

A página se protege sozinha: enquanto `WEBHOOK_ACEITE` ou `LINK_PAGAMENTO`
estiverem com placeholder, o botão **não redireciona** — mostra a mensagem de
erro e registra o motivo no console.

### Eventos de GTM

A página empurra três eventos no `dataLayer`, para acompanhar o funil de adesão:

| Evento | Quando |
|---|---|
| `kaptura_aceite_enviado` | O usuário passou na validação e o POST saiu |
| `kaptura_aceite_registrado` | Webhook respondeu 2xx, logo antes do redirect |
| `kaptura_aceite_falhou` | As duas tentativas falharam, sem redirect |

---

## Fase 1 · Supabase

Rodar no SQL Editor, **nesta ordem**:

1. `supabase/migrations/0001_role_kaptura_n8n.sql` — trocar
   `DEFINIR_SENHA_FORTE_AQUI` por uma senha forte antes de rodar. Não comitar a
   senha real; ela vive só na connection string dentro do n8n.
2. `supabase/migrations/0002_kaptura_aceites.sql`

### Por que a migration tem policies de RLS

O plano original ligava RLS sem nenhuma policy, contando só com as grants para
o `kaptura_n8n`. Isso não funciona: com RLS ligada, quem não é dono da tabela
precisa de policy **além** da grant — sem ela, todo INSERT do nó 3 seria negado
e o workflow falharia em 100% dos aceites.

A migration cria duas policies (`insert` e `select`) restritas ao role
`kaptura_n8n`, espelhando exatamente as grants. A intenção original está
preservada:

- `anon` e `authenticated` continuam sem acesso nenhum — nada acessível pela anon key;
- não existe grant nem policy de `update`/`delete` — a tabela segue append-only,
  com duas camadas de proteção em vez de uma.

---

## Fase 2 · n8n

1. Importar `n8n/kaptura-aceite.workflow.json`.
2. Criar e vincular as três credenciais (Postgres, Gmail, Header Auth do Resend).
   Os campos `"id": "SUBSTITUIR"` são preenchidos ao selecionar a credencial na UI.
3. Confirmar o destinatário do nó 4.
4. Ativar o workflow e copiar a **URL de produção** do nó 1 para `WEBHOOK_ACEITE`.

### Nós

| # | Nó | Papel |
|---|---|---|
| 1 | Webhook Aceite | POST `/kaptura-aceite`, responde `{"ok":true}` na hora |
| 2 | Normalizar Aceite | IP real, SHA-256 do payload, honeypot, formatações |
| 3 | Registrar Aceite (Supabase) | INSERT — **nó crítico** |
| 4 | Backup Interno (Gmail) | JSON completo para a caixa interna |
| 5 | Baixar PDF do Contrato | GET binário do PDF publicado |
| 5b | Montar E-mail do Cliente | Converte o PDF em base64 e monta o corpo do Resend |
| 6 | Enviar Confirmação (Resend) | POST `api.resend.com/emails` |

Dois detalhes que fogem do plano original, por necessidade técnica:

- **CORS no nó 1.** A página roda em `kapturacreators.com.br` e o n8n em outro
  host, então o browser faz preflight. Sem `allowedOrigins` configurado o fetch
  falha antes de sair — e como o redirect agora é bloqueado, isso travaria
  *todos* os checkouts. A lista de origens está no nó; atualizar se o domínio mudar.
- **Nó 5b.** Expressão de template não lê binário de forma confiável. O Code node
  pega o buffer do nó 5, converte em base64 e monta o JSON do Resend. Se o PDF
  estiver indisponível, manda o e-mail sem anexo em vez de deixar o cliente sem
  confirmação — a falha do nó 5 fica registrada na execução para reenvio manual.

### Tratamento de erro

- Nó 3: `onError: stopWorkflow`. Se o banco falhar, a execução falha e aparece
  em vermelho no painel. É de propósito.
- Nós 4, 5, 5b e 6: `onError: continueRegularOutput`. Falha de e-mail não derruba
  um aceite já gravado.

---

## Fase 3 · Resend

1. Criar conta (free tier: 3.000/mês, 100/dia).
2. Adicionar o domínio `kapturacreators.com.br` e criar na Cloudflare os
   registros DNS que o painel fornecer (SPF, DKIM, DMARC).
3. Aguardar a verificação, criar a API key e guardá-la nas credenciais do n8n
   como Header Auth: `Name = Authorization`, `Value = Bearer re_xxx`.
4. Remetente: `contratos@kapturacreators.com.br`.

---

## Fase 5 · Versionamento do contrato (regra permanente)

O arquivo do contrato carrega a versão **no nome** e **no rodapé interno**.
`VERSAO_CONTRATO` sempre corresponde ao arquivo linkado.

Quando o contrato mudar, tudo isto vai no **mesmo commit**:

1. Subir `contrato-kaptura-hospedagem-v1-1.pdf` (arquivo novo, nome novo);
2. Atualizar `ARQUIVO_CONTRATO` em `assinar.html` (o link do checkbox lê essa constante);
3. Atualizar `VERSAO_CONTRATO` em `assinar.html`;
4. Atualizar a URL do nó 5 e o `filename` do anexo no nó 5b.

**Nunca sobrescrever o PDF de uma versão antiga.** Aceites passados apontam para
ela, e o registro no banco guarda a versão aceita.

---

## Fase 6 · Testes de aceitação

Rodar todos antes de liberar.

| # | Teste | Esperado |
|---|---|---|
| 1 | Formulário completo com CNPJ de 14 dígitos | Linha no Supabase com `ip`, `user_agent` e `hash_payload` preenchidos; backup na caixa interna; e-mail de confirmação com PDF anexado; redirect para a Hypercash no plano de R$97/mês |
| 2 | Mesmo fluxo com CPF de 11 dígitos | `tipo_documento = 'cpf'` no banco |
| 3 | Avançar sem marcar o checkbox | Bloqueado, com mensagem no campo |
| 4 | URL do webhook inválida temporariamente | **Não redireciona**, mostra a mensagem de erro, reabilita o botão (após 2 tentativas) |
| 5 | Preencher o honeypot pelo console | Nada gravado no banco |
| 6 | UPDATE/DELETE como `kaptura_n8n` | Negado — rodar `supabase/testes/verificar_append_only.sql` |
| 7 | Viewport 390px | Formulário, checkbox e barra fixa sem sobreposição |

Comandos úteis para o teste 5, no console da página:

```javascript
document.getElementById('site_url').value = 'http://bot.exemplo'
```

Depois preencher o resto normalmente e enviar: a página envia, o webhook
responde 200, e o nó 2 descarta antes do INSERT. Confirmar no Supabase que
nenhuma linha nova apareceu.

Servidor local para os testes 3, 4, 5 e 7:

```bash
python -m http.server 8080
```

---

## Fase 7 · Operação v1 (manual)

**Conferência de pagamento.** Ao ver uma assinatura ativa no painel da Hypercash,
ops localiza o aceite no Supabase pelo documento ou pelo e-mail:

```sql
select criado_em, razao_social, documento, responsavel, email, whatsapp, versao_contrato
from kaptura_aceites
where documento = '00000000000191'
   or email = 'cliente@exemplo.com.br'
order by criado_em desc;
```

- **Batendo:** disparar o script H1 de boas-vindas no WhatsApp.
- **Não batendo** (pagou sem aceite registrado): contatar o cliente para
  regularizar o aceite **antes** da primeira sessão de curadoria.

**Fase futura, já prevista (não implementar agora).** Webhook da Hypercash →
`kaptura_pagamentos` → cruzamento automático com o aceite → disparo do H1.
A tabela já existe e já tem as grants do `kaptura_n8n`.

---

## Segredos

Nunca comitar neste repositório:

- senha do role `kaptura_n8n` / connection string do Supabase;
- `RESEND_API_KEY`;
- tokens OAuth do Google.

Tudo isso vive só nas credenciais do n8n. A URL do webhook e o link de pagamento
são públicos por natureza (rodam no browser do cliente) e podem ser versionados.
