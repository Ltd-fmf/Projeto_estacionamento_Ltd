-- Estacionamento (09/10/2026): cadastro de carro com 5 fotos guiadas
-- (placa, frente, traseira, lateral esquerda, lateral direita) e placa lida da
-- foto da placa.
--
-- Cada foto tem a versão aprovada (`arquivo`) e, quando o funcionário troca,
-- a versão aguardando decisão do admin (`arquivo_pendente`). Mesmo desenho que
-- `usuario.foto_perfil` / `foto_perfil_pendente`.

CREATE TABLE IF NOT EXISTS veiculo_foto (
  id               bigserial PRIMARY KEY,
  veiculo_id       bigint NOT NULL REFERENCES veiculo(id) ON DELETE CASCADE,
  tipo             text NOT NULL
                   CHECK (tipo IN ('placa', 'frente', 'traseira', 'lateral_esq', 'lateral_dir')),
  arquivo          text,
  arquivo_pendente text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (veiculo_id, tipo),
  CHECK (arquivo IS NOT NULL OR arquivo_pendente IS NOT NULL)
);

-- As fotos únicas que já existem (veiculo.foto) eram fotos do carro em geral:
-- viram a "frente". As colunas antigas continuam, só leitura, por uma versão;
-- saem numa migration futura.
INSERT INTO veiculo_foto (veiculo_id, tipo, arquivo, arquivo_pendente)
SELECT id, 'frente', foto, foto_pendente
  FROM veiculo
 WHERE foto IS NOT NULL OR foto_pendente IS NOT NULL
ON CONFLICT (veiculo_id, tipo) DO NOTHING;

-- Auditoria do OCR: o que a leitura da foto devolveu e se a pessoa corrigiu.
--   foto      = placa digitada igual ao que o OCR leu
--   corrigida = a pessoa mudou o que o OCR leu
--   manual    = sem leitura (ficha antiga ou OCR sem resultado)
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS placa_lida text;
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS placa_origem text NOT NULL DEFAULT 'manual'
  CHECK (placa_origem IN ('foto', 'corrigida', 'manual'));
