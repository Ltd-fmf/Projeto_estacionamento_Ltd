"use strict";

// Carro do funcionário com 5 fotos guiadas (placa, frente, traseira, laterais).
// A placa do carro sai da foto da placa (OCR no navegador, ver
// public/placa-ocr.js) e o servidor revalida tudo. O admin aprova o carro e as
// trocas de foto.

const path = require("node:path");
const express = require("express");
const { pool } = require("../db/pool");
const { BASE_PATH, requireAuth, requireAdmin } = require("./auth");
const { uploadCampos, removerArquivo, DIR_FOTOS } = require("./fotos");
const { limpar, salvarFoto, registrar } = require("./social");
const { auditar } = require("./seguranca");
const { avisarCarro } = require("./aviso-jarvis");
const { TIPOS, NOMES, campoDe } = require("./tipos-foto");
const { paginaCarro, paginaCarroDetalhe } = require("./paginas-social");

const router = express.Router();

// Placa dos dois padrões (antigo AAA0000 e Mercosul AAA0A00). Aqui é bloqueio,
// diferente do legado: dado novo entra limpo.
const RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
const placaDe = (v) => String(v || "").trim().toUpperCase().replace(/[\s-]/g, "");

const CAMPOS = TIPOS.map((t) => ({ name: campoDe(t.tipo), maxCount: 1 }));
const podeTerCarro = (sessao) => sessao.papel === "membro" || sessao.papel === "admin";
const ehAdmin = (sessao) => sessao.papel === "admin";

async function carroAcessivel(id, sessao) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(`SELECT * FROM veiculo WHERE id = $1`, [id]);
  const c = r.rows[0];
  if (!c) return null;
  if (!ehAdmin(sessao) && String(c.usuario_id) !== String(sessao.id)) return null;
  return c;
}

async function fotosDoCarro(id) {
  const r = await pool.query(`SELECT tipo, arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id = $1`, [id]);
  return Object.fromEntries(r.rows.map((f) => [f.tipo, f]));
}

// Grava no disco só as fotos enviadas. Devolve [[tipo, nome], ...] ou lança
// com o rótulo da foto que não pôde ser lida.
async function processarFotos(files, gravados) {
  const saida = [];
  for (const t of TIPOS) {
    const f = files && files[campoDe(t.tipo)] && files[campoDe(t.tipo)][0];
    if (!f) continue;
    try {
      const nome = await salvarFoto(f.buffer, "carro");
      gravados.push(nome);
      saida.push([t.tipo, nome]);
    } catch {
      const e = new Error(`Não foi possível ler a foto "${t.rotulo}". Tente outra imagem.`);
      e.aviso = true;
      throw e;
    }
  }
  return saida;
}

// De onde veio a placa: lida da foto e mantida, lida e corrigida, ou digitada.
// `placa_lida` vem do navegador e só serve de estatística de acerto do OCR; a
// placa que vale é a validada aqui.
function origemDaPlaca(placa, lidaBruta) {
  const lida = placaDe(lidaBruta);
  if (!RE_PLACA.test(lida)) return { lida: null, origem: "manual" };
  return { lida, origem: lida === placa ? "foto" : "corrigida" };
}

// ---------------------------------------------------------------- cadastro
router.get("/carros/novo", requireAuth, (req, res) => {
  if (!podeTerCarro(req.sessao)) return res.status(403).send("Seu acesso é só de consulta.");
  res.type("html").send(paginaCarro({ sessao: req.sessao }));
});

router.post("/carros", requireAuth, ...uploadCampos(CAMPOS), async (req, res, next) => {
  const gravados = [];
  try {
    if (!podeTerCarro(req.sessao)) return res.status(403).send("Seu acesso é só de consulta.");
    const files = req.files || {};
    const placa = placaDe(req.body.placa);
    const valores = { placa, modelo: limpar(req.body.modelo, 60), cor: limpar(req.body.cor, 30) };
    const refazer = (erro) => res.status(400).type("html").send(paginaCarro({ sessao: req.sessao, erro, carro: valores }));

    if (!files[campoDe("placa")]) return refazer("Tire a foto da placa: é dela que sai a placa do carro.");
    if (!RE_PLACA.test(placa)) return refazer("Placa inválida. Confira a leitura (ex.: ABC1D23 ou ABC1234).");
    if (!valores.modelo) return refazer("Informe o modelo do carro.");

    const jaTem = await pool.query(`SELECT 1 FROM veiculo WHERE usuario_id = $1 AND placa = $2`, [req.sessao.id, placa]);
    if (jaTem.rowCount) return refazer("Você já cadastrou um carro com essa placa.");

    let fotos;
    try {
      fotos = await processarFotos(files, gravados);
    } catch (e) {
      gravados.forEach(removerArquivo);
      if (e.aviso) return refazer(e.message);
      throw e;
    }

    const admin = ehAdmin(req.sessao);
    const { lida, origem } = origemDaPlaca(placa, req.body.placa_lida);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const v = await client.query(
        `INSERT INTO veiculo (placa, nome, setor, ramal, modelo, cor, usuario_id, status, criado_por, placa_lida, placa_origem)
         SELECT $1, u.nome, u.setor, u.ramal, $2, $3, u.id, $4, u.id, $5, $6 FROM usuario u WHERE u.id = $7
         RETURNING id`,
        [placa, valores.modelo, valores.cor, admin ? "aprovado" : "pendente", lida, origem, req.sessao.id]
      );
      for (const [tipo, nome] of fotos) {
        await client.query(
          `INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo, arquivo_pendente) VALUES ($1, $2, $3, $4)`,
          [v.rows[0].id, tipo, admin ? nome : null, admin ? null : nome]
        );
      }
      await client.query("COMMIT");
      auditar("carro_cadastrado", req, { carro: v.rows[0].id, origem, fotos: fotos.length });
      if (!admin) avisarCarro(v.rows[0].id, "cadastro", req);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    const msg = admin ? "Carro cadastrado." : "Carro enviado. Ele aparece para os colegas depois da aprovação.";
    res.redirect(`${BASE_PATH}/perfil/${req.sessao.id}?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    gravados.forEach(removerArquivo);
    next(e);
  }
});

// ----------------------------------------------------------------- detalhe
router.get("/carros/:id", requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).send("Carro não encontrado.");
    const r = await pool.query(
      `SELECT v.*, u.nome AS dono_nome, u.id AS dono_id, u.whatsapp
         FROM veiculo v LEFT JOIN usuario u ON u.id = v.usuario_id WHERE v.id = $1`,
      [req.params.id]
    );
    const c = r.rows[0];
    if (!c) return res.status(404).send("Carro não encontrado.");
    const dono = String(c.usuario_id) === String(req.sessao.id) || ehAdmin(req.sessao);
    if (c.status !== "aprovado" && !dono) return res.status(404).send("Carro não encontrado.");
    res.type("html").send(
      paginaCarroDetalhe({ sessao: req.sessao, carro: c, fotos: await fotosDoCarro(c.id), dono, msg: String(req.query.msg || "") })
    );
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------ edição
router.get("/carros/:id/editar", requireAuth, async (req, res, next) => {
  try {
    const c = await carroAcessivel(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    res.type("html").send(
      paginaCarro({ sessao: req.sessao, carro: c, fotos: await fotosDoCarro(c.id), editar: true, msg: String(req.query.msg || "") })
    );
  } catch (e) {
    next(e);
  }
});

router.post("/carros/:id", requireAuth, ...uploadCampos(CAMPOS), async (req, res, next) => {
  const gravados = [];
  try {
    const c = await carroAcessivel(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    const files = req.files || {};
    const placa = placaDe(req.body.placa);
    const volta = (m) => res.redirect(`${BASE_PATH}/carros/${c.id}/editar?msg=${encodeURIComponent(m)}`);
    if (!RE_PLACA.test(placa)) return volta("Placa inválida. Exemplos: ABC1D23 ou ABC1234.");
    const modelo = limpar(req.body.modelo, 60);
    if (!modelo) return volta("Informe o modelo do carro.");

    let fotos;
    try {
      fotos = await processarFotos(files, gravados);
    } catch (e) {
      gravados.forEach(removerArquivo);
      if (e.aviso) return volta(e.message);
      throw e;
    }

    const admin = ehAdmin(req.sessao);
    // Trocar a placa, ou a foto da placa, muda a identidade do carro: volta
    // para aprovação (admin edita direto).
    const mexeuNaIdentidade = placa !== c.placa || fotos.some(([t]) => t === "placa");
    const status = admin || !mexeuNaIdentidade ? c.status : "pendente";
    const { lida, origem } = fotos.some(([t]) => t === "placa") || placa !== c.placa
      ? origemDaPlaca(placa, req.body.placa_lida)
      : { lida: c.placa_lida, origem: c.placa_origem };

    const antigos = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE veiculo SET placa=$1, modelo=$2, cor=$3, status=$4, motivo_recusa=NULL, placa_lida=$5, placa_origem=$6,
                            atualizado_em=now(), atualizado_por=$7 WHERE id=$8`,
        [placa, modelo, limpar(req.body.cor, 30), status, lida, origem, req.sessao.id, c.id]
      );
      for (const [tipo, nome] of fotos) {
        const atual = await client.query(
          `SELECT arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1 AND tipo=$2 FOR UPDATE`,
          [c.id, tipo]
        );
        if (admin) {
          if (atual.rowCount) {
            antigos.push(atual.rows[0].arquivo, atual.rows[0].arquivo_pendente);
            await client.query(
              `UPDATE veiculo_foto SET arquivo=$1, arquivo_pendente=NULL WHERE veiculo_id=$2 AND tipo=$3`,
              [nome, c.id, tipo]
            );
          } else {
            await client.query(`INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo) VALUES ($1,$2,$3)`, [c.id, tipo, nome]);
          }
        } else if (atual.rowCount) {
          antigos.push(atual.rows[0].arquivo_pendente);
          await client.query(`UPDATE veiculo_foto SET arquivo_pendente=$1 WHERE veiculo_id=$2 AND tipo=$3`, [nome, c.id, tipo]);
        } else {
          await client.query(`INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo_pendente) VALUES ($1,$2,$3)`, [c.id, tipo, nome]);
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    antigos.forEach(removerArquivo);

    const msg = status === "pendente" && c.status !== "pendente" ? "Salvo. A alteração espera aprovação." : "Carro atualizado.";
    res.redirect(`${BASE_PATH}/perfil/${c.usuario_id || req.sessao.id}?msg=${encodeURIComponent(msg)}`);
  } catch (e) {
    gravados.forEach(removerArquivo);
    next(e);
  }
});

router.post("/carros/:id/excluir", requireAuth, async (req, res, next) => {
  try {
    const c = await carroAcessivel(req.params.id, req.sessao);
    if (!c) return res.status(404).send("Carro não encontrado.");
    const fs_ = await pool.query(`SELECT arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1`, [c.id]);
    await pool.query(`DELETE FROM veiculo WHERE id = $1`, [c.id]); // CASCADE leva veiculo_foto
    fs_.rows.forEach((f) => {
      removerArquivo(f.arquivo);
      removerArquivo(f.arquivo_pendente);
    });
    removerArquivo(c.foto);
    removerArquivo(c.foto_pendente);
    auditar("carro_removido", req, { carro: c.id });
    res.redirect(`${BASE_PATH}/perfil/${c.usuario_id || req.sessao.id}?msg=${encodeURIComponent("Carro removido.")}`);
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- fotos
// ?tipo=frente|placa|... escolhe a foto; sem tipo devolve a "capa" (frente, ou
// a primeira que existir). Quem não é dono nem admin só vê foto APROVADA de
// carro aprovado; dono e admin veem também a pendente (?pendente=1 ou, na capa,
// quando ainda não há aprovada).
router.get("/carros/:id/foto", requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).send("Sem foto.");
    const r = await pool.query(`SELECT foto, usuario_id, status FROM veiculo WHERE id = $1`, [req.params.id]);
    const c = r.rows[0];
    if (!c) return res.status(404).send("Sem foto.");
    const dono = String(c.usuario_id) === String(req.sessao.id) || ehAdmin(req.sessao);
    if (c.status !== "aprovado" && !dono) return res.status(404).send("Sem foto.");

    const fotos = await fotosDoCarro(req.params.id);
    const querPendente = req.query.pendente === "1";
    const pegar = (f) => (f ? (querPendente ? (dono ? f.arquivo_pendente : null) : f.arquivo || (dono ? f.arquivo_pendente : null)) : null);

    let nome = null;
    if (req.query.tipo) {
      if (!NOMES.has(String(req.query.tipo))) return res.status(404).send("Sem foto.");
      nome = pegar(fotos[req.query.tipo]);
    } else {
      for (const t of ["frente", "lateral_esq", "lateral_dir", "traseira", "placa"]) {
        nome = pegar(fotos[t]);
        if (nome) break;
      }
      if (!nome && c.foto) nome = c.foto; // foto única de antes da migration 0003
    }
    if (!nome) return res.status(404).send("Sem foto.");
    res.sendFile(path.join(DIR_FOTOS, path.basename(nome)));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- aprovação
// Aprova/recusa o carro inteiro: todas as fotos pendentes vão junto. `absorver`
// (opcional) é uma ficha antiga sem dono com a mesma placa: a ficha some, e a
// foto antiga dela vira a "frente" se o carro novo não trouxe uma.
router.post("/admin/carro/:id/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao)) return res.status(400).send("Decisão inválida.");
  const motivo = limpar(req.body.motivo, 200);
  const client = await pool.connect();
  const descartar = [];
  try {
    await client.query("BEGIN");
    const novo = decisao === "aprovar" ? "aprovado" : "recusado";
    const r = await client.query(
      `UPDATE veiculo SET status=$1, motivo_recusa=$2, atualizado_em=now(), atualizado_por=$3
        WHERE id=$4 AND status='pendente' RETURNING id, placa`,
      [novo, novo === "recusado" ? motivo : null, req.sessao.id, id]
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Esse carro já foi decidido.")}`);
    }
    const carro = r.rows[0];

    const fotos = await client.query(`SELECT id, arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1 FOR UPDATE`, [id]);
    for (const f of fotos.rows) {
      if (!f.arquivo_pendente) continue;
      if (novo === "aprovado") {
        descartar.push(f.arquivo);
        await client.query(`UPDATE veiculo_foto SET arquivo=arquivo_pendente, arquivo_pendente=NULL WHERE id=$1`, [f.id]);
      } else {
        descartar.push(f.arquivo_pendente);
        if (f.arquivo) await client.query(`UPDATE veiculo_foto SET arquivo_pendente=NULL WHERE id=$1`, [f.id]);
        else await client.query(`DELETE FROM veiculo_foto WHERE id=$1`, [f.id]);
      }
    }

    if (novo === "aprovado" && req.body.absorver) {
      const velha = await client.query(
        `DELETE FROM veiculo WHERE id=$1 AND usuario_id IS NULL AND placa=$2 RETURNING foto, foto_pendente`,
        [req.body.absorver, carro.placa]
      );
      if (velha.rowCount) {
        const tem = await client.query(`SELECT 1 FROM veiculo_foto WHERE veiculo_id=$1 AND tipo='frente'`, [id]);
        if (!tem.rowCount && velha.rows[0].foto) {
          await client.query(`INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo) VALUES ($1,'frente',$2)`, [id, velha.rows[0].foto]);
        } else {
          descartar.push(velha.rows[0].foto);
        }
        descartar.push(velha.rows[0].foto_pendente);
        await registrar(client, "veiculo", req.body.absorver, "recusado", `ficha antiga absorvida pelo carro ${id}`, req.sessao.id);
      }
    }
    await registrar(client, "veiculo", id, novo, motivo, req.sessao.id);
    await client.query("COMMIT");
    descartar.forEach(removerArquivo);
    auditar("carro_decidido", req, { carro: id, decisao: novo });
    if (novo === "aprovado") avisarCarro(id, "aprovado", req);
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent(novo === "aprovado" ? "Carro aprovado." : "Carro recusado.")}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Troca de UMA foto de um carro já aprovado.
router.post("/admin/foto-carro/:id/:tipo/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, tipo, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao) || !NOMES.has(tipo)) return res.status(400).send("Pedido inválido.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const a = await client.query(
      `SELECT id, arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id=$1 AND tipo=$2 FOR UPDATE`,
      [id, tipo]
    );
    const f = a.rows[0];
    if (!f || !f.arquivo_pendente) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias`);
    }
    let sobra;
    if (decisao === "aprovar") {
      sobra = f.arquivo;
      await client.query(`UPDATE veiculo_foto SET arquivo=arquivo_pendente, arquivo_pendente=NULL WHERE id=$1`, [f.id]);
    } else {
      sobra = f.arquivo_pendente;
      if (f.arquivo) await client.query(`UPDATE veiculo_foto SET arquivo_pendente=NULL WHERE id=$1`, [f.id]);
      else await client.query(`DELETE FROM veiculo_foto WHERE id=$1`, [f.id]);
    }
    await registrar(client, "foto_veiculo", id, decisao === "aprovar" ? "aprovado" : "recusado", tipo, req.sessao.id);
    await client.query("COMMIT");
    removerArquivo(sobra);
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Foto " + (decisao === "aprovar" ? "aprovada." : "recusada."))}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = { router };
