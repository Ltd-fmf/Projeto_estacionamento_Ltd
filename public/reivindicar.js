// Cadastro de carro: se a placa já existe numa ficha antiga, oferece "este
// carro é meu". Reivindicar só marca a ficha (campo oculto `reivindica`) e
// adianta modelo e cor; as fotos continuam obrigatórias e o admin decide.
(function () {
  "use strict";

  var form = document.querySelector("form[data-captura]");
  var caixa = form && form.querySelector("[data-ficha]");
  var oculto = form && form.querySelector("[data-reivindica]");
  var campo = form && form.querySelector("#placa");
  if (!caixa || !oculto || !campo) return;

  var BASE = (document.currentScript && document.currentScript.src || "").replace(/\/publico\/reivindicar\.js.*$/, "");
  var RE_PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
  var ultima = "", espera = null, pedido = 0;

  function limpar() {
    oculto.value = "";
    caixa.hidden = true;
    caixa.textContent = "";
  }

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto) e.textContent = texto;
    return e;
  }

  function preencher(nome, valor) {
    var c = form.querySelector("[name=" + nome + "]");
    if (c && !c.value && valor) c.value = valor;
  }

  function descricao(f) {
    return [f.nome, f.setor, [f.modelo, f.cor].filter(Boolean).join(" ")].filter(Boolean).join(" · ") + (f.temFoto ? " (com foto)" : "");
  }

  function escolher(f) {
    oculto.value = String(f.id);
    preencher("modelo", f.modelo);
    preencher("cor", f.cor);
    caixa.textContent = "";
    caixa.appendChild(el("p", "ficha-titulo", "Reivindicando a ficha antiga: " + descricao(f)));
    caixa.appendChild(el("p", "suave", "Complete as fotos e envie. A secretaria confere e a ficha antiga é substituída pelo seu cadastro."));
    var desfazer = el("button", "btn pequeno", "Desfazer");
    desfazer.type = "button";
    desfazer.addEventListener("click", function () { mostrar(ultimaLista); });
    caixa.appendChild(desfazer);
  }

  var ultimaLista = [];
  function mostrar(fichas) {
    ultimaLista = fichas;
    oculto.value = "";
    caixa.textContent = "";
    if (!fichas.length) { caixa.hidden = true; return; }
    caixa.hidden = false;
    caixa.appendChild(el("p", "ficha-titulo", fichas.length > 1 ? "Já existem fichas com esta placa. Alguma é o seu carro?" : "Já existe uma ficha com esta placa. É o seu carro?"));
    fichas.forEach(function (f) {
      var linha = el("div", "ficha-linha");
      linha.appendChild(el("span", "", descricao(f)));
      var sim = el("button", "btn pequeno forte", "Sim, é meu");
      sim.type = "button";
      sim.addEventListener("click", function () { escolher(f); });
      linha.appendChild(sim);
      caixa.appendChild(linha);
    });
    var nao = el("button", "btn pequeno", "Não é meu");
    nao.type = "button";
    nao.addEventListener("click", limpar);
    caixa.appendChild(nao);
  }

  function consultar() {
    var placa = campo.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (placa === ultima) return;
    ultima = placa;
    limpar();
    if (!RE_PLACA.test(placa)) return;
    var meu = ++pedido;
    fetch(BASE + "/carros/ficha?placa=" + encodeURIComponent(placa), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { fichas: [] }; })
      .then(function (d) { if (meu === pedido && d && Array.isArray(d.fichas)) mostrar(d.fichas); })
      .catch(function () { /* sem ficha: o cadastro segue normal */ });
  }

  campo.addEventListener("input", function () {
    clearTimeout(espera);
    espera = setTimeout(consultar, 400);
  });
  consultar();
})();
