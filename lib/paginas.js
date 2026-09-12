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
:root{--principal:#38576b;--acento:#038cfc;--letra:#403d3d;--fundo:#e9edf5;--branco:#feffff;--vermelho:#ef5350;--borda:#d5dce8}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--fundo);color:var(--letra)}
header{background:var(--principal);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
header h1{font-size:1.05rem;margin:0;font-weight:700;letter-spacing:.3px}
header .quem{margin-left:auto;font-size:.8rem;opacity:.95;display:flex;align-items:center;gap:10px}
header form{margin:0}
header button.sair{background:rgba(0,0,0,.18);padding:5px 12px;font-size:.76rem;font-weight:600}
main{max-width:1100px;margin:0 auto;padding:18px}
.cartao{background:var(--branco);border:1px solid var(--borda);border-radius:10px;padding:16px;margin-bottom:18px}
.cartao h2{margin:0 0 12px;font-size:.95rem;color:var(--principal)}
form.busca{display:flex;gap:8px;flex-wrap:wrap}
input[type=text],input[type=search],input[type=password]{padding:9px 11px;border:1px solid var(--borda);border-radius:7px;font-size:.92rem;min-width:0}
button{padding:9px 16px;border:0;border-radius:7px;background:var(--acento);color:#fff;font-weight:700;font-size:.9rem;cursor:pointer}
button:hover{filter:brightness(1.08)}
button.sec{background:var(--principal)}
button.perigo{background:var(--vermelho)}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--borda);vertical-align:middle}
th{background:#f4f7fb;color:var(--principal);font-size:.76rem;text-transform:uppercase;letter-spacing:.4px}
tr:hover td{background:#f9fbfe}
.placa{font-weight:700;letter-spacing:.6px;font-family:ui-monospace,Consolas,monospace}
.vazio{color:#999;font-style:italic}
.tag{display:inline-block;padding:1px 7px;border-radius:20px;font-size:.68rem;font-weight:700;background:#ffe9a8;color:#7a5a00;margin-left:6px}
.aviso{background:#fff6d9;border:1px solid #f0d98a;padding:10px 12px;border-radius:8px;font-size:.85rem;margin-bottom:14px}
.erro{background:#fdecea;border:1px solid #f5c2bd;color:#a32a1c;padding:10px 12px;border-radius:8px;font-size:.85rem;margin-bottom:14px}
.rodape{text-align:center;font-size:.75rem;color:#8b93a3;padding:8px 0 22px}
.acoes{display:flex;gap:6px}
.foto{display:block;max-width:100%;width:320px;border-radius:8px;border:1px solid var(--borda);background:#fff}
.sem-foto{width:320px;max-width:100%;padding:28px 10px;text-align:center;border:1px dashed var(--borda);border-radius:8px;color:#999;font-size:.82rem}
/* O input[type=file] cru não é estilizável: some da tela (mas segue acessível
   pelo teclado) e quem aparece é o <span> do label. */
.arquivo{display:inline-block;cursor:pointer}
.arquivo input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
.arquivo span{display:inline-block;padding:9px 16px;border-radius:7px;background:var(--principal);color:#fff;font-weight:700;font-size:.9rem}
.arquivo:hover span{filter:brightness(1.12)}
.arquivo input:focus-visible+span{outline:2px solid var(--acento);outline-offset:2px}
.nome-arquivo{font-size:.82rem;color:#8b93a3}
.acoes form{display:inline}
.rolagem{overflow-x:auto}
.entrada{max-width:360px;margin:8vh auto 0}
.entrada h2{text-align:center}
.entrada label{display:block;font-size:.76rem;font-weight:700;color:var(--principal);margin-bottom:10px}
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
  return `<label style="display:block;font-size:.76rem;font-weight:700;color:var(--principal);margin-bottom:4px">
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
      <td class="acoes">
        <a href="${BASE_PATH}/veiculos/${r.id}/ver"><button type="button">Ver</button></a>
        ${
          podeEditar
            ? `<a href="${BASE_PATH}/veiculos/${r.id}"><button type="button" class="sec">Editar</button></a>
          <form method="post" action="${BASE_PATH}/veiculos/${r.id}/excluir" onsubmit="return confirm('Excluir o veículo ${esc(r.placa || "sem placa")}?')">
            <button class="perigo">Excluir</button>
          </form>`
            : ""
        }
      </td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="7" class="vazio">Nenhum veículo encontrado${q ? ` para “${esc(q)}”` : ""}.</td></tr>`;

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
          <th>Ações</th>
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

      <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--borda)">
        <h2 style="margin:0 0 10px">Foto</h2>
        ${
          registro.foto
            ? `<img class="foto" src="${BASE_PATH}/veiculos/${registro.id}/foto" alt="Foto do veículo ${esc(registro.placa)}">`
            : `<div class="sem-foto">Nenhuma foto enviada</div>`
        }
        <form method="post" action="${BASE_PATH}/veiculos/${registro.id}/foto" enctype="multipart/form-data"
              style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="arquivo">
            <input type="file" name="foto" accept="image/jpeg,image/png,image/webp" required
                   onchange="this.parentNode.nextElementSibling.textContent = this.files[0] ? this.files[0].name : 'Nenhum arquivo escolhido'">
            <span>Escolher imagem</span>
          </label>
          <span class="nome-arquivo">Nenhum arquivo escolhido</span>
          <button>${registro.foto ? "Trocar foto" : "Enviar foto"}</button>
        </form>
        ${
          registro.foto
            ? `<form method="post" action="${BASE_PATH}/veiculos/${registro.id}/foto/excluir"
                     onsubmit="return confirm('Remover a foto deste veículo?')" style="margin-top:8px">
                 <button class="perigo">Remover foto</button>
               </form>`
            : ""
        }
        <p style="font-size:.74rem;color:#8b93a3;margin:10px 0 0">
          JPG, PNG ou WEBP, até 15 MB. A imagem é reduzida e recomprimida no servidor.
        </p>
      </div>

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

// Só leitura: é o que o papel `consulta` pode abrir (a edição exige admin).
// O caso de uso é o do pátio — achar o dono e o ramal para ligar —, então nome
// e ramal ficam em destaque, e não num formulário que dá a impressão de editável.
function linhaInfo(rotulo, valor) {
  return `<div>
    <div style="font-size:.72rem;font-weight:700;color:var(--principal);text-transform:uppercase;letter-spacing:.4px">${esc(rotulo)}</div>
    <div style="margin-top:2px">${valor && String(valor).trim() ? esc(valor) : '<span class="vazio">não informado</span>'}</div>
  </div>`;
}

function paginaDetalhe({ registro, sessao }) {
  const podeEditar = sessao.papel === "admin";
  return moldura(
    `${registro.placa || "Veículo"} — Estacionamento`,
    `
    <div class="cartao">
      <h2>Veículo #${registro.id}</h2>
      <p style="margin:0 0 14px;font-size:1.4rem">${linhaPlaca(registro.placa)}</p>
      ${
        registro.foto
          ? `<img class="foto" style="margin-bottom:14px" src="${BASE_PATH}/veiculos/${registro.id}/foto" alt="Foto do veículo ${esc(registro.placa)}">`
          : ""
      }
      <div class="grade">
        ${linhaInfo("Nome", registro.nome)}
        ${linhaInfo("Setor", registro.setor)}
        ${linhaInfo("Ramal", registro.ramal)}
        ${linhaInfo("Modelo", registro.modelo)}
        ${linhaInfo("Cor", registro.cor)}
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <a href="${BASE_PATH}/"><button type="button" class="sec">Voltar</button></a>
        ${podeEditar ? `<a href="${BASE_PATH}/veiculos/${registro.id}"><button type="button">Editar</button></a>` : ""}
      </div>
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

module.exports = { paginaLista, paginaEdicao, paginaDetalhe, paginaLogin, moldura, esc };
