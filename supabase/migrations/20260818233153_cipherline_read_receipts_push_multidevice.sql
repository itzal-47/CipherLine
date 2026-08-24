/*
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

ALTER PUBLICATION supabase_realtime ADD TABLE read_receipts;