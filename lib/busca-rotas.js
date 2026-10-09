"use strict";

// Home de busca ("de quem é este carro?"), diretório de pessoas e
// administração das fichas antigas (veículos sem conta, do sistema anterior).

const express = require("express");
const { pool } = require("../db/pool");
const { BASE_PATH, requireAuth, requireAdmin } = require("./auth");
const { limitar, auditar } = require("./seguranca");
const { removerArquivo } = require("./fotos");
const { casar, normalizar, pareceOPlaca } = require("./busca");
const { paginaInicio, paginaPessoas, paginaFichas, paginaFichaEdicao } = require("./paginas-busca");

const router = express.Router();

// Só carro aprovado de gente aprovada, mais as fichas antigas (sem conta).
const BASE_VISIVEL = `
  SELECT v.id, v.placa, v.modelo, v.cor, v.usuario_id IS NULL AS antiga,
         u.id AS dono_id, COALESCE(u.nome, v.nome) AS nome, COALESCE(u.setor, v.setor) AS setor,
         COALESCE(u.ramal, v.ramal) AS ramal, u.whatsapp, u.foto_perfil,
         (v.foto IS NOT NULL OR EXISTS (SELECT 1 FROM veiculo_foto f WHERE f.veiculo_id = v.id AND f.arquivo IS NOT NULL)) AS tem_foto
    FROM veiculo v LEFT JOIN usuario u ON u.id = v.usuario_id
   WHERE v.status = 'aprovado' AND (v.usuario_id IS NULL OR (u.status = 'aprovado' AND u.ativo))`;

const limiteBusca = limitar({
  janelaMs: 60_000,
  max: 40,
  nome: "busca",
  chave: (req) => `b:${(req.sessao && req.sessao.id) || req.ip}`,
});

const curinga = (t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`;

router.get("/", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store").type("html").send(paginaInicio({ sessao: req.sessao, msg: req.query.msg || "" }));
});

router.get("/buscar", requireAuth, limiteBusca, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    const camera = req.query.origem === "camera";
    // Leituras do OCR (a mais votada primeiro). Só letras e números, até 5.
    const lidas = String(req.query.placas || "")
      .split(",")
      .map((p) => normalizar(p).slice(0, 8))
      .filter((p) => p.length >= 4)
      .slice(0, 5);
    const consulta = Boolean(q || lidas.length);

    let resultados = [];
    let sugestoes = [];
    if (consulta) {
      const candidatas = [...lidas, ...(pareceOPlaca(q) ? [normalizar(q)] : [])];
      if (candidatas.length) {
        const todas = (await pool.query(`SELECT DISTINCT placa FROM (${BASE_VISIVEL}) x WHERE placa <> ''`)).rows.map((r) => r.placa);
        const achado = casar(candidatas, todas);
        if (achado.exatas.length) {
          resultados = (
            await pool.query(`SELECT * FROM (${BASE_VISIVEL}) x WHERE upper(placa) = ANY($1) ORDER BY antiga, nome`, [achado.exatas])
          ).rows;
        } else {
          sugestoes = achado.sugestoes;
        }
      }
      if (!resultados.length && !sugestoes.length && q) {
        const termos = q.split(/\s+/).filter(Boolean).slice(0, 4);
        const filtros = termos.map((_, i) => `(lower(nome) LIKE $${i + 1} ESCAPE '\\' OR lower(coalesce(setor,'')) LIKE $${i + 1} ESCAPE '\\'
              OR lower(coalesce(ramal,'')) LIKE $${i + 1} ESCAPE '\\' OR lower(placa) LIKE $${i + 1} ESCAPE '\\')`);
        resultados = (
          await pool.query(
            `SELECT * FROM (${BASE_VISIVEL}) x WHERE ${filtros.join(" AND ")} ORDER BY antiga, nome, placa LIMIT 40`,
            termos.map((t) => curinga(t.toLowerCase()))
          )
        ).rows;
      }
      // Sem texto livre no log: só o tipo e se achou.
      auditar("busca", req, { origem: camera ? "camera" : "texto", achou: resultados.length, sugeriu: sugestoes.length });
    }

    res.set("Cache-Control", "no-store").type("html").send(
      paginaInicio({ sessao: req.sessao, q, consulta, resultados, sugestoes, camera: camera && resultados.length > 0 })
    );
  } catch (e) {
    next(e);
  }
});

router.get("/pessoas", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    const termos = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const filtros = termos.map(
      (_, i) => `(lower(nome) LIKE $${i + 1} ESCAPE '\\' OR lower(coalesce(setor,'')) LIKE $${i + 1} ESCAPE '\\' OR lower(coalesce(ramal,'')) LIKE $${i + 1} ESCAPE '\\')`
    );
    const r = await pool.query(
      `SELECT id, nome, setor, ramal, foto_perfil FROM usuario
        WHERE status = 'aprovado' AND ativo ${filtros.length ? "AND " + filtros.join(" AND ") : ""}
        ORDER BY nome LIMIT 300`,
      termos.map((t) => curinga(t.toLowerCase()))
    );
    res.set("Cache-Control", "no-store").type("html").send(paginaPessoas({ sessao: req.sessao, pessoas: r.rows, q }));
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------ fichas antigas
const POR_PAGINA = 25;

router.get("/admin/fichas", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    const termos = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const filtros = termos.map(
      (_, i) => `(lower(coalesce(nome,'')) LIKE $${i + 1} ESCAPE '\\' OR lower(coalesce(setor,'')) LIKE $${i + 1} ESCAPE '\\'
        OR lower(coalesce(ramal,'')) LIKE $${i + 1} ESCAPE '\\' OR lower(placa) LIKE $${i + 1} ESCAPE '\\')`
    );
    const onde = `usuario_id IS NULL ${filtros.length ? "AND " + filtros.join(" AND ") : ""}`;
    const params = termos.map((t) => curinga(t.toLowerCase()));
    const total = (await pool.query(`SELECT count(*)::int AS n FROM veiculo WHERE ${onde}`, params)).rows[0].n;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const pagina = Math.min(paginas, Math.max(1, parseInt(req.query.p, 10) || 1));
    const fichas = (
      await pool.query(
        `SELECT id, placa, nome, setor, ramal, modelo, cor FROM veiculo WHERE ${onde}
          ORDER BY nome NULLS LAST, placa LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
        params
      )
    ).rows;
    res.set("Cache-Control", "no-store").type("html").send(
      paginaFichas({ sessao: req.sessao, fichas, q, total, pagina, paginas, msg: req.query.msg || "" })
    );
  } catch (e) {
    next(e);
  }
});

async function fichaPorId(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(`SELECT * FROM veiculo WHERE id = $1 AND usuario_id IS NULL`, [id]);
  return r.rows[0] || null;
}

router.get("/admin/fichas/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ficha = await fichaPorId(req.params.id);
    if (!ficha) return res.status(404).send("Ficha não encontrada.");
    res.set("Cache-Control", "no-store").type("html").send(paginaFichaEdicao({ sessao: req.sessao, ficha }));
  } catch (e) {
    next(e);
  }
});

const texto = (v, max) => String(v || "").trim().slice(0, max) || null;

router.post("/admin/fichas/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ficha = await fichaPorId(req.params.id);
    if (!ficha) return res.status(404).send("Ficha não encontrada.");
    const b = req.body || {};
    const placa = normalizar(b.placa).slice(0, 8);
    await pool.query(
      `UPDATE veiculo SET placa=$1, nome=$2, setor=$3, ramal=$4, modelo=$5, cor=$6, atualizado_em=now(), atualizado_por=$7
        WHERE id=$8 AND usuario_id IS NULL`,
      [placa, texto(b.nome, 120), texto(b.setor, 120), texto(b.ramal, 20), texto(b.modelo, 80), texto(b.cor, 40), req.sessao.id, ficha.id]
    );
    auditar("ficha_editada", req, { ficha: ficha.id });
    res.redirect(`${BASE_PATH}/admin/fichas?msg=${encodeURIComponent(`Ficha ${placa || "sem placa"} salva.`)}`);
  } catch (e) {
    next(e);
  }
});

router.post("/admin/fichas/:id/excluir", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).send("Ficha não encontrada.");
    const r = await pool.query(`DELETE FROM veiculo WHERE id=$1 AND usuario_id IS NULL RETURNING placa, foto`, [req.params.id]);
    if (!r.rowCount) return res.status(404).send("Ficha não encontrada.");
    removerArquivo(r.rows[0].foto);
    auditar("ficha_excluida", req, { ficha: Number(req.params.id) });
    res.redirect(`${BASE_PATH}/admin/fichas?msg=${encodeURIComponent(`Ficha ${r.rows[0].placa || "sem placa"} excluída.`)}`);
  } catch (e) {
    next(e);
  }
});

module.exports = { router };
