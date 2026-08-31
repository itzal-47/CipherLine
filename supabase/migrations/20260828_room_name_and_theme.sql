/*
# Nome do canal + preferência de tema

- `rooms.name`: nome opcional e cosmético do canal (não é identificador,
  só exibição — o código continua sendo o que dá acesso)
- `profiles.theme_preference`: 'default' | 'overide', tema visual escolhido
  pelo usuário para a plataforma inteira

## Correção importante
Nunca existiu uma política de UPDATE na tabela `rooms` — isso significa que
toda atualização feita após criar a sala (tópico, público/privado, gatilho
de inatividade, e agora o nome) estava falhando silenciosamente por RLS
desde que essas funcionalidades foram implementadas.
*/

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT 'default';

DROP POLICY IF EXISTS "anon_update_rooms" ON rooms;
CREATE POLICY "anon_update_rooms" ON rooms FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
