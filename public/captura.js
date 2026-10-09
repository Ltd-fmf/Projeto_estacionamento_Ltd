// Captura guiada: cada bloco abre a câmera (celular) ou o seletor (desktop).
// Ao escolher a foto, reduz no canvas (lado maior 1600px, JPEG 0,85, já
// corrigindo a rotação do EXIF), troca o arquivo do input pelo reduzido e
// avisa a página com o evento "captura:pronta" (o OCR da placa escuta).
(function () {
  "use strict";
  var LADO = 1600;
  var QUALIDADE = 0.85;

  function reduzir(arquivo) {
    return createImageBitmap(arquivo, { imageOrientation: "from-image" }).then(function (img) {
      var escala = Math.min(1, LADO / Math.max(img.width, img.height));
      var w = Math.round(img.width * escala);
      var h = Math.round(img.height * escala);
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      if (img.close) img.close();
      return new Promise(function (ok, erro) {
        c.toBlob(function (b) { b ? ok(b) : erro(new Error("toBlob")); }, "image/jpeg", QUALIDADE);
      });
    });
  }

  function trocarArquivo(input, blob, nome) {
    var arq = new File([blob], nome, { type: "image/jpeg" });
    var dt = new DataTransfer();
    dt.items.add(arq);
    input.files = dt.files;
    return arq;
  }

  function aoEscolher(input) {
    var bloco = input.closest(".bloco");
    var original = input.files && input.files[0];
    if (!original) return;
    bloco.classList.add("lendo");
    reduzir(original)
      .then(function (blob) {
        var arq = trocarArquivo(input, blob, input.name + ".jpg");
        var previa = bloco.querySelector(".bloco-previa");
        if (previa) {
          if (previa.dataset.url) URL.revokeObjectURL(previa.dataset.url);
          previa.dataset.url = URL.createObjectURL(arq);
          previa.src = previa.dataset.url;
          previa.hidden = false;
        }
        bloco.classList.add("feito");
        bloco.classList.remove("lendo");
        var txt = bloco.querySelector(".bloco-texto small");
        if (txt) txt.textContent = "Toque para trocar";
        input.dispatchEvent(new CustomEvent("captura:pronta", {
          bubbles: true,
          detail: { tipo: bloco.dataset.tipo, arquivo: arq },
        }));
      })
      .catch(function () {
        // Navegador sem suporte (ou imagem ilegível): segue com o arquivo
        // original; o servidor valida e reduz de qualquer forma.
        bloco.classList.remove("lendo");
        bloco.classList.add("feito");
        input.dispatchEvent(new CustomEvent("captura:pronta", {
          bubbles: true,
          detail: { tipo: bloco.dataset.tipo, arquivo: original },
        }));
      });
  }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches(".bloco input[type=file]")) aoEscolher(t);
  });

  // Evita duplo envio: enquanto o formulário sobe 5 fotos, o botão trava.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.matches || !form.matches("[data-captura]")) return;
    var b = form.querySelector("[data-enviar]");
    if (b) {
      if (b.disabled) return e.preventDefault();
      setTimeout(function () { b.disabled = true; b.textContent = "Enviando…"; }, 0);
    }
  });
})();
