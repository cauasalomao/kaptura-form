# Kaptura Creators — Fluxo de Aceite e Assinatura

Repositório: `cauasalomao/kaptura-form` · Domínio: `kapturacreators.com.br`

Fluxo de adesão ao Programa Kaptura com registro imutável do aceite contratual.
A página `assinar.html` segue a mesma identidade do `index.html` (Anton + Work
Sans, paleta ciano/amarelo/tinta, skew de -10°) e usa o mesmo GTM (`GTM-PPZ9GFDK`).

## Arquitetura

```
assinar.html
   └─ POST → Edge Function /kaptura-aceite   (roda no Supabase)
                ├─ honeypot: descarta bot, responde 200 sem gravar
                ├─ valida os dados no servidor (dígito verificador incluso)
                ├─ extrai o IP real e calcula SHA-256 do corpo cru
                ├─ INSERT em kaptura_aceites (como kaptura_n8n)  ← crítico
                ├─ Resend: e-mail do cliente + PDF anexado
                └─ Resend: backup do JSON → caixa interna
   └─ redirect → Hypercash (assinatura R$97/mês)
```

O redirect para o pagamento **só acontece depois de um 2xx da função**.
Aceite sem registro é contrato sem prova.

Regra de erro, espelhada na página: **falha de banco devolve 500** e trava o
redirect; **falha de e-mail não devolve erro**. Um aceite já gravado não pode
ser desfeito porque o Resend caiu — a falha vai pro log e o time reenvia.

> O workflow do n8n continua versionado em `n8n/` como alternativa, mas **não é
> o caminho ativo**. Ver "Alternativa: n8n" no fim deste documento.

## Arquivos

| Arquivo | O que é |
|---|---|
| `assinar.html` | Página de adesão: formulário, clickwrap, honeypot, envio do aceite |
| `index.html` | Página de candidatura, já existente — **não alterada** |
| `contrato-kaptura-hospedagem-v1.pdf` | Contrato anexado no e-mail e linkado no checkbox — **ainda não está no repo** |
| `supabase/migrations/0001_role_kaptura_n8n.sql` | Cria o usuário `kaptura_n8n` |
| `supabase/migrations/0002_kaptura_aceites.sql` | Tabelas, índices, RLS e grants append-only |
| `supabase/testes/verificar_append_only.sql` | Fase 6, teste 6 |
| `supabase/functions/kaptura-aceite/index.ts` | **Edge Function** que registra o aceite e dispara os e-mails |
| `supabase/config.toml` | `verify_jwt = false` na função (a página chama sem sessão) |
| `n8n/kaptura-aceite.workflow.json` | Workflow equivalente — **alternativa, não usado** |

---

## Pendências de configuração

Nada disso vive no código — são valores que só o Cauã tem.

| Item | Onde | Status |
|---|---|---|
| `LINK_PAGAMENTO` (Hypercash) | `assinar.html` | ✅ Configurado — plano "Kaptura Creators · Assinatura", R$97,00/mês |

> **A taxa da Hypercash é absorvida pela Komplexa.** O checkout cobra R$97,00
> limpos, sem linha de taxas. Isso não é acidente: a página anuncia R$97/mês e o
> **Anexo II do contrato diz "R$ 97,00 por mês"**. Se alguém reativar o repasse
> da taxa no painel da Hypercash, o cliente passa a ser cobrado acima do que
> aceitou por contrato. Ao mexer no plano, conferir os três: página, Anexo II e
> valor final do checkout.
| `WEBHOOK_ACEITE` | `assinar.html` | **Placeholder** — `https://<ref>.supabase.co/functions/v1/kaptura-aceite`. O `<ref>` está em Project Settings → General → Reference ID |
| `KAPTURA_DB_URL` | Secrets da Edge Function | Connection string do `kaptura_n8n` |
| `ACEITES_EMAIL_INTERNO` | Secrets da Edge Function | Caixa que recebe o backup do JSON |
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

## Fase 2 · Edge Function

### 2.1 · Segredos

Supabase → projeto `komplexa-form` → **Edge Functions → Secrets**:

| Nome | Valor |
|---|---|
| `KAPTURA_DB_URL` | `postgresql://kaptura_n8n:SENHA@db.<ref>.supabase.co:5432/postgres` |
| `RESEND_API_KEY` | `re_...` (Fase 3) |
| `ACEITES_EMAIL_INTERNO` | caixa interna que recebe o backup |
| `CONTRATO_URL` | *(opcional)* URL do PDF; o padrão já aponta pro domínio de produção |

Nenhum desses valores vai pro repositório.

### 2.2 · Deploy

```bash
supabase login
```

```bash
supabase link --project-ref <ref>
```

```bash
supabase functions deploy kaptura-aceite
```

Os dois primeiros são interativos (navegador e senha do banco) e precisam ser
rodados por uma pessoa. O `config.toml` já traz `verify_jwt = false` — sem isso
a função devolveria 401 para a página, que chama sem sessão de usuário.

### 2.3 · Apontar a página

Copiar a URL da função para `WEBHOOK_ACEITE` em `assinar.html`:

```
https://<ref>.supabase.co/functions/v1/kaptura-aceite
```

### 2.4 · Ver o que aconteceu

Supabase → Edge Functions → `kaptura-aceite` → **Logs**. Toda falha de banco ou
de e-mail é registrada com o prefixo `[kaptura-aceite]`.

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
4. Atualizar `NOME_ARQUIVO_CONTRATO` e o padrão de `CONTRATO_URL` em
   `supabase/functions/kaptura-aceite/index.ts` (ou o secret `CONTRATO_URL`),
   e fazer novo `supabase functions deploy`.

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

---

## Alternativa: n8n

`n8n/kaptura-aceite.workflow.json` faz exatamente a mesma coisa que a Edge
Function e continua versionado, mas **não é o caminho ativo**. Ficou como
alternativa caso o time prefira o painel visual do n8n para operar.

Trocar de um para o outro é mudar `WEBHOOK_ACEITE` em `assinar.html` — o banco,
as tabelas e o role `kaptura_n8n` são os mesmos nos dois caminhos.

Diferenças que importam se você voltar pro n8n:

| | Edge Function | n8n |
|---|---|---|
| Onde vive | no repo, entra por commit | JSON importado na mão, pode divergir do repo |
| Ver falhas | logs no dashboard do Supabase | painel com o nó vermelho e o payload |
| Credenciais | Secrets do Supabase | credenciais do n8n |
| E-mail interno | Resend | Gmail (OAuth do Workspace) |
| IP do cliente | `x-forwarded-for` (último elemento) | `cf-connecting-ip` da Cloudflare |
| Validação | refeita no servidor | confia no que a página mandou |
