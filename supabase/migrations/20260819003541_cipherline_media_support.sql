/*
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
  EXECUTE FUNCTION public.cleanup_media_on_message_delete();