/*
# CipherPaste + Cápsulas do Tempo

## CipherPaste
Bloco de notas compartilhado por sala, cifrado com a mesma chave da sala.
Um único documento por sala (v1) — todos os participantes podem ler/editar.

## Cápsulas do tempo
Mensagens cifradas com "timelock encryption" via drand (tlock-js) — a
matemática da rede drand garante que o conteúdo não pode ser decifrado
antes do horário definido, sem depender de nenhum servidor "prometer"
isso. `capsule_unlock_at` é só para exibição (mostrar contagem regressiva);
a garantia real é criptográfica, não vem desse campo.
*/

CREATE TABLE IF NOT EXISTS room_pastes (
  room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  encrypted_content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE room_pastes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_room_pastes" ON room_pastes;
CREATE POLICY "anon_select_room_pastes" ON room_pastes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_room_pastes" ON room_pastes;
CREATE POLICY "anon_insert_room_pastes" ON room_pastes FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_room_pastes" ON room_pastes;
CREATE POLICY "anon_update_room_pastes" ON room_pastes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_pastes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_pastes;
  END IF;
END $$;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS capsule_unlock_at timestamptz;
