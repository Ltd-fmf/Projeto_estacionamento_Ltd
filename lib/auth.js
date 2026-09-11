"use strict";

// Autenticação PRÓPRIA do estacionamento (11/09/2026).
//
// A primeira versão web usava o SSO REVEMAR (cookie rvmr_sso do `accounts`).
// Requisito do projeto: sistema isolado, com senha de acesso própria. Então
// aqui tem login e senha próprios, tabela `usuario` no banco próprio, e
// nenhuma leitura do schema `identity`.
//
// Três decisões que importam:
//
// 1. Senha com PBKDF2-HMAC-SHA512 do `node:crypto` — nada de dependência nova
//    (bcrypt/argon2 exigem compilação nativa, e a VPS não tem toolchain
//    garantida). Salt por usuário, comparação em tempo constante.
// 2. Sessão sem tabela: um JWT HS256 assinado com SESSION_SECRET, guardado em
//    cookie. Mas NÃO é "confie no cookie e pronto" — a cada request se
//    rechecam `ativo` e `sessao_versao` no banco, então desativar alguém ou
//    trocar a senha derruba as sessões abertas.
// 3. Cookie com `path` = BASE_PATH (/estacionamento). O navegador só manda o
//    cookie para este caminho: ele nunca chega em /prisma, /codex,
//    /bayer-evolution ou no accounts. É o isolamento valendo no transporte,
//    não só no código.

const crypto = require("node:crypto");
const { assinar, verificar } = require("./jwtHs256");
const { pool } = require("../db/pool");

const BASE_PATH = process.env.BASE_PATH || "/estacionamento";
const NOME_COOKIE = "estac_sess";
const DURACAO_S = 12 * 60 * 60; // 12h: o uso é no expediente, do balcão/portaria.

// PBKDF2 sha512 com 210 mil iterações — recomendação atual do OWASP para
// sha512. Custa ~100ms por login, o que é o objetivo (encarece ataque offline).
const ITERACOES = 210_000;
const TAM_SALT = 16;
const TAM_HASH = 32;

// Freio de força bruta, em memória: 5 tentativas erradas por (IP + login)
// bloqueiam por 5 minutos. Some no restart, e isso é aceitável — serve contra
// script tentando senha em sequência, não contra ataque distribuído.
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60_000;
const tentativas = new Map(); // chave -> { n, ate }

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) {
    throw new Error("SESSION_SECRET ausente ou curto demais (mínimo 24 chars) — ver .env.example");
  }
  return s;
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(TAM_SALT);
  const hash = crypto.pbkdf2Sync(String(senha), salt, ITERACOES, TAM_HASH, "sha512");
  return `pbkdf2$sha512$${ITERACOES}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function conferirSenha(senha, armazenado) {
  const partes = String(armazenado || "").split("$");
  if (partes.length !== 5 || partes[0] !== "pbkdf2") return false;
  const [, algo, iter, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, "base64");
  let calculado;
  try {
    calculado = crypto.pbkdf2Sync(String(senha), Buffer.from(saltB64, "base64"), Number(iter), esperado.length, algo);
  } catch {
    return false;
  }
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

function lerCookie(headerCookie, nome = NOME_COOKIE) {
  if (!headerCookie) return null;
  for (const parte of String(headerCookie).split(";")) {
    const i = parte.indexOf("=");
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function opcoesCookie() {
  return {
    httpOnly: true,
    // Atrás do nginx com TLS; em desenvolvimento (http local) o cookie
    // `secure` não seria aceito pelo navegador, daí o escape por NODE_ENV.
    secure: process.env.NODE_ENV !== "desenvolvimento",
    sameSite: "lax",
    path: BASE_PATH,
    maxAge: DURACAO_S * 1000,
  };
}

function chaveFreio(req, login) {
  return `${req.ip || "?"}|${String(login || "").toLowerCase()}`;
}

function bloqueado(req, login) {
  const reg = tentativas.get(chaveFreio(req, login));
  if (!reg) return 0;
  if (Date.now() > reg.ate) {
    tentativas.delete(chaveFreio(req, login));
    return 0;
  }
  return reg.n >= MAX_TENTATIVAS ? Math.ceil((reg.ate - Date.now()) / 60_000) : 0;
}

function registrarFalha(req, login) {
  const chave = chaveFreio(req, login);
  const reg = tentativas.get(chave) || { n: 0, ate: 0 };
  reg.n += 1;
  reg.ate = Date.now() + BLOQUEIO_MS;
  tentativas.set(chave, reg);
}

function limparFalhas(req, login) {
  tentativas.delete(chaveFreio(req, login));
}

// Login de verdade: confere senha, atualiza último acesso e devolve a sessão.
// Mensagem de erro é sempre a mesma (login OU senha), para não revelar quais
// logins existem.
async function autenticar(login, senha) {
  const r = await pool.query(
    `SELECT id, login, nome, papel, senha_hash, ativo, sessao_versao
       FROM usuario WHERE lower(login) = lower($1)`,
    [String(login || "").trim()]
  );
  const u = r.rows[0];
  // Sem usuário: ainda assim gasta o tempo de um PBKDF2 contra um hash
  // descartável, para o tempo de resposta não dizer se o login existe.
  if (!u) {
    conferirSenha(senha, hashSenha("nao-existe"));
    return null;
  }
  if (!u.ativo || !conferirSenha(senha, u.senha_hash)) return null;
  await pool.query(`UPDATE usuario SET ultimo_acesso = now() WHERE id = $1`, [u.id]);
  return { id: u.id, login: u.login, nome: u.nome, papel: u.papel, sv: u.sessao_versao };
}

function emitirSessao(res, sessao) {
  const token = assinar(
    { sub: String(sessao.id), login: sessao.login, nome: sessao.nome, papel: sessao.papel, sv: sessao.sv },
    segredo(),
    DURACAO_S
  );
  res.cookie(NOME_COOKIE, token, opcoesCookie());
}

function encerrarSessao(res) {
  res.clearCookie(NOME_COOKIE, { path: BASE_PATH });
}

// Verifica o cookie e recheca o usuário no banco. Retorna a sessão ou null.
async function sessaoDe(req) {
  const token = lerCookie(req.headers.cookie);
  if (!token) return null;
  const p = verificar(token, segredo());
  if (!p || !p.sub) return null;
  const r = await pool.query(
    `SELECT id, login, nome, papel, ativo, sessao_versao FROM usuario WHERE id = $1`,
    [p.sub]
  );
  const u = r.rows[0];
  if (!u || !u.ativo || u.sessao_versao !== p.sv) return null;
  return { id: u.id, login: u.login, nome: u.nome, papel: u.papel, sv: u.sessao_versao };
}

// Middleware: sem sessão válida vai para a tela de login, guardando para onde
// a pessoa queria ir.
async function requireAuth(req, res, next) {
  try {
    const sessao = await sessaoDe(req);
    if (!sessao) {
      const proximo = req.originalUrl || `${BASE_PATH}/`;
      if (req.accepts(["html", "json"]) === "json") {
        return res.status(401).json({ erro: "sessão expirada" });
      }
      return res.redirect(`${BASE_PATH}/login?proximo=${encodeURIComponent(proximo)}`);
    }
    req.sessao = sessao;
    next();
  } catch (e) {
    next(e);
  }
}

// Escrita (inserir/editar/excluir) só para papel admin.
function requireAdmin(req, res, next) {
  if (req.sessao && req.sessao.papel === "admin") return next();
  if (req.accepts(["html", "json"]) === "json") {
    return res.status(403).json({ erro: "somente administrador" });
  }
  return res
    .status(403)
    .type("html")
    .send(`<p>Seu acesso é somente de consulta.</p><p><a href="${BASE_PATH}/">Voltar</a></p>`);
}

module.exports = {
  BASE_PATH,
  NOME_COOKIE,
  DURACAO_S,
  hashSenha,
  conferirSenha,
  autenticar,
  emitirSessao,
  encerrarSessao,
  sessaoDe,
  requireAuth,
  requireAdmin,
  bloqueado,
  registrarFalha,
  limparFalhas,
};
