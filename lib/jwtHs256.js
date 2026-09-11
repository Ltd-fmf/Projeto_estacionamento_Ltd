"use strict";

// JWT HS256 mínimo com `node:crypto` — sem dependência externa, para assinar o
// cookie de sessão deste app sem arrastar `jsonwebtoken`.
//
// É um utilitário puro (assina e verifica com o segredo que recebe): não sabe
// nada de SSO. O segredo usado aqui é o SESSION_SECRET próprio do
// estacionamento, nunca o do accounts — ver lib/auth.js.

const crypto = require("node:crypto");

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function assinar(payloadObj, segredo, expiresInSec) {
  const agora = Math.floor(Date.now() / 1000);
  const payload = { ...payloadObj, iat: agora, exp: agora + expiresInSec };
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const dados = `${head}.${body}`;
  const sig = b64url(crypto.createHmac("sha256", segredo).update(dados).digest());
  return `${dados}.${sig}`;
}

// Retorna o payload se a assinatura e a expiração conferem; null caso contrário.
function verificar(token, segredo) {
  if (typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [head, body, sig] = partes;
  const esperado = crypto.createHmac("sha256", segredo).update(`${head}.${body}`).digest();
  let recebido;
  try {
    recebido = fromB64url(sig);
  } catch {
    return null;
  }
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) >= payload.exp) {
    return null;
  }
  return payload;
}

module.exports = { assinar, verificar };
