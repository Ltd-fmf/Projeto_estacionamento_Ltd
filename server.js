"use strict";

// Estacionamento — consulta de veículos de funcionários (o antigo "Controle de
// Carros - PGEAM", que era um Tkinter desktop com SQLite local no repo
// Ltd-fmf/Projeto_estacionamento_Ltd).
//
// 11/09/2026: virou web, servido em adairbayer.com.br/estacionamento.
//
// SISTEMA ISOLADO por requisito do projeto: login e senha próprios
// (lib/auth.js), banco próprio (`estacionamento`, role própria), zero vínculo
// com o SSO do S.A.D — Bayer Evolution, PRISMA e CodeX. Mesmo desenho do NPJ,
// que divide só o domínio.
//
// Por que reescrever em vez de portar: Tkinter é interface de desktop e não
// roda em servidor headless (sem $DISPLAY). O que sobreviveu do original foi o
// modelo de dados; a interface é nova.
//
// O nginx do apex encaminha /estacionamento/ pra cá SEM strip de prefixo, então
// o app conhece o próprio BASE_PATH.

require("dotenv/config");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { pool } = require("./db/pool");
const {
  BASE_PATH,
  requireAuth,
  requireAdmin,
  autenticar,
  emitirSessao,
  encerrarSessao,
  sessaoDe,
  bloqueado,
  registrarFalha,
  limparFalhas,
} = require("./lib/auth");
const { paginaLista, paginaEdicao, paginaDetalhe, paginaLogin } = require("./lib/paginas");

const app = express();
// Atrás do nginx: sem isto, req.ip seria sempre 127.0.0.1 e o freio de
// tentativas de login misturaria todo mundo num só balde.
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));

const PORT = Number(process.env.PORT || 3007);

// As fotos ficam em disco, em `imagens/` — pasta já ignorada pelo .gitignore.
// Fora do versionamento de propósito: foto de carro de funcionário é dado
// pessoal, e assim o diretório sobrevive ao `git pull` do deploy.
const DIR_FOTOS = path.join(__dirname, "imagens");
fs.mkdirSync(DIR_FOTOS, { recursive: true });

const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

// Em memória, não em disco: o arquivo passa antes pelo sharp, e o que é gravado
// é só a versão já reduzida. O limite é de entrada — foto de celular hoje passa
// fácil de 5 MB, e o que sai daqui fica na casa das centenas de KB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, TIPOS_ACEITOS.has(file.mimetype)),
});

// Redução sem perda visível: 1600px no maior lado (mais do que isso não muda
// nada numa tela de consulta) e WebP em qualidade 82, que é onde o olho ainda
// não distingue do original. `rotate()` sem argumento aplica a orientação do
// EXIF — sem ele, foto tirada de pé no celular aparece deitada.
async function comprimir(buffer, destino) {
  await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(destino);
}

// Trocar ou apagar a foto deixa o arquivo anterior órfão em disco.
function removerArquivo(nome) {
  if (!nome) return;
  // basename: impede que um valor estranho no banco vire travessia de diretório.
  fs.rm(path.join(DIR_FOTOS, path.basename(nome)), { force: true }, () => {});
}

// Placa dos dois padrões: antigo (AAA0000) e Mercosul (AAA0A00).
const RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

function normalizarPlaca(v) {
  return String(v || "").trim().toUpperCase().replace(/[\s-]/g, "");
}

// Aviso, nunca bloqueio: o dado importado tem 16 registros sem placa e 3 fora
// de qualquer padrão (QZAJ51, PHZIE26, PHP). Barrar formato impediria de abrir
// e consertar justamente esses.
function avisoPlaca(placa) {
  if (!placa) return "Veículo salvo sem placa — preencha quando souber.";
  if (!RE_PLACA.test(placa)) return `Placa "${placa}" fora do padrão brasileiro — salva como está.`;
  return null;
}

function campos(body) {
  return {
    placa: normalizarPlaca(body.placa),
    nome: (body.nome || "").trim() || null,
    setor: (body.setor || "").trim() || null,
    ramal: (body.ramal || "").trim() || null,
    modelo: (body.modelo || "").trim() || null,
    cor: (body.cor || "").trim() || null,
  };
}

// Placas repetidas: marcadas na listagem para limpeza (o dado legado tem 31
// placas em 78 linhas). Sem UNIQUE no banco justamente para não perder dado.
async function placasDuplicadas() {
  const r = await pool.query(
    `SELECT placa FROM veiculo WHERE placa <> '' GROUP BY placa HAVING count(*) > 1`
  );
  return new Set(r.rows.map((x) => x.placa));
}

// Só aceita voltar para dentro do próprio app — `proximo` vem da query string,
// e sem esta trava viraria um open redirect para qualquer site.
function destinoSeguro(proximo) {
  const p = String(proximo || "");
  return p.startsWith(`${BASE_PATH}/`) && !p.startsWith("//") ? p : `${BASE_PATH}/`;
}

const router = express.Router();

router.get("/login", async (req, res, next) => {
  try {
    if (await sessaoDe(req)) return res.redirect(`${BASE_PATH}/`);
    res.type("html").send(paginaLogin({ proximo: String(req.query.proximo || "") }));
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const login = String(req.body.login || "").trim();
    const proximo = String(req.body.proximo || "");

    const minutos = bloqueado(req, login);
    if (minutos) {
      return res.type("html").send(
        paginaLogin({
          erro: `Muitas tentativas. Tente de novo em ${minutos} min.`,
          proximo,
          login,
        })
      );
    }

    const sessao = await autenticar(login, String(req.body.senha || ""));
    if (!sessao) {
      registrarFalha(req, login);
      // Mensagem única: não diz se foi o usuário ou a senha que errou.
      return res.type("html").send(paginaLogin({ erro: "Usuário ou senha inválidos.", proximo, login }));
    }

    limparFalhas(req, login);
    emitirSessao(res, sessao);
    res.redirect(destinoSeguro(proximo));
  } catch (e) {
    next(e);
  }
});

router.post("/sair", (_req, res) => {
  encerrarSessao(res);
  res.redirect(`${BASE_PATH}/login`);
});

router.get("/", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const params = [];
  let filtro = "";
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    filtro = `WHERE lower(placa) LIKE $1 OR lower(coalesce(nome,'')) LIKE $1
                 OR lower(coalesce(setor,'')) LIKE $1 OR lower(coalesce(ramal,'')) LIKE $1`;
  }
  const [lista, contagem, dup] = await Promise.all([
    pool.query(
      `SELECT id, placa, nome, setor, ramal, modelo, cor
         FROM veiculo ${filtro}
        ORDER BY nome NULLS LAST, placa LIMIT 500`,
      params
    ),
    pool.query(`SELECT count(*)::int AS n FROM veiculo`),
    placasDuplicadas(),
  ]);

  res.type("html").send(
    paginaLista({
      registros: lista.rows,
      q,
      sessao: req.sessao,
      total: contagem.rows[0].n,
      duplicadas: dup,
      msg: req.query.msg || "",
    })
  );
});

// A foto sai por rota própria, e não por express.static: é dado pessoal e só
// pode ser entregue a quem tem sessão. Servir a pasta abriria as imagens a
// qualquer um que descobrisse o nome do arquivo.
router.get("/veiculos/:id/foto", requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT foto FROM veiculo WHERE id = $1`, [req.params.id]);
  const nome = r.rows[0] && r.rows[0].foto;
  if (!nome) return res.status(404).send("Sem foto.");
  res.sendFile(path.join(DIR_FOTOS, path.basename(nome)));
});

router.post("/veiculos/:id/foto", requireAuth, requireAdmin, upload.single("foto"), async (req, res) => {
  const destino = `${BASE_PATH}/veiculos/${req.params.id}`;
  if (!req.file) {
    const aviso = "Envie uma imagem JPG, PNG ou WEBP de até 5 MB.";
    return res.redirect(`${destino}?msg=${encodeURIComponent(aviso)}`);
  }

  const atual = await pool.query(`SELECT foto FROM veiculo WHERE id = $1`, [req.params.id]);
  if (!atual.rows[0]) return res.status(404).send("Veículo não encontrado.");

  // Nome sorteado em vez do nome que veio do navegador: aquele não é confiável
  // (traz caminho, acento, colisão entre dois "foto.jpg") e um nome previsível
  // deixaria a foto adivinhável por quem soubesse o id. Sempre .webp porque é
  // o formato em que o sharp regrava.
  const nomeArquivo = `${req.params.id}-${crypto.randomBytes(8).toString("hex")}.webp`;
  try {
    await comprimir(req.file.buffer, path.join(DIR_FOTOS, nomeArquivo));
  } catch (e) {
    console.error("[estacionamento] falha ao processar imagem:", e);
    const aviso = "Não foi possível ler essa imagem. Tente outro arquivo.";
    return res.redirect(`${destino}?msg=${encodeURIComponent(aviso)}`);
  }

  await pool.query(
    `UPDATE veiculo SET foto=$1, atualizado_em=now(), atualizado_por=$2 WHERE id=$3`,
    [nomeArquivo, req.sessao.id, req.params.id]
  );
  removerArquivo(atual.rows[0].foto);
  res.redirect(`${destino}?msg=${encodeURIComponent("Foto atualizada.")}`);
});

router.post("/veiculos/:id/foto/excluir", requireAuth, requireAdmin, async (req, res) => {
  const atual = await pool.query(`SELECT foto FROM veiculo WHERE id = $1`, [req.params.id]);
  if (!atual.rows[0]) return res.status(404).send("Veículo não encontrado.");
  await pool.query(
    `UPDATE veiculo SET foto=NULL, atualizado_em=now(), atualizado_por=$1 WHERE id=$2`,
    [req.sessao.id, req.params.id]
  );
  removerArquivo(atual.rows[0].foto);
  res.redirect(`${BASE_PATH}/veiculos/${req.params.id}?msg=${encodeURIComponent("Foto removida.")}`);
});

// Detalhe só leitura: sem requireAdmin de propósito — quem tem papel `consulta`
// precisa ver os dados (é o caso de uso da portaria), só não pode alterar.
router.get("/veiculos/:id/ver", requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT * FROM veiculo WHERE id = $1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).send("Veículo não encontrado.");
  res.type("html").send(paginaDetalhe({ registro: r.rows[0], sessao: req.sessao }));
});

router.get("/veiculos/:id", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(`SELECT * FROM veiculo WHERE id = $1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).send("Veículo não encontrado.");
  res.type("html").send(paginaEdicao({ registro: r.rows[0], sessao: req.sessao, msg: req.query.msg || "" }));
});

router.post("/veiculos", requireAuth, requireAdmin, async (req, res) => {
  const c = campos(req.body);
  await pool.query(
    `INSERT INTO veiculo (placa, nome, setor, ramal, modelo, cor, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.placa, c.nome, c.setor, c.ramal, c.modelo, c.cor, req.sessao.id]
  );
  const aviso = avisoPlaca(c.placa) || `Veículo ${c.placa} cadastrado.`;
  res.redirect(`${BASE_PATH}/?msg=${encodeURIComponent(aviso)}`);
});

router.post("/veiculos/:id", requireAuth, requireAdmin, async (req, res) => {
  const c = campos(req.body);
  const r = await pool.query(
    `UPDATE veiculo
        SET placa=$1, nome=$2, setor=$3, ramal=$4, modelo=$5, cor=$6,
            atualizado_em=now(), atualizado_por=$7
      WHERE id=$8`,
    [c.placa, c.nome, c.setor, c.ramal, c.modelo, c.cor, req.sessao.id, req.params.id]
  );
  if (!r.rowCount) return res.status(404).send("Veículo não encontrado.");
  const aviso = avisoPlaca(c.placa) || `Veículo ${c.placa} atualizado.`;
  res.redirect(`${BASE_PATH}/?msg=${encodeURIComponent(aviso)}`);
});

router.post("/veiculos/:id/excluir", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(`DELETE FROM veiculo WHERE id=$1 RETURNING placa, foto`, [req.params.id]);
  if (!r.rowCount) return res.status(404).send("Veículo não encontrado.");
  // Sem isto a foto de um veículo excluído ficaria em disco para sempre.
  removerArquivo(r.rows[0].foto);
  res.redirect(`${BASE_PATH}/?msg=${encodeURIComponent(`Veículo ${r.rows[0].placa || "sem placa"} excluído.`)}`);
});

// Sonda sem sessão. Precisa existir DENTRO do prefixo também: o nginx do apex
// só encaminha /estacionamento/*, então sem esta linha o healthz responderia
// apenas em 127.0.0.1:3007 e qualquer monitoramento externo veria 404.
router.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use(BASE_PATH, router);

// A mesma sonda sem prefixo, para checagem direta na porta (pm2/curl local).
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Tratador global — sem isso, uma falha do Postgres viraria página branca.
app.use((err, _req, res, _next) => {
  // Arquivo grande demais é erro de quem usa, não falha do servidor: merece
  // recado claro em vez da página genérica de erro interno.
  if (err instanceof multer.MulterError) {
    const aviso =
      err.code === "LIMIT_FILE_SIZE"
        ? "A imagem passa de 15 MB. Reduza o tamanho e tente de novo."
        : "Não foi possível enviar a imagem.";
    return res.redirect(`${BASE_PATH}/?msg=${encodeURIComponent(aviso)}`);
  }
  console.error("[estacionamento] erro não tratado:", err);
  if (!res.headersSent) res.status(500).send("Erro interno. Tente de novo em instantes.");
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`estacionamento rodando em http://127.0.0.1:${PORT}${BASE_PATH}`);
});
