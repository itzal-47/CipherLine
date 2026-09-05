/*
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
GRANT EXECUTE ON FUNCTION public.create_room(text, boolean, jsonb) TO anon, authenticated;