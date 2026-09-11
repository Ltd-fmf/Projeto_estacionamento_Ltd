"use strict";

// Runner de migrations do banco `estacionamento` — aplica em ordem alfabética
// todo db/migrations/NNNN_*.sql ainda não registrado, cada um em UMA transação.
//
// O controle mora em `_migrations` no schema default do próprio banco: como o
// banco é exclusivo deste sistema, não há motivo para um schema separado.
//
// Só arquivos com prefixo numérico entram. `seed_veiculos.sql` (a carga dos
// 368 registros vindos do SQLite original) fica de fora de propósito: é dado,
// não estrutura, e se aplica uma única vez à mão.
//
// Uso: npm run migrate            (aplica pendentes)
//      npm run migrate:status     (só lista)

require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../db/pool");

const DIR = path.join(__dirname, "..", "db", "migrations");
const PADRAO = /^\d{4}_.*\.sql$/;

async function garantirControle(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       nome text PRIMARY KEY,
       aplicada_em timestamptz NOT NULL DEFAULT now()
     )`
  );
}

async function main() {
  const soStatus = process.argv.includes("--status");
  const arquivos = fs.readdirSync(DIR).filter((f) => PADRAO.test(f)).sort();

  if (!arquivos.length) {
    console.log("Nenhuma migration em", DIR);
    return;
  }

  const inicial = await pool.connect();
  try {
    await garantirControle(inicial);
  } finally {
    inicial.release();
  }

  for (const arquivo of arquivos) {
    const client = await pool.connect();
    try {
      const r = await client.query("SELECT 1 FROM _migrations WHERE nome = $1", [arquivo]);
      if (r.rowCount) {
        console.log(`  já aplicada  ${arquivo}`);
        continue;
      }
      if (soStatus) {
        console.log(`  PENDENTE     ${arquivo}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(DIR, arquivo), "utf-8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (nome) VALUES ($1)", [arquivo]);
      await client.query("COMMIT");
      console.log(`  APLICADA     ${arquivo}`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`  FALHOU       ${arquivo}\n`, e);
      throw e;
    } finally {
      client.release();
    }
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exitCode = 1;
  });
