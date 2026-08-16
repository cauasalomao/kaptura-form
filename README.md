# Kaptura Creators · Página de candidatura

Página estática única (index.html) na identidade Kaptura, pronta pra GitHub Pages com DNS na Cloudflare.

## Estrutura

- `index.html` — página de candidatura (formulário em 15 takes, webhook n8n)
- `404.html` — página de erro na identidade
- `favicon.svg` — símbolo viewfinder com ponto de REC
- `CNAME` — domínio custom do GitHub Pages (ajustar se o domínio final for outro)
- `.nojekyll` — desliga o processamento Jekyll do GitHub Pages
- `robots.txt` / `sitemap.xml` — SEO básico

## Antes de publicar

1. **Webhook**: em `index.html`, trocar a constante `WEBHOOK_URL` pela URL do webhook do n8n (produção). Enquanto for placeholder, o payload cai no console e não é enviado.
2. **Domínio**: o arquivo `CNAME` está com `kapturacreators.com.br`. Se o domínio final for outro, editar o arquivo E as meta tags `og:url` e `canonical` no `index.html`, além do `robots.txt` e `sitemap.xml`.

## Deploy no GitHub Pages

```bash
# dentro desta pasta
git init
git add .
git commit -m "feat: pagina de candidatura Kaptura v1"
git branch -M main
git remote add origin git@github.com:cauasalomao/kaptura-creators.git
git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save**.

Em 1 a 2 minutos a página sobe em `https://cauasalomao.github.io/kaptura-creators/`.

## DNS na Cloudflare (domínio raiz + www)

No painel da Cloudflare, na zona do domínio:

| Tipo  | Nome | Conteúdo                | Proxy |
|-------|------|-------------------------|-------|
| A     | @    | 185.199.108.153         | DNS only (nuvem cinza) durante a validação |
| A     | @    | 185.199.109.153         | DNS only |
| A     | @    | 185.199.110.153         | DNS only |
| A     | @    | 185.199.111.153         | DNS only |
| CNAME | www  | cauasalomao.github.io   | DNS only |

Depois, no GitHub: **Settings → Pages → Custom domain** → digitar o domínio → aguardar o check DNS → marcar **Enforce HTTPS** (pode levar até 1h pro certificado emitir).

**Só depois do HTTPS ativo**: voltar na Cloudflare e ligar o proxy (nuvem laranja) nos registros, com **SSL/TLS mode: Full (strict)**. Ligar o proxy antes do certificado do GitHub emitir trava a validação.

## Alternativa: Cloudflare Pages direto (padrão Komplexa)

Se preferir o mesmo fluxo dos sites de clientes, dá pra pular o GitHub Pages:

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
2. Selecionar o repositório `kaptura-creators`
3. Build settings: framework **None**, build command vazio, output directory `/`
4. Deploy, depois **Custom domains** → adicionar o domínio (a Cloudflare configura o DNS sozinha, com HTTPS automático)

Nesse caso os arquivos `CNAME` e `.nojekyll` são ignorados sem causar problema, e todo push na main publica sozinho.

## Pós-publicação

- Testar o formulário completo em produção e conferir o payload chegando no n8n
- Validar o preview de compartilhamento (og tags) em https://www.opengraph.xyz
- Apontar o link da bio do Instagram direto pra página
