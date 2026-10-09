// Home: câmera ao vivo para ler a placa e buscar o dono. Sem permissão ou sem
// câmera, a página continua funcionando pelo campo de texto e pela foto.
(function () {
  "use strict";

  var raiz = document.querySelector("[data-busca]");
  if (!raiz || !window.PlacaOCR) return;

  var form = raiz.querySelector(".busca-form");
  var campoQ = form.querySelector("[name=q]");
  var campoPlacas = form.querySelector("[data-placas]");
  var campoOrigem = form.querySelector("[data-origem]");
  var estado = raiz.querySelector("[data-ocr-estado]");
  var botaoCamera = raiz.querySelector("[data-abrir-camera]");
  var rotuloFoto = raiz.querySelector("[data-foto-fallback]");
  var inputFoto = raiz.querySelector("[data-foto-placa]");
  var painel = document.querySelector("[data-camera]");
  var video = painel.querySelector("[data-video]");
  var dica = painel.querySelector("[data-camera-dica]");

  // Onde fica o quadro-guia dentro da imagem da câmera (frações).
  var REGIAO = { x: 0.08, y: 0.33, w: 0.84, h: 0.34 };
  var LIMITE_MS = 30000;

  var fluxo = null, ativo = false, quadros = 0, placar = {};

  function dizer(txt) { estado.textContent = txt || ""; }

  function enviar(rank, origem) {
    campoPlacas.value = rank.slice(0, 3).map(function (r) { return r.placa; }).join(",");
    campoOrigem.value = origem;
    campoQ.value = rank[0].placa;
    dizer("Lida: " + rank[0].placa + ". Buscando…");
    form.submit();
  }

  function fechar() {
    ativo = false;
    if (fluxo) { fluxo.getTracks().forEach(function (t) { t.stop(); }); fluxo = null; }
    video.srcObject = null;
    painel.hidden = true;
    document.body.classList.remove("camera-aberta");
  }

  function melhorDoPlacar() {
    return Object.keys(placar)
      .map(function (k) { return placar[k]; })
      .sort(function (a, b) { return b.quadros - a.quadros || b.votos - a.votos; });
  }

  function somar(rank) {
    quadros++;
    (rank || []).forEach(function (r) {
      var p = placar[r.placa] || (placar[r.placa] = { placa: r.placa, votos: 0, quadros: 0 });
      p.votos += r.votos;
      p.quadros++;
    });
  }

  function laco(inicio) {
    if (!ativo) return;
    if (Date.now() - inicio > LIMITE_MS) {
      var talvez = melhorDoPlacar();
      fechar();
      if (talvez.length) return enviar(talvez, "camera");
      dizer("Não consegui ler. Chegue mais perto, com luz, ou digite a placa.");
      return campoQ.focus();
    }
    window.PlacaOCR.ler(video, { regiao: REGIAO, incluirRegiao: true })
      .then(function (rank) {
        if (!ativo) return;
        somar(rank);
        var topo = melhorDoPlacar();
        // A mesma placa em 2 quadros diferentes: leitura firme.
        if (topo.length && topo[0].quadros >= 2) {
          fechar();
          return enviar(topo, "camera");
        }
        dica.textContent = topo.length ? "Quase… segure firme." : "Aproxime até a placa ocupar o quadro.";
        setTimeout(function () { laco(inicio); }, 200);
      })
      .catch(function () {
        fechar();
        dizer("Leitura automática indisponível. Digite a placa.");
      });
  }

  function abrir() {
    dizer("");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false })
      .then(function (f) {
        fluxo = f;
        video.srcObject = f;
        placar = {};
        quadros = 0;
        ativo = true;
        painel.hidden = false;
        document.body.classList.add("camera-aberta");
        dica.textContent = "Carregando o leitor…";
        window.PlacaOCR.iniciar()
          .then(function () {
            dica.textContent = "Aproxime até a placa ocupar o quadro.";
            laco(Date.now());
          })
          .catch(function () {
            fechar();
            dizer("Leitura automática indisponível. Digite a placa.");
          });
      })
      .catch(function () {
        dizer("Não consegui abrir a câmera. Libere o acesso ou tire uma foto da placa.");
        if (rotuloFoto) rotuloFoto.hidden = false;
      });
  }

  // Capturar agora: usa o que já foi lido; sem nada, tenta mais uma vez.
  painel.querySelector("[data-camera-foto]").addEventListener("click", function () {
    var topo = melhorDoPlacar();
    if (topo.length) { fechar(); return enviar(topo, "camera"); }
    dica.textContent = "Lendo…";
  });
  painel.querySelector("[data-camera-fechar]").addEventListener("click", function () { fechar(); campoQ.focus(); });
  window.addEventListener("pagehide", function () { fechar(); window.PlacaOCR.terminar(); });

  // Foto tirada (ou escolhida): mesma leitura, sobre a foto inteira.
  inputFoto.addEventListener("change", function () {
    var arq = inputFoto.files && inputFoto.files[0];
    if (!arq) return;
    dizer("Lendo a placa…");
    createImageBitmap(arq, { imageOrientation: "from-image" })
      .then(function (bitmap) {
        return window.PlacaOCR.ler(bitmap).then(function (rank) {
          if (bitmap.close) bitmap.close();
          return rank;
        });
      })
      .then(function (rank) {
        if (rank && rank.length) return enviar(rank, "camera");
        dizer("Não consegui ler a placa. Tente de novo mais perto, ou digite.");
        campoQ.focus();
      })
      .catch(function () { dizer("Leitura automática indisponível. Digite a placa."); });
    inputFoto.value = "";
  });

  campoQ.addEventListener("input", function () { campoPlacas.value = ""; campoOrigem.value = ""; });

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext) {
    botaoCamera.hidden = false;
    if (rotuloFoto) rotuloFoto.hidden = true;
    botaoCamera.addEventListener("click", abrir);
  }
})();
