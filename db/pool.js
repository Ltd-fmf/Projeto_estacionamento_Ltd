"use strict";

// Pool do Postgres — banco PRÓPRIO `estacionamento`, role `estacionamento`.
// Nada compartilhado com o `comissao` (identity/S.A.D): projeto isolado, no
// mesmo desenho do NPJ, que também tem banco e role só dele.

const { Pool } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL ausente — ver .env.example");
}

const pool = new Pool({ connectionString: url, max: 5 });

pool.on("error", (e) => console.error("[estacionamento] erro no pool:", e.message));

module.exports = { pool };
