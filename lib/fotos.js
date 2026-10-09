"use strict";

// Upload e tratamento de fotos, compartilhado entre veículos (server.js) e
// perfis (lib/social.js).

const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const sharp = require("sharp");
const { exigirTokenMultipart } = require("./seguranca");

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
  // Tetos de multipart: um formulário legítimo tem no máximo 5 fotos e poucos
  // campos curtos. Sem isso, um cliente malicioso gastaria memória à vontade.
  limits: { fileSize: 15 * 1024 * 1024, files: 5, fields: 24, fieldSize: 4 * 1024, parts: 32 },
  fileFilter: (_req, file, cb) => cb(null, TIPOS_ACEITOS.has(file.mimetype)),
});

// Redução sem perda visível: 1600px no maior lado (mais do que isso não muda
// nada numa tela de consulta) e WebP em qualidade 82, que é onde o olho ainda
// não distingue do original. `rotate()` sem argumento aplica a orientação do
// EXIF — sem ele, foto tirada de pé no celular aparece deitada.
// Contra imagem-bomba: recusa arquivo com mais de 40 megapixels e só aceita o
// que o sharp realmente decodifica como JPEG, PNG ou WEBP (o mimetype que vem
// do navegador não é confiável; SVG, GIF e TIFF ficam de fora).
const OPCOES_SHARP = { limitInputPixels: 40_000_000, failOn: "error" };
const FORMATOS = new Set(["jpeg", "png", "webp"]);

async function comprimir(buffer, destino) {
  const meta = await sharp(buffer, OPCOES_SHARP).metadata();
  if (!FORMATOS.has(meta.format)) throw new Error(`formato não aceito: ${meta.format}`);
  await sharp(buffer, OPCOES_SHARP)
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

// Multer + conferência do token CSRF (o corpo multipart só existe depois do
// multer, então o token é checado aqui e não no middleware global).
const uploadUm = (campo) => [upload.single(campo), exigirTokenMultipart];
const uploadCampos = (campos) => [upload.fields(campos), exigirTokenMultipart];

module.exports = { upload, uploadUm, uploadCampos, comprimir, removerArquivo, DIR_FOTOS };
