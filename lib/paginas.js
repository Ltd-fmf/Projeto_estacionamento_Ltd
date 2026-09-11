"use strict";

// HTML renderizado no servidor, em template string — sem framework de front
// nem build. A paleta é a do app Tkinter original (verde/azul), para quem usava
// o desktop reconhecer a ferramenta.

const BASE_PATH = process.env.BASE_PATH || "/estacionamento";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root{--verde:#4fa882;--azul:#38576b;--letra:#403d3d;--fundo:#e9edf5;--branco:#feffff;--vermelho:#ef5350;--borda:#d5dce8}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fundo);color:var(--letra)}
header{background:var(--verde);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
header h1{font-size:1.05rem;margin:0;font-weight:700;letter-spacing:.3px}
header .quem{margin-left:auto;font-size:.8rem;opacity:.95;display:flex;align-items:center;gap:10px}
header form{margin:0}
header button.sair{background:rgba(0,0,0,.18);padding:5px 12px;font-size:.76rem;font-weight:600}
main{max-width:1100px;margin:0 auto;padding:18px}
.cartao{background:var(--branco);border:1px solid var(--borda);border-radius:10px;padding:16px;margin-bottom:18px}
.cartao h2{margin:0 0 12px;font-size:.95rem;color:var(--azul)}
form.busca{display:flex;gap:8px;flex-wrap:wrap}
input[type=text],input[type=search],input[type=password]{padding:9px 11px;border:1px solid var(--borda);border-radius:7px;font-size:.92rem;min-width:0}
button{padding:9px 16px;border:0;border-radius:7px;background:var(--verde);color:#fff;font-weight:700;font-size:.9rem;cursor:pointer}
button.sec{background:var(--azul)}
button.perigo{background:var(--vermelho)}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--borda);vertical-align:middle}
th{background:#f4f7fb;color:var(--azul);font-size:.76rem;text-transform:uppercase;letter-spacing:.4px}
tr:hover td{background:#f9fbfe}
.placa{font-weight:700;letter-spacing:.6px;font-family:ui-monospace,Consolas,monospace}
.vazio{color:#999;font-style:italic}
.tag{display:inline-block;padding:1px 7px;border-radius:20px;font-size:.68rem;font-weight:700;background:#ffe9a8;color:#7a5a00;margin-left:6px}
.aviso{background:#fff6d9;border:1px solid #f0d98a;padding:10px 12px;border-radius:8px;font-size:.85rem;margin-bottom:14px}
.erro{background:#fdecea;border:1px solid #f5c2bd;color:#a32a1c;padding:10px 12px;border-radius:8px;font-size:.85rem;margin-bottom:14px}
.rodape{text-align:center;font-size:.75rem;color:#8b93a3;padding:8px 0 22px}
.acoes{display:flex;gap:6px}
.acoes form{display:inline}
.rolagem{overflow-x:auto}
.entrada{max-width:360px;margin:8vh auto 0}
.entrada h2{text-align:center}
.entrada label{display:block;font-size:.76rem;font-weight:700;color:var(--azul);margin-bottom:10px}
.entrada input{width:100%;margin-top:3px;font-weight:400}
.entrada button{width:100%;margin-top:6px}
@media(max-width:640px){header .quem{margin-left:0;width:100%}}
`;

function moldura(titulo, corpo, sessao) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>${CSS}</style></head>
<body>
<header>
  <h1>🚗 Estacionamento</h1>
  ${
    sessao
      ? `<span class="quem">
           ${esc(sessao.nome || sessao.login)}${sessao.papel === "admin" ? " · administrador" : " · consulta"}
           <form method="post" action="${BASE_PATH}/sair"><button class="sair">Sair</button></form>
         </span>`
      : ""
  }
</header>
<main>${corpo}</main>
<p class="rodape">Consulta de veículos de funcionários</p>
</body></html>`;
}

// Tela de login. O `proximo` volta a pessoa para a página que ela tentou abrir
// antes de a sessão expirar.
function paginaLogin({ erro = "", proximo = "", login = "" } = {}) {
  return moldura(
    "Entrar — Estacionamento",
    `<div class="cartao entrada">
      <h2>Entrar</h2>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ""}
      <form method="post" action="${BASE_PATH}/login">
        <input type="hidden" name="proximo" value="${esc(proximo)}">
        <label>Usuário
          <input type="text" name="login" value="${esc(login)}" autocomplete="username" autofocus required>
        </label>
        <label>Senha
          <input type="password" name="senha" autocomplete="current-password" required>
        </label>
        <button>Entrar</button>
      </form>
      <p style="font-size:.74rem;color:#8b93a3;margin:14px 0 0;text-align:center">
        Acesso concedido pelo responsável do sistema.
      </p>
    </div>`,
    null
  );
}

function linhaPlaca(v) {
  return v && v.trim()
    ? `<span class="placa">${esc(v)}</span>`
    : `<span class="vazio">sem placa</span>`;
}

function campo(rotulo, nome, valor = "", obrigatorio = false) {
  return `<label style="display:block;font-size:.76rem;font-weight:700;color:var(--azul);margin-bottom:4px">
    ${esc(rotulo)}${obrigatorio ? " *" : ""}
    <input type="text" name="${esc(nome)}" value="${esc(valor)}" style="width:100%;margin-top:3px;font-weight:400">
  </label>`;
}

function paginaLista({ registros, q, sessao, total, duplicadas, msg }) {
  const podeEditar = sessao.papel === "admin";

  const linhas = registros.length
    ? registros
        .map(
          (r) => `<tr>
      <td>${linhaPlaca(r.placa)}${duplicadas.has((r.placa || "").trim()) && (r.placa || "").trim() ? '<span class="tag">repetida</span>' : ""}</td>
      <td>${esc(r.nome)}</td>
      <td>${esc(r.setor)}</td>
      <td>${esc(r.ramal)}</td>
      <td>${esc(r.modelo)}</td>
      <td>${esc(r.cor)}</td>
      ${
        podeEditar
          ? `<td class="acoes">
          <a href="${BASE_PATH}/veiculos/${r.id}"><button type="button" class="sec">Editar</button></a>
          <form method="post" action="${BASE_PATH}/veiculos/${r.id}/excluir" onsubmit="return confirm('Excluir o veículo ${esc(r.placa || "sem placa")}?')">
            <button class="perigo">Excluir</button>
          </form></td>`
          : ""
      }
    </tr>`
        )
        .join("")
    : `<tr><td colspan="${podeEditar ? 7 : 6}" class="vazio">Nenhum veículo encontrado${q ? ` para “${esc(q)}”` : ""}.</td></tr>`;

  return moldura(
    "Estacionamento",
    `
    ${msg ? `<div class="aviso">${esc(msg)}</div>` : ""}
    <div class="cartao">
      <h2>Localizar veículo</h2>
      <form class="busca" method="get" action="${BASE_PATH}/">
        <input type="search" name="q" value="${esc(q || "")}" placeholder="Placa, nome ou setor" style="flex:1" autofocus>
        <button>Buscar</button>
        ${q ? `<a href="${BASE_PATH}/"><button type="button" class="sec">Limpar</button></a>` : ""}
      </form>
      <p style="font-size:.78rem;color:#8b93a3;margin:10px 0 0">
        ${registros.length} de ${total} veículos cadastrados${q ? " (filtrado)" : ""}.
      </p>
    </div>

    ${
      podeEditar
        ? `<div class="cartao">
      <h2>Cadastrar veículo</h2>
      <form method="post" action="${BASE_PATH}/veiculos">
        <div class="grade">
          ${campo("Placa", "placa", "", true)}
          ${campo("Nome", "nome")}
          ${campo("Setor", "setor")}
          ${campo("Ramal", "ramal")}
          ${campo("Modelo", "modelo")}
          ${campo("Cor", "cor")}
        </div>
        <button style="margin-top:10px">Inserir</button>
      </form>
    </div>`
        : ""
    }

    <div class="cartao">
      <h2>Veículos</h2>
      <div class="rolagem">
      <table>
        <thead><tr>
          <th>Placa</th><th>Nome</th><th>Setor</th><th>Ramal</th><th>Modelo</th><th>Cor</th>
          ${podeEditar ? "<th>Ações</th>" : ""}
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      </div>
    </div>`,
    sessao
  );
}

function paginaEdicao({ registro, sessao, msg }) {
  return moldura(
    `Editar ${registro.placa || "veículo"} — Estacionamento`,
    `
    ${msg ? `<div class="aviso">${esc(msg)}</div>` : ""}
    <div class="cartao">
      <h2>Editar veículo #${registro.id}</h2>
      <form method="post" action="${BASE_PATH}/veiculos/${registro.id}">
        <div class="grade">
          ${campo("Placa", "placa", registro.placa, true)}
          ${campo("Nome", "nome", registro.nome)}
          ${campo("Setor", "setor", registro.setor)}
          ${campo("Ramal", "ramal", registro.ramal)}
          ${campo("Modelo", "modelo", registro.modelo)}
          ${campo("Cor", "cor", registro.cor)}
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button>Salvar</button>
          <a href="${BASE_PATH}/"><button type="button" class="sec">Voltar</button></a>
        </div>
      </form>
      <p style="font-size:.74rem;color:#8b93a3;margin:14px 0 0">
        Cadastrado em ${registro.criado_em ? new Date(registro.criado_em).toLocaleString("pt-BR") : "—"}${
          registro.atualizado_em
            ? ` · última alteração em ${new Date(registro.atualizado_em).toLocaleString("pt-BR")}`
            : ""
        }.
      </p>
    </div>`,
    sessao
  );
}

module.exports = { paginaLista, paginaEdicao, paginaLogin, moldura, esc };
