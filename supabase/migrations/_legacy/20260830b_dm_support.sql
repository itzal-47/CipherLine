/*
# Vínculo de conta ao participante + DM real

## Problema
A tabela `participants` nunca guardou qual conta (profile) cada participante
é de verdade — por isso "Responder em Privado" nunca pôde ser implementado
de verdade (não tinha como saber com quem abrir a conversa).

## Correção
- `participants.user_id`: preenchido quando o participante é uma conta
  logada (nulo para convidados — que continuam sem DM disponível, já que
  não têm identidade estável entre sessões)
- RPC `find_or_create_dm`: dado o user_id de outra pessoa, encontra uma
  sala privada 1-para-1 já existente entre as duas contas, ou cria uma nova
*/

ALTER TABLE participants ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.find_or_create_dm(p_other_user_id uuid)
RETURNS TABLE (room_id uuid, room_code text, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_existing_room_id uuid;
  v_new_room_id uuid;
  v_new_code text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'PRECISA DE CONTA PARA CONVERSAS PRIVADAS';
  END IF;
  IF v_me = p_other_user_id THEN
    RAISE EXCEPTION 'NÃO É POSSÍVEL CRIAR DM COM VOCÊ MESMO';
  END IF;

  -- Procura uma sala privada já existente com EXATAMENTE estes 2 membros
  SELECT rm1.room_id INTO v_existing_room_id
  FROM room_members rm1
  JOIN room_members rm2 ON rm2.room_id = rm1.room_id AND rm2.user_id = p_other_user_id
  JOIN rooms r ON r.id = rm1.room_id
  WHERE rm1.user_id = v_me
    AND r.is_public = false
    AND (SELECT COUNT(*) FROM room_members rm3 WHERE rm3.room_id = rm1.room_id) = 2
  LIMIT 1;

  IF v_existing_room_id IS NOT NULL THEN
    RETURN QUERY SELECT r.id, r.code, false FROM rooms r WHERE r.id = v_existing_room_id;
    RETURN;
  END IF;

  -- Cria uma nova sala privada permanente para os dois — com repetição segura em caso de colisão de código (rara, mas possível)
  FOR i IN 1..5 LOOP
    v_new_code := upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));
    BEGIN
      INSERT INTO rooms (code, is_permanent, is_public, owner_id)
      VALUES (v_new_code, true, false, v_me)
      RETURNING id INTO v_new_room_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_new_room_id := NULL;
    END;
  END LOOP;

  IF v_new_room_id IS NULL THEN
    RAISE EXCEPTION 'FALHA AO GERAR CÓDIGO ÚNICO — TENTE NOVAMENTE';
  END IF;

  INSERT INTO room_members (room_id, user_id, role) VALUES (v_new_room_id, v_me, 'owner');
  INSERT INTO room_members (room_id, user_id, role) VALUES (v_new_room_id, p_other_user_id, 'member');

  RETURN QUERY SELECT v_new_room_id, v_new_code, true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_dm(uuid) TO authenticated;
