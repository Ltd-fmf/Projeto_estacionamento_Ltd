"use strict";

// Aviso ao staff pelo WhatsApp. Não fala com o WhatsApp: grava um job .json
// na pasta de fila do Jarvis (que roda no mesmo servidor); o Jarvis monta o
// cartão-imagem com as 5 fotos e envia pela sessão que ele já mantém.
//
//   AVISO_WHATSAPP_JID  destino: JID de grupo (…@g.us) ou só dígitos de um
//                       número (vira …@s.whatsapp.net). Sem ele, desligado.
//   JARVIS_FILA_DIR     pasta de jobs (padrão /opt/jarvis-revemar-cloud/outboxCarros)
//   BASE_URL            endereço público do site (vai no link da legenda)

const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../db/pool");
const { DIR_FOTOS } = require("./fotos");
const { TIPOS } = require("./tipos-foto");
const { auditar } = require("./seguranca");

const FILA_PADRAO = "/opt/jarvis-revemar-cloud/outboxCarros";
const EVENTOS = new Set(["cadastro", "aprovado"]);

function normalizarDestino(bruto) {
  const v = String(bruto || "").trim();
  if (!v) return null;
  if (/^[0-9]+(-[0-9]+)?@g\.us$/.test(v) || /^[0-9]+@s\.whatsapp\.net$/.test(v)) return v;
  const digitos = v.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 15 ? `${digitos}@s.whatsapp.net` : null;
}

async function montarJob(veiculoId, evento, destino) {
  const c = (
    await pool.query(
      `SELECT v.id, v.placa, v.placa_origem, v.placa_lida, v.modelo, v.cor, u.nome, u.setor
         FROM veiculo v LEFT JOIN usuario u ON u.id = v.usuario_id WHERE v.id = $1`,
      [veiculoId]
    )
  ).rows[0];
  if (!c) return null;
  const fotos = {};
  const linhas = (await pool.query(`SELECT tipo, arquivo, arquivo_pendente FROM veiculo_foto WHERE veiculo_id = $1`, [veiculoId])).rows;
  for (const t of TIPOS) {
    const f = linhas.find((l) => l.tipo === t.tipo);
    const nome = f && (f.arquivo || f.arquivo_pendente);
    // basename: o nome vem do banco, mas nunca deixamos sair da pasta de fotos.
    if (nome) fotos[t.tipo] = path.join(DIR_FOTOS, path.basename(nome));
  }
  return {
    evento,
    carro: c.id,
    nome: c.nome || "Sem dono",
    setor: c.setor || "",
    placa: c.placa,
    placaOrigem: c.placa_origem,
    modelo: c.modelo || "",
    cor: c.cor || "",
    fotos,
    destino,
    baseUrl: (process.env.BASE_URL || "").replace(/\/+$/, ""),
    criadoEm: new Date().toISOString(),
  };
}

// Nunca lança: aviso é acessório, não pode derrubar cadastro nem aprovação.
async function avisarCarro(veiculoId, evento, req = null) {
  try {
    if (!EVENTOS.has(evento)) return false;
    const destino = normalizarDestino(process.env.AVISO_WHATSAPP_JID);
    if (!destino) return false;
    const job = await montarJob(veiculoId, evento, destino);
    if (!job) return false;
    const dir = process.env.JARVIS_FILA_DIR || FILA_PADRAO;
    fs.mkdirSync(dir, { recursive: true });
    const nome = `carro-${veiculoId}-${evento}-${Date.now()}.json`;
    // Escrita atômica: o Jarvis nunca vê o arquivo pela metade.
    const tmp = path.join(dir, `.${nome}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, nome));
    auditar("aviso_jarvis", req, { carro: veiculoId, tipo: evento });
    return true;
  } catch (e) {
    try {
      auditar("aviso_jarvis_erro", req, { carro: veiculoId, tipo: evento, erro: String(e.message).slice(0, 120) });
    } catch {}
    return false;
  }
}

module.exports = { avisarCarro, normalizarDestino };
