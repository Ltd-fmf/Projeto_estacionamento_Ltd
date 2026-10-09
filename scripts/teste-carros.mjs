// Testes do cadastro de carro com 5 fotos, contra servidor LOCAL.
//   node --env-file=.env scripts/teste-carros.mjs

// Cria usuários t_car_* e placas TST* no banco e apaga no fim.

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
        for (const [k, v] of Object.entries(dados)) v instanceof Blob ? corpo.append(k, v, k + ".jpg") : corpo.append(k, v);
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

import sharp from "sharp";
const jpg = async (cor) =>
  new Blob([await sharp({ create: { width: 800, height: 500, channels: 3, background: cor } }).jpeg().toBuffer()], { type: "image/jpeg" });

const sufixo = Date.now().toString(36);
const SENHA = "Zq!7vMr2-teste";
const criados = [];
async function criar(login, papel) {
  const r = await pool.query(
    `INSERT INTO usuario (login, nome, papel, senha_hash, status, setor, foto_perfil)
     VALUES ($1, $2, $3, $4, 'aprovado', 'TI', 'x.webp') RETURNING id`,
    [login, `Teste ${login}`, papel, hashSenha(SENHA)]
  );
  criados.push(r.rows[0].id);
  return r.rows[0].id;
}
const L = { adm: `t_car_adm_${sufixo}`, a: `t_car_a_${sufixo}`, b: `t_car_b_${sufixo}` };
await criar(L.adm, "admin");
const idA = await criar(L.a, "membro");
await criar(L.b, "membro");
const nova = () => "TST" + (1000 + Math.floor(Math.random() * 8999));
const placa = nova();

async function entrar(login) {
  const n = navegador();
  const r = await n.entrar(login, SENHA);
  if (r.status !== 302) throw new Error("login falhou " + login + " " + r.status);
  return n;
}

try {
  const adm = await entrar(L.adm), a = await entrar(L.a), b = await entrar(L.b);

  const form = await a.get("/carros/novo");
  ok(form.status === 200 && ["placa", "frente", "traseira", "lateral_esq", "lateral_dir"].every((t) => form.texto.includes(`name="foto_${t}"`)), "formulário com os 5 blocos");

  let t = await a.token("/carros/novo");
  let r = await a.post("/carros", { placa, modelo: "Onix", foto_frente: await jpg("red") }, { csrf: t, multipart: true });
  ok(r.status === 400, "sem foto da placa -> 400 (veio " + r.status + ")");

  t = await a.token("/carros/novo");
  r = await a.post("/carros", { placa: "XX", modelo: "Onix", foto_placa: await jpg("white") }, { csrf: t, multipart: true });
  ok(r.status === 400, "placa inválida -> 400 (veio " + r.status + ")");

  t = await a.token("/carros/novo");
  r = await a.post("/carros", { placa, placa_lida: placa, modelo: "Onix", cor: "Prata",
    foto_placa: await jpg("white"), foto_frente: await jpg("red"), foto_traseira: await jpg("blue") }, { csrf: t, multipart: true });
  ok(r.status === 302, "membro cadastra carro (veio " + r.status + ")");
  const v = (await pool.query("SELECT id,status,placa_origem FROM veiculo WHERE placa=$1", [placa])).rows[0];
  ok(v && v.status === "pendente" && v.placa_origem === "foto", "carro pendente, origem=foto");
  const fs = (await pool.query("SELECT tipo,arquivo,arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1", [v.id])).rows;
  ok(fs.length === 3 && fs.every((f) => !f.arquivo && f.arquivo_pendente), "3 fotos gravadas como pendentes");

  t = await a.token("/carros/novo");
  r = await a.post("/carros", { placa, modelo: "Onix", foto_placa: await jpg("white") }, { csrf: t, multipart: true });
  ok(r.status === 400 || r.status === 409, "placa repetida do mesmo usuário recusada (veio " + r.status + ")");

  r = await b.get(`/carros/${v.id}/foto?tipo=frente&pendente=1`);
  ok(r.status === 403 || r.status === 404, "foto pendente invisível a outro membro (" + r.status + ")");
  r = await b.get(`/carros/${v.id}/foto?tipo=frente`);
  ok(r.status === 403 || r.status === 404, "foto não aprovada invisível a outro membro (" + r.status + ")");
  r = await a.get(`/carros/${v.id}/foto?tipo=frente&pendente=1`);
  ok(r.status === 200, "dono vê a própria foto pendente");

  r = await adm.get("/admin/pendencias");
  ok(r.status === 200 && r.texto.includes(placa), "admin vê o carro na fila");

  t = await b.token("/carros/novo");
  r = await b.post(`/admin/carro/${v.id}/aprovar`, {}, { csrf: t });
  const aindaPend = (await pool.query("SELECT status FROM veiculo WHERE id=$1", [v.id])).rows[0].status;
  ok(aindaPend === "pendente", "membro não consegue aprovar (" + r.status + ")");

  t = await adm.token("/admin/pendencias");
  r = await adm.post(`/admin/carro/${v.id}/aprovar`, {}, { csrf: t });
  ok(r.status === 302, "admin aprova (" + r.status + ")");
  const ap = (await pool.query("SELECT status FROM veiculo WHERE id=$1", [v.id])).rows[0];
  const fp = (await pool.query("SELECT arquivo,arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1", [v.id])).rows;
  ok(ap.status === "aprovado" && fp.every((f) => f.arquivo && !f.arquivo_pendente), "carro aprovado e fotos promovidas");
  r = await b.get(`/carros/${v.id}/foto?tipo=frente`);
  ok(r.status === 200, "outro membro vê foto aprovada");
  r = await b.get(`/carros/${v.id}`);
  ok(r.status === 200 && r.texto.includes(placa), "página de detalhe abre");

  t = await a.token(`/carros/${v.id}/editar`);
  r = await a.post(`/carros/${v.id}`, { placa, modelo: "Onix", cor: "Prata", foto_frente: await jpg("green") }, { csrf: t, multipart: true });
  ok(r.status === 302, "dono troca a foto da frente (" + r.status + ")");
  const tr = (await pool.query("SELECT arquivo,arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1 AND tipo='frente'", [v.id])).rows[0];
  ok(tr.arquivo && tr.arquivo_pendente, "frente: antiga aprovada + nova pendente");
  const st = (await pool.query("SELECT status FROM veiculo WHERE id=$1", [v.id])).rows[0].status;
  ok(st === "aprovado", "trocar só a frente não derruba a aprovação");
  r = await adm.get("/admin/pendencias");
  ok(r.texto.includes(`/admin/foto-carro/${v.id}/frente/aprovar`), "fila mostra a nova foto da frente");
  t = await adm.token("/admin/pendencias");
  r = await adm.post(`/admin/foto-carro/${v.id}/frente/aprovar`, {}, { csrf: t });
  const tr2 = (await pool.query("SELECT arquivo,arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1 AND tipo='frente'", [v.id])).rows[0];
  ok(r.status === 302 && tr2.arquivo && !tr2.arquivo_pendente, "admin aprova a nova frente");

  t = await a.token(`/carros/${v.id}/editar`);
  r = await a.post(`/carros/${v.id}`, { placa: nova(), modelo: "Onix", cor: "Prata" }, { csrf: t, multipart: true });
  const st2 = (await pool.query("SELECT status FROM veiculo WHERE id=$1", [v.id])).rows[0];
  ok(st2.status === "pendente", "trocar a placa volta a pendente (" + st2.status + ")");

  const placa3 = nova();
  const antiga = (await pool.query("INSERT INTO veiculo (placa, nome, setor) VALUES ($1,'Fulano antigo','Vendas') RETURNING id", [placa3])).rows[0].id;
  t = await a.token("/carros/novo");
  await a.post("/carros", { placa: placa3, modelo: "Gol", foto_placa: await jpg("white") }, { csrf: t, multipart: true });
  const novo = (await pool.query("SELECT id,placa_origem FROM veiculo WHERE placa=$1 AND usuario_id=$2", [placa3, idA])).rows[0];
  ok(novo && novo.placa_origem === "manual", "sem placa_lida -> origem manual");
  r = await adm.get("/admin/pendencias");
  ok(r.texto.includes("Fulano antigo"), "fila oferece absorver a ficha antiga");
  t = await adm.token("/admin/pendencias");
  await adm.post(`/admin/carro/${novo.id}/aprovar`, { absorver: antiga }, { csrf: t });
  const sobrou = (await pool.query("SELECT 1 FROM veiculo WHERE id=$1", [antiga])).rowCount;
  ok(sobrou === 0, "ficha antiga absorvida e apagada");

  t = await a.token("/carros/novo");
  const lixo = new Blob(["isto nao e imagem"], { type: "image/jpeg" });
  r = await a.post("/carros", { placa: nova(), modelo: "X", foto_placa: lixo }, { csrf: t, multipart: true });
  ok(r.status === 400, "arquivo que não é imagem -> 400 (veio " + r.status + ")");
} catch (e) {
  console.log("ERRO no teste:", e);
  falhas++;
} finally {
  await pool.query("DELETE FROM veiculo WHERE placa LIKE 'TST%' OR usuario_id = ANY($1)", [criados]);
  await pool.query("DELETE FROM aprovacao_log WHERE ator_id = ANY($1)", [criados]).catch(() => {});
  await pool.query("DELETE FROM usuario WHERE id = ANY($1)", [criados]).catch((e) => console.log("limpeza usuario:", e.message));
  await pool.end();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
