"use strict";

// Páginas da busca (home), do diretório de pessoas e da administração das
// fichas antigas. Mesma moldura e CSS das demais páginas sociais.

const { esc, avatar, moldura, mensagem, asset } = require("./paginas-social");

const BASE_PATH = process.env.BASE_PATH || "/estacionamento";

const IC_CAMERA = `<svg viewBox="0 0 24 24" aria-hidden="true" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>`;

// ---------------------------------------------------------------- resultado
function cartaoResultado(r) {
  const nome = r.nome || "Sem nome";
  const zap = r.whatsapp
    ? `<a class="btn zap" href="https://wa.me/${esc(r.whatsapp)}" target="_blank" rel="noopener">Chamar no WhatsApp</a>`
    : "";
  const perfil = r.dono_id ? `<a class="btn" href="${BASE_PATH}/perfil/${r.dono_id}">Ver perfil</a>` : "";
  const foto = r.tem_foto
    ? `<img class="res-carro" src="${BASE_PATH}/carros/${r.id}/foto?m=1" alt="Foto do carro ${esc(r.placa)}" width="220" height="140" loading="lazy">`
    : "";
  const fatos = [
    r.setor ? `<span class="chip">${esc(r.setor)}</span>` : "",
    r.ramal ? `<span class="chip">Ramal ${esc(r.ramal)}</span>` : "",
  ].join("");
  return `<article class="resultado">
    <div class="res-dono">
      ${r.dono_id ? avatar({ id: r.dono_id, nome, foto_perfil: r.foto_perfil }, 72) : avatar({ id: 0, nome }, 72)}
      <div class="res-texto">
        <h3>${esc(nome)}</h3>
        <div class="chips">${fatos || `<span class="suave">sem setor informado</span>`}</div>
      </div>
    </div>
    <div class="res-carro-info">
      ${foto}
      <div>
        ${r.placa ? `<span class="placa">${esc(r.placa)}</span>` : ""}
        <p class="suave" style="margin:6px 0 0">${esc(r.modelo || "Modelo não informado")}${r.cor ? ` · ${esc(r.cor)}` : ""}${r.antiga ? " · ficha antiga" : ""}</p>
      </div>
    </div>
    <div class="acoes">${zap}${perfil}</div>
  </article>`;
}

function blocoResultados({ q, consulta, resultados, sugestoes, camera }) {
  if (!consulta) return "";
  const titulo = esc(q || "sua busca");
  if (resultados.length) {
    return `<section class="secao" id="resultado" aria-live="polite">
      <h2>${resultados.length === 1 ? "Achei" : `Achei ${resultados.length}`} ${esc(camera ? "pela câmera" : "para")} <span class="suave">${camera ? "" : titulo}</span></h2>
      <div class="resultados">${resultados.map(cartaoResultado).join("")}</div>
    </section>`;
  }
  const sug = sugestoes.length
    ? `<p>Será que é um destes?</p>
       <div class="acoes" style="justify-content:center">${sugestoes
         .map((s) => `<a class="btn forte" href="${BASE_PATH}/buscar?q=${encodeURIComponent(s.placa)}"><span class="placa">${esc(s.placa)}</span></a>`)
         .join("")}</div>`
    : "";
  return `<section class="secao" id="resultado" aria-live="polite">
    <div class="vazio">
      <h3 style="margin-bottom:8px">Não achei ninguém para ${titulo}</h3>
      ${sug}
      <p class="suave" style="margin:12px 0 0">Confira a placa e tente de novo, ou aponte a câmera outra vez.</p>
    </div>
  </section>`;
}

function paginaInicio({ sessao, q = "", consulta = false, resultados = [], sugestoes = [], camera = false, msg = "" }) {
  return moldura(
    "Buscar",
    `${mensagem(msg)}
    <section class="busca" data-busca>
      <h1>De quem é este carro?</h1>
      <p class="suave">Aponte a câmera para a placa ou digite a placa, o nome ou o ramal.</p>
      <button type="button" class="btn forte gigante" data-abrir-camera hidden>${IC_CAMERA}<span>Apontar a câmera na placa</span></button>
      <label class="btn forte gigante" for="foto-placa" data-foto-fallback>${IC_CAMERA}<span>Tirar foto da placa</span></label>
      <input id="foto-placa" class="so-leitor" type="file" accept="image/*" capture="environment" data-foto-placa>
      <form class="busca-form" method="get" action="${BASE_PATH}/buscar" role="search">
        <input type="hidden" name="origem" value="" data-origem>
        <input type="hidden" name="placas" value="" data-placas>
        <div class="campo"><label for="q" class="so-leitor">Placa, nome, setor ou ramal</label>
          <input id="q" name="q" value="${esc(q)}" maxlength="60" autocomplete="off" autocapitalize="characters"
                 placeholder="Placa, nome ou ramal" enterkeyhint="search"></div>
        <button class="btn">Buscar</button>
      </form>
      <p class="estado-ocr suave" data-ocr-estado aria-live="polite"></p>
    </section>
    <div class="camera" data-camera hidden>
      <div class="camera-palco">
        <video playsinline muted autoplay data-video></video>
        <div class="camera-quadro" aria-hidden="true"><span>Encaixe a placa aqui</span></div>
      </div>
      <p class="camera-dica" data-camera-dica aria-live="polite">Aproxime até a placa ocupar o quadro.</p>
      <div class="acoes" style="justify-content:center">
        <button type="button" class="btn forte" data-camera-foto>Capturar agora</button>
        <button type="button" class="btn" data-camera-fechar>Fechar</button>
      </div>
    </div>
    ${blocoResultados({ q, consulta, resultados, sugestoes, camera })}
    <script src="${asset("placa-ocr.js")}" defer></script>
    <script src="${asset("camera.js")}" defer></script>`,
    sessao,
    "inicio"
  );
}

// ------------------------------------------------------------------ pessoas
function paginaPessoas({ sessao, pessoas, q = "" }) {
  const lista = pessoas.length
    ? `<div class="pessoas">${pessoas
        .map(
          (p) => `<a class="pessoa" href="${BASE_PATH}/perfil/${p.id}">${avatar(p, 56)}
            <span><b>${esc(p.nome)}</b><small>${esc(p.setor || "sem setor")}${p.ramal ? ` · ramal ${esc(p.ramal)}` : ""}</small></span></a>`
        )
        .join("")}</div>`
    : `<div class="vazio">Ninguém encontrado.</div>`;
  return moldura(
    "Pessoas",
    `<h1 style="margin-bottom:14px">Pessoas</h1>
    <form class="busca-form" method="get" action="${BASE_PATH}/pessoas" role="search">
      <div class="campo"><label for="q" class="so-leitor">Nome, setor ou ramal</label>
        <input id="q" name="q" value="${esc(q)}" maxlength="60" placeholder="Nome, setor ou ramal"></div>
      <button class="btn">Buscar</button>
    </form>
    <section class="secao">${lista}</section>`,
    sessao,
    "pessoas"
  );
}

// ------------------------------------------------------------------- fichas
function paginaFichas({ sessao, fichas, q = "", total = 0, pagina = 1, paginas = 1, msg = "" }) {
  const linhas = fichas.length
    ? fichas
        .map(
          (f) => `<tr>
        <td><span class="placa">${esc(f.placa || "—")}</span></td>
        <td>${esc(f.nome || "—")}</td>
        <td>${esc(f.setor || "—")}</td>
        <td>${esc(f.ramal || "—")}</td>
        <td>${esc([f.modelo, f.cor].filter(Boolean).join(" · ") || "—")}</td>
        <td class="acoes-tabela"><a class="btn pequeno" href="${BASE_PATH}/admin/fichas/${f.id}">Editar</a></td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="6"><div class="vazio">Nenhuma ficha.</div></td></tr>`;
  const link = (n) => `${BASE_PATH}/admin/fichas?${q ? `q=${encodeURIComponent(q)}&` : ""}p=${n}`;
  return moldura(
    "Fichas antigas",
    `${mensagem(msg)}
    <h1 style="margin-bottom:6px">Fichas antigas</h1>
    <p class="suave" style="margin:0 0 16px">Cadastros do sistema anterior, sem conta. Continuam aparecendo na busca. (${total})</p>
    <form class="busca-form" method="get" action="${BASE_PATH}/admin/fichas" role="search">
      <div class="campo"><label for="q" class="so-leitor">Buscar fichas</label>
        <input id="q" name="q" value="${esc(q)}" maxlength="60" placeholder="Placa, nome, setor ou ramal"></div>
      <button class="btn">Buscar</button>
    </form>
    <div class="tabela-rolavel"><table class="tabela">
      <thead><tr><th>Placa</th><th>Nome</th><th>Setor</th><th>Ramal</th><th>Carro</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
    ${
      paginas > 1
        ? `<nav class="paginacao" aria-label="Páginas">${pagina > 1 ? `<a class="btn pequeno" href="${link(pagina - 1)}">← Anterior</a>` : ""}
           <span class="suave">Página ${pagina} de ${paginas}</span>
           ${pagina < paginas ? `<a class="btn pequeno" href="${link(pagina + 1)}">Próxima →</a>` : ""}</nav>`
        : ""
    }`,
    sessao,
    "fichas"
  );
}

function paginaFichaEdicao({ sessao, ficha, erro = "" }) {
  const v = (k) => esc(ficha[k] || "");
  return moldura(
    "Editar ficha",
    `${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ""}
    <p style="margin:0 0 6px"><a href="${BASE_PATH}/admin/fichas">← Fichas antigas</a></p>
    <h1 style="margin-bottom:18px">Editar ficha</h1>
    <form class="form" style="max-width:560px" method="post" action="${BASE_PATH}/admin/fichas/${ficha.id}">
      <div class="campo"><label for="placa">Placa</label>
        <input id="placa" name="placa" value="${v("placa")}" maxlength="8" autocapitalize="characters" class="entrada-placa"></div>
      <div class="campo"><label for="nome">Nome</label><input id="nome" name="nome" value="${v("nome")}" maxlength="120"></div>
      <div class="duas">
        <div class="campo"><label for="setor">Setor</label><input id="setor" name="setor" value="${v("setor")}" maxlength="120"></div>
        <div class="campo"><label for="ramal">Ramal</label><input id="ramal" name="ramal" value="${v("ramal")}" maxlength="20"></div>
      </div>
      <div class="duas">
        <div class="campo"><label for="modelo">Modelo</label><input id="modelo" name="modelo" value="${v("modelo")}" maxlength="80"></div>
        <div class="campo"><label for="cor">Cor</label><input id="cor" name="cor" value="${v("cor")}" maxlength="40"></div>
      </div>
      <div class="acoes"><button class="btn forte">Salvar</button><a class="btn" href="${BASE_PATH}/admin/fichas">Cancelar</a></div>
    </form>
    <form method="post" action="${BASE_PATH}/admin/fichas/${ficha.id}/excluir" data-confirmar="Excluir esta ficha de vez?" style="margin-top:28px">
      <button class="btn pequeno perigo">Excluir ficha</button></form>`,
    sessao,
    "fichas"
  );
}

module.exports = { paginaInicio, paginaPessoas, paginaFichas, paginaFichaEdicao };
