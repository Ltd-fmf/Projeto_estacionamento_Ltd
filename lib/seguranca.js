"use strict";

// Endurecimento do estacionamento (08/10/2026), sem dependência nova.
//
//  - cabeçalhos de segurança (CSP, nosniff, frame, referrer, permissions);
//  - CSRF: origem do pedido (Origin/Referer/Sec-Fetch-Site) + token por
//    navegador (cookie estac_csrf + HMAC), injetado em todo <form method=post>;
//  - mensagens "flash" de uso único em cookie assinado, no lugar de ?msg=
//    (a query string aceitava qualquer texto: link de phishing);
//  - limitador de taxa em memória e log de auditoria.

const crypto = require("node:crypto");

const BASE_PATH = process.env.BASE_PATH || "/estacionamento";
const COOKIE_CSRF = "estac_csrf";
const COOKIE_FLASH = "estac_flash";

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new Error("SESSION_SECRET ausente ou curto demais");
  return s;
}

const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmac = (txt) => b64u(crypto.createHmac("sha256", segredo()).update(txt).digest());

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lerCookie(req, nome) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const parte of h.split(";")) {
    const i = parte.indexOf("=");
    if (i !== -1 && parte.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const seguro = () => process.env.NODE_ENV !== "desenvolvimento";

// ---------------------------------------------------------------- headers
// style-src 'unsafe-inline' porque as páginas usam atributos style=""; scripts
// são só os do próprio site (nada inline). 'wasm-unsafe-eval' e worker blob:
// são do OCR da placa (Tesseract.js roda no navegador).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function cabecalhos(req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  // CSS e fontes podem ser guardados; o resto (HTML, fotos, JSON) não: tem
  // dado pessoal e depende de sessão.
  if (!req.path.startsWith(`${BASE_PATH}/publico/`) && !req.path.startsWith("/publico/")) {
    res.set("Cache-Control", "no-store");
  }
  next();
}

// ------------------------------------------------------------------- CSRF
function tokenCsrf(valorCookie) {
  return hmac(`csrf|${valorCookie}`);
}

function opcoesCookieFino(maxAgeMs) {
  return { httpOnly: true, secure: seguro(), sameSite: "lax", path: BASE_PATH, ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

// Pedido que muda estado tem de ter nascido neste mesmo site.
function origemConfere(req) {
  const site = req.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return false;
  const host = req.get("host");
  const fonte = req.get("origin") || req.get("referer");
  if (!fonte) return false; // navegador moderno sempre manda um dos dois em POST
  try {
    return new URL(fonte).host === host;
  } catch {
    return false;
  }
}

function csrf(req, res, next) {
  let c = lerCookie(req, COOKIE_CSRF);
  if (!c || c.length < 20) {
    c = b64u(crypto.randomBytes(24));
    res.cookie(COOKIE_CSRF, c, opcoesCookieFino(24 * 3600_000));
  }
  req.csrfToken = tokenCsrf(c);

  // Injeta o token em todo formulário POST do HTML que sair.
  const enviar = res.send.bind(res);
  res.send = (corpo) => {
    const tipo = String(res.get("Content-Type") || "");
    if (typeof corpo === "string" && tipo.includes("text/html")) {
      corpo = corpo.replace(
        /(<form\b[^>]*\bmethod=["']?post["']?[^>]*>)/gi,
        `$1<input type="hidden" name="_csrf" value="${req.csrfToken}">`
      );
    }
    return enviar(corpo);
  };

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!origemConfere(req)) return recusarCsrf(req, res);

  // multipart: o corpo só existe depois do multer; o token é conferido em
  // exigirTokenMultipart (lib/fotos.js).
  if (!String(req.headers["content-type"] || "").startsWith("multipart/form-data")) {
    if (!iguais((req.body && req.body._csrf) || "", req.csrfToken)) return recusarCsrf(req, res);
  }
  next();
}

function exigirTokenMultipart(req, res, next) {
  if (!iguais((req.body && req.body._csrf) || "", req.csrfToken || "")) return recusarCsrf(req, res);
  next();
}

function recusarCsrf(req, res) {
  auditar("csrf_recusado", req);
  res.status(403).type("html").send(
    `<p>Pedido recusado por segurança. Volte à página, recarregue e tente de novo.</p><p><a href="${BASE_PATH}/">Voltar</a></p>`
  );
}

// ------------------------------------------------------------------ flash
// Mensagem de uso único: vai num cookie assinado (60 s) e é apagada ao ser
// lida. Por baixo, res.redirect troca "?msg=..." por esse cookie, então as
// rotas continuam escrevendo como antes.
function flash(req, res, next) {
  const bruto = lerCookie(req, COOKIE_FLASH);
  let msg = "";
  if (bruto) {
    const [corpo, assinatura] = bruto.split(".");
    if (corpo && assinatura && iguais(assinatura, hmac(`flash|${corpo}`))) {
      try {
        const obj = JSON.parse(Buffer.from(corpo.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"));
        if (Date.now() - obj.t < 60_000) msg = String(obj.m || "").slice(0, 300);
      } catch {
        /* cookie adulterado: ignora */
      }
    }
    res.clearCookie(COOKIE_FLASH, { path: BASE_PATH });
  }
  req.query = { ...req.query, msg }; // ignora qualquer ?msg= vindo da URL

  const redirecionar = res.redirect.bind(res);
  res.redirect = (a, b) => {
    const [status, url] = typeof a === "number" ? [a, b] : [302, a];
    const m = /([?&])msg=([^&#]*)/.exec(url);
    if (!m) return redirecionar(status, url);
    let texto = "";
    try {
      texto = decodeURIComponent(m[2]);
    } catch {
      /* fica vazio */
    }
    const limpa = url.replace(/([?&])msg=[^&#]*&?/, "$1").replace(/[?&]$/, "");
    const corpo = b64u(JSON.stringify({ m: texto, t: Date.now() }));
    res.cookie(COOKIE_FLASH, `${corpo}.${hmac(`flash|${corpo}`)}`, opcoesCookieFino(60_000));
    return redirecionar(status, limpa);
  };
  next();
}

// ------------------------------------------------------- limite de taxa
// Em memória (some no restart). `chave(req)` decide quem é "o mesmo".
function limitar({ janelaMs, max, chave, nome }) {
  const mapa = new Map();
  setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of mapa) if (agora - v.inicio > janelaMs) mapa.delete(k);
  }, Math.max(janelaMs, 60_000)).unref();

  return (req, res, next) => {
    const k = chave ? chave(req) : req.ip;
    const agora = Date.now();
    let reg = mapa.get(k);
    if (!reg || agora - reg.inicio > janelaMs) reg = { inicio: agora, n: 0 };
    reg.n += 1;
    mapa.set(k, reg);
    if (reg.n > max) {
      auditar("limite_excedido", req, { regra: nome || "?" });
      res.set("Retry-After", String(Math.ceil((reg.inicio + janelaMs - agora) / 1000)));
      return res.status(429).type("html").send("<p>Muitas tentativas. Aguarde alguns minutos e tente de novo.</p>");
    }
    next();
  };
}

// -------------------------------------------------------------- auditoria
// Uma linha JSON por evento no stdout (pm2 guarda e rotaciona). Nunca grava
// senha, token nem corpo de formulário.
function auditar(evento, req, extra = {}) {
  console.log(
    "[audit] " +
      JSON.stringify({
        t: new Date().toISOString(),
        evento,
        ip: req && req.ip,
        usuario: req && req.sessao ? req.sessao.id : undefined,
        rota: req && req.method ? `${req.method} ${req.path}` : undefined,
        ...extra,
      })
  );
}

module.exports = { cabecalhos, csrf, exigirTokenMultipart, flash, limitar, auditar, hmac, iguais };
