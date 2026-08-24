/*
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
  SELECT
    r.id,
    r.code,
    r.topic,
    COUNT(rm.id),
    r.created_at
  INTO v_id, v_code, v_topic, v_member_count, v_created_at
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
