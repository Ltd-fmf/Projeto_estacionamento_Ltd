"use strict";

// Cria ou atualiza um usuário do estacionamento. É o único caminho para
// cadastrar acesso — não existe tela de autocadastro, de propósito.
//
// Uso:
//   node scripts/criar-usuario.js <login> "<senha>" --nome "Fulano" [--papel admin|consulta]
//
// Sem --senha nova em um usuário existente, a senha é substituída pela que for
// passada (é o caminho de "esqueci minha senha"), e as sessões abertas dessa
// pessoa caem, porque sessao_versao é incrementada.

require("dotenv/config");
const { pool } = require("../db/pool");
const { hashSenha } = require("../lib/auth");

const [, , login, senha, ...rest] = process.argv;

if (!login || !senha) {
  console.log('Uso: node scripts/criar-usuario.js <login> "<senha>" --nome "Fulano" [--papel admin|consulta]');
  process.exit(1);
}

const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const nome = rest[i].slice(2);
  const prox = rest[i + 1];
  if (prox && !prox.startsWith("--")) {
    flags[nome] = prox;
    i++;
  } else {
    flags[nome] = true;
  }
}

const papel = flags.papel || "consulta";
if (!["admin", "consulta"].includes(papel)) {
  console.error(`Papel inválido: ${papel}. Use admin ou consulta.`);
  process.exit(1);
}
if (String(senha).length < 8) {
  console.error("Senha curta demais: mínimo 8 caracteres.");
  process.exit(1);
}

async function main() {
  const existente = await pool.query("SELECT id, nome FROM usuario WHERE lower(login) = lower($1)", [login]);
  const nome = flags.nome || (existente.rows[0] && existente.rows[0].nome);
  if (!nome) throw new Error("--nome é obrigatório ao criar um usuário novo.");

  if (existente.rows[0]) {
    await pool.query(
      `UPDATE usuario
          SET nome = $2, papel = $3, senha_hash = $4, ativo = true,
              sessao_versao = sessao_versao + 1
        WHERE id = $1`,
      [existente.rows[0].id, nome, papel, hashSenha(senha)]
    );
    console.log(`Usuário "${login}" atualizado (papel=${papel}). Sessões antigas derrubadas.`);
  } else {
    await pool.query(
      `INSERT INTO usuario (login, nome, papel, senha_hash) VALUES ($1, $2, $3, $4)`,
      [String(login).trim(), nome, papel, hashSenha(senha)]
    );
    console.log(`Usuário "${login}" criado (papel=${papel}).`);
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e.message || e);
    pool.end();
    process.exitCode = 1;
  });
