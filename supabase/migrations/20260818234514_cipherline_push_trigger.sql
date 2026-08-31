/*
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
  EXECUTE FUNCTION public.notify_push_on_message();