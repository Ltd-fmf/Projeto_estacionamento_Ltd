"use strict";

// Fase 1 da rede social interna: autocadastro com aprovação, perfil com foto e
// fila de aprovação do admin. Os veículos do funcionário (Fase 2) entram aqui.

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { pool } = require("../db/pool");
const { BASE_PATH, hashSenha, requireAuth, requireAdmin } = require("./auth");
const { limitar, auditar, hmac, iguais } = require("./seguranca");
const { uploadUm, comprimir, removerArquivo, enviarFoto, DIR_FOTOS } = require("./fotos");
const {
  paginaCadastro,
  paginaCadastroEnviado,
  paginaPerfil,
  paginaPerfilEdicao,
  paginaPendencias,
} = require("./paginas-social");

const router = express.Router();

// O formulário de cadastro é público. Camadas contra encher a fila e o disco:
// limite por IP (requisições e pedidos aceitos), teto global de pendentes,
// campo-isca invisível (robôs preenchem), tempo mínimo de preenchimento com
// carimbo assinado e expiração dos pendentes antigos.
const limiteCadastro = limitar({ janelaMs: 60 * 60_000, max: 20, nome: "cadastro-ip" });
const MAX_PENDENTES = 100;
const MIN_PREENCHIMENTO_S = 4;
const MAX_PREENCHIMENTO_S = 2 * 3600;
const pedidos = new Map();
function excedeuCadastro(ip) {
  const agora = Date.now();
  const lista = (pedidos.get(ip) || []).filter((t) => agora - t < 3_600_000);
  pedidos.set(ip, lista);
  return lista.length >= 5;
}

const carimbo = () => {
  const t = String(Math.floor(Date.now() / 1000));
  return `${t}.${hmac("form|" + t)}`;
};
function carimboValido(c) {
  const [t, sig] = String(c || "").split(".");
  if (!t || !sig || !iguais(sig, hmac("form|" + t))) return false;
  const idade = Math.floor(Date.now() / 1000) - Number(t);
  return idade >= MIN_PREENCHIMENTO_S && idade <= MAX_PREENCHIMENTO_S;
}

// Senhas que ninguém deveria usar, mais as que repetem o próprio usuário.
const SENHAS_FRACAS = new Set([
  "12345678", "123456789", "1234567890", "qwertyui", "password", "senha123", "senha1234",
  "abcd1234", "11111111", "00000000", "admin123", "mudar123", "brasil123", "estacionamento",
]);
function senhaFraca(senha, login) {
  const s = String(senha);
  if (SENHAS_FRACAS.has(s.toLowerCase())) return true;
  if (/^(.)\1+$/.test(s)) return true; // "aaaaaaaa"
  return s.toLowerCase().includes(String(login).toLowerCase()) && String(login).length >= 4;
}

// Pendentes esquecidos por mais de 30 dias saem, com as fotos.
async function limparPendentes() {
  try {
    const r = await pool.query(
      `DELETE FROM usuario WHERE status = 'pendente' AND criado_em < now() - interval '30 days'
       RETURNING foto_perfil_pendente`
    );
    r.rows.forEach((x) => removerArquivo(x.foto_perfil_pendente));
    if (r.rowCount) console.log(`[estacionamento] ${r.rowCount} pedido(s) de acesso expirado(s) removido(s).`);
  } catch (e) {
    console.error("[estacionamento] falha ao limpar pendentes:", e.message);
  }
}
setTimeout(limparPendentes, 30_000).unref();
setInterval(limparPendentes, 6 * 3600_000).unref();

// WhatsApp: guarda só dígitos com DDI. Aceita "(92) 99382-4906", "92993824906"
// ou já com 55. Devolve null se não parecer um celular/fixo brasileiro.
function normalizarWhatsapp(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : undefined; // undefined = inválido
}

function limpar(v, max = 120) {
  const t = String(v || "").trim().slice(0, max);
  return t || null;
}

async function salvarFoto(buffer, prefixo) {
  const nome = `${prefixo}-${crypto.randomBytes(8).toString("hex")}.webp`;
  await comprimir(buffer, path.join(DIR_FOTOS, nome));
  return nome;
}

// ------------------------------------------------------------- autocadastro
router.get("/cadastro", (_req, res) => {
  res.type("html").send(paginaCadastro({ carimbo: carimbo() }));
});

router.post("/cadastro", limiteCadastro, ...uploadUm("foto"), async (req, res, next) => {
  const b = req.body || {};
  const dados = {
    nome: limpar(b.nome),
    login: String(b.login || "").trim().toLowerCase(),
    setor: limpar(b.setor),
    ramal: limpar(b.ramal, 20),
    whatsappBruto: String(b.whatsapp || ""),
  };
  const refazer = (erro) =>
    res.status(400).type("html").send(paginaCadastro({ erro, valores: dados, carimbo: carimbo() }));

  try {
    // Campo-isca preenchido = robô: finge sucesso e não grava nada.
    if (b.site) {
      auditar("cadastro_isca", req);
      return res.type("html").send(paginaCadastroEnviado());
    }
    if (!carimboValido(b._t)) return refazer("Por segurança, confira os dados e envie de novo.");
    if (excedeuCadastro(req.ip)) return refazer("Muitos pedidos deste dispositivo. Tente de novo mais tarde.");
    const pend = await pool.query(`SELECT count(*)::int AS n FROM usuario WHERE status = 'pendente'`);
    if (pend.rows[0].n >= MAX_PENDENTES)
      return refazer("Os pedidos de acesso estão temporariamente fechados. Fale com a secretaria.");
    if (!dados.nome || dados.nome.length < 5) return refazer("Informe seu nome completo.");
    if (!/^[a-z0-9._-]{3,30}$/.test(dados.login))
      return refazer("Usuário: 3 a 30 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.");
    if (String(b.senha || "").length < 8) return refazer("A senha precisa ter pelo menos 8 caracteres.");
    if (String(b.senha).length > 128) return refazer("A senha pode ter no máximo 128 caracteres.");
    if (senhaFraca(b.senha, dados.login)) return refazer("Escolha uma senha menos óbvia (não use sequências nem o seu usuário).");
    if (b.senha !== b.senha2) return refazer("As senhas não conferem.");
    if (!dados.setor) return refazer("Informe seu setor.");
    const whatsapp = normalizarWhatsapp(b.whatsapp);
    if (whatsapp === undefined) return refazer("WhatsApp inválido. Use DDD + número, ex.: (92) 99999-9999.");
    if (!b.consentimento) return refazer("É preciso concordar com o uso dos seus dados para continuar.");

    const existe = await pool.query(`SELECT 1 FROM usuario WHERE lower(login) = $1`, [dados.login]);
    if (existe.rowCount) return refazer("Esse usuário já existe. Escolha outro.");

    let fotoPendente = null;
    if (req.file) {
      try {
        fotoPendente = await salvarFoto(req.file.buffer, "perfil");
      } catch {
        return refazer("Não foi possível ler a foto. Tente outro arquivo JPG, PNG ou WEBP.");
      }
    }

    await pool.query(
      `INSERT INTO usuario (login, nome, papel, senha_hash, status, setor, ramal, whatsapp,
                            foto_perfil_pendente, consentimento_em)
       VALUES ($1, $2, 'membro', $3, 'pendente', $4, $5, $6, $7, now())`,
      [dados.login, dados.nome, hashSenha(b.senha), dados.setor, dados.ramal, whatsapp, fotoPendente]
    );
    pedidos.get(req.ip).push(Date.now());
    auditar("cadastro_pedido", req, { login: dados.login });
    res.type("html").send(paginaCadastroEnviado());
  } catch (e) {
    // Dois pedidos simultâneos com o mesmo usuário: a restrição UNIQUE do
    // banco decide, e a pessoa recebe um recado em vez de erro 500.
    if (e && e.code === "23505") return refazer("Esse usuário já existe. Escolha outro.");
    next(e);
  }
});

// ------------------------------------------------------------------- perfil
router.get("/perfil", requireAuth, (req, res) => res.redirect(`${BASE_PATH}/perfil/${req.sessao.id}`));

router.get("/perfil/:id", requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, nome, login, setor, ramal, whatsapp, bio, papel, foto_perfil, foto_perfil_pendente
         FROM usuario WHERE id = $1 AND status = 'aprovado' AND ativo`,
      [req.params.id]
    );
    const pessoa = r.rows[0];
    if (!pessoa) return res.status(404).type("html").send("<p>Perfil não encontrado.</p>");
    const meu = String(pessoa.id) === String(req.sessao.id);
    // Dono e admin enxergam também os carros ainda pendentes ou recusados.
    const verTodos = meu || req.sessao.papel === "admin";
    const carros = await pool.query(
      `SELECT v.id, v.placa, v.modelo, v.cor, v.status, v.motivo_recusa,
              (v.foto IS NOT NULL OR EXISTS (
                 SELECT 1 FROM veiculo_foto f WHERE f.veiculo_id = v.id
                  AND (f.arquivo IS NOT NULL ${verTodos ? "OR f.arquivo_pendente IS NOT NULL" : ""}))) AS tem_foto
         FROM veiculo v WHERE v.usuario_id = $1 ${verTodos ? "" : "AND v.status = 'aprovado'"} ORDER BY v.id`,
      [pessoa.id]
    );
    res.type("html").send(
      paginaPerfil({ pessoa, sessao: req.sessao, meu, carros: carros.rows, msg: String(req.query.msg || "") })
    );
  } catch (e) {
    next(e);
  }
});

router.get("/perfil/:id/editar", requireAuth, async (req, res, next) => {
  try {
    if (String(req.params.id) !== String(req.sessao.id) && req.sessao.papel !== "admin")
      return res.status(403).type("html").send("<p>Você só edita o seu próprio perfil.</p>");
    const r = await pool.query(
      `SELECT id, nome, setor, ramal, whatsapp, bio, foto_perfil, foto_perfil_pendente FROM usuario WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).send("Perfil não encontrado.");
    res.type("html").send(paginaPerfilEdicao({ pessoa: r.rows[0], sessao: req.sessao, msg: String(req.query.msg || "") }));
  } catch (e) {
    next(e);
  }
});

router.post("/perfil/:id", requireAuth, ...uploadUm("foto"), async (req, res, next) => {
  try {
    const id = req.params.id;
    const dono = String(id) === String(req.sessao.id);
    if (!dono && req.sessao.papel !== "admin") return res.status(403).send("Sem permissão.");
    const volta = (m) => res.redirect(`${BASE_PATH}/perfil/${id}/editar?msg=${encodeURIComponent(m)}`);

    const b = req.body || {};
    const whatsapp = normalizarWhatsapp(b.whatsapp);
    if (whatsapp === undefined) return volta("WhatsApp inválido. Use DDD + número.");
    const nome = limpar(b.nome);
    if (!nome || nome.length < 5) return volta("Informe o nome completo.");

    const atual = await pool.query(`SELECT foto_perfil, foto_perfil_pendente FROM usuario WHERE id = $1`, [id]);
    if (!atual.rows[0]) return res.status(404).send("Perfil não encontrado.");

    let aviso = "Perfil atualizado.";
    let fotoPendente = atual.rows[0].foto_perfil_pendente;
    if (req.file) {
      try {
        const nova = await salvarFoto(req.file.buffer, "perfil");
        removerArquivo(fotoPendente); // descarta a pendente anterior, nunca aprovada
        fotoPendente = nova;
        aviso = "Perfil atualizado. A nova foto aparece depois da aprovação.";
      } catch {
        return volta("Não foi possível ler a foto. Tente outro arquivo.");
      }
    }
    // Admin editando o próprio perfil (ou o de alguém) não precisa de segunda
    // pessoa para aprovar: a foto entra direto.
    let fotoAtual = atual.rows[0].foto_perfil;
    if (req.file && req.sessao.papel === "admin") {
      removerArquivo(fotoAtual);
      fotoAtual = fotoPendente;
      fotoPendente = null;
      aviso = "Perfil atualizado.";
    }

    await pool.query(
      `UPDATE usuario SET nome=$1, setor=$2, ramal=$3, whatsapp=$4, bio=$5,
                          foto_perfil=$6, foto_perfil_pendente=$7 WHERE id=$8`,
      [nome, limpar(b.setor), limpar(b.ramal, 20), whatsapp, limpar(b.bio, 280), fotoAtual, fotoPendente, id]
    );
    res.redirect(`${BASE_PATH}/perfil/${id}?msg=${encodeURIComponent(aviso)}`);
  } catch (e) {
    next(e);
  }
});

// Foto de perfil. Qualquer logado vê a foto aprovada; a pendente só o dono e o
// admin (por isso a rota recebe ?pendente=1 e confere quem pede).
router.get("/perfil/:id/foto", requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT foto_perfil, foto_perfil_pendente, status, ativo FROM usuario WHERE id = $1`,
      [req.params.id]
    );
    const u = r.rows[0];
    if (!u) return res.status(404).send("Sem foto.");
    const quer = req.query.pendente === "1";
    const podeVerPendente = String(req.params.id) === String(req.sessao.id) || req.sessao.papel === "admin";
    // Quem ainda não foi aprovado (ou foi desativado) não é visível a colegas.
    if (!podeVerPendente && (u.status !== "aprovado" || !u.ativo)) return res.status(404).send("Sem foto.");
    const nome = quer && podeVerPendente ? u.foto_perfil_pendente : u.foto_perfil;
    if (!nome) return res.status(404).send("Sem foto.");
    await enviarFoto(res, nome, req.query.m === "1");
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- admin
router.get("/admin/pendencias", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const usuarios = await pool.query(
      `SELECT id, nome, login, setor, ramal, whatsapp, foto_perfil_pendente, criado_em
         FROM usuario WHERE status = 'pendente' ORDER BY criado_em`
    );
    const fotos = await pool.query(
      `SELECT id, nome, setor, foto_perfil, foto_perfil_pendente
         FROM usuario WHERE status = 'aprovado' AND foto_perfil_pendente IS NOT NULL ORDER BY nome`
    );
    const carros = await pool.query(
      `SELECT v.id, v.placa, v.modelo, v.cor, v.placa_lida, v.placa_origem, u.nome AS dono, u.setor,
              (SELECT json_agg(json_build_object('id', o.id, 'nome', o.nome, 'setor', o.setor))
                 FROM veiculo o WHERE o.usuario_id IS NULL AND o.placa = v.placa) AS fichas_antigas,
              (SELECT json_agg(json_build_object('tipo', f.tipo) ORDER BY f.tipo)
                 FROM veiculo_foto f WHERE f.veiculo_id = v.id AND f.arquivo_pendente IS NOT NULL) AS fotos,
              EXISTS (SELECT 1 FROM veiculo o WHERE o.placa = v.placa AND o.id <> v.id AND o.usuario_id IS NOT NULL
                         AND o.usuario_id IS DISTINCT FROM v.usuario_id) AS duplicada
         FROM veiculo v LEFT JOIN usuario u ON u.id = v.usuario_id
        WHERE v.status = 'pendente' ORDER BY v.id`
    );
    const fotosCarro = await pool.query(
      `SELECT v.id, v.placa, v.modelo, f.tipo, u.nome AS dono
         FROM veiculo_foto f JOIN veiculo v ON v.id = f.veiculo_id LEFT JOIN usuario u ON u.id = v.usuario_id
        WHERE v.status = 'aprovado' AND f.arquivo_pendente IS NOT NULL ORDER BY v.id, f.tipo`
    );
    res.type("html").send(
      paginaPendencias({
        usuarios: usuarios.rows,
        fotos: fotos.rows,
        carros: carros.rows,
        fotosCarro: fotosCarro.rows,
        sessao: req.sessao,
        msg: String(req.query.msg || ""),
      })
    );
  } catch (e) {
    next(e);
  }
});

async function registrar(client, tipo, alvo, decisao, motivo, por) {
  await client.query(
    `INSERT INTO aprovacao_log (tipo, alvo_id, decisao, motivo, decidido_por) VALUES ($1,$2,$3,$4,$5)`,
    [tipo, alvo, decisao, motivo, por]
  );
}

router.post("/admin/usuario/:id/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao)) return res.status(400).send("Decisão inválida.");
  const motivo = limpar(req.body.motivo, 200);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const novo = decisao === "aprovar" ? "aprovado" : "recusado";
    const r = await client.query(
      `UPDATE usuario SET status=$1, motivo_recusa=$2, foto_perfil=COALESCE(foto_perfil_pendente, foto_perfil),
                          foto_perfil_pendente=NULL
        WHERE id=$3 AND status='pendente' RETURNING id`,
      [novo, novo === "recusado" ? motivo : null, id]
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Esse pedido já foi decidido.")}`);
    }
    await registrar(client, "usuario", id, novo, motivo, req.sessao.id);
    await client.query("COMMIT");
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent(novo === "aprovado" ? "Acesso aprovado." : "Acesso recusado.")}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

router.post("/admin/foto-perfil/:id/:decisao", requireAuth, requireAdmin, async (req, res, next) => {
  const { id, decisao } = req.params;
  if (!["aprovar", "recusar"].includes(decisao)) return res.status(400).send("Decisão inválida.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const atual = await client.query(
      `SELECT foto_perfil, foto_perfil_pendente FROM usuario WHERE id=$1 FOR UPDATE`,
      [id]
    );
    const u = atual.rows[0];
    if (!u || !u.foto_perfil_pendente) {
      await client.query("ROLLBACK");
      return res.redirect(`${BASE_PATH}/admin/pendencias`);
    }
    if (decisao === "aprovar") {
      await client.query(`UPDATE usuario SET foto_perfil=foto_perfil_pendente, foto_perfil_pendente=NULL WHERE id=$1`, [id]);
    } else {
      await client.query(`UPDATE usuario SET foto_perfil_pendente=NULL WHERE id=$1`, [id]);
    }
    await registrar(client, "foto_perfil", id, decisao === "aprovar" ? "aprovado" : "recusado", null, req.sessao.id);
    await client.query("COMMIT");
    removerArquivo(decisao === "aprovar" ? u.foto_perfil : u.foto_perfil_pendente);
    res.redirect(`${BASE_PATH}/admin/pendencias?msg=${encodeURIComponent("Foto " + (decisao === "aprovar" ? "aprovada." : "recusada."))}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = { router, normalizarWhatsapp, limpar, salvarFoto, registrar, limparPendentes };
