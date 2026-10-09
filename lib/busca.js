"use strict";

// Casamento de placas tolerante a erro de leitura. O OCR do navegador erra
// sempre os mesmos pares (O/0, I/1, B/8, S/5, Z/2, E/6, 7/2…): trocar um
// caractere por um "parecido" custa pouco; qualquer outra troca, inserção ou
// remoção custa 1. Função pura, sem banco.

const PARECIDOS = [
  "O0", "Q0", "D0", "I1", "L1", "B8", "S5", "Z2", "E6", "G6", "T7", "A4", "27", "U0", "H8", "C0",
];
const CUSTO_PARECIDO = 0.4;
const parecidos = new Set(PARECIDOS.flatMap((p) => [p, p[1] + p[0]]));

const normalizar = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
const pareceOPlaca = (v) => RE_PLACA.test(normalizar(v));

function custoTroca(a, b) {
  if (a === b) return 0;
  return parecidos.has(a + b) ? CUSTO_PARECIDO : 1;
}

// Distância de edição com custos (Levenshtein ponderado).
function distancia(a, b) {
  const n = a.length, m = b.length;
  let ant = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const atual = [i];
    for (let j = 1; j <= m; j++) {
      atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + custoTroca(a[i - 1], b[j - 1]));
    }
    ant = atual;
  }
  return ant[m];
}

// candidatas: leituras do OCR (a primeira é a mais votada) ou a placa digitada.
// placas: as placas do banco. Devolve
//   { exatas: [placa…] }                     achou igual a alguma candidata
//   { exatas: [], sugestoes: [{placa,custo}] } nada igual; até 3 parecidas
const LIMITE = 2;

function casar(candidatas, placas, { limite = LIMITE, maximo = 3 } = {}) {
  const cands = [...new Set((candidatas || []).map(normalizar).filter((c) => c.length >= 4))].slice(0, 5);
  const unicas = [...new Set(placas.map(normalizar).filter(Boolean))];
  const noBanco = new Set(unicas);
  const exatas = cands.filter((c) => noBanco.has(c));
  if (exatas.length) return { exatas, sugestoes: [] };

  const melhor = new Map();
  for (const p of unicas) {
    for (const c of cands) {
      if (Math.abs(p.length - c.length) > limite) continue;
      const d = distancia(c, p);
      if (d <= limite && (!melhor.has(p) || d < melhor.get(p))) melhor.set(p, d);
    }
  }
  const sugestoes = [...melhor.entries()]
    .map(([placa, custo]) => ({ placa, custo: Math.round(custo * 100) / 100 }))
    .sort((x, y) => x.custo - y.custo || x.placa.localeCompare(y.placa))
    .slice(0, maximo);
  return { exatas: [], sugestoes };
}

module.exports = { normalizar, pareceOPlaca, distancia, casar, LIMITE };
