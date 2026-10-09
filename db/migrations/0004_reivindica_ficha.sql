-- Estacionamento (09/10/2026): ao cadastrar o carro, o funcionário pode
-- reivindicar a ficha antiga (veiculo sem usuario_id) com a mesma placa. O
-- admin decide na aprovação; aprovar absorve a ficha. Coluna aditiva.

ALTER TABLE veiculo
  ADD COLUMN IF NOT EXISTS ficha_reivindicada bigint REFERENCES veiculo(id) ON DELETE SET NULL;
