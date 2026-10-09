-- Estacionamento v2 (08/10/2026): de "consulta de placas" para rede social
-- interna. Cada funcionário tem perfil (foto, setor, ramal, WhatsApp) e cadastra
-- o próprio carro; admin/secretaria aprova acessos, carros e fotos.
--
-- Fase 1: usuário com status de aprovação + perfil. Os campos de veículo já
-- entram aqui para a Fase 2 não precisar de outra migration de estrutura.
--
-- Quem já existe (usuario e os 368 veiculo importados) continua valendo:
-- entra como `aprovado`. Só o que nascer a partir de agora começa `pendente`.

-- ---------------------------------------------------------------- usuario
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aprovado'
  CHECK (status IN ('pendente', 'aprovado', 'recusado'));
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS setor text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ramal text;
-- Só dígitos, com DDI+DDD (55 + 2 + 8/9). Montado no servidor ao salvar.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS bio text;
-- Foto em uso e foto aguardando aprovação: a nova só substitui a atual quando
-- o admin aprova, e até lá o perfil segue mostrando a anterior.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS foto_perfil text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS foto_perfil_pendente text;
-- Consentimento LGPD registrado no autocadastro.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS consentimento_em timestamptz;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS motivo_recusa text;

-- A partir daqui, quem se cadastra sozinho espera aprovação.
ALTER TABLE usuario ALTER COLUMN status SET DEFAULT 'pendente';

-- `membro` = funcionário aprovado (vê todos os perfis, edita o próprio).
-- `consulta` continua existindo para a portaria (só olha).
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_papel_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_papel_check
  CHECK (papel IN ('consulta', 'membro', 'admin'));

CREATE INDEX IF NOT EXISTS usuario_status_idx ON usuario (status);

-- ---------------------------------------------------------------- veiculo
-- usuario_id nulo = ficha "não reivindicada" (os 368 importados).
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS usuario_id bigint REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aprovado'
  CHECK (status IN ('pendente', 'aprovado', 'recusado'));
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS motivo_recusa text;
ALTER TABLE veiculo ADD COLUMN IF NOT EXISTS foto_pendente text;
ALTER TABLE veiculo ALTER COLUMN status SET DEFAULT 'pendente';

CREATE INDEX IF NOT EXISTS veiculo_usuario_idx ON veiculo (usuario_id);
CREATE INDEX IF NOT EXISTS veiculo_placa_idx ON veiculo (placa);

-- -------------------------------------------------------------- auditoria
CREATE TABLE IF NOT EXISTS aprovacao_log (
  id          bigserial PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('usuario', 'veiculo', 'foto_perfil', 'foto_veiculo')),
  alvo_id     bigint NOT NULL,
  decisao     text NOT NULL CHECK (decisao IN ('aprovado', 'recusado')),
  motivo      text,
  decidido_por bigint REFERENCES usuario(id) ON DELETE SET NULL,
  decidido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aprovacao_log_alvo_idx ON aprovacao_log (tipo, alvo_id);
