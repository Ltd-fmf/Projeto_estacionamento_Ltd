"use strict";

// As 5 fotos guiadas do carro. A ordem é a da tela. Só a da placa é
// obrigatória: é dela que sai a placa do carro.
const TIPOS = [
  { tipo: "placa", rotulo: "Placa", dica: "De perto, reta e legível", obrigatoria: true },
  { tipo: "frente", rotulo: "Frente", dica: "O carro de frente, inteiro" },
  { tipo: "traseira", rotulo: "Traseira", dica: "O carro de trás, inteiro" },
  { tipo: "lateral_esq", rotulo: "Lateral esquerda", dica: "Lado do motorista, de corpo inteiro" },
  { tipo: "lateral_dir", rotulo: "Lateral direita", dica: "Lado do passageiro, de corpo inteiro" },
];

const NOMES = new Set(TIPOS.map((t) => t.tipo));
const campoDe = (tipo) => `foto_${tipo}`;

module.exports = { TIPOS, NOMES, campoDe };
