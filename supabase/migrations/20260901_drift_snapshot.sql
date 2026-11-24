-- ============================================================
-- 20260901_drift_snapshot.sql
--
-- OBJECTIVO: consolidar no repositório tudo o que está a correr
-- em produção mas nunca foi versionado. Sem isto, um restore
-- limpo pelas migrations parte stories, avatares de sala,
-- system rooms, dashboard backgrounds, friendships, etc.
--
-- SEGURANÇA: tudo IF NOT EXISTS. Correr 2x = zero efeito.
-- Não remove nada. Não altera colunas existentes.
--
-- Este ficheiro inclui 2 correcções objectivas (marcadas
-- separadamente na secção final) para não perpetuar bugs
-- conhecidos sem ficheiro fonte.
-- ============================================================

-- ============================================================
-- 1) COLUNAS EM FALTA
-- ============================================================

-- rooms: avatar + sistema (existem em prod, sem migration)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_system_room boolean DEFAULT false;

-- profiles: dashboard background
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dashboard_bg_path text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dashboard_bg_apply_to_chats boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dashboard_bg_mode text DEFAULT 'default';

-- participants: secret (usado por join_room_secure / verify_participant)
ALTER TABLE participants ADD COLUMN IF NOT EXISTS secret_hash text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS secret_set_at timestamptz;

-- messages: poll + pin + whisper + 1x audio + filename
ALTER TABLE messages ADD COLUMN IF NOT EXISTS target_participant_id uuid
  REFERENCES participants(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_data jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS burn_after_listen boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name text;

-- ============================================================
-- 2) ÍNDICES EM FALTA
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_participants_room_nickname
  ON participants (room_id, nickname);

-- ============================================================
-- 3) CONSTRAINTS UNIQUE EM FALTA
--    (usadas por upsert com onConflict no frontend)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reactions_unique'
  ) THEN
    ALTER TABLE reactions
      ADD CONSTRAINT reactions_unique UNIQUE (message_id, participant_id, emoji);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'read_receipts_unique'
  ) THEN
    ALTER TABLE read_receipts
      ADD CONSTRAINT read_receipts_unique UNIQUE (message_id, participant_id);
  END IF;
END $$;

-- ============================================================
-- 4) TABELAS EM FALTA: friendships
--    (usadas em DashboardScreen para lista de amigos)
-- ============================================================
CREATE TABLE IF NOT EXISTS friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT friendships_status_check
    CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT friendships_user_id_friend_id_key
    UNIQUE (user_id, friend_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_can_see_own_friendships" ON friendships;
CREATE POLICY "users_can_see_own_friendships" ON friendships FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

DROP POLICY IF EXISTS "users_can_insert_friendships" ON friendships;
CREATE POLICY "users_can_insert_friendships" ON friendships FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_can_update_friendships" ON friendships;
CREATE POLICY "users_can_update_friendships" ON friendships FOR UPDATE
  TO authenticated USING (auth.uid() = friend_id OR auth.uid() = user_id);

-- ============================================================
-- 5) TABELAS EM FALTA: stories + story_views + story_reactions
--    (estrutura inferida dos tipos TS + queries do frontend)
-- ============================================================
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_encrypted text,
  media_path text,
  media_type text NOT NULL DEFAULT 'text',
  burn_trigger text NOT NULL DEFAULT 'none',
  unlock_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_stories_user_id    ON stories (user_id);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories (expires_at);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_can_view_stories" ON stories;
CREATE POLICY "friends_can_view_stories" ON stories FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE (f.user_id = auth.uid() AND f.friend_id = stories.user_id AND f.status = 'accepted')
         OR (f.user_id = stories.user_id AND f.friend_id = auth.uid() AND f.status = 'accepted')
    )
  );

DROP POLICY IF EXISTS "users_can_insert_own_stories" ON stories;
CREATE POLICY "users_can_insert_own_stories" ON stories FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_can_delete_own_stories" ON stories;
CREATE POLICY "users_can_delete_own_stories" ON stories FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------- story_views ----------
CREATE TABLE IF NOT EXISTS story_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_anonymous boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_views_story_id_viewer_id_key UNIQUE (story_id, viewer_id)
);

ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "viewer_can_insert_view" ON story_views;
CREATE POLICY "viewer_can_insert_view" ON story_views FOR INSERT
  TO authenticated WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS "owner_can_see_views" ON story_views;
CREATE POLICY "owner_can_see_views" ON story_views FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM stories s WHERE s.id = story_views.story_id AND s.user_id = auth.uid())
  );

-- ---------- story_reactions ----------
CREATE TABLE IF NOT EXISTS story_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  reactor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_reactions_story_id_reactor_id_key UNIQUE (story_id, reactor_id)
);

ALTER TABLE story_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_react" ON story_reactions;
CREATE POLICY "anyone_can_react" ON story_reactions FOR INSERT
  TO authenticated WITH CHECK (reactor_id = auth.uid());

DROP POLICY IF EXISTS "owner_can_see_reactions" ON story_reactions;
CREATE POLICY "owner_can_see_reactions" ON story_reactions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM stories s WHERE s.id = story_reactions.story_id AND s.user_id = auth.uid())
  );

-- Realtime para stories (DashboardScreen subscreve, mas nunca dispara — B07)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'stories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stories;
  END IF;
END $$;

-- ============================================================
-- 6) POLICIES EM FALTA (em tabelas que já existem)
-- ============================================================

-- profiles: leitura de perfis em salas partilhadas
DROP POLICY IF EXISTS "read_profiles_in_shared_rooms" ON profiles;
CREATE POLICY "read_profiles_in_shared_rooms" ON profiles FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM participants p1
      JOIN participants p2 ON p2.room_id = p1.room_id
      WHERE p1.user_id = auth.uid()
        AND p2.user_id = profiles.id
        AND p2.show_profile = true
    )
    OR id = auth.uid()
  );

-- push_subscriptions: gestão apenas das próprias subscrições
DROP POLICY IF EXISTS "auth_manage_own_push_subs" ON push_subscriptions;
CREATE POLICY "auth_manage_own_push_subs" ON push_subscriptions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM participants p
      WHERE p.id = push_subscriptions.participant_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM participants p
      WHERE p.id = push_subscriptions.participant_id
        AND p.user_id = auth.uid()
    )
  );

-- rooms: membros vêem as suas salas
DROP POLICY IF EXISTS "authenticated_select_member_rooms" ON rooms;
CREATE POLICY "authenticated_select_member_rooms" ON rooms FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM room_members
      WHERE room_members.room_id = rooms.id
        AND room_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- 7) FUNÇÕES EM FALTA
-- ============================================================

-- add_user_to_eivorak_sys(): trigger AFTER INSERT em profiles
-- Objectivo inferido do nome: associar novo perfil à sala de sistema EiVORAK.
-- Se a sala não existir ainda, não faz nada (defensivo).
CREATE OR REPLACE FUNCTION public.add_user_to_eivorak_sys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sys_room uuid;
BEGIN
  SELECT id INTO v_sys_room
  FROM rooms
  WHERE is_system_room = true
  LIMIT 1;

  IF v_sys_room IS NOT NULL THEN
    INSERT INTO room_members (room_id, user_id, role)
    VALUES (v_sys_room, NEW.id, 'member')
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_add_eivorak_sys ON profiles;
CREATE TRIGGER on_profile_add_eivorak_sys
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.add_user_to_eivorak_sys();

-- ============================================================
-- 8) CORRECÇÕES APLICADAS NESTA MIGRATION
--
-- Estas DUAS policies não existiam em nenhum ficheiro fonte,
-- por isso é impossível "só fazer snapshot". Corrigem bugs
-- conhecidos no momento em que são versionadas.
-- ============================================================

-- B04: rate_limit_feedback estava a comparar contact_email consigo
-- mesmo (`feedback_1.contact_email = feedback_1.contact_email`),
-- o que é sempre TRUE → bloqueio global após 5 feedbacks.
-- Correção: comparar com a row externa.
DROP POLICY IF EXISTS "rate_limit_feedback" ON feedback;
CREATE POLICY "rate_limit_feedback" ON feedback FOR INSERT
  TO anon, authenticated WITH CHECK (
    contact_email IS NULL
    OR (
      SELECT count(*)
      FROM feedback f
      WHERE f.contact_email = feedback.contact_email
        AND f.created_at > (now() - interval '1 hour')
    ) < 5
  );

-- ============================================================
-- FIM
-- ============================================================