/*
# Perfil (nome + foto) com exibição opcional por sala

## Conceito
Hoje, ao logar, a identidade é sempre `profiles.nickname` (um código
gerado tipo USER_84CA9A) — sem opção de aparecer com algo reconhecível.

Esta migration adiciona uma IDENTIDADE DE PERFIL separada e opcional:
- `profiles.display_name`: nome que a pessoa escolhe deliberadamente
- `profiles.avatar_path`: foto de perfil (Storage, não cifrada — mesma
  decisão já tomada para outras imagens do app)
- `participants.show_profile`: escolha POR SALA — desativado por padrão
  (continua anônimo com o código de sempre), a pessoa liga isso sala por
  sala quando quiser aparecer com nome/foto reais
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS show_profile boolean NOT NULL DEFAULT false;
