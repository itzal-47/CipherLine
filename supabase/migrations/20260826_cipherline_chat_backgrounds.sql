/*
# Fundo de tela personalizado por sala ou global

## Novidades
- `profiles.default_background_path` / `default_background_mode`: fundo
  padrão do usuário, aplicado a qualquer sala sem configuração própria
- `room_members.background_path` / `background_mode`: fundo específico de
  uma sala, sobrescreve o padrão do perfil só para essa linha de participação

## Modos
'scan' | 'parallax' | 'reactive' — validados na aplicação, não via CHECK
constraint (mantém consistência com o resto do projeto, que já valida no
cliente/RPC em vez de constraints rígidas no banco)
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_background_path text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_background_mode text;

ALTER TABLE room_members ADD COLUMN IF NOT EXISTS background_path text;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS background_mode text;
