"use strict";

// Fase 2: o funcionário cadastra o próprio carro (e foto), o admin aprova.
// Também aprova troca de foto e "absorve" fichas antigas sem dono.

const path = require("node:path");
const express = require("express");
const { pool } = require("../db/pool");
const { BASE_PATH, requireAuth, requireAdmin } = require("./auth");
const { uploadUm, removerArquivo, DIR_FOTOS } = require("./fotos");
const { limpar, salvarFoto, registrar } = require("./social");
const { paginaCarro } = require("./paginas-social");

const router = express.Router();

// Placa dos dois padrões (antigo AAA0000 e Mercosul AAA0A00). Aqui é bloqueio,
// diferente do legado: dado novo entra limpo.
const RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
const placaDe = (v) => String(v || "").trim().toUpperCase().replace(/[\s-]/g, "");

const podeTerCarro = (sessao) => sessao.papel === "membro" || sessao.papel === "admin";

async function carroDoUsuario(id, sessao) {
  const r = await pool.query(`SELECT * FROM veiculo WHERE id = $1`, [id]);
  const c = r.rows[0];
  if (!c) return null;
  if (sessao.papel !== "admin" && String(c.usuario_id) !== String(sessao.id)) return null;
  return c;
}

router.get("/carros/novo", requireAuth, (req, res) => {
  if (!podeTerCarro(req.sessao)) return res.status(403).send("Seu acesso é só de consulta.");
  res.type("html").send(paginaCarro({ sessao: req.sessao }));
});

router.post("/carros", requireAuth, ...uploadUm("foto"), async (req, res, next) => {
  try {
    if (!podeTerCarro(req.sessao)) return res.status(403).send("Seu acesso é só de consulta.");
    const placa = placaDe(req.body.placa);
    const valores = { placa, modelo: limpar(req.body.modelo, 60), cor: limpar(req.body.cor, 30) };
    const refazer = (erro) =>
      res.status(400).type("html").send(paginaCarro({ sessao: req.sessao, erro, carro: valores }));
    if (!RE_PLACA.test(placa)) return refazer("Placa inválida. Exemplos: ABC1D23 ou ABC1234.");
    if (!valores.modelo) return refazer("Informe o modelo do carro.");

    const admin = req.sessao.papel === "admin";
    let foto = null;
    if (req.file) {
      try {
        foto = await salvarFoto(req.file.buffer, "carro");
      } catch {
        return refazer("Não foi possível ler a foto. Tente outro arquivo.");
      }
    }
    // Admin cadastra direto; funcionário espera aprovação (carro e foto).
    await pool.query(
      `INSERT INTO veiculo (placa, nome, setor, ramal, modelo, cor, foto, foto_pendente, usuario_id, status, criado_por)
       SELECT $1, u.nome, u.setor, u.ramal, $2, $3, $4, $5, u.id, $6, u.id FROM usuario u WHERE u.id = $7`,
      [placa, valores.modelo, valores.cor, admin ? foto : null, admin ? null : foto, admin ? "aprovado" : "pendente", req.sessao.id]
    );
    const msg = admin ? "Carro cadastrado." : "Carro enviado. Ele aparece para os colegas depois da aprovação.";
    res.redirect(`${BASE_PATH}/perfil/${req.sessao.id}?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    next(e);
  }
});

router.get("/carros/:id/editar", requireAuth, async (req, res, next) => {
  try {
    const c = await carroDoUsuario(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    res.type("html").send(paginaCarro({ sessao: req.sessao, carro: c, editar: true, msg: String(req.query.msg || "") }));
  } catch (e) {
    next(e);
  }
});

router.post("/carros/:id", requireAuth, ...uploadUm("foto"), async (req, res, next) => {
  try {
    const c = await carroDoUsuario(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    const placa = placaDe(req.body.placa);
    const volta = (m) => res.redirect(`${BASE_PATH}/carros/${c.id}/editar?msg=${encodeURIComponent(m)}`);
    if (!RE_PLACA.test(placa)) return volta("Placa inválida. Exemplos: ABC1D23 ou ABC1234.");
    const modelo = limpar(req.body.modelo, 60);
    if (!modelo) return volta("Informe o modelo do carro.");

    const admin = req.sessao.papel === "admin";
    // Trocar a placa muda a identidade do carro: volta para aprovação.
    const status = admin || placa === c.placa ? c.status : "pendente";
    let foto = c.foto;
    let fotoPend = c.foto_pendente;
    if (req.file) {
      try {
        const nova = await salvarFoto(req.file.buffer, "carro");
        if (admin) {
          removerArquivo(foto);
          foto = nova;
        } else {
          removerArquivo(fotoPend);
          fotoPend = nova;
        }
      } catch {
        return volta("Não foi possível ler a foto. Tente outro arquivo.");
      }
    }
    await pool.query(
      `UPDATE veiculo SET placa=$1, modelo=$2, cor=$3, foto=$4, foto_pendente=$5, status=$6,
                          motivo_recusa=NULL, atualizado_em=now(), atualizado_por=$7 WHERE id=$8`,
      [placa, modelo, limpar(req.body.cor, 30), foto, fotoPend, status, req.sessao.id, c.id]
    );
    const msg =
      status === "pendente" && c.status !== "pendente" ? "Salvo. A alteração espera aprovação." : "Carro atualizado.";
    res.redirect(`${BASE_PATH}/perfil/${c.usuario_id || req.sessao.id}?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    next(e);
  }
});

router.post("/carros/:id/excluir", requireAuth, async (req, res, next) => {
  try {
    const c = await carroDoUsuario(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    await pool.query(`DELETE FROM veiculo WHERE id = $1`, [c.id]);
    removerArquivo(c.foto);
    removerArquivo(c.foto_pendente);
    res.redirect(`${BASE_PATH}/perfil/${c.usuario_id || req.sessao.id}?msg=${encodeURIComponent("Carro removido.")}`);
  } catch (e) {
    next(e);
  }
});

// Foto aprovada: qualquer logado vê (carro aprovado). Pendente: só dono/admin.
router.get("/carros/:id/foto", requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT foto, foto_pendente, usuario_id, status FROM veiculo WHERE id = $1`, [req.params.id]);
    const c = r.rows[0];
    if (!c) return res.status(404).send("Sem foto.");
    const dono = String(c.usuario_id) === String(req.sessao.id) || req.sessao.papel === "admin";
    const nome =
      req.query.pendente === "1" ? (dono ? c.foto_pendente : null) : c.status === "aprovado" || dono ? c.foto : null;
    if (!nome) return res.status(404).send("Sem foto.");
    res.sendFile(path.join(DIR_FOTOS, path.basename(nome)));
  } catch (e) {
    next(e);
  }
});

// Aprovação de carro. `absorver` (opcional) é o id de uma ficha antiga sem dono
// com a mesma placa: a ficha some e a foto dela passa para o carro novo, se ele
// não trouxe uma. Fica registrado no log.
router.post("/admin/carro/:id/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao)) return res.status(400).send("Decisão inválida.");
  const motivo = limpar(req.body.motivo, 200);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const novo = decisao === "aprovar" ? "aprovado" : "recusado";
    const r = await client.query(
      `UPDATE veiculo SET status=$1, motivo_recusa=$2, atualizado_em=now(), atualizado_por=$3
        WHERE id=$4 AND status='pendente' RETURNING id, placa, foto, foto_pendente`,
      [novo, novo === "recusado" ? motivo : null, req.sessao.id, id]
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Esse carro já foi decidido.")}`);
    }
    const carro = r.rows[0];
    const descartar = [];
    if (novo === "aprovado" && carro.foto_pendente) {
      await client.query(`UPDATE veiculo SET foto=foto_pendente, foto_pendente=NULL WHERE id=$1`, [id]);
      descartar.push(carro.foto);
    } else if (novo === "recusado" && carro.foto_pendente) {
      await client.query(`UPDATE veiculo SET foto_pendente=NULL WHERE id=$1`, [id]);
      descartar.push(carro.foto_pendente);
    }
    if (novo === "aprovado" && req.body.absorver) {
      const velha = await client.query(
        `DELETE FROM veiculo WHERE id=$1 AND usuario_id IS NULL AND placa=$2 RETURNING foto`,
        [req.body.absorver, carro.placa]
      );
      if (velha.rowCount) {
        const tem = await client.query(`SELECT foto FROM veiculo WHERE id=$1`, [id]);
        if (!tem.rows[0].foto && velha.rows[0].foto) {
          await client.query(`UPDATE veiculo SET foto=$1 WHERE id=$2`, [velha.rows[0].foto, id]);
        } else {
          descartar.push(velha.rows[0].foto);
        }
        await registrar(client, "veiculo", req.body.absorver, "recusado", `ficha antiga absorvida pelo carro ${id}`, req.sessao.id);
      }
    }
    await registrar(client, "veiculo", id, novo, motivo, req.sessao.id);
    await client.query("COMMIT");
    descartar.forEach(removerArquivo);
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent(novo === "aprovado" ? "Carro aprovado." : "Carro recusado.")}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Troca de foto de um carro já aprovado.
router.post("/admin/foto-carro/:id/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao)) return res.status(400).send("Decisão inválida.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const a = await client.query(`SELECT foto, foto_pendente FROM veiculo WHERE id=$1 FOR UPDATE`, [id]);
    const c = a.rows[0];
    if (!c || !c.foto_pendente) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias`);
    }
    if (decisao === "aprovar") {
      await client.query(`UPDATE veiculo SET foto=foto_pendente, foto_pendente=NULL WHERE id=$1`, [id]);
    } else {
      await client.query(`UPDATE veiculo SET foto_pendente=NULL WHERE id=$1`, [id]);
    }
    await registrar(client, "foto_veiculo", id, decisao === "aprovar" ? "aprovado" : "recusado", null, req.sessao.id);
    await client.query("COMMIT");
    removerArquivo(decisao === "aprovar" ? c.foto : c.foto_pendente);
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Foto " + (decisao === "aprovar" ? "aprovada." : "recusada."))}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = { router };
