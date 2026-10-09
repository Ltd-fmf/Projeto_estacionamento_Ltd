// Leitura da placa no próprio navegador (Tesseract.js auto-hospedado em
// /publico/ocr, nada sai do site). O resultado é só uma SUGESTÃO: o campo
// continua editável e o servidor revalida o formato.
(function () {
  "use strict";

  // ---------------------------------------------------------- lógica pura
  var PARA_LETRA = { "0": "O", "1": "I", "8": "B", "5": "S", "2": "Z", "6": "G", "4": "A", "7": "T" };
  var PARA_DIGITO = { O: "0", Q: "0", D: "0", I: "1", L: "1", B: "8", S: "5", Z: "2", G: "6", T: "7" };
  var RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

  // Corrige uma janela de 7 caracteres por posição: AAA 0 X 00.
  // Devolve { placa, trocas } ou null se alguma posição não tem conserto.
  function ajustar(j) {
    var s = "", trocas = 0;
    for (var i = 0; i < 7; i++) {
      var c = j[i], ehLetra = /[A-Z]/.test(c), ehDigito = /[0-9]/.test(c);
      var quer = i < 3 ? "letra" : i === 4 ? "qualquer" : "digito";
      if (quer === "qualquer") { s += c; continue; }
      if (quer === "letra") {
        if (ehLetra) s += c;
        else if (PARA_LETRA[c]) { s += PARA_LETRA[c]; trocas++; }
        else return null;
      } else {
        if (ehDigito) s += c;
        else if (PARA_DIGITO[c]) { s += PARA_DIGITO[c]; trocas++; }
        else return null;
      }
    }
    return RE_PLACA.test(s) ? { placa: s, trocas: trocas } : null;
  }

  // Procura a melhor placa num texto bruto do OCR (ruído, "BRASIL", quebras).
  function acharPlaca(texto) {
    var limpo = String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var melhor = null;
    for (var i = 0; i + 7 <= limpo.length; i++) {
      var r = ajustar(limpo.slice(i, i + 7));
      if (r && (!melhor || r.trocas < melhor.trocas)) melhor = r;
      if (melhor && melhor.trocas === 0) break;
    }
    return melhor; // { placa, trocas } | null
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { acharPlaca: acharPlaca, ajustar: ajustar };
    return;
  }

  // ------------------------------------------------------------- navegador
  var BASE = (document.currentScript && document.currentScript.src || "").replace(/\/placa-ocr\.js.*$/, "") + "/ocr";
  var worker = null, carregando = null, rodada = 0;

  function carregarScript(src) {
    return new Promise(function (ok, erro) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = function () { erro(new Error("script " + src)); };
      document.head.appendChild(s);
    });
  }

  function iniciar() {
    if (worker) return Promise.resolve(worker);
    if (carregando) return carregando;
    carregando = (window.Tesseract ? Promise.resolve() : carregarScript(BASE + "/tesseract.min.js"))
      .then(function () {
        return window.Tesseract.createWorker("eng", 1, {
          workerPath: BASE + "/worker.min.js",
          corePath: BASE,
          langPath: BASE,
          gzip: true,
          workerBlobURL: false,
          cacheMethod: "none",
        });
      })
      .then(function (w) { worker = w; return w; });
    carregando.catch(function () { carregando = null; });
    return carregando;
  }

  // Imagem em tons de cinza com contraste esticado; recorte opcional (fração).
  function preparar(bitmap, faixa) {
    var sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (faixa) { sy = Math.round(sh * faixa[0]); sh = Math.round(sh * (faixa[1] - faixa[0])); }
    var escala = Math.min(1, 1100 / sw);
    if (sh * escala < 90) escala = Math.min(3, 90 / sh); // evita texto minúsculo
    var c = document.createElement("canvas");
    c.width = Math.round(sw * escala);
    c.height = Math.round(sh * escala);
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, min = 255, max = 0, i, y;
    for (i = 0; i < p.length; i += 4) {
      y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000;
      p[i] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    var f = max > min ? 255 / (max - min) : 1;
    for (i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = Math.min(255, Math.max(0, (p[i] - min) * f));
    g.putImageData(d, 0, 0);
    return c;
  }

  var TENTATIVAS = [
    { faixa: null, psm: "11" },
    { faixa: [0.25, 0.75], psm: "7" },
    { faixa: [0.25, 0.75], psm: "8" },
    { faixa: null, psm: "7" },
  ];

  async function ler(arquivo, rodadaAtual) {
    var w = await iniciar();
    var bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    var melhor = null;
    for (var t = 0; t < TENTATIVAS.length; t++) {
      if (rodadaAtual !== rodada) return null; // chegou foto mais nova
      var tent = TENTATIVAS[t];
      await w.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        tessedit_pageseg_mode: tent.psm,
      });
      var r = await w.recognize(preparar(bitmap, tent.faixa));
      var achou = acharPlaca(r.data.text);
      if (achou && (!melhor || achou.trocas < melhor.trocas)) melhor = achou;
      if (melhor && melhor.trocas <= 1) break;
    }
    if (bitmap.close) bitmap.close();
    return melhor;
  }

  function ligar(form) {
    var campo = form.querySelector("#placa");
    var estado = form.querySelector("[data-placa-estado]");
    var lida = form.querySelector("input[name=placa_lida]");
    var ultimo = null;
    if (!campo || !estado || !lida) return;

    var botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn pequeno";
    botao.textContent = "Ler de novo";
    botao.hidden = true;
    estado.parentNode.appendChild(botao);

    function rodar(arquivo) {
      var minha = ++rodada;
      ultimo = arquivo;
      botao.hidden = true;
      estado.textContent = "Lendo a placa…";
      estado.className = "lendo";
      ler(arquivo, minha)
        .then(function (r) {
          if (minha !== rodada) return;
          botao.hidden = false;
          if (r) {
            lida.value = r.placa;
            campo.value = r.placa;
            estado.className = "achou";
            estado.textContent = "Lida da foto: " + r.placa + " — confira e corrija se precisar";
          } else {
            lida.value = "";
            estado.className = "nao-achou";
            estado.textContent = "Não consegui ler. Digite a placa ou tire outra foto.";
          }
        })
        .catch(function () {
          if (minha !== rodada) return;
          lida.value = "";
          botao.hidden = false;
          estado.className = "nao-achou";
          estado.textContent = "Leitura automática indisponível. Digite a placa.";
        });
    }

    form.addEventListener("captura:pronta", function (e) {
      if (e.detail && e.detail.tipo === "placa") rodar(e.detail.arquivo);
    });
    botao.addEventListener("click", function () { if (ultimo) rodar(ultimo); });
    campo.addEventListener("input", function () { campo.value = campo.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
    window.addEventListener("pagehide", function () { if (worker) worker.terminate(); });
  }

  var form = document.querySelector("form[data-captura]");
  if (form) ligar(form);
})();
