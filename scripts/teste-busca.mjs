// Testes da home de busca, das fichas antigas, das miniaturas e do cache,
// contra servidor LOCAL.   node --env-file=.env scripts/teste-busca.mjs

import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
const require = createRequire(import.meta.url);
const { pool } = require("../db/pool");
const { hashSenha } = require("../lib/auth");
const { casar } = require("../lib/busca");
const { DIR_FOTOS } = require("../lib/fotos");

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
    cookieHeader() { return [...cookies].map(([k, v]) => `${k}=${v}`).join("; "); },
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


// ----------------------------------------------------------- lógica pura
{
  const banco = ["TRZ5E22", "ABC1D23", "QWE4R56", "TRZ5E27"];
  ok(casar(["TRZ5E22"], banco).exatas[0] === "TRZ5E22", "casar: exata");
  const t1 = casar(["TRZ5E2Z"], ["TRZ5E22", "ABC1D23"]);
  ok(!t1.exatas.length && t1.sugestoes[0]?.placa === "TRZ5E22", "casar: Z lido no lugar de 2 sugere a placa certa");
  const t2 = casar(["TRZ6E22"], ["TRZ5E22"]);
  ok(t2.sugestoes[0]?.placa === "TRZ5E22", "casar: um caractere errado qualquer ainda sugere");
  ok(casar(["ZZZ9Z99"], banco).sugestoes.length === 0, "casar: placa sem parecida -> nada");
  const t3 = casar(["TRZ5E2"], ["TRZ5E22"]);
  ok(t3.sugestoes[0]?.placa === "TRZ5E22", "casar: caractere faltando sugere");
  const t4 = casar(["TRZ5E2Z", "TRZ5E22"], banco);
  ok(t4.exatas[0] === "TRZ5E22", "casar: uma das leituras exata basta");
  ok(casar(["TR"], banco).sugestoes.length === 0, "casar: leitura curta demais é ignorada");
}

const sufixo = Date.now().toString(36);
const SENHA = "Zq!7vMr2-teste";
const criados = [];
const arquivos = [];
async function criar(login, papel, extra = {}) {
  const r = await pool.query(
    `INSERT INTO usuario (login, nome, papel, senha_hash, status, setor, ramal, whatsapp)
     VALUES ($1, $2, $3, $4, 'aprovado', $5, $6, $7) RETURNING id`,
    [login, extra.nome || `Teste ${login}`, papel, hashSenha(SENHA), extra.setor || "TI", extra.ramal || null, extra.whatsapp || null]
  );
  criados.push(r.rows[0].id);
  return r.rows[0].id;
}
const L = { adm: `t_bus_adm_${sufixo}`, a: `t_bus_a_${sufixo}`, b: `t_bus_b_${sufixo}` };
await criar(L.adm, "admin");
const idA = await criar(L.a, "membro", { nome: "Maria Buscada", setor: "Financeiro", ramal: "4455", whatsapp: "5592999990000" });
const idB = await criar(L.b, "membro", { nome: "Bruno Pendente" });
const PLACA = "TST1204", PLACA_PEND = "TST7788", PLACA_FICHA = "TST9911", PLACA_DUP = "TST3322";

async function entrar(login) {
  const n = navegador();
  const r = await n.entrar(login, SENHA);
  if (r.status !== 302) throw new Error("login falhou " + login + " " + r.status);
  return n;
}

try {
  const carroA = (await pool.query(`INSERT INTO veiculo (placa, modelo, cor, status, usuario_id) VALUES ($1,'Onix','Prata','aprovado',$2) RETURNING id`, [PLACA, idA])).rows[0].id;
  await pool.query(`INSERT INTO veiculo (placa, modelo, status, usuario_id) VALUES ($1,'Gol','pendente',$2)`, [PLACA_PEND, idB]);
  const ficha = (await pool.query(`INSERT INTO veiculo (placa, nome, setor, ramal, modelo, status) VALUES ($1,'Joao Ficha Antiga','Compras','1234','Palio','aprovado') RETURNING id`, [PLACA_FICHA])).rows[0].id;
  await pool.query(`INSERT INTO veiculo (placa, nome, setor, status) VALUES ($1,'Dono Um','Vendas','aprovado'), ($1,'Dono Dois','Logistica','aprovado')`, [PLACA_DUP]);

  // foto grande de verdade para testar a miniatura
  const nomeFoto = `tst-${sufixo}.webp`;
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#789" } }).webp().toFile(join(DIR_FOTOS, nomeFoto));
  arquivos.push(nomeFoto, `tst-${sufixo}-m.webp`);
  await pool.query(`INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo) VALUES ($1,'frente',$2)`, [carroA, nomeFoto]);

  const anon = navegador();
  let r = await anon.get("/");
  ok(r.status === 302 && /login/.test(r.location), "home exige login");
  r = await anon.get("/buscar?q=" + PLACA);
  ok(r.status === 302, "busca exige login");

  const adm = await entrar(L.adm), b = await entrar(L.b), a = await entrar(L.a);

  r = await b.get("/");
  ok(r.status === 200 && r.texto.includes("data-abrir-camera") && r.texto.includes('name="q"'), "home: botão da câmera + campo de busca");
  ok(!/veiculos\//.test(r.texto), "home: sem resquício da tela legada");
  ok(/estilo\.css\?v=\d+/.test(r.texto) && /camera\.js\?v=\d+/.test(r.texto), "assets versionados (?v=)");
  ok(r.headers.get("cache-control")?.includes("no-store"), "home: no-store");

  r = await b.get("/buscar?q=" + PLACA);
  ok(r.status === 200 && r.texto.includes("Maria Buscada") && r.texto.includes("Financeiro") && r.texto.includes("4455"), "placa exata -> dono, setor e ramal");
  ok(r.texto.includes("https://wa.me/5592999990000"), "botão WhatsApp do dono");
  ok(r.texto.includes(`/carros/${carroA}/foto?m=1`), "resultado usa miniatura do carro");

  r = await b.get("/buscar?q=tst-1204");
  ok(r.texto.includes("Maria Buscada"), "placa com hífen/minúscula também acha");

  r = await b.get("/buscar?origem=camera&placas=TST12O4,TST1ZO4");
  ok(r.status === 200 && r.texto.includes(`buscar?q=${PLACA}`) && !r.texto.includes("Maria Buscada</h3>"), "leitura do OCR com erro -> sugere a placa certa para confirmar");

  r = await b.get("/buscar?origem=camera&placas=XXXX,TST1204");
  ok(r.texto.includes("Maria Buscada"), "várias leituras: a exata resolve direto");

  r = await b.get("/buscar?q=" + PLACA_PEND);
  ok(!r.texto.includes("Bruno Pendente") && r.texto.includes("Não achei"), "carro pendente não aparece para colega");

  r = await b.get("/buscar?q=" + PLACA_FICHA);
  ok(r.texto.includes("Joao Ficha Antiga") && r.texto.includes("ficha antiga"), "ficha antiga é achada pela placa");

  r = await b.get("/buscar?q=" + PLACA_DUP);
  ok(r.texto.includes("Dono Um") && r.texto.includes("Dono Dois"), "placa com dois donos mostra os dois");

  r = await b.get("/buscar?q=Maria%20Busc");
  ok(r.texto.includes("Maria Buscada"), "busca por nome");
  r = await b.get("/buscar?q=4455");
  ok(r.texto.includes("Maria Buscada"), "busca por ramal");
  r = await b.get("/buscar?q=%25");
  ok(r.status === 200 && !r.texto.includes("Maria Buscada"), "curinga % é literal (não lista todo mundo)");
  r = await b.get("/buscar?q=%3Cscript%3Ealert(1)%3C/script%3E");
  ok(!r.texto.includes("<script>alert"), "busca escapa HTML");

  r = await b.get("/pessoas?q=Maria");
  ok(r.status === 200 && r.texto.includes("Maria Buscada") && !r.texto.includes("Bruno Pendente"), "/pessoas filtra");

  // legado fora
  for (const caminho of ["/veiculos/1", `/veiculos/${ficha}/ver`, `/veiculos/${ficha}/foto`]) {
    r = await adm.get(caminho);
    ok(r.status === 404, `${caminho} -> 404 (veio ${r.status})`);
  }

  // fichas antigas (admin)
  r = await b.get("/admin/fichas");
  ok(r.status === 403, "/admin/fichas bloqueado para membro (veio " + r.status + ")");
  r = await adm.get("/admin/fichas?q=Ficha%20Antiga");
  ok(r.status === 200 && r.texto.includes("Joao Ficha Antiga") && r.texto.includes(`/admin/fichas/${ficha}`), "/admin/fichas lista e filtra");
  r = await adm.get(`/admin/fichas/${carroA}`);
  ok(r.status === 404, "carro de quem tem conta não é editável por aqui");
  let t = await adm.token(`/admin/fichas/${ficha}`);
  r = await adm.post(`/admin/fichas/${ficha}`, { placa: "tst 9911", nome: "Joao Editado", setor: "Compras", ramal: "9999", modelo: "Palio", cor: "Azul" }, { csrf: t });
  ok(r.status === 302, "editar ficha");
  r = await b.get("/buscar?q=" + PLACA_FICHA);
  ok(r.texto.includes("Joao Editado") && r.texto.includes("9999"), "edição aparece na busca");
  t = await adm.token(`/admin/fichas/${ficha}`);
  r = await adm.post(`/admin/fichas/${ficha}/excluir`, {}, { csrf: t });
  r = await b.get("/buscar?q=" + PLACA_FICHA);
  ok(!r.texto.includes("Joao Editado"), "ficha excluída some da busca");
  t = await adm.token("/admin/fichas");
  r = await adm.post(`/admin/fichas/${carroA}/excluir`, {}, { csrf: t });
  const seguro = (await pool.query("SELECT 1 FROM veiculo WHERE id=$1", [carroA])).rowCount;
  ok(r.status === 404 && seguro === 1, "excluir ficha não apaga carro de quem tem conta");

  // miniatura
  const orig = await fetch(`${BASE}/carros/${carroA}/foto?tipo=frente`, { headers: { cookie: b.cookieHeader() } });
  const mini = await fetch(`${BASE}/carros/${carroA}/foto?tipo=frente&m=1`, { headers: { cookie: b.cookieHeader() } });
  const bo = Buffer.from(await orig.arrayBuffer()), bm = Buffer.from(await mini.arrayBuffer());
  const meta = await sharp(bm).metadata();
  ok(orig.status === 200 && mini.status === 200 && meta.width <= 480 && bm.length < bo.length, `miniatura ${meta.width}px/${bm.length}B < original ${bo.length}B`);

  // cache dos estáticos
  const css = await fetch(`${BASE}/publico/estilo.css`);
  const ocr = await fetch(`${BASE}/publico/ocr/eng.traineddata.gz`, { method: "HEAD" });
  ok(css.headers.get("cache-control") === "no-cache", "estilo.css revalida sempre");
  ok(/immutable/.test(ocr.headers.get("cache-control") || ""), "motor do OCR com cache longo");

  // limite de taxa por usuário (por último)
  let bloqueou = false;
  for (let i = 0; i < 50 && !bloqueou; i++) bloqueou = (await a.get("/buscar?q=zzzz")).status === 429;
  ok(bloqueou, "limite de buscas por minuto");
} catch (e) {
  console.log("ERRO no teste:", e);
  falhas++;
} finally {
  await pool.query("DELETE FROM veiculo WHERE placa LIKE 'TST%' OR usuario_id = ANY($1)", [criados]);
  await pool.query("DELETE FROM usuario WHERE id = ANY($1)", [criados]).catch((e) => console.log("limpeza usuario:", e.message));
  for (const f of arquivos) {
    try {
      rmSync(join(DIR_FOTOS, f), { force: true });
    } catch (e) {
      console.log("limpeza arquivo:", f, e.code);
    }
  }
  await pool.end();
}
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
