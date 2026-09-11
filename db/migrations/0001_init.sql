-- Schema do estacionamento (11/09/2026). O projeto nasceu como app Tkinter com
-- SQLite local (repo Ltd-fmf/Projeto_estacionamento_Ltd) e virou web na VPS, em
-- adairbayer.com.br/estacionamento.
--
-- Banco PRÓPRIO (`estacionamento`, role `estacionamento`), no mesmo desenho do
-- NPJ: nenhuma tabela, role ou schema compartilhado com o S.A.D (Bayer
-- Evolution, PRISMA, CodeX) nem com o `identity`. Requisito do projeto: sistema
-- isolado — por isso o usuário do sistema vive aqui, e não no SSO.
--
-- Diferenças conscientes em relação à tabela `formulario` do SQLite original:
--   - id de verdade (bigserial): no original era `id INT` sem PK e o INSERT
--     nem preenchia o campo, então 3 dos 368 registros tinham id NULL e eram
--     impossíveis de editar ou apagar pela interface.
--   - placa normalizada (maiúscula, sem espaço/hífen) e NOT NULL.
--   - SEM UNIQUE na placa: o dado real tem 321 placas distintas em 368 linhas.
--     Impor unicidade agora exigiria descartar dado sem o José decidir; a
--     interface marca as repetições para limpeza.
--   - auditoria (criado_em/por, atualizado_em/por) apontando para usuario.id
--     daqui — antes apontava para identity.usuario, que era o vínculo com o SSO.

CREATE TABLE IF NOT EXISTS usuario (
  id            bigserial PRIMARY KEY,
  login         text NOT NULL UNIQUE,
  nome          text NOT NULL,
  -- 'consulta' só busca e vê; 'admin' insere, edita e exclui.
  papel         text NOT NULL DEFAULT 'consulta' CHECK (papel IN ('consulta', 'admin')),
  -- pbkdf2$sha512$<iteracoes>$<salt b64>$<hash b64> — ver lib/auth.js.
  senha_hash    text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  -- Incrementar invalida as sessões já emitidas para esta pessoa (troca de
  -- senha, desligamento): o cookie carrega o valor e é conferido a cada request.
  sessao_versao integer NOT NULL DEFAULT 1,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso timestamptz
);

CREATE TABLE IF NOT EXISTS veiculo (
  id             bigserial PRIMARY KEY,
  placa          text NOT NULL,
  nome           text,
  setor          text,
  ramal          text,
  modelo         text,
  cor            text,
  foto           text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     bigint REFERENCES usuario(id) ON DELETE SET NULL,
  atualizado_em  timestamptz,
  atualizado_por bigint REFERENCES usuario(id) ON DELETE SET NULL
);

-- Busca por placa é o caso de uso principal (ver um carro no pátio e achar o
-- dono), então índice na placa; o resto da busca é por nome/setor.
CREATE INDEX IF NOT EXISTS veiculo_placa_idx ON veiculo (placa);
CREATE INDEX IF NOT EXISTS veiculo_nome_idx  ON veiculo (lower(nome));
CREATE INDEX IF NOT EXISTS veiculo_setor_idx ON veiculo (lower(setor));
