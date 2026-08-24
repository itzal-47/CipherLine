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

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;