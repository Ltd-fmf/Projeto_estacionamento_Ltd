// Testes de segurança de ponta a ponta contra um servidor LOCAL já rodando.
//   node --env-file=.env scripts/teste-seguranca.mjs
// Cria usuários de teste direto no banco (prefixo "t_sec_") e apaga no fim.
// Nunca aponte para produção: ele tenta forçar bloqueios de login de propósito.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { pool } = require("../db/pool");
const { hashSenha } = require("../lib/auth");

const HOST = process.env.TESTE_HOST || "http://127.0.0.1:3007";
const BASE = HOST + (process.env.BASE_PATH || "/estacionamento");
if (!/127\.0\.0\.1|localhost/.test(HOST)) {
  console.error("Recusado: este teste só roda contra localhost.");
  process.exit(2);
}

let falhas = 0;
const ok = (cond, msg) => {
  console.log((cond ? "OK    " : "FALHA ") + msg);
  if (!cond) falhas++;
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// "Navegador" mínimo com jarra de cookies, Origin e token CSRF.
function navegador(ipReal) {
  const cookies = new Map();
  const guardar = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      const k = par.slice(0, i), v = par.slice(i + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) || v === "") cookies.delete(k);
      else cookies.set(k, v);
    }
  };
  const cab = (extra = {}) => ({
    cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    ...(ipReal ? { "x-forwarded-for": `${Math.random().toString(36).slice(2)}, ${ipReal}` } : {}),
    ...extra,
  });
  const nav = {
    cookies,
    async get(caminho, extra) {
      const r = await fetch(BASE + caminho, { redirect: "manual", headers: cab(extra) });
      guardar(r);
      return { status: r.status, texto: await r.text(), headers: r.headers, location: r.headers.get("location") };
    },
    async token(caminho) {
      const { texto } = await nav.get(caminho);
      return (texto.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    },
    async post(caminho, campos, { origem = HOST, csrf = null, multipart = false } = {}) {
      const dados = { ...campos };
      if (csrf) dados._csrf = csrf;
      let corpo, tipo = {};
      if (multipart) {
        corpo = new FormData();
        for (const [k, v] of Object.entries(dados)) corpo.append(k, v);
      } else {
        corpo = new URLSearchParams(dados);
      }
      const headers = cab({ ...(origem ? { origin: origem } : {}), ...tipo });
      const r = await fetch(BASE + caminho, { method: "POST", body: corpo, redirect: "manual", headers });
      guardar(r);
      return { status: r.status, texto: await r.text(), location: r.headers.get("location") };
    },
    async entrar(login, senha) {
      const t = await nav.token("/login");
      return nav.post("/login", { login, senha }, { csrf: t });
    },
  };
  return nav;
}

// ------------------------------------------------------------- preparação
const sufixo = Date.now().toString(36);
const U = {
  adm: `t_sec_adm_${sufixo}`,
  mem: `t_sec_mem_${sufixo}`,
  pend: `t_sec_pen_${sufixo}`,
};
const SENHA = "Zq!7vMr2-teste";
const criados = [];
async function criar(login, papel, status) {
  const r = await pool.query(
    `INSERT INTO usuario (login, nome, papel, senha_hash, status, setor, foto_perfil)
     VALUES ($1, $2, $3, $4, $5, 'TI', $6) RETURNING id`,
    [login, `Teste ${login}`, papel, hashSenha(SENHA), status, status === "pendente" ? null : "x.webp"]
  );
  criados.push(r.rows[0].id);
  return r.rows[0].id;
}
const idAdm = await criar(U.adm, "admin", "aprovado");
const idMem = await criar(U.mem, "membro", "aprovado");
const idPend = await criar(U.pend, "membro", "pendente");
await pool.query(`UPDATE usuario SET foto_perfil_pendente = 'pend.webp' WHERE id = $1`, [idPend]);

try {
  // 1. cabeçalhos
  {
    const n = navegador();
    const r = await n.get("/login");
    const h = r.headers;
    ok(!h.get("x-powered-by"), "sem X-Powered-By");
    ok(/default-src 'self'/.test(h.get("content-security-policy") || ""), "CSP presente");
    ok(h.get("x-content-type-options") === "nosniff", "nosniff");
    ok(h.get("x-frame-options") === "DENY", "X-Frame-Options DENY");
    ok(/no-store/.test(h.get("cache-control") || ""), "Cache-Control no-store nas páginas");
    ok(!/<script[^>]*>[^<]/.test(r.texto.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), "nenhum script inline");
  }

  // 2. CSRF
  {
    const n = navegador();
    const t = await n.token("/login");
    ok(!!t, "formulário traz token CSRF");
    let r = await n.post("/login", { login: U.mem, senha: SENHA }, { csrf: t, origem: null });
    ok(r.status === 403, `POST sem Origin/Referer → 403 (${r.status})`);
    r = await n.post("/login", { login: U.mem, senha: SENHA }, { csrf: t, origem: "https://site-malicioso.example" });
    ok(r.status === 403, `POST com Origin de outro site → 403 (${r.status})`);
    r = await n.post("/login", { login: U.mem, senha: SENHA }, { csrf: null });
    ok(r.status === 403, `POST sem token → 403 (${r.status})`);
    r = await n.post("/login", { login: U.mem, senha: SENHA }, { csrf: "token-errado-123" });
    ok(r.status === 403, `POST com token errado → 403 (${r.status})`);
    r = await n.post("/login", { login: U.mem, senha: SENHA }, { csrf: t });
    ok(r.status === 302, `POST legítimo → 302 (${r.status})`);
  }

  // 3. IP forjado não escapa do freio
  {
    const alvo = `t_sec_naoexiste_${sufixo}`;
    const n = navegador("9.9.9.9"); // o app deve enxergar sempre 9.9.9.9
    let ultimo;
    for (let i = 0; i < 7; i++) {
      const t = await n.token("/login");
      ultimo = await n.post("/login", { login: alvo, senha: "errada-" + i }, { csrf: t });
    }
    ok(/Muitas tentativas/.test(ultimo.texto), "XFF forjado variando à esquerda não burla o freio de login");
  }

  // 4. senha enorme
  {
    const n = navegador("8.8.8.8");
    const t = await n.token("/login");
    const r = await n.post("/login", { login: U.mem, senha: "a".repeat(5000) }, { csrf: t });
    ok(r.status === 200 && /inválidos/.test(r.texto), "senha de 5000 caracteres é recusada sem processar");
  }

  // 5. foto de perfil de usuário pendente
  {
    const m = navegador("7.7.7.1");
    await m.entrar(U.mem, SENHA);
    let r = await m.get(`/perfil/${idPend}/foto`);
    ok(r.status === 404, `membro NÃO vê foto de usuário pendente (${r.status})`);
    r = await m.get(`/perfil/${idPend}`);
    ok(r.status === 404, `membro NÃO vê perfil de usuário pendente (${r.status})`);
    r = await m.get(`/perfil/${idAdm}/foto`);
    ok(r.status === 404 || r.status === 200, "foto de aprovado não é bloqueada por filtro de status");
    r = await m.get(`/admin/pendencias`);
    ok(r.status === 403, `membro não acessa a fila do admin (${r.status})`);
  }

  // 6. mensagens de uso único (nada de ?msg= refletido)
  {
    const m = navegador("7.7.7.2");
    await m.entrar(U.mem, SENHA);
    const r = await m.get(`/perfil/${idMem}?msg=PAGUE-AGORA-NO-PIX-9999`);
    ok(!r.texto.includes("PAGUE-AGORA-NO-PIX-9999"), "?msg= vindo da URL não aparece na página");
  }

  // 7. logout invalida o token copiado
  {
    const m = navegador("7.7.7.3");
    await m.entrar(U.mem, SENHA);
    const copia = new Map(m.cookies);
    const t = await m.token(`/perfil/${idMem}`);
    await m.post("/sair", {}, { csrf: t });
    const velho = navegador("7.7.7.3");
    for (const [k, v] of copia) velho.cookies.set(k, v);
    const r = await velho.get(`/perfil/${idMem}`);
    ok(r.status === 302 && /login/.test(r.location || ""), "token copiado antes do logout deixa de valer");
  }

  // 8. cadastro público
  {
    const n = navegador("6.6.6.6");
    const pag = await n.get("/cadastro");
    const t = (pag.texto.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const carimbo = (pag.texto.match(/name="_t" value="([^"]+)"/) || [])[1];
    const base = (login) => ({
      nome: "Fulano de Tal Teste", login, setor: "RH", ramal: "1", whatsapp: "(92) 99999-9999",
      senha: "Zq!7vMr2-ok", senha2: "Zq!7vMr2-ok", consentimento: "1", _t: carimbo || "",
    });
    let r = await n.post("/cadastro", base(`t_sec_c1_${sufixo}`), { csrf: t, multipart: true });
    ok(r.status === 400 && /confira os dados/.test(r.texto), "cadastro rápido demais (< 4 s) é recusado");
    await espera(4500);
    r = await n.post("/cadastro", { ...base(`t_sec_c2_${sufixo}`), senha: "a".repeat(129), senha2: "a".repeat(129) }, { csrf: t, multipart: true });
    ok(r.status === 400, `senha com 129 caracteres recusada (${r.status})`);
    r = await n.post("/cadastro", { ...base(`t_sec_c3_${sufixo}`), senha: "12345678", senha2: "12345678" }, { csrf: t, multipart: true });
    ok(r.status === 400 && /menos óbvia/.test(r.texto), "senha fraca recusada");
    r = await n.post("/cadastro", { ...base(`t_sec_c4_${sufixo}`), site: "http://spam" }, { csrf: t, multipart: true });
    const n4 = await pool.query(`SELECT 1 FROM usuario WHERE login = $1`, [`t_sec_c4_${sufixo}`]);
    ok(r.status === 200 && n4.rowCount === 0, "campo-isca preenchido: finge sucesso e não grava");
    // corrida: duas requisições simultâneas com o mesmo usuário
    const login = `t_sec_corrida_${sufixo}`;
    const [a, b] = await Promise.all([
      n.post("/cadastro", base(login), { csrf: t, multipart: true }),
      n.post("/cadastro", base(login), { csrf: t, multipart: true }),
    ]);
    ok(a.status !== 500 && b.status !== 500, `cadastro em corrida não gera 500 (${a.status}/${b.status})`);
  }
} finally {
  await pool.query(`DELETE FROM usuario WHERE id = ANY($1) OR login LIKE 't\\_sec\\_%' ESCAPE '\\'`, [criados]);
  await pool.end();
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes de segurança passaram.");
process.exit(falhas ? 1 : 0);
