"use strict";

// Páginas da rede social interna (Fase 1). HTML no servidor, CSS estático em
// public/estilo.css. As páginas antigas (lista/edição de veículo) ainda usam a
// moldura de lib/paginas.js e migram na Fase 3.

const fs = require("node:fs");
const path = require("node:path");
const { TIPOS } = require("./tipos-foto");

const BASE_PATH = process.env.BASE_PATH || "/estacionamento";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iniciais(nome) {
  const p = String(nome || "?").trim().split(/\s+/);
  return ((p[0] || "")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

// Foto redonda; sem foto, as iniciais.
function avatar(pessoa, tamanho = 64, pendente = false) {
  const foto = pendente ? pessoa.foto_perfil_pendente : pessoa.foto_perfil;
  const estilo = `style="--t:${tamanho}px"`;
  if (!foto) return `<span class="avatar" ${estilo} aria-hidden="true">${esc(iniciais(pessoa.nome))}</span>`;
  const q = pendente ? "?pendente=1" : "";
  return `<img class="avatar" ${estilo} src="${BASE_PATH}/perfil/${pessoa.id}/foto${q}${q ? "&" : "?"}m=1" alt="" width="${tamanho}" height="${tamanho}">`;
}

// URL de um arquivo de public/ com ?v=<mtime>: trocou o arquivo, o navegador
// pega o novo mesmo que tenha o antigo guardado.
const PUBLICO = path.join(__dirname, "..", "public");
const versoes = new Map();
function asset(nome) {
  if (!versoes.has(nome)) {
    let v = "0";
    try {
      v = String(Math.round(fs.statSync(path.join(PUBLICO, nome)).mtimeMs));
    } catch {}
    versoes.set(nome, v);
  }
  return `${BASE_PATH}/publico/${nome}?v=${versoes.get(nome)}`;
}

function moldura(titulo, corpo, sessao, ativo = "") {
  const admin = sessao && sessao.papel === "admin";
  const nav = sessao
    ? `<nav class="nav" aria-label="Principal">
         <a href="${BASE_PATH}/"${ativo === "inicio" ? " aria-current=\"page\"" : ""}>Buscar</a>
         <a href="${BASE_PATH}/pessoas"${ativo === "pessoas" ? " aria-current=\"page\"" : ""}>Pessoas</a>
         ${sessao.papel !== "consulta" ? `<a href="${BASE_PATH}/carros/novo"${ativo === "carro" ? " aria-current=\"page\"" : ""}>Cadastrar carro</a>` : ""}
         ${admin ? `<a href="${BASE_PATH}/admin/pendencias"${ativo === "admin" ? " aria-current=\"page\"" : ""}>Aprovações</a>
         <a href="${BASE_PATH}/admin/fichas"${ativo === "fichas" ? " aria-current=\"page\"" : ""}>Fichas</a>` : ""}
       </nav>
       <div class="eu">
         <a href="${BASE_PATH}/perfil" title="Meu perfil" style="text-decoration:none">${avatar({ id: sessao.id, nome: sessao.nome, foto_perfil: sessao.foto }, 36)}</a>
         <form method="post" action="${BASE_PATH}/sair"><button class="btn pequeno">Sair</button></form>
       </div>`
    : "";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#16303f">
<title>${esc(titulo)} · StateHub</title>
<link rel="stylesheet" href="${asset("estilo.css")}">
</head><body>
<header class="topo"><div class="topo-in">
  <a class="marca" href="${BASE_PATH}/"><i></i>StateHub</a>${nav}
</div></header>
<main>${corpo}</main>
<p class="rodape">Diretório interno de funcionários e veículos. Dados de uso restrito.</p>
<script src="${asset("app.js")}" defer></script></body></html>`;
}

function mensagem(msg, tipo = "ok") {
  return msg ? `<div class="${tipo}" role="status">${esc(msg)}</div>` : "";
}

// ------------------------------------------------------------ entrada
function entrada(titulo, lado, miolo) {
  return `<div class="entrada">
    <section class="lado">${lado}</section>
    <section class="miolo"><h2>${esc(titulo)}</h2>${miolo}</section>
  </div>`;
}

function paginaLogin({ erro = "", info = "", proximo = "", login = "" } = {}) {
  return moldura(
    "Entrar",
    entrada(
      "Entrar",
      `<h1>Quem estacionou aí?</h1><p>Encontre o dono do carro pela placa e fale com ele em um toque.</p>`,
      `${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}${info ? `<div class="aviso" role="status">${esc(info)}</div>` : ""}
      <form class="form" method="post" action="${BASE_PATH}/login">
        <input type="hidden" name="proximo" value="${esc(proximo)}">
        <div class="campo"><label for="login">Usuário</label>
          <input id="login" name="login" value="${esc(login)}" autocomplete="username" autocapitalize="none" autofocus required></div>
        <div class="campo"><label for="senha">Senha</label>
          <input id="senha" type="password" name="senha" autocomplete="current-password" required></div>
        <button class="btn forte">Entrar</button>
        <p style="margin:0;color:var(--suave);font-size:.9rem">Ainda não tem acesso? <a href="${BASE_PATH}/cadastro"><b>Peça o seu</b></a></p>
      </form>`
    ),
    null
  );
}

function paginaCadastro({ erro = "", valores = {}, carimbo = "" } = {}) {
  const v = (k) => esc(valores[k] || "");
  return moldura(
    "Pedir acesso",
    entrada(
      "Pedir acesso",
      `<h1>Entre para o pátio</h1><p>Seu perfil e seu carro aparecem para os colegas depois que a secretaria aprovar.</p>`,
      `${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}
      <form class="form" method="post" action="${BASE_PATH}/cadastro" enctype="multipart/form-data">
        <input type="hidden" name="_t" value="${esc(carimbo)}">
        <div class="isca" aria-hidden="true"><label>Não preencha <input name="site" tabindex="-1" autocomplete="off"></label></div>
        <div class="campo"><label for="nome">Nome completo</label>
          <input id="nome" name="nome" value="${v("nome")}" autocomplete="name" required></div>
        <div class="duas">
          <div class="campo"><label for="setor">Setor</label><input id="setor" name="setor" value="${v("setor")}" required></div>
          <div class="campo"><label for="ramal">Ramal <small>(opcional)</small></label><input id="ramal" name="ramal" value="${v("ramal")}" inputmode="numeric"></div>
        </div>
        <div class="campo"><label for="whatsapp">WhatsApp <small>(com DDD)</small></label>
          <input id="whatsapp" name="whatsapp" value="${v("whatsappBruto")}" inputmode="tel" autocomplete="tel" placeholder="(92) 99999-9999"></div>
        <div class="campo"><label for="foto">Sua foto <small>(opcional, passa por aprovação)</small></label>
          <input id="foto" type="file" name="foto" accept="image/jpeg,image/png,image/webp"></div>
        <div class="campo"><label for="login">Usuário de acesso</label>
          <input id="login" name="login" value="${v("login")}" autocomplete="username" autocapitalize="none" required></div>
        <div class="duas">
          <div class="campo"><label for="senha">Senha <small>(8+ caracteres)</small></label><input id="senha" type="password" name="senha" autocomplete="new-password" minlength="8" required></div>
          <div class="campo"><label for="senha2">Repita a senha</label><input id="senha2" type="password" name="senha2" autocomplete="new-password" minlength="8" required></div>
        </div>
        <label class="check"><input type="checkbox" name="consentimento" value="1" required>
          <span>Concordo que meu nome, setor, ramal, WhatsApp e foto fiquem visíveis aos demais funcionários aprovados, para contato sobre veículos no estacionamento.</span></label>
        <button class="btn forte">Enviar pedido</button>
        <p style="margin:0;color:var(--suave);font-size:.9rem">Já tem acesso? <a href="${BASE_PATH}/login"><b>Entrar</b></a></p>
      </form>`
    ),
    null
  );
}

function paginaCadastroEnviado() {
  return moldura(
    "Pedido enviado",
    entrada(
      "Pedido enviado",
      `<h1>Quase lá</h1><p>A secretaria vai analisar seu pedido.</p>`,
      `<p>Assim que for aprovado, é só entrar com o usuário e a senha que você escolheu.</p>
       <p><a class="btn" href="${BASE_PATH}/login">Voltar ao início</a></p>`
    ),
    null
  );
}

// ------------------------------------------------------------- perfil
function paginaPerfil({ pessoa, sessao, meu, carros = [], msg }) {
  const foto = pessoa.foto_perfil
    ? `<img class="retrato" src="${BASE_PATH}/perfil/${pessoa.id}/foto" alt="Foto de ${esc(pessoa.nome)}">`
    : `<div class="sem" aria-hidden="true">${esc(iniciais(pessoa.nome))}</div>`;
  const fatos = [
    ["Setor", pessoa.setor],
    ["Ramal", pessoa.ramal],
  ]
    .filter(([, val]) => val)
    .map(([k, val]) => `<div class="fato"><b>${k}</b><span>${esc(val)}</span></div>`)
    .join("");
  const zap = pessoa.whatsapp
    ? `<a class="btn zap" href="https://wa.me/${esc(pessoa.whatsapp)}" target="_blank" rel="noopener">Chamar no WhatsApp</a>`
    : "";
  const pode = meu || sessao.papel === "admin";
  const podeCarro = meu && sessao.papel !== "consulta";
  const garagem = `<section class="secao"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h2>${meu ? "Meus carros" : "Carros"}</h2>${podeCarro ? `<a class="btn pequeno forte" href="${BASE_PATH}/carros/novo">Cadastrar carro</a>` : ""}</div>
      ${
        carros.length
          ? `<div class="garagem">${carros.map((c) => cartaoCarro(c, pode)).join("")}</div>`
          : `<div class="vazio">${meu ? "Você ainda não cadastrou nenhum carro." : "Nenhum carro cadastrado."}</div>`
      }</section>`;
  return moldura(
    pessoa.nome,
    `${mensagem(msg)}
    <article class="perfil">
      <div>${foto}${meu && pessoa.foto_perfil_pendente ? `<p class="aviso" style="margin-top:12px">Sua nova foto está aguardando aprovação.</p>` : ""}</div>
      <div>
        <span class="papel">${pessoa.papel === "admin" ? "Administração" : "Funcionário"}</span>
        <h1>${esc(pessoa.nome)}</h1>
        ${pessoa.bio ? `<p style="font-size:1.1rem;max-width:52ch">${esc(pessoa.bio)}</p>` : ""}
        <div class="fatos">${fatos || ""}</div>
        <div class="acoes">${zap}${pode ? `<a class="btn" href="${BASE_PATH}/perfil/${pessoa.id}/editar">Editar perfil</a>` : ""}</div>
      </div>
    </article>${garagem}`,
    sessao
  );
}

function paginaPerfilEdicao({ pessoa, sessao, msg }) {
  return moldura(
    "Editar perfil",
    `${mensagem(msg, "aviso")}
    <h1 style="margin-bottom:22px">Editar perfil</h1>
    <form class="form" style="max-width:560px" method="post" action="${BASE_PATH}/perfil/${pessoa.id}" enctype="multipart/form-data">
      <div style="display:flex;align-items:center;gap:16px">${avatar(pessoa, 84)}
        <div class="campo" style="flex:1"><label for="foto">Nova foto <small>(passa por aprovação)</small></label>
          <input id="foto" type="file" name="foto" accept="image/jpeg,image/png,image/webp"></div></div>
      <div class="campo"><label for="nome">Nome completo</label><input id="nome" name="nome" value="${esc(pessoa.nome)}" required></div>
      <div class="duas">
        <div class="campo"><label for="setor">Setor</label><input id="setor" name="setor" value="${esc(pessoa.setor)}"></div>
        <div class="campo"><label for="ramal">Ramal</label><input id="ramal" name="ramal" value="${esc(pessoa.ramal)}" inputmode="numeric"></div>
      </div>
      <div class="campo"><label for="whatsapp">WhatsApp <small>(com DDD)</small></label>
        <input id="whatsapp" name="whatsapp" value="${esc(pessoa.whatsapp ? pessoa.whatsapp.replace(/^55/, "") : "")}" inputmode="tel" placeholder="(92) 99999-9999"></div>
      <div class="campo"><label for="bio">Sobre você <small>(até 280 caracteres)</small></label>
        <textarea id="bio" name="bio" maxlength="280">${esc(pessoa.bio)}</textarea></div>
      <div class="acoes"><button class="btn forte">Salvar</button><a class="btn" href="${BASE_PATH}/perfil/${pessoa.id}">Cancelar</a></div>
    </form>`,
    sessao
  );
}

// ------------------------------------------------------------- carros
const ROTULO_STATUS = { pendente: "Aguardando aprovação", recusado: "Recusado" };

// Desenhos de linha de cada ângulo pedido. São só um guia visual do que
// fotografar; a foto de verdade substitui o desenho no bloco.
const DESENHOS = {
  placa: `<svg viewBox="0 0 120 60" aria-hidden="true"><rect x="12" y="14" width="96" height="34" rx="5"/><rect x="12" y="14" width="96" height="9" rx="4" class="cheio"/><text x="60" y="41" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2">ABC1D23</text></svg>`,
  frente: `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M20 46V31q0-4 4-6l8-13h56l8 13q4 2 4 6v15z"/><path d="M36 15h48l5 10H31z"/><circle cx="32" cy="35" r="4"/><circle cx="88" cy="35" r="4"/><rect x="47" y="35" width="26" height="8" rx="2"/><rect x="22" y="46" width="9" height="7" rx="2" class="cheio"/><rect x="89" y="46" width="9" height="7" rx="2" class="cheio"/></svg>`,
  traseira: `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M20 46V31q0-4 4-6l8-13h56l8 13q4 2 4 6v15z"/><path d="M38 15h44l4 10H34z"/><rect x="24" y="30" width="14" height="6" rx="2" class="cheio"/><rect x="82" y="30" width="14" height="6" rx="2" class="cheio"/><rect x="47" y="35" width="26" height="8" rx="2"/><rect x="22" y="46" width="9" height="7" rx="2" class="cheio"/><rect x="89" y="46" width="9" height="7" rx="2" class="cheio"/></svg>`,
  lateral_esq: `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M8 42v-8q0-4 5-5l17-4 11-13q2-2 5-2h30q4 0 6 3l10 12 11 3q6 1 6 6v8z"/><path d="M42 14l-9 13h30V14zM68 14v13h24L82 15q-1-1-3-1z"/><circle cx="32" cy="43" r="8" class="roda"/><circle cx="90" cy="43" r="8" class="roda"/><path d="M6 36h5" /><path d="M20 22l-8-3" opacity="0"/><path d="M4 30l-3 2 3 2" /></svg>`,
  lateral_dir: `<svg viewBox="0 0 120 60" aria-hidden="true"><g transform="translate(120 0) scale(-1 1)"><path d="M8 42v-8q0-4 5-5l17-4 11-13q2-2 5-2h30q4 0 6 3l10 12 11 3q6 1 6 6v8z"/><path d="M42 14l-9 13h30V14zM68 14v13h24L82 15q-1-1-3-1z"/><circle cx="32" cy="43" r="8" class="roda"/><circle cx="90" cy="43" r="8" class="roda"/><path d="M4 30l-3 2 3 2" /></g></svg>`,
};

// capa: foto de destaque do cartão; sem foto, um aviso discreto.
function cartaoCarro(c, dono) {
  const foto = c.tem_foto
    ? `<img src="${BASE_PATH}/carros/${c.id}/foto?m=1" alt="Foto do carro ${esc(c.placa)}" loading="lazy">`
    : `<div class="carro-sem">sem foto</div>`;
  return `<div class="carro">
    <a href="${BASE_PATH}/carros/${c.id}" class="carro-foto" aria-label="Ver fotos do carro ${esc(c.placa)}">${foto}</a>
    <div class="carro-info">
      <span class="placa">${esc(c.placa)}</span>
      <b>${esc(c.modelo || "Modelo não informado")}</b>${c.cor ? `<span class="suave"> · ${esc(c.cor)}</span>` : ""}
      ${c.status !== "aprovado" ? `<span class="selo ${c.status}">${ROTULO_STATUS[c.status]}</span>` : ""}
      ${c.status === "recusado" && c.motivo_recusa ? `<small class="suave">Motivo: ${esc(c.motivo_recusa)}</small>` : ""}
      ${dono ? `<div class="acoes"><a class="btn pequeno" href="${BASE_PATH}/carros/${c.id}/editar">Editar</a></div>` : ""}
    </div>
  </div>`;
}

// Os 5 blocos de captura. `fotos` (edição) traz o que já existe por tipo.
function blocoFoto(t, carroId, fotos) {
  const f = fotos && fotos[t.tipo];
  const existente = f && (f.arquivo || f.arquivo_pendente);
  const pend = f && !f.arquivo && f.arquivo_pendente ? "&pendente=1" : "";
  return `<label class="bloco${t.obrigatoria ? " bloco-obrigatorio" : ""}${existente ? " feito" : ""}" data-tipo="${t.tipo}">
    <input class="so-leitor" type="file" name="foto_${t.tipo}" accept="image/*" capture="environment">
    <span class="bloco-arte">
      ${DESENHOS[t.tipo]}
      <img class="bloco-previa" alt="" ${existente ? `src="${BASE_PATH}/carros/${carroId}/foto?tipo=${t.tipo}${pend}&m=1"` : "hidden"}>
    </span>
    <span class="bloco-texto"><b>${t.rotulo}</b>${t.obrigatoria ? `<em>obrigatória</em>` : ""}<small>${existente ? "Toque para trocar" : t.dica}</small></span>
    <span class="bloco-ok" aria-hidden="true">✓</span>
  </label>`;
}

function paginaCarro({ sessao, carro = {}, fotos = null, editar = false, erro = "", msg = "" }) {
  const acao = editar ? `${BASE_PATH}/carros/${carro.id}` : `${BASE_PATH}/carros`;
  return moldura(
    editar ? "Editar carro" : "Cadastrar carro",
    `${mensagem(msg, "aviso")}${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}
    <h1 style="margin-bottom:6px">${editar ? "Editar carro" : "Cadastrar carro"}</h1>
    <p class="suave" style="margin:0 0 22px;max-width:60ch">Toque em cada bloco para tirar a foto. A foto da <b>placa</b> é obrigatória: o site lê a placa dela. As outras ajudam a achar o carro no pátio.</p>
    <form class="form carro-form" method="post" action="${acao}" enctype="multipart/form-data" data-captura>
      <div class="blocos">${TIPOS.map((t) => blocoFoto(t, carro.id, fotos)).join("")}</div>

      ${editar ? "" : `<div class="ficha-aviso" data-ficha hidden aria-live="polite"></div>
      <input type="hidden" name="reivindica" value="" data-reivindica>`}
      <div class="leitura" data-leitura aria-live="polite">
        <div class="campo"><label for="placa">Placa <small data-placa-estado>${editar ? "" : "(aparece aqui depois da foto da placa)"}</small></label>
          <input id="placa" name="placa" value="${esc(carro.placa)}" maxlength="8" autocapitalize="characters" autocomplete="off"
                 class="entrada-placa" placeholder="ABC1D23" required></div>
        <input type="hidden" name="placa_lida" value="">
      </div>

      <div class="duas">
        <div class="campo"><label for="modelo">Modelo</label><input id="modelo" name="modelo" value="${esc(carro.modelo)}" placeholder="Onix, Hilux…" required></div>
        <div class="campo"><label for="cor">Cor</label><input id="cor" name="cor" value="${esc(carro.cor)}"></div>
      </div>
      <p class="suave" style="margin:0">${editar ? "Trocar a placa ou a foto da placa leva o carro para nova aprovação." : "O carro aparece para os colegas depois que a secretaria aprovar."}</p>
      <div class="acoes"><button class="btn forte" data-enviar>${editar ? "Salvar" : "Enviar para aprovação"}</button>
        <a class="btn" href="${BASE_PATH}/perfil/${esc(carro.usuario_id || sessao.id)}">Cancelar</a></div>
    </form>
    ${
      editar
        ? `<form method="post" action="${BASE_PATH}/carros/${carro.id}/excluir" data-confirmar="Remover este carro?" style="margin-top:28px">
             <button class="btn pequeno perigo">Remover carro</button></form>`
        : ""
    }
    <script src="${asset("captura.js")}" defer></script>
    <script src="${asset("placa-ocr.js")}" defer></script>
    ${editar ? "" : `<script src="${asset("reivindicar.js")}" defer></script>`}`,
    sessao
  );
}

function paginaCarroDetalhe({ sessao, carro, fotos, dono, msg }) {
  const itens = TIPOS.map((t) => {
    const f = fotos[t.tipo];
    const aprovada = f && f.arquivo;
    const pendente = f && f.arquivo_pendente;
    if (!aprovada && !(dono && pendente)) return "";
    const q = aprovada ? "" : "&pendente=1";
    return `<figure class="galeria-item">
      <img src="${BASE_PATH}/carros/${carro.id}/foto?tipo=${t.tipo}${q}" alt="${t.rotulo} do carro ${esc(carro.placa)}" loading="lazy">
      <figcaption>${t.rotulo}${!aprovada ? ` <span class="selo pendente">Aguardando</span>` : dono && pendente ? ` <span class="selo pendente">Nova foto aguardando</span>` : ""}</figcaption>
    </figure>`;
  }).join("");
  return moldura(
    `Carro ${carro.placa}`,
    `${mensagem(msg)}
    <p style="margin:0 0 6px"><a href="${BASE_PATH}/perfil/${carro.dono_id || sessao.id}">← ${esc(carro.dono_nome || "Voltar")}</a></p>
    <h1 style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span class="placa" style="font-size:1.6rem">${esc(carro.placa)}</span>
      <span style="font-size:1.4rem">${esc(carro.modelo || "")}${carro.cor ? ` <span class="suave">· ${esc(carro.cor)}</span>` : ""}</span></h1>
    ${carro.status !== "aprovado" ? `<p><span class="selo ${carro.status}">${ROTULO_STATUS[carro.status]}</span></p>` : ""}
    <div class="acoes" style="margin:18px 0">
      ${carro.whatsapp ? `<a class="btn zap" href="https://wa.me/${esc(carro.whatsapp)}" target="_blank" rel="noopener">Chamar o dono no WhatsApp</a>` : ""}
      ${dono ? `<a class="btn" href="${BASE_PATH}/carros/${carro.id}/editar">Editar</a>` : ""}
    </div>
    ${itens ? `<div class="galeria">${itens}</div>` : `<div class="vazio">Este carro ainda não tem fotos.</div>`}`,
    sessao
  );
}

// ---------------------------------------------------------- aprovações
function paginaPendencias({ usuarios, fotos, carros = [], fotosCarro = [], sessao, msg }) {
  const dec = (url, rotulo, classe = "") =>
    `<form method="post" action="${url}" style="margin:0"><button class="btn pequeno ${classe}">${rotulo}</button></form>`;

  const blocoUsuarios = usuarios.length
    ? usuarios
        .map(
          (u) => `<div class="item">
        ${avatar({ id: u.id, nome: u.nome, foto_perfil: u.foto_perfil_pendente }, 56)}
        <div><h3>${esc(u.nome)}</h3>
          <p>${esc(u.setor || "sem setor")}${u.ramal ? ` · ramal ${esc(u.ramal)}` : ""}${u.whatsapp ? ` · +${esc(u.whatsapp)}` : ""} · usuário <b>${esc(u.login)}</b></p></div>
        <div class="acoes">${dec(`${BASE_PATH}/admin/usuario/${u.id}/aprovar`, "Aprovar", "forte")}${dec(`${BASE_PATH}/admin/usuario/${u.id}/recusar`, "Recusar", "perigo")}</div>
      </div>`
        )
        .join("")
    : `<div class="vazio">Nenhum pedido de acesso esperando.</div>`;

  const blocoFotos = fotos.length
    ? fotos
        .map(
          (u) => `<div class="item">
        ${avatar(u, 56, true)}
        <div><h3>${esc(u.nome)}</h3><p>Pediu para trocar a foto do perfil${u.setor ? ` · ${esc(u.setor)}` : ""}</p></div>
        <div class="acoes">${dec(`${BASE_PATH}/admin/foto-perfil/${u.id}/aprovar`, "Aprovar", "forte")}${dec(`${BASE_PATH}/admin/foto-perfil/${u.id}/recusar`, "Recusar", "perigo")}</div>
      </div>`
        )
        .join("")
    : `<div class="vazio">Nenhuma foto esperando.</div>`;

  const miniatura = (id, tipo, pendente = true) =>
    `<img class="miniatura" src="${BASE_PATH}/carros/${id}/foto?tipo=${tipo}${pendente ? "&pendente=1" : ""}&m=1" alt="${esc(tipo)}" width="96" height="72" loading="lazy">`;

  const blocoCarros = carros.length
    ? carros
        .map((c) => {
          const antigas = c.fichas_antigas || [];
          const fotosC = c.fotos || [];
          const placaFoto = fotosC.find((f) => f.tipo === "placa");
          const outras = fotosC.filter((f) => f.tipo !== "placa");
          const reivind = antigas.find((f) => String(f.id) === String(c.ficha_reivindicada));
          const linhaFicha = (f) =>
            `${esc(f.nome || "sem nome")}${f.setor ? ` · ${esc(f.setor)}` : ""}${f.ramal ? ` · ramal ${esc(f.ramal)}` : ""}${f.modelo ? ` · ${esc(f.modelo)}` : ""}${f.cor ? ` ${esc(f.cor)}` : ""}`;
          const absorver = antigas.length
            ? antigas
                .map(
                  (f) => `<label class="check" style="flex-basis:100%"><input type="checkbox" name="absorver" value="${f.id}"${reivind && f.id === reivind.id ? " checked" : ""}>
                 <span>${reivind && f.id === reivind.id ? "<b>Reivindicada:</b> " : "Ficha antiga com esta placa: "}${linhaFicha(f)}. Absorver e apagar a ficha antiga.</span></label>`
                )
                .join("")
            : "";
          const reivindicacao = reivind
            ? `<p class="ficha-reivind"><span class="selo ${c.nome_confere ? "aprovado" : "pendente"}">${c.nome_confere ? "Nome confere" : "Nome diferente"}</span>
                 Reivindica a ficha antiga de <b>${esc(reivind.nome || "sem nome")}</b>.</p>`
            : "";
          const avisos = [
            c.placa_origem === "corrigida" ? `<span class="selo pendente">Placa corrigida à mão (OCR leu ${esc(c.placa_lida || "?")})</span>` : "",
            c.placa_origem === "manual" ? `<span class="selo pendente">Placa digitada, sem leitura</span>` : "",
            c.duplicada ? `<span class="selo recusado">Placa já cadastrada por outra pessoa</span>` : "",
          ].join(" ");
          return `<div class="item item-carro">
          <div class="conferencia">
            ${placaFoto ? miniatura(c.id, "placa") : `<span class="avatar" style="--t:72px;border-radius:12px" aria-hidden="true">·</span>`}
            <div><span class="placa">${esc(c.placa)}</span><p class="suave" style="margin:4px 0 0;font-size:.8rem">confira: foto da placa × texto</p></div>
          </div>
          <div><h3>${esc(c.modelo || "")}${c.cor ? ` <span class="suave">· ${esc(c.cor)}</span>` : ""}</h3>
            <p>${esc(c.dono || "sem dono")}${c.setor ? ` · ${esc(c.setor)}` : ""}</p>
            <div class="mini-fotos">${outras.map((f) => miniatura(c.id, f.tipo)).join("")}</div>
            ${reivindicacao}${avisos ? `<p>${avisos}</p>` : ""}</div>
          <form method="post" action="${BASE_PATH}/admin/carro/${c.id}/aprovar" class="acoes" style="margin:0">
            <button class="btn pequeno forte">Aprovar</button>
            <button class="btn pequeno perigo" formaction="${BASE_PATH}/admin/carro/${c.id}/recusar">Recusar</button>
            ${absorver}
          </form></div>`;
        })
        .join("")
    : `<div class="vazio">Nenhum carro esperando.</div>`;

  const blocoFotosCarro = fotosCarro.length
    ? fotosCarro
        .map(
          (c) => `<div class="item">${miniatura(c.id, c.tipo)}
        <div><h3><span class="placa">${esc(c.placa)}</span> ${esc(c.modelo || "")}</h3><p>Nova foto (${esc(c.tipo)}) de ${esc(c.dono || "sem dono")}</p></div>
        <div class="acoes">${dec(`${BASE_PATH}/admin/foto-carro/${c.id}/${esc(c.tipo)}/aprovar`, "Aprovar", "forte")}${dec(`${BASE_PATH}/admin/foto-carro/${c.id}/${esc(c.tipo)}/recusar`, "Recusar", "perigo")}</div>
      </div>`
        )
        .join("")
    : `<div class="vazio">Nenhuma foto de carro esperando.</div>`;

  return moldura(
    "Aprovações",
    `${mensagem(msg)}
    <h1 style="margin-bottom:6px">Aprovações</h1>
    <p style="color:var(--suave);margin:0">O que está esperando uma decisão sua.</p>
    <section class="secao"><h2>Pedidos de acesso <small style="color:var(--suave)">(${usuarios.length})</small></h2><div class="fila">${blocoUsuarios}</div></section>
    <section class="secao"><h2>Carros <small style="color:var(--suave)">(${carros.length})</small></h2><div class="fila">${blocoCarros}</div></section>
    <section class="secao"><h2>Fotos de carros <small style="color:var(--suave)">(${fotosCarro.length})</small></h2><div class="fila">${blocoFotosCarro}</div></section>
    <section class="secao"><h2>Fotos de perfil <small style="color:var(--suave)">(${fotos.length})</small></h2><div class="fila">${blocoFotos}</div></section>`,
    sessao,
    "admin"
  );
}

module.exports = {
  esc,
  avatar,
  moldura,
  mensagem,
  asset,
  paginaLogin,
  paginaCadastro,
  paginaCadastroEnviado,
  paginaPerfil,
  paginaPerfilEdicao,
  paginaPendencias,
  paginaCarro,
  paginaCarroDetalhe,
};
