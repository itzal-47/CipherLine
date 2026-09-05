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
