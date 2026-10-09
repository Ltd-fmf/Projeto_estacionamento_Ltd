// Comportamentos pequenos das páginas, sem JavaScript inline (a CSP só aceita
// scripts do próprio site).
(function () {
  "use strict";

  // <form data-confirmar="Tem certeza?"> pede confirmação antes de enviar.
  document.addEventListener("submit", function (ev) {
    var msg = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-confirmar");
    if (msg && !window.confirm(msg)) ev.preventDefault();
  });

  // <input type="file" data-nome-arquivo> mostra o nome escolhido no <span>
  // .nome-arquivo que vem depois do rótulo.
  document.addEventListener("change", function (ev) {
    var el = ev.target;
    if (!el || !el.hasAttribute || !el.hasAttribute("data-nome-arquivo")) return;
    var alvo = el.parentNode && el.parentNode.nextElementSibling;
    if (alvo) alvo.textContent = el.files && el.files[0] ? el.files[0].name : "Nenhum arquivo escolhido";
  });
})();
