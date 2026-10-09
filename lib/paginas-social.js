"use strict";

// Páginas da rede social interna (Fase 1). HTML no servidor, CSS estático em
// public/estilo.css. As páginas antigas (lista/edição de veículo) ainda usam a
// moldura de lib/paginas.js e migram na Fase 3.

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
  return `<img class="avatar" ${estilo} src="${BASE_PATH}/perfil/${pessoa.id}/foto${q}" alt="">`;
}

function moldura(titulo, corpo, sessao, ativo = "") {
  const admin = sessao && sessao.papel === "admin";
  const nav = sessao
    ? `<nav class="nav" aria-label="Principal">
         <a href="${BASE_PATH}/"${ativo === "inicio" ? " aria-current=\"page\"" : ""}>Pessoas</a>
         ${admin ? `<a href="${BASE_PATH}/admin/pendencias"${ativo === "admin" ? " aria-current=\"page\"" : ""}>Aprovações</a>` : ""}
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
<title>${esc(titulo)} · Estacionamento</title>
<link rel="stylesheet" href="${BASE_PATH}/publico/estilo.css">
</head><body>
<header class="topo"><div class="topo-in">
  <a class="marca" href="${BASE_PATH}/"><i></i>Estacionamento</a>${nav}
</div></header>
<main>${corpo}</main>
<p class="rodape">Diretório interno de funcionários e veículos. Dados de uso restrito.</p>
</body></html>`;
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

function paginaCadastro({ erro = "", valores = {} } = {}) {
  const v = (k) => esc(valores[k] || "");
  return moldura(
    "Pedir acesso",
    entrada(
      "Pedir acesso",
      `<h1>Entre para o pátio</h1><p>Seu perfil e seu carro aparecem para os colegas depois que a secretaria aprovar.</p>`,
      `${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}
      <form class="form" method="post" action="${BASE_PATH}/cadastro" enctype="multipart/form-data">
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

function cartaoCarro(c, dono) {
  const foto = c.foto
    ? `<img src="${BASE_PATH}/carros/${c.id}/foto" alt="Foto do carro ${esc(c.placa)}" loading="lazy">`
    : `<div class="carro-sem">sem foto</div>`;
  return `<div class="carro">
    ${foto}
    <div class="carro-info">
      <span class="placa">${esc(c.placa)}</span>
      <b>${esc(c.modelo || "Modelo não informado")}</b>${c.cor ? `<span class="suave"> · ${esc(c.cor)}</span>` : ""}
      ${c.status !== "aprovado" ? `<span class="selo ${c.status}">${ROTULO_STATUS[c.status]}</span>` : ""}
      ${c.status === "recusado" && c.motivo_recusa ? `<small class="suave">Motivo: ${esc(c.motivo_recusa)}</small>` : ""}
      ${dono && c.foto_pendente ? `<small class="suave">Nova foto aguardando aprovação.</small>` : ""}
      ${dono ? `<div class="acoes"><a class="btn pequeno" href="${BASE_PATH}/carros/${c.id}/editar">Editar</a></div>` : ""}
    </div>
  </div>`;
}

function paginaCarro({ sessao, carro = {}, editar = false, erro = "", msg = "" }) {
  const acao = editar ? `${BASE_PATH}/carros/${carro.id}` : `${BASE_PATH}/carros`;
  return moldura(
    editar ? "Editar carro" : "Cadastrar carro",
    `${mensagem(msg, "aviso")}${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}
    <h1 style="margin-bottom:22px">${editar ? "Editar carro" : "Cadastrar carro"}</h1>
    <form class="form" style="max-width:520px" method="post" action="${acao}" enctype="multipart/form-data">
      <div class="campo"><label for="placa">Placa</label>
        <input id="placa" name="placa" value="${esc(carro.placa)}" maxlength="8" autocapitalize="characters" autocomplete="off"
               style="text-transform:uppercase;letter-spacing:.12em;font-weight:700" placeholder="ABC1D23" required></div>
      <div class="duas">
        <div class="campo"><label for="modelo">Modelo</label><input id="modelo" name="modelo" value="${esc(carro.modelo)}" placeholder="Onix, Hilux…" required></div>
        <div class="campo"><label for="cor">Cor</label><input id="cor" name="cor" value="${esc(carro.cor)}"></div>
      </div>
      <div class="campo"><label for="foto">Foto do carro <small>(passa por aprovação)</small></label>
        <input id="foto" type="file" name="foto" accept="image/jpeg,image/png,image/webp"></div>
      <p class="suave" style="margin:0">${editar ? "Se você trocar a placa, o carro volta para aprovação." : "O carro aparece para os colegas depois que a secretaria aprovar."}</p>
      <div class="acoes"><button class="btn forte">${editar ? "Salvar" : "Enviar para aprovação"}</button>
        <a class="btn" href="${BASE_PATH}/perfil/${esc(carro.usuario_id || sessao.id)}">Cancelar</a></div>
    </form>
    ${
      editar
        ? `<form method="post" action="${BASE_PATH}/carros/${carro.id}/excluir" style="margin-top:28px">
             <button class="btn pequeno perigo">Remover carro</button></form>`
        : ""
    }`,
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

  const miniatura = (id) =>
    `<img class="avatar" style="--t:56px;border-radius:12px" src="${BASE_PATH}/carros/${id}/foto?pendente=1" alt="">`;

  const blocoCarros = carros.length
    ? carros
        .map((c) => {
          const antigas = c.fichas_antigas || [];
          const absorver = antigas.length
            ? `<label class="check" style="flex-basis:100%"><input type="checkbox" name="absorver" value="${antigas[0].id}">
                 <span>Ficha antiga com esta placa: <b>${esc(antigas[0].nome || "sem nome")}</b>${antigas[0].setor ? ` (${esc(antigas[0].setor)})` : ""}. Absorver e apagar a ficha antiga.</span></label>`
            : "";
          return `<div class="item">${c.foto_pendente ? miniatura(c.id) : `<span class="avatar" style="--t:56px;border-radius:12px" aria-hidden="true">·</span>`}
          <div><h3><span class="placa">${esc(c.placa)}</span> ${esc(c.modelo || "")}</h3>
            <p>${esc(c.dono || "sem dono")}${c.setor ? ` · ${esc(c.setor)}` : ""}${c.cor ? ` · ${esc(c.cor)}` : ""}</p></div>
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
          (c) => `<div class="item">${miniatura(c.id)}
        <div><h3><span class="placa">${esc(c.placa)}</span> ${esc(c.modelo || "")}</h3><p>Nova foto de ${esc(c.dono || "sem dono")}</p></div>
        <div class="acoes">${dec(`${BASE_PATH}/admin/foto-carro/${c.id}/aprovar`, "Aprovar", "forte")}${dec(`${BASE_PATH}/admin/foto-carro/${c.id}/recusar`, "Recusar", "perigo")}</div>
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
  paginaLogin,
  paginaCadastro,
  paginaCadastroEnviado,
  paginaPerfil,
  paginaPerfilEdicao,
  paginaPendencias,
  paginaCarro,
};
