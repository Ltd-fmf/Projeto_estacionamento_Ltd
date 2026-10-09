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
const path = require("node:path");
const express = require("express");
const multer = require("multer");
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
const { paginaLogin } = require("./lib/paginas-social");
const { router: social } = require("./lib/social");
const { router: carros } = require("./lib/carros");
const { router: busca } = require("./lib/busca-rotas");
const { cabecalhos, csrf, flash, limitar, auditar } = require("./lib/seguranca");

const app = express();
// Atrás do nginx: sem isto, req.ip seria sempre 127.0.0.1 e o freio de
// tentativas de login misturaria todo mundo num só balde.
// Só o nginx local (loopback) é confiável. Com `true`, o X-Forwarded-For inteiro
// valia e o cliente forjava o IP, escapando dos freios de login e cadastro.
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));

const PORT = Number(process.env.PORT || 3007);

// Só aceita voltar para dentro do próprio app — `proximo` vem da query string,
// e sem esta trava viraria um open redirect para qualquer site.
function destinoSeguro(proximo) {
  const p = String(proximo || "");
  return p.startsWith(`${BASE_PATH}/`) && !p.startsWith("//") ? p : `${BASE_PATH}/`;
}

const router = express.Router();

// CSS e fontes (nada pessoal aqui; fotos continuam atrás de login).
router.use(cabecalhos);
// CSS/JS do site revalidam sempre (ETag; o ?v= das páginas já troca a URL);
// fontes e o motor do OCR quase nunca mudam e são pesados: cache longo.
router.use(
  "/publico",
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, arquivo) {
      const longo = /[\\/](fontes|ocr)[\\/]/.test(arquivo);
      res.setHeader("Cache-Control", longo ? "public, max-age=604800, immutable" : "no-cache");
    },
  })
);
router.use(flash);
router.use(csrf);
router.use(social);
router.use(carros);
router.use(busca);

router.get("/login", async (req, res, next) => {
  try {
    if (await sessaoDe(req)) return res.redirect(`${BASE_PATH}/`);
    res.type("html").send(paginaLogin({ proximo: String(req.query.proximo || "") }));
  } catch (e) {
    next(e);
  }
});

// Teto por IP em qualquer login, além do freio por IP+login de lib/auth.js.
const limiteLogin = limitar({ janelaMs: 15 * 60_000, max: 40, nome: "login-ip" });

router.post("/login", limiteLogin, async (req, res, next) => {
  try {
    const login = String(req.body.login || "").trim().slice(0, 60);
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

    // Senha enorme custaria um PBKDF2 inteiro por tentativa: corta cedo.
    const senha = String(req.body.senha || "");
    const sessao = senha.length > 128 ? null : await autenticar(login, senha);
    if (!sessao) {
      registrarFalha(req, login);
      auditar("login_falhou", req, { login });
      // Mensagem única: não diz se foi o usuário ou a senha que errou.
      return res.type("html").send(paginaLogin({ erro: "Usuário ou senha inválidos.", proximo, login }));
    }

    // Senha certa, acesso ainda não liberado: explica em vez de "senha inválida".
    if (sessao.bloqueio) {
      limparFalhas(req, login);
      const info =
        sessao.bloqueio === "pendente"
          ? "Seu pedido de acesso ainda está em análise. Você poderá entrar assim que for aprovado."
          : "Seu pedido de acesso não foi aprovado. Fale com a secretaria.";
      return res.type("html").send(paginaLogin({ info, proximo, login }));
    }

    limparFalhas(req, login);
    emitirSessao(res, sessao);
    auditar("login_ok", req, { usuario: sessao.id });
    res.redirect(destinoSeguro(proximo));
  } catch (e) {
    next(e);
  }
});

// Sair invalida o token no servidor (sessao_versao+1), e não só apaga o cookie:
// um token copiado antes deixa de valer.
router.post("/sair", async (req, res, next) => {
  try {
    const sessao = await sessaoDe(req);
    if (sessao) {
      await pool.query(`UPDATE usuario SET sessao_versao = sessao_versao + 1 WHERE id = $1`, [sessao.id]);
      auditar("logout", req, { usuario: sessao.id });
    }
    encerrarSessao(res);
    res.redirect(`${BASE_PATH}/login`);
  } catch (e) {
    next(e);
  }
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
  // Arquivo de foto que o banco cita mas o disco não tem: é "não encontrado",
  // não falha do servidor (e não deve poluir o log com stack).
  if (err && (err.code === "ENOENT" || err.status === 404)) {
    if (!res.headersSent) res.status(404).send("Não encontrado.");
    return;
  }
  console.error("[estacionamento] erro não tratado:", err);
  if (!res.headersSent) res.status(500).send("Erro interno. Tente de novo em instantes.");
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`estacionamento rodando em http://127.0.0.1:${PORT}${BASE_PATH}`);
});
