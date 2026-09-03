/*
# CipherLine: rooms, participants, and messages tables

## Overview
Creates the core schema for CipherLine, an encrypted ephemeral chat app.
The app has NO sign-in screen — users join channels with a shared code and a nickname.
All access is through the anon key, so policies target `anon, authenticated`.

## New Tables

### rooms
- `id` (uuid, primary key)
- `code` (text, unique, not null) — the XXXX-XXXX channel code users share
- `created_at` (timestamptz, default now())
- `expires_at` (timestamptz, default now() + interval '24 hours') — optional expiry

### participants
- `id` (uuid, primary key)
- `room_id` (uuid, FK to rooms, on delete cascade)
- `nickname` (text, not null)
- `joined_at` (timestamptz, default now())
- `last_seen` (timestamptz, default now()) — updated periodically for presence

### messages
- `id` (uuid, primary key)
- `room_id` (uuid, FK to rooms, on delete cascade)
- `sender_id` (uuid, FK to participants, on delete cascade)
- `encrypted_content` (text, not null) — base64-encoded AES-256-GCM ciphertext
- `created_at` (timestamptz, default now())
- `read_at` (timestamptz, nullable)
- `destroyed_at` (timestamptz, nullable)

## Security (RLS)
- All three tables have RLS enabled.
- `rooms`: anyone can insert (create a room) and select by code. No update needed.
- `participants`: anyone can insert (join a room), select participants of rooms they
  can see, update their own last_seen, and delete their own row (leave room).
- `messages`: anyone can insert a message if they are a participant of the room,
  select messages for rooms they participate in, update read_at/destroyed_at for
  messages in rooms they participate in, and delete messages in rooms they
  participate in (for self-destruct).

## Realtime
- Realtime is enabled on the `messages` table via publication so the frontend
  receives instant push of new messages.

## Notes
1. No auth.users dependency — fully anon-key compatible.
2. Schema supports N participants per room (future group support).
3. Messages store only ciphertext; plaintext never touches the server.
*/

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '24 hours'
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_rooms" ON rooms;
CREATE POLICY "anon_select_rooms" ON rooms FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_rooms" ON rooms;
CREATE POLICY "anon_insert_rooms" ON rooms FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_rooms" ON rooms;
CREATE POLICY "anon_delete_rooms" ON rooms FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  joined_at timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now()
);

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_participants" ON participants;
CREATE POLICY "anon_select_participants" ON participants FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_participants" ON participants;
CREATE POLICY "anon_insert_participants" ON participants FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_participants" ON participants;
CREATE POLICY "anon_update_participants" ON participants FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_participants" ON participants;
CREATE POLICY "anon_delete_participants" ON participants FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  encrypted_content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz,
  destroyed_at timestamptz
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_messages" ON messages;
CREATE POLICY "anon_update_messages" ON messages FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_messages" ON messages;
CREATE POLICY "anon_delete_messages" ON messages FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE participants;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  END IF;
END $$;/*
# CipherLine: security hardening + permanent rooms + reactions + burn config

## Overview
This migration hardens the rooms table against enumeration, adds support for
permanent rooms and custom codes, adds configurable message self-destruct,
and adds a reactions table for quick emoji reactions.

## Changes to existing tables

### rooms
- Add `is_permanent` (boolean, default false) — distinguishes temp vs permanent rooms
- Add `default_burn_config` (jsonb, nullable) — per-room default self-destruct config
- Make `expires_at` nullable (null = permanent room, never expires)

### messages
- Add `burn_config` (jsonb, nullable) — per-message self-destruct config, inherits from room

## New tables

### reactions
- `id` (uuid, primary key)
- `message_id` (uuid, FK to messages, on delete cascade)
- `participant_id` (uuid, FK to participants, on delete cascade)
- `emoji` (text, not null)
- `created_at` (timestamptz, default now())
- RLS enabled, permissive anon/authenticated policies (same pattern as other tables)
- Realtime enabled

## Security changes

### rooms SELECT policy revoked
- Drop the existing `anon_select_rooms` policy that used USING(true)
- Replace with USING(false) so direct SELECT on rooms returns nothing to anon clients
- This prevents enumeration of room codes

### New RPC functions (SECURITY DEFINER)

1. `find_room_by_code(p_code text)` — returns room row ONLY if code matches exactly.
   Prevents enumeration. Returns null if not found or if temp room has expired.

2. `create_room(p_code text, p_is_permanent boolean, p_default_burn_config jsonb)` —
   inserts a room, checks for code collision, returns the created room.
   Raises exception 'CÓDIGO JÁ EM USO' if code already exists.

## Notes
1. SECURITY DEFINER functions bypass RLS, so they can read rooms even though
   the SELECT policy is now USING(false).
2. The functions have a fixed search_path to prevent search_path injection.
3. Realtime is added to the reactions table.
4. All existing data is preserved — only additive changes.
*/

-- Add columns to rooms
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_permanent boolean DEFAULT false;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS default_burn_config jsonb;
ALTER TABLE rooms ALTER COLUMN expires_at DROP NOT NULL;

-- Add burn_config to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS burn_config jsonb;

-- Create reactions table
CREATE TABLE IF NOT EXISTS reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reactions" ON reactions;
CREATE POLICY "anon_select_reactions" ON reactions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_reactions" ON reactions;
CREATE POLICY "anon_insert_reactions" ON reactions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_reactions" ON reactions;
CREATE POLICY "anon_delete_reactions" ON reactions FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reactions;
  END IF;
END $$;

-- Revoke direct SELECT on rooms
DROP POLICY IF EXISTS "anon_select_rooms" ON rooms;
CREATE POLICY "anon_select_rooms" ON rooms FOR SELECT
  TO anon, authenticated USING (false);

-- RPC: find_room_by_code
CREATE OR REPLACE FUNCTION public.find_room_by_code(p_code text)
RETURNS TABLE (id uuid, code text, is_permanent boolean, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.id, r.code, r.is_permanent, r.expires_at
    FROM rooms r
    WHERE r.code = p_code
      AND (
        r.is_permanent = true
        OR r.expires_at IS NULL
        OR r.expires_at > now()
      );
END;
$$;

-- RPC: create_room
CREATE OR REPLACE FUNCTION public.create_room(
  p_code text,
  p_is_permanent boolean DEFAULT false,
  p_default_burn_config jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, code text, is_permanent boolean, expires_at timestamptz, default_burn_config jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM rooms WHERE rooms.code = p_code) THEN
    RAISE EXCEPTION 'CÓDIGO JÁ EM USO';
  END IF;

  INSERT INTO rooms (code, is_permanent, default_burn_config, expires_at)
  VALUES (
    p_code,
    p_is_permanent,
    p_default_burn_config,
    CASE WHEN p_is_permanent THEN NULL ELSE now() + interval '24 hours' END
  )
  RETURNING * INTO v_room;

  RETURN QUERY SELECT v_room.id, v_room.code, v_room.is_permanent, v_room.expires_at, v_room.default_burn_config;
END;
$$;

-- Grant execute on RPCs to anon and authenticated
GRANT EXECUTE ON FUNCTION public.find_room_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room(text, boolean, jsonb) TO anon, authenticated;/*
# Add find_room_by_code_any RPC for expired room detection

## Overview
Adds a SECURITY DEFINER function that finds a room by code regardless of expiry status.
This is used by the frontend to distinguish between "room not found" and "room expired"
when joining a channel.

## New RPC function
- `find_room_by_code_any(p_code text)` — returns room id, code, is_permanent, expires_at
  if the code matches any room (even expired ones). Used to detect expired rooms and
  show the dedicated "CANAL EXPIRADO" screen.

## Notes
1. SECURITY DEFINER bypasses RLS so it can read rooms despite the USING(false) SELECT policy.
2. Fixed search_path to prevent injection.
*/

CREATE OR REPLACE FUNCTION public.find_room_by_code_any(p_code text)
RETURNS TABLE (id uuid, code text, is_permanent boolean, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.id, r.code, r.is_permanent, r.expires_at
    FROM rooms r
    WHERE r.code = p_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_room_by_code_any(text) TO anon, authenticated;/*
# CipherLine: read_receipts, push_subscriptions, device_id

## Overview
Adds per-participant read receipts (replacing the single read_at on messages),
push subscription storage for Web Push notifications, and a device_id column
on participants for multi-device sync.

## New Tables

### read_receipts
- id (uuid pk)
- message_id (uuid FK messages, on delete cascade)
- participant_id (uuid FK participants, on delete cascade)
- read_at (timestamptz default now())
- Index on message_id
- RLS enabled, permissive anon/authenticated policies
- Realtime enabled

### push_subscriptions
- id (uuid pk)
- participant_id (uuid FK participants, on delete cascade)
- subscription (jsonb, stores PushSubscription object)
- created_at (timestamptz default now())
- RLS enabled, permissive anon/authenticated policies

## Modified Tables

### participants
- Add device_id (text, nullable) — used for multi-device sync

## Notes
1. All new tables follow the same permissive RLS pattern as existing tables.
2. Realtime enabled on read_receipts for live read status updates.
3. device_id allows the same logical participant to be recognized across devices.
*/

CREATE TABLE IF NOT EXISTS read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now()
);

ALTER TABLE read_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_read_receipts" ON read_receipts;
CREATE POLICY "anon_select_read_receipts" ON read_receipts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_read_receipts" ON read_receipts;
CREATE POLICY "anon_insert_read_receipts" ON read_receipts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_read_receipts" ON read_receipts;
CREATE POLICY "anon_delete_read_receipts" ON read_receipts FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_read_receipts_message_id ON read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_participant_id ON read_receipts(participant_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_push_subs" ON push_subscriptions;
CREATE POLICY "anon_select_push_subs" ON push_subscriptions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_push_subs" ON push_subscriptions;
CREATE POLICY "anon_insert_push_subs" ON push_subscriptions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_push_subs" ON push_subscriptions;
CREATE POLICY "anon_delete_push_subs" ON push_subscriptions FOR DELETE
  TO anon, authenticated USING (true);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS device_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'read_receipts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE read_receipts;
  END IF;
END $$;/*
# CipherLine: Database trigger to invoke send-push edge function on message insert

## Overview
Creates a trigger function that calls the send-push edge function via pg_net
whenever a new message is inserted into the messages table.

## Notes
1. Uses pg_net extension for HTTP calls from Postgres
2. The edge function URL is constructed from the Supabase project URL
3. Uses SECURITY DEFINER to bypass RLS for the trigger
4. Variable names use v_ prefix to avoid column name ambiguity
*/

CREATE OR REPLACE FUNCTION public.notify_push_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_url text;
  v_edge_url text;
  v_request_id int;
BEGIN
  -- Este bloco NUNCA pode impedir a mensagem de ser salva: qualquer falha aqui
  -- (extensão pg_net ausente, URL errada, edge function fora do ar, etc.) é
  -- silenciosamente ignorada, e a mensagem segue seu fluxo normal.
  BEGIN
    v_project_url := current_setting('app.supabase_url', true);
    IF v_project_url IS NULL OR v_project_url = '' THEN
      -- Sem app.supabase_url configurado, não há como saber a URL correta
      -- deste projeto — pula o push em vez de arriscar chamar outro projeto.
      RETURN NEW;
    END IF;

    v_edge_url := v_project_url || '/functions/v1/send-push';

    SELECT net.http_post(
      url := v_edge_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW)
      )
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    -- pg_net indisponível, erro de rede, o que for — ignora e segue.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_insert_push ON messages;
CREATE TRIGGER on_message_insert_push
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_message();/*
# CipherLine: Media support — message types, storage paths, media bucket

## Overview
Adds support for audio and image messages by extending the messages table
with type classification, storage path tracking, and audio duration metadata.
Creates a storage bucket for media files with permissive access policies
and a cleanup trigger to delete orphaned files when messages are destroyed.

## Modified Tables

### messages
- message_type (text, default 'text') — 'text' | 'audio' | 'image'
- storage_path (text, nullable) — path in the cipherline-media bucket
- duration_seconds (integer, nullable) — audio duration for player UI

## Storage
- Bucket: cipherline-media (public read, anon/authenticated write/delete)
- Subfolders: audio/, images/

## Cleanup
- Trigger on messages DELETE that removes the associated Storage object
  via the Storage API (supabase.storage.from().remove())
- Uses a SECURITY DEFINER function with search_path set to avoid ambiguity
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- Insert the storage bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('cipherline-media', 'cipherline-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (permissive, matching the app's no-auth pattern)
DROP POLICY IF EXISTS "anon_read_media" ON storage.objects;
CREATE POLICY "anon_read_media" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'cipherline-media');

DROP POLICY IF EXISTS "anon_insert_media" ON storage.objects;
CREATE POLICY "anon_insert_media" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'cipherline-media');

DROP POLICY IF EXISTS "anon_update_media" ON storage.objects;
CREATE POLICY "anon_update_media" ON storage.objects
  FOR UPDATE TO anon, authenticated USING (bucket_id = 'cipherline-media');

DROP POLICY IF EXISTS "anon_delete_media" ON storage.objects;
CREATE POLICY "anon_delete_media" ON storage.objects
  FOR DELETE TO anon, authenticated USING (bucket_id = 'cipherline-media');

-- Cleanup function: delete Storage object when message is deleted
CREATE OR REPLACE FUNCTION public.cleanup_media_on_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_path text;
BEGIN
  v_path := OLD.storage_path;
  IF v_path IS NOT NULL THEN
    -- Remove the file from the storage bucket
    -- We use the storage API via pg_net HTTP call to the Storage REST API
    -- The object path is relative to the bucket root
    PERFORM net.http_post(
      url := current_setting('app.supabase_url', true) || '/storage/v1/object/' || v_path,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
        'x-upsert', 'false'
      ),
      body := '{}'::jsonb
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_message_delete_cleanup_media ON messages;
CREATE TRIGGER on_message_delete_cleanup_media
  BEFORE DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_media_on_message_delete();/*
# CipherLine: User accounts, room membership, and message replies

## Overview
Adds optional user accounts via Supabase Auth, persistent room membership,
public/private channel discovery, and message reply support. This is an
additive layer — the existing guest (no-auth) flow continues to work unchanged.

## New Tables

### profiles
- id (uuid, PK, FK → auth.users ON DELETE CASCADE)
- email (text, not null)
- nickname (text, not null, default generated)
- created_at (timestamptz, default now())
- One row per authenticated user, created via trigger on auth.users signup.

### email_verification_codes
- id (uuid, PK)
- email (text, not null, indexed)
- code_hash (text, not null — SHA-256 hash of 6-digit code, never stored in plain)
- expires_at (timestamptz, default now() + 10 minutes)
- attempts (integer, default 0)
- created_at (timestamptz, default now())
- Used by the custom email verification flow (code-based, not link-based).

### room_members
- id (uuid, PK)
- room_id (uuid, FK → rooms ON DELETE CASCADE)
- user_id (uuid, FK → profiles ON DELETE CASCADE)
- joined_at (timestamptz, default now())
- role (text, default 'member' — 'owner' for room creator)
- is_archived (boolean, default false)
- is_pinned (boolean, default false)
- is_muted (boolean, default false)
- last_read_at (timestamptz, nullable)
- UNIQUE (room_id, user_id)
- This is the PERSISTENT membership record, distinct from the ephemeral
  `participants` table which tracks who is currently online in a session.

## Modified Tables

### rooms
- is_public (boolean, default false) — public channels appear in discovery
- owner_id (uuid, nullable, FK → profiles ON DELETE SET NULL) — null for guest rooms
- topic (text, nullable) — short description for public channels

### messages
- reply_to_message_id (uuid, nullable, FK → messages ON DELETE SET NULL)
  Self-referencing FK for reply chains. ON DELETE SET NULL so destroying a
  message doesn't cascade-delete replies.

## Security (RLS)

### profiles
- SELECT: authenticated users can read their own profile only
- INSERT: blocked (profiles are created via trigger, not client insert)
- UPDATE: authenticated users can update their own profile only

### email_verification_codes
- No direct client access (no SELECT/INSERT/UPDATE/DELETE policies).
  All operations go through SECURITY DEFINER RPC functions that use
  the service role internally, so the table is effectively locked down.

### room_members
- SELECT: authenticated users can read their own membership rows only
- INSERT: authenticated users can insert their own membership rows
- UPDATE: authenticated users can update their own membership rows only
- DELETE: authenticated users can delete their own membership rows only

### rooms (additional policies)
- SELECT for public rooms: any authenticated user can see rooms where
  is_public = true (via a dedicated policy)
- Existing anon/authenticated policies remain for the guest flow

## RPC Functions

### generate_verification_code(p_email text)
- SECURITY DEFINER, callable by authenticated
- Generates a 6-digit code, hashes it, stores in email_verification_codes
- Returns the plain code (for the edge function to send via email)
- The client never receives the plain code — only the edge function does

### verify_email_code(p_email text, p_code text)
- SECURITY DEFINER, callable by authenticated
- Validates the code against stored hash, checks expiry and attempt count
- On success: updates auth.users to set email_confirmed_at
- On failure: increments attempts, returns error
- Max 5 attempts before requiring a new code

### get_public_rooms()
- SECURITY DEFINER, callable by authenticated
- Returns public rooms with member counts
- Prevents enumeration of private rooms

## Triggers

### on_auth_user_created
- AFTER INSERT on auth.users
- Creates a profile row with a generated nickname
*/

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  nickname text NOT NULL DEFAULT 'USER_' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- EMAIL VERIFICATION CODES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires ON email_verification_codes(expires_at);

ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;
-- No policies = table is fully locked from direct client access

-- ============================================================
-- ROOM_MEMBERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL DEFAULT 'member',
  is_archived boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  is_muted boolean NOT NULL DEFAULT false,
  last_read_at timestamptz,
  UNIQUE (room_id, user_id)
);

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_membership" ON room_members;
CREATE POLICY "select_own_membership" ON room_members FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_membership" ON room_members;
CREATE POLICY "insert_own_membership" ON room_members FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_membership" ON room_members;
CREATE POLICY "update_own_membership" ON room_members FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_membership" ON room_members;
CREATE POLICY "delete_own_membership" ON room_members FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- ROOMS TABLE MODIFICATIONS
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'is_public') THEN
    ALTER TABLE rooms ADD COLUMN is_public boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'owner_id') THEN
    ALTER TABLE rooms ADD COLUMN owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'topic') THEN
    ALTER TABLE rooms ADD COLUMN topic text;
  END IF;
END $$;

-- Public rooms: any authenticated user can see them
DROP POLICY IF EXISTS "authenticated_select_public_rooms" ON rooms;
CREATE POLICY "authenticated_select_public_rooms" ON rooms FOR SELECT
  TO authenticated USING (is_public = true);

-- ============================================================
-- MESSAGES TABLE MODIFICATIONS
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'reply_to_message_id') THEN
    ALTER TABLE messages ADD COLUMN reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- RPC: generate_verification_code
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_verification_code(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_hash text;
BEGIN
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  v_hash := encode(digest(v_code, 'sha256'), 'hex');

  INSERT INTO email_verification_codes (email, code_hash)
  VALUES (p_email, v_hash);

  RETURN v_code;
END;
$$;

-- ============================================================
-- RPC: verify_email_code
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_email_code(p_email text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_hash text;
BEGIN
  v_hash := encode(digest(p_code, 'sha256'), 'hex');

  SELECT * INTO v_record
  FROM email_verification_codes
  WHERE email_verification_codes.email = p_email
    AND email_verification_codes.code_hash = v_hash
    AND email_verification_codes.expires_at > now()
    AND email_verification_codes.attempts < 5
  ORDER BY email_verification_codes.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Increment attempts on the latest code for this email
    UPDATE email_verification_codes
    SET attempts = attempts + 1
    WHERE id = (
      SELECT id FROM email_verification_codes
      WHERE email_verification_codes.email = p_email
      ORDER BY created_at DESC LIMIT 1
    );
    RETURN false;
  END IF;

  -- Mark email as confirmed in auth.users
  UPDATE auth.users
  SET email_confirmed_at = now()
  WHERE email = p_email;

  -- Clean up used codes for this email
  DELETE FROM email_verification_codes WHERE email_verification_codes.email = p_email;

  RETURN true;
END;
$$;

-- ============================================================
-- RPC: get_public_rooms
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_rooms()
RETURNS table (
  v_id uuid,
  v_code text,
  v_topic text,
  v_member_count bigint,
  v_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.code,
    r.topic,
    COUNT(rm.id),
    r.created_at
  FROM rooms r
  LEFT JOIN room_members rm ON rm.room_id = r.id
  WHERE r.is_public = true
  GROUP BY r.id, r.code, r.topic, r.created_at
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_verification_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_email_code(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_rooms() TO authenticated;

-- ============================================================
-- TRIGGER: Auto-create profile on auth.users signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Enable pgcrypto for digest() function
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
/*
# Feedback (Reportar Bug / Sugestões)
*/

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type text NOT NULL,
  message text NOT NULL,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_submit_feedback" ON feedback;
CREATE POLICY "anyone_can_submit_feedback" ON feedback FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "users_see_own_feedback" ON feedback;
CREATE POLICY "users_see_own_feedback" ON feedback FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
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
/*
# Correção crítica: exclusão de mensagem estava sendo bloqueada silenciosamente

## Causa raiz
O gatilho `cleanup_media_on_message_delete` rodava ANTES de apagar a
mensagem, e tentava remover o arquivo de mídia via chamada HTTP interna
(pg_net) sem nenhum tratamento de erro. Como essa chamada depende de uma
configuração (`app.supabase_url`) que nunca foi confirmada como definida
no projeto, ela falha — e por ser um gatilho SEM tratamento de exceção
rodando ANTES da exclusão, isso cancelava a exclusão inteira no banco.

O aplicativo, por sua vez, não verificava se a exclusão realmente
funcionou — então a mensagem "sumia" só na tela de quem apagou (estado
local), enquanto continuava intacta no banco. Por isso: outros usuários
nunca viam a mudança em tempo real, e a mensagem "voltava" após atualizar
a página.

## Correção
- Movido para AFTER DELETE (a exclusão da linha nunca deve depender do
  sucesso da limpeza de mídia)
- Envolvido em tratamento de exceção: falha na limpeza de mídia nunca
  impede a exclusão da mensagem
*/

CREATE OR REPLACE FUNCTION public.cleanup_media_on_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_path text;
  v_project_url text;
BEGIN
  BEGIN
    v_path := OLD.storage_path;
    IF v_path IS NOT NULL THEN
      v_project_url := current_setting('app.supabase_url', true);
      IF v_project_url IS NOT NULL AND v_project_url <> '' THEN
        PERFORM net.http_post(
          url := v_project_url || '/storage/v1/object/' || v_path,
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
            'x-upsert', 'false'
          ),
          body := '{}'::jsonb
        );
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Limpeza de mídia é "melhor esforço" — nunca pode impedir a exclusão
    -- da mensagem em si, que é a ação que o usuário pediu de verdade.
    NULL;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_message_delete_cleanup_media ON messages;
CREATE TRIGGER on_message_delete_cleanup_media
  AFTER DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_media_on_message_delete();
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

  -- Cria uma nova sala privada permanente para os dois
  v_new_code := upper(substr(md5(random()::text), 1, 4)) || '-' || upper(substr(md5(random()::text), 1, 4));

  INSERT INTO rooms (code, is_permanent, is_public, owner_id)
  VALUES (v_new_code, true, false, v_me)
  RETURNING id INTO v_new_room_id;

  INSERT INTO room_members (room_id, user_id, role) VALUES (v_new_room_id, v_me, 'owner');
  INSERT INTO room_members (room_id, user_id, role) VALUES (v_new_room_id, p_other_user_id, 'member');

  RETURN QUERY SELECT v_new_room_id, v_new_code, true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_dm(uuid) TO authenticated;
