-- ============================================================
-- 20260902_expand_create_room.sql
--
-- BUG B01: CreateScreen fazia UPDATE directo a `rooms` para
-- name/owner_id/is_public/topic/dead_man_switch_days DEPOIS
-- do create_room, mas não existe policy de UPDATE em `rooms`
-- → RLS bloqueia silenciosamente → estes campos ficavam NULL.
--
-- FIX: expandir create_room para receber todos os parâmetros
-- e fazer tudo numa única transacção (room + room_members).
--
-- SEGURANÇA: valida p_owner_id = auth.uid() quando fornecido.
-- Não permite criar salas "em nome de" outro utilizador.
-- ============================================================

-- Drop da versão antiga (3 params). A nova tem assinatura
-- diferente e coexiste mal com overloads + defaults.
DROP FUNCTION IF EXISTS public.create_room(text, boolean, jsonb);

CREATE OR REPLACE FUNCTION public.create_room(
  p_code text,
  p_is_permanent boolean DEFAULT false,
  p_default_burn_config jsonb DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_is_public boolean DEFAULT false,
  p_topic text DEFAULT NULL,
  p_dead_man_switch_days integer DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  code text,
  is_permanent boolean,
  expires_at timestamptz,
  default_burn_config jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_caller uuid := auth.uid();
BEGIN
  -- Se o cliente passou p_owner_id, tem de ser ele mesmo.
  -- Impede criação de salas com owner_id forjado.
  IF p_owner_id IS NOT NULL AND p_owner_id <> v_caller THEN
    RAISE EXCEPTION 'OWNER_MUST_BE_CALLER';
  END IF;

  IF EXISTS (SELECT 1 FROM rooms WHERE rooms.code = p_code) THEN
    RAISE EXCEPTION 'CÓDIGO JÁ EM USO';
  END IF;

  INSERT INTO rooms (
    code,
    is_permanent,
    default_burn_config,
    expires_at,
    owner_id,
    name,
    is_public,
    topic,
    dead_man_switch_days
  )
  VALUES (
    p_code,
    p_is_permanent,
    p_default_burn_config,
    CASE WHEN p_is_permanent THEN NULL ELSE now() + interval '24 hours' END,
    p_owner_id,
    p_name,
    COALESCE(p_is_public, false),
    p_topic,
    p_dead_man_switch_days
  )
  RETURNING * INTO v_room;

  -- Cria membership atomicamente. Guests não têm owner_id,
  -- portanto não entram aqui (room_members exige user_id NOT NULL).
  IF p_owner_id IS NOT NULL THEN
    INSERT INTO room_members (room_id, user_id, role)
    VALUES (v_room.id, p_owner_id, 'owner')
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;

  RETURN QUERY SELECT
    v_room.id,
    v_room.code,
    v_room.is_permanent,
    v_room.expires_at,
    v_room.default_burn_config;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_room(
  text, boolean, jsonb, uuid, text, boolean, text, integer
) TO anon, authenticated;