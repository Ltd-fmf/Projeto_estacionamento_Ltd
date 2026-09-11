# Estacionamento — consulta de veículos de funcionários

Ferramenta web servida em **https://adairbayer.com.br/estacionamento**.
Substitui o app desktop `Controle de Carros - PGEAM v1` (branch `main` deste
repositório), que era Tkinter + SQLite local.

Caso de uso: um carro no pátio com o farol aceso, mal estacionado ou bloqueando
outro — busca-se pela placa e chega-se ao dono, com setor e **ramal** para ligar.

## Sistema isolado

Não tem vínculo nenhum com o S.A.D (Bayer Evolution, PRISMA, CodeX) nem com o
SSO da Central de Acessos: **login, senha e banco são próprios**. O que é
compartilhado com os outros sistemas é apenas o domínio e a instância do
Postgres — mesmo desenho do NPJ.

Na prática, o isolamento é:

| Camada | Aqui | S.A.D |
|---|---|---|
| Autenticação | tabela `usuario` deste banco, senha PBKDF2 | SSO, cookie `rvmr_sso` |
| Cookie | `estac_sess`, `path=/estacionamento` (não sai daqui) | `rvmr_sso`, domínio inteiro |
| Banco | banco `estacionamento`, role `estacionamento` | banco `comissao`, role `comissao_app` |

## Por que foi reescrito

Tkinter é interface de desktop: não roda em servidor headless (sem `$DISPLAY`).
Além disso o código publicado estava **truncado** (`cad_cli.py` termina no meio
da linha 383, em `tree.co`, sem `janela.mainloop()`), então nem abria janela. Do
original sobreviveu o modelo de dados; a interface é nova.

## Stack

Node 22 + Express + Postgres, rodando em pm2 na porta 3007. Nenhuma dependência
de front — o HTML é renderizado no servidor. As únicas dependências são
`express`, `pg` e `dotenv`; senha e sessão usam só o `node:crypto`.

## Acesso

Login e senha próprios, cadastrados por quem administra o sistema — não existe
autocadastro.

- **`consulta`** — busca e vê a lista;
- **`admin`** — também insere, edita e exclui.

Criar ou trocar a senha de alguém:

```bash
node scripts/criar-usuario.js joao "senha-forte" --nome "João da Portaria"
node scripts/criar-usuario.js jose "senha-forte" --nome "José Airton" --papel admin
```

Rodar o comando de novo sobre um login existente troca a senha e **derruba as
sessões abertas** daquela pessoa (`sessao_versao` é incrementada). Desativar
alguém sem apagar: `UPDATE usuario SET ativo = false WHERE login = '...'`.

Proteções: senha em PBKDF2-HMAC-SHA512 (210 mil iterações, salt por usuário),
comparação em tempo constante, 5 tentativas erradas por IP+login bloqueiam por
5 minutos, sessão de 12h rechecada no banco a cada request.

## Dados

Importados do `dados.db` original: 368 veículos. O que foi encontrado nele e
como está tratado:

| Situação no dado real | Tratamento |
|---|---|
| 3 registros com `id` NULL (não editáveis no app antigo) | `id bigserial` de verdade; todos editáveis |
| 16 registros sem placa | importados; a lista mostra "sem placa" |
| 31 placas repetidas, em 78 linhas | importadas; marcadas com a tag "repetida" para limpeza |
| 3 placas fora do padrão (`QZAJ51`, `PHZIE26`, `PHP`) | importadas; validação avisa mas não bloqueia |

## Rodar local

```bash
npm install
cp .env.example .env    # preencher DATABASE_URL e SESSION_SECRET
npm run migrate
node scripts/criar-usuario.js admin "uma-senha" --nome "Admin" --papel admin
node server.js          # http://127.0.0.1:3007/estacionamento
```

Em local sem HTTPS, ponha `NODE_ENV=desenvolvimento` no `.env`, senão o cookie
de sessão sai com `Secure` e o navegador o descarta.

## Branches

- **`main`** — o app desktop original em Tkinter, preservado como está.
- **`web`** — esta versão. É a branch que vai pro servidor; a `main` não é tocada.

## Deploy (VPS)

`/opt/estacionamento` é um clone desta branch. O repositório é público, então o
`pull` não precisa de chave nem de token:

```bash
cd /opt/estacionamento
git pull                # já rastreia origin/web
npm ci                  # só quando package-lock.json mudar
npm run migrate         # aplica db/migrations/NNNN_*.sql
pm2 restart estacionamento
```

O `.env` (modo 600) e o `node_modules/` ficam fora do versionamento e sobrevivem
ao `pull`.

O `seed_veiculos.sql` é carga única e fica fora do runner de migrations de
propósito (é dado, não estrutura) — e fora do versionamento, porque é dado
pessoal de 368 pessoas.
