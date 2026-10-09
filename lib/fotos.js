"use strict";

// Upload e tratamento de fotos, compartilhado entre veículos (server.js) e
// perfis (lib/social.js).

const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const sharp = require("sharp");

// As fotos ficam em disco, em `imagens/` — pasta já ignorada pelo .gitignore.
// Fora do versionamento de propósito: foto de carro de funcionário é dado
// pessoal, e assim o diretório sobrevive ao `git pull` do deploy.
const DIR_FOTOS = path.join(__dirname, "..", "imagens");
fs.mkdirSync(DIR_FOTOS, { recursive: true });

const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

// Em memória, não em disco: o arquivo passa antes pelo sharp, e o que é gravado
// é só a versão já reduzida. O limite é de entrada — foto de celular hoje passa
// fácil de 5 MB, e o que sai daqui fica na casa das centenas de KB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, TIPOS_ACEITOS.has(file.mimetype)),
});

// Redução sem perda visível: 1600px no maior lado (mais do que isso não muda
// nada numa tela de consulta) e WebP em qualidade 82, que é onde o olho ainda
// não distingue do original. `rotate()` sem argumento aplica a orientação do
// EXIF — sem ele, foto tirada de pé no celular aparece deitada.
async function comprimir(buffer, destino) {
  await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(destino);
}

// Trocar ou apagar a foto deixa o arquivo anterior órfão em disco.
function removerArquivo(nome) {
  if (!nome) return;
  // basename: impede que um valor estranho no banco vire travessia de diretório.
  fs.rm(path.join(DIR_FOTOS, path.basename(nome)), { force: true }, () => {});
}

module.exports = { upload, comprimir, removerArquivo, DIR_FOTOS };
