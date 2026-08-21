/**
 * Kaptura · Registro de aceite do contrato
 * ---------------------------------------------------------------------
 * Recebe o POST da página de adesão, registra o aceite de forma imutável
 * e dispara os dois e-mails. Substitui o workflow do n8n.
 *
 * Contrato com a página (assinar.html):
 *   - 2xx  -> aceite registrado, a página pode redirecionar pro pagamento
 *   - !2xx -> a página NÃO redireciona, tenta de novo e mostra erro
 *
 * Por isso a regra de erro aqui é: falha de banco derruba a resposta
 * (500), falha de e-mail não. Um aceite gravado não pode ser desfeito
 * porque o Resend caiu.
 *
 * Segredos (Supabase → Edge Functions → Secrets):
 *   KAPTURA_DB_URL          connection string do role kaptura_app
 *   RESEND_API_KEY          chave da API do Resend
 *   ACEITES_EMAIL_INTERNO   caixa que recebe o backup do JSON
 *   CONTRATO_URL            (opcional) URL do PDF anexado no e-mail
 */

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const ORIGENS_PERMITIDAS = [
  "https://kapturacreators.com.br",
  "https://www.kapturacreators.com.br",
  "http://localhost:8080",
];

const CONTRATO_URL = Deno.env.get("CONTRATO_URL") ??
  "https://kapturacreators.com.br/contrato-kaptura-hospedagem-v1.pdf";

const NOME_ARQUIVO_CONTRATO = "contrato-kaptura-hospedagem-v1.pdf";

/**
 * O domínio do remetente PRECISA estar verificado no Resend, senão o envio
 * volta 403. Usamos o da Komplexa Growth, que já está verificado, e não o
 * kapturacreators.com.br -- o plano free do Resend só permite um domínio.
 *
 * O nome de exibição continua "Kaptura": é o que o cliente vê na caixa.
 * Dá pra sobrescrever pelo secret REMETENTE sem novo deploy.
 */
const REMETENTE = Deno.env.get("REMETENTE") ??
  "Kaptura <contratos@komplexagrowth.com>";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function cors(origem: string | null): Record<string, string> {
  const permitida = origem && ORIGENS_PERMITIDAS.includes(origem)
    ? origem
    : ORIGENS_PERMITIDAS[0];
  return {
    "Access-Control-Allow-Origin": permitida,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origem: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origem), "Content-Type": "application/json" },
  });
}

function digitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * O IP vem de cabeçalho, e cabeçalho de requisição é dado do cliente até
 * prova em contrário. `x-forwarded-for` é uma lista onde a infra ANEXA o
 * IP real observado no fim -- se o cliente mandar um XFF forjado, o valor
 * forjado fica na frente. Por isso pegamos o ÚLTIMO elemento, não o
 * primeiro: é o único que a nossa camada de rede escreveu.
 */
function extrairIp(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  const xff = headers.get("x-forwarded-for");
  if (!xff) return "";

  const partes = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : "";
}

// Validação server-side. A página já valida, mas validação de cliente é
// conveniência, não garantia: qualquer um pode postar direto aqui.
function validaCPF(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0, resto: number;
  for (let i = 1; i <= 9; i++) soma += parseInt(d.charAt(i - 1), 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(d.charAt(9), 10)) return false;
  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(d.charAt(i - 1), 10) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(d.charAt(10), 10);
}

function validaCNPJ(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string): number => {
    let peso = base.length === 12 ? 5 : 6, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base.charAt(i), 10) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (dv(d.slice(0, 12)) !== parseInt(d.charAt(12), 10)) return false;
  return dv(d.slice(0, 13)) === parseInt(d.charAt(13), 10);
}

function formatarDocumento(d: string): string {
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return d;
}

function agoraEmBrasilia(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date()).replace(", ", " ");
}

// ---------------------------------------------------------------------
// E-mails (Resend) — nunca derrubam a requisição
// ---------------------------------------------------------------------

async function enviarResend(payload: unknown): Promise<void> {
  const chave = Deno.env.get("RESEND_API_KEY");
  if (!chave) throw new Error("RESEND_API_KEY ausente");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${chave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

async function baixarContratoBase64(): Promise<string | null> {
  try {
    const res = await fetch(CONTRATO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return encodeBase64(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    console.error("[kaptura-aceite] falha ao baixar o contrato:", e);
    return null;
  }
}

function htmlConfirmacao(d: Record<string, string>): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#06344A;max-width:560px">
  <p>Olá, ${d.responsavel}!</p>

  <p>Confirmamos o registro do seu aceite do Contrato de Adesão ao Programa
  Kaptura (versão 1.0) em ${d.registrado_em}, em nome de
  ${d.razao_social} (${d.documento_formatado}).</p>

  <p>O contrato completo está anexado neste e-mail pra sua guarda.</p>

  <p><strong>Próximo passo:</strong> concluir a ativação da assinatura na página
  de pagamento. Se você já concluiu, é só aguardar: nosso time entra em contato
  pelo WhatsApp pra dar as boas-vindas e iniciar a curadoria do seu primeiro
  influenciador.</p>

  <p>Qualquer dúvida, responde este e-mail.</p>

  <p style="margin-top:28px">
    <strong>Kaptura Creators</strong><br>
    <span style="color:#5B7A88">um programa Komplexa</span>
  </p>
</div>`;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const origem = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origem) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, erro: "método não permitido" }, 405, origem);
  }

  // Corpo cru: o hash é dos bytes exatos que chegaram, não de uma
  // re-serialização nossa. Assim o hash confere com o que foi enviado.
  const corpoCru = await req.text();

  let body: Record<string, any>;
  try {
    body = JSON.parse(corpoCru);
  } catch {
    return json({ ok: false, erro: "JSON inválido" }, 400, origem);
  }

  // Honeypot: responde 200 sem gravar. Bot não descobre que foi barrado.
  if (body.site_url) {
    console.log("[kaptura-aceite] honeypot acionado, descartado");
    return json({ ok: true }, 200, origem);
  }

  const c = body.contratante ?? {};
  const documento = digitos(c.documento);
  const tipo = documento.length === 14 ? "cnpj" : "cpf";

  const invalido =
    !body.versao_contrato ||
    String(c.razao_social ?? "").trim().length < 2 ||
    String(c.responsavel ?? "").trim().length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(c.email ?? "").trim()) ||
    digitos(c.whatsapp).length < 10 ||
    (documento.length === 11 ? !validaCPF(documento) : !validaCNPJ(documento));

  if (invalido) {
    return json({ ok: false, erro: "dados do aceite inválidos" }, 400, origem);
  }

  const registro = {
    versao_contrato: String(body.versao_contrato),
    razao_social: String(c.razao_social).trim(),
    documento,
    tipo_documento: tipo,
    responsavel: String(c.responsavel).trim(),
    email: String(c.email).trim(),
    whatsapp: String(c.whatsapp).trim(),
    ip: extrairIp(req.headers),
    user_agent: String(body.user_agent ?? ""),
    origem_pagina: String(body.origem_pagina ?? ""),
    hash_payload: await sha256(corpoCru),
  };

  // ---- Banco: NÓ CRÍTICO. Se falhar, a página não pode redirecionar. ----
  const dbUrl = Deno.env.get("KAPTURA_DB_URL");
  if (!dbUrl) {
    console.error("[kaptura-aceite] KAPTURA_DB_URL ausente");
    return json({ ok: false, erro: "configuração ausente" }, 500, origem);
  }

  const sql = postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 5 });

  try {
    await sql`
      insert into kaptura_aceites ${sql(
        registro,
        "versao_contrato", "razao_social", "documento", "tipo_documento",
        "responsavel", "email", "whatsapp", "ip", "user_agent",
        "origem_pagina", "hash_payload",
      )}
    `;
  } catch (e) {
    console.error("[kaptura-aceite] INSERT falhou:", e);
    return json({ ok: false, erro: "falha ao registrar o aceite" }, 500, origem);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  // A partir daqui o aceite JÁ ESTÁ GRAVADO. Nada abaixo pode devolver
  // erro, senão a página bloquearia um redirect que já é legítimo.

  const dados = {
    ...registro,
    documento_formatado: formatarDocumento(documento),
    registrado_em: agoraEmBrasilia(),
  };

  const contratoBase64 = await baixarContratoBase64();
  const anexos = contratoBase64
    ? [{ filename: NOME_ARQUIVO_CONTRATO, content: contratoBase64 }]
    : [];

  const emailInterno = Deno.env.get("ACEITES_EMAIL_INTERNO");

  // O e-mail pede "responde este e-mail". Sem reply_to, a resposta cairia
  // no endereço do remetente, que é de disparo e ninguém acompanha.
  const envios: Promise<void>[] = [
    enviarResend({
      from: REMETENTE,
      to: [dados.email],
      ...(emailInterno ? { reply_to: [emailInterno] } : {}),
      subject: "Seu aceite do Contrato Kaptura foi registrado ✅",
      html: htmlConfirmacao(dados),
      attachments: anexos,
    }),
  ];

  if (emailInterno) {
    envios.push(enviarResend({
      from: REMETENTE,
      to: [emailInterno],
      subject:
        `[ACEITE] ${dados.razao_social} · ${dados.documento_formatado} · ${dados.versao_contrato}`,
      text: [
        "ACEITE REGISTRADO",
        "",
        `Data/hora (Brasília): ${dados.registrado_em}`,
        `Versão do contrato:   ${dados.versao_contrato}`,
        "",
        `Razão social: ${dados.razao_social}`,
        `Documento:    ${dados.documento_formatado} (${dados.tipo_documento})`,
        `Responsável:  ${dados.responsavel}`,
        `E-mail:       ${dados.email}`,
        `WhatsApp:     ${dados.whatsapp}`,
        "",
        `IP:           ${dados.ip}`,
        `User agent:   ${dados.user_agent}`,
        `Origem:       ${dados.origem_pagina}`,
        `Hash SHA-256: ${dados.hash_payload}`,
        `Anexo:        ${contratoBase64 ? "PDF anexado" : "FALHOU — reenviar manualmente"}`,
        "",
        "--- PAYLOAD COMPLETO ---",
        corpoCru,
      ].join("\n"),
    }));
  } else {
    console.warn("[kaptura-aceite] ACEITES_EMAIL_INTERNO ausente, backup não enviado");
  }

  const resultados = await Promise.allSettled(envios);
  resultados.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[kaptura-aceite] e-mail ${i} falhou:`, r.reason);
    }
  });

  return json({ ok: true }, 200, origem);
});
