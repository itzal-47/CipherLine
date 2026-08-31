/*
# Gatilho de inatividade (Dead Man's Switch)

## Novidades
- `rooms.dead_man_switch_days`: dias de inatividade até a sala se
  autodestruir sozinha (null = desativado). Só faz sentido para salas
  permanentes — temporárias já expiram em 24h de qualquer forma.
- `rooms.last_activity_at`: atualizado automaticamente a cada mensagem nova,
  usado para calcular a inatividade

## Como a verificação acontece
Sem um agendador externo garantido (pg_cron pode não estar disponível no
plano do projeto), a verificação roda de forma "preguiçosa": toda vez que
alguém tenta entrar numa sala (via código), se o prazo de inatividade já
passou, a sala é destruída ali mesmo antes de deixar entrar — mesmo padrão
já usado para salas temporárias expiradas.
*/

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS dead_man_switch_days integer;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.touch_room_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE rooms SET last_activity_at = now() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_touch_room_activity ON messages;
CREATE TRIGGER on_message_touch_room_activity
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_room_activity();

-- RPC que verifica e, se aplicável, destrói a sala por inatividade antes de
-- retornar seus dados — usada por find_room_by_code, chamada pelo cliente
-- ao tentar entrar por código.
CREATE OR REPLACE FUNCTION public.check_and_wipe_if_inactive(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_wiped boolean := false;
BEGIN
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id;

  IF v_room.id IS NOT NULL
     AND v_room.dead_man_switch_days IS NOT NULL
     AND v_room.last_activity_at < now() - (v_room.dead_man_switch_days || ' days')::interval
  THEN
    DELETE FROM messages WHERE room_id = p_room_id;
    DELETE FROM rooms WHERE id = p_room_id;
    v_wiped := true;
  END IF;

  RETURN v_wiped;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_wipe_if_inactive(uuid) TO anon, authenticated;
