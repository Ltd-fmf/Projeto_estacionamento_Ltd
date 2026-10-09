// Leitura da placa no próprio navegador (Tesseract.js auto-hospedado em
// /publico/ocr, nada sai do site). O resultado é só uma SUGESTÃO: o campo
// continua editável, o servidor revalida e a busca tolera erro de leitura.
//
// Como lê: acha onde está a placa na imagem (faixa com muitas bordas
// verticais, as hastes das letras), recorta e reconhece cada recorte com
// vários modos do Tesseract. Cada leitura válida vira um voto; vence a placa
// mais votada (a primeira leitura válida erra com frequência).
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

  function suavizar(v, r) {
    var o = new Float32Array(v.length);
    for (var i = 0; i < v.length; i++) {
      var s = 0, n = 0;
      for (var k = -r; k <= r; k++) { var j = i + k; if (j >= 0 && j < v.length) { s += v[j]; n++; } }
      o[i] = s / n;
    }
    return o;
  }

  // gray: Uint8 de w*h. Devolve até 3 caixas {x,y,w,h} (frações da imagem),
  // da mais provável à menos. O limiar é relativo ao contraste da própria foto
  // (percentis 2 e 98), para funcionar também no escuro.
  function localizar(gray, w, h) {
    var hist = new Uint32Array(256), i, x, y;
    for (i = 0; i < gray.length; i++) hist[gray[i]]++;
    var acc = 0, p2 = 0, p98 = 255;
    for (var v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc < gray.length * 0.02) p2 = v;
      if (acc <= gray.length * 0.98) p98 = v;
    }
    var lim = Math.max(12, (p98 - p2) * 0.3);
    var bin = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 1; x < w - 1; x++) bin[y * w + x] = Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1]) > lim ? 1 : 0;
    var R = new Float32Array(h);
    for (y = 0; y < h; y++) { var s = 0; for (x = 0; x < w; x++) s += bin[y * w + x]; R[y] = s; }
    var Rs = suavizar(R, Math.max(1, Math.round(h * 0.012)));
    var caixas = [], usada = new Uint8Array(h);
    for (var tent = 0; tent < 3; tent++) {
      var pico = -1, vp = 0;
      for (y = 0; y < h; y++) if (!usada[y] && Rs[y] > vp) { vp = Rs[y]; pico = y; }
      if (pico < 0 || vp < 4) break;
      var y0 = pico, y1 = pico;
      while (y0 > 0 && Rs[y0 - 1] > vp * 0.4) y0--;
      while (y1 < h - 1 && Rs[y1 + 1] > vp * 0.4) y1++;
      for (y = Math.max(0, y0 - 3); y <= Math.min(h - 1, y1 + 3); y++) usada[y] = 1;
      var C = new Float32Array(w);
      for (y = y0; y <= y1; y++) for (x = 0; x < w; x++) C[x] += bin[y * w + x];
      var Cs = suavizar(C, Math.max(1, Math.round(w * 0.015)));
      var cm = 0;
      for (x = 0; x < w; x++) if (Cs[x] > cm) cm = Cs[x];
      if (cm <= 0) continue;
      var x0 = -1, x1 = -1;
      for (x = 0; x < w; x++) if (Cs[x] > cm * 0.18) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 < 0) continue;
      var bh = y1 - y0 + 1, bw = x1 - x0 + 1;
      var padY = bh * 0.35, padX = bw * 0.06;
      var X0 = Math.max(0, x0 - padX), X1 = Math.min(w, x1 + 1 + padX);
      var Y0 = Math.max(0, y0 - padY), Y1 = Math.min(h, y1 + 1 + padY);
      if ((X1 - X0) / (Y1 - Y0) < 1.2) continue; // placa é bem mais larga que alta
      caixas.push({ x: X0 / w, y: Y0 / h, w: (X1 - X0) / w, h: (Y1 - Y0) / h });
    }
    return caixas;
  }

  // Soma os votos de várias leituras (cada uma { placa, trocas } ou null) e
  // devolve [{ placa, votos, trocas }] da mais votada à menos; empate: menos trocas.
  function votar(leituras) {
    var mapa = {};
    leituras.forEach(function (a) {
      if (!a) return;
      var m = mapa[a.placa] || (mapa[a.placa] = { placa: a.placa, votos: 0, trocas: 9 });
      m.votos++;
      if (a.trocas < m.trocas) m.trocas = a.trocas;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.votos - a.votos || a.trocas - b.trocas; });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { acharPlaca: acharPlaca, ajustar: ajustar, localizar: localizar, votar: votar };
    return;
  }

  // ------------------------------------------------------------- navegador
  var BASE = (document.currentScript && document.currentScript.src || "").replace(/\/placa-ocr\.js.*$/, "") + "/ocr";
  var worker = null, carregando = null, rodada = 0;
  var MODOS = ["7", "8", "6"];

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

  function dimensoes(fonte) {
    return { w: fonte.videoWidth || fonte.naturalWidth || fonte.width, h: fonte.videoHeight || fonte.naturalHeight || fonte.height };
  }

  // Desenha a região (frações) da fonte num canvas de tamanho `largura`.
  function desenhar(fonte, regiao, largura, altura) {
    var d = dimensoes(fonte);
    var r = regiao || { x: 0, y: 0, w: 1, h: 1 };
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(largura));
    c.height = Math.max(1, Math.round(altura));
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(fonte, r.x * d.w, r.y * d.h, r.w * d.w, r.h * d.h, 0, 0, c.width, c.height);
    return c;
  }

  function tonsDeCinza(c, esticar) {
    var g = c.getContext("2d", { willReadFrequently: true });
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, n = c.width * c.height;
    var cinza = new Uint8Array(n), min = 255, max = 0, i, y;
    for (i = 0; i < n; i++) {
      y = (p[i * 4] * 299 + p[i * 4 + 1] * 587 + p[i * 4 + 2] * 114) / 1000;
      cinza[i] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    if (esticar) {
      var f = max > min ? 255 / (max - min) : 1;
      for (i = 0; i < n; i++) {
        y = Math.min(255, Math.max(0, (cinza[i] - min) * f));
        cinza[i] = y;
        p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = y;
      }
      g.putImageData(d, 0, 0);
    }
    return cinza;
  }

  // Recorta a caixa (frações) da fonte, em tons de cinza com contraste esticado
  // e numa escala em que o Tesseract lê bem (letras nem minúsculas nem enormes).
  function recorte(fonte, regiao, caixa) {
    var d = dimensoes(fonte);
    var cx = regiao.x + caixa.x * regiao.w, cy = regiao.y + caixa.y * regiao.h;
    var cw = caixa.w * regiao.w, ch = caixa.h * regiao.h;
    var pw = cw * d.w, ph = ch * d.h;
    var escala = ph > 220 ? 220 / ph : ph < 70 ? Math.min(3, 70 / ph) : 1;
    var c = desenhar(fonte, { x: cx, y: cy, w: cw, h: ch }, pw * escala, ph * escala);
    tonsDeCinza(c, true);
    return c;
  }

  // Lê uma imagem/quadro de vídeo. `regiao` (frações) limita onde procurar (o
  // quadro-guia da câmera). Devolve Promise<[{ placa, votos, trocas }]>.
  function ler(fonte, opcoes) {
    opcoes = opcoes || {};
    var minha = ++rodada;
    var regiao = opcoes.regiao || { x: 0, y: 0, w: 1, h: 1 };
    return iniciar().then(async function (w) {
      var d = dimensoes(fonte);
      var largura = 320, altura = Math.max(40, Math.round(largura * (regiao.h * d.h) / (regiao.w * d.w)));
      var pequeno = desenhar(fonte, regiao, largura, altura);
      var caixas = localizar(tonsDeCinza(pequeno, false), pequeno.width, pequeno.height);
      // A região inteira também é candidata: o quadro-guia já pode estar justo na placa.
      if (opcoes.incluirRegiao) caixas.push({ x: 0, y: 0, w: 1, h: 1 });
      if (!caixas.length) caixas.push({ x: 0, y: 0, w: 1, h: 1 });
      var leituras = [];
      for (var i = 0; i < caixas.length; i++) {
        var c = recorte(fonte, regiao, caixas[i]);
        for (var m = 0; m < MODOS.length; m++) {
          if (opcoes.cancelavel && minha !== rodada) return null; // chegou pedido mais novo
          await w.setParameters({
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            tessedit_pageseg_mode: MODOS[m],
          });
          var r = await w.recognize(c);
          leituras.push(acharPlaca(r.data.text));
        }
      }
      return votar(leituras);
    });
  }

  function terminar() {
    if (worker) worker.terminate();
    worker = null;
    carregando = null;
  }

  window.PlacaOCR = { iniciar: iniciar, ler: ler, terminar: terminar, acharPlaca: acharPlaca, votar: votar };

  // ------------------------------------------- formulário de cadastro do carro
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
      var minha = rodada + 1;
      ultimo = arquivo;
      botao.hidden = true;
      estado.textContent = "Lendo a placa…";
      estado.className = "lendo";
      createImageBitmap(arquivo, { imageOrientation: "from-image" })
        .then(function (bitmap) {
          return ler(bitmap, { cancelavel: true }).then(function (rank) {
            if (bitmap.close) bitmap.close();
            return rank;
          });
        })
        .then(function (rank) {
          if (rank === null || minha !== rodada) return;
          botao.hidden = false;
          if (rank && rank.length) {
            lida.value = rank[0].placa;
            campo.value = rank[0].placa;
            estado.className = "achou";
            estado.textContent = "Lida da foto: " + rank[0].placa + " — confira e corrija se precisar";
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
    window.addEventListener("pagehide", terminar);
  }

  var form = document.querySelector("form[data-captura]");
  if (form) ligar(form);
})();
