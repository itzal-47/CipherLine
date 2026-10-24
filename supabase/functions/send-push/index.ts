import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    // ============================================================
    // AUTENTICAÇÃO
    //
    // Esta função é chamada pelo trigger SQL (não por utilizadores), e o
    // trigger envia o service_role_key no header Authorization. Só quem
    // tem esse valor pode disparar pushes — evita spam de notificações.
    // ============================================================
    const authHeader = req.headers.get("Authorization");
    const expectedToken = `Bearer ${serviceRoleKey}`;
    if (!authHeader || authHeader !== expectedToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Configura o web-push com o par VAPID. O "subject" é um mailto:
    // ou URL de contacto — exigido pelo protocolo para que os serviços de
    // push possam contactar o remetente em caso de abuso.
    webpush.setVapidDetails(
      "mailto:Edivaldotc16@gmail.com",
      vapidPublicKey,
      vapidPrivateKey,
    );

    const { record } = await req.json();
    const roomId = record?.room_id;
    const senderId = record?.sender_id;

    if (!roomId || !senderId) {
      return new Response(
        JSON.stringify({ error: "Missing room_id or sender_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Todos os participantes da sala, excepto o remetente
    const { data: participants, error: pErr } = await supabase
      .from("participants")
      .select("id")
      .eq("room_id", roomId)
      .neq("id", senderId);

    if (pErr || !participants || participants.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "no_participants" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const participantIds = participants.map((p) => p.id);

    // Subscrições desses participantes — incluindo o id para podermos
    // remover as expiradas depois.
    const { data: subscriptions, error: sErr } = await supabase
      .from("push_subscriptions")
      .select("id, subscription")
      .in("participant_id", participantIds);

    if (sErr || !subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "no_subscriptions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Nome da sala para a notificação
    const { data: room } = await supabase
      .from("rooms")
      .select("code, name")
      .eq("id", roomId)
      .single();

    const roomLabel = room?.name || room?.code || "CANAL";

    const payload = JSON.stringify({
      title: "CIPHERLINE",
      body: `Nova mensagem em ${roomLabel}`,
      roomCode: room?.code || null,
      tag: `cipherline-${roomId}`,
    });

    let sentCount = 0;
    const toDelete: string[] = [];

    // Envia em paralelo (mais rápido que sequencial; se a lista for muito
    // grande, isto pode ser limitado com Promise.allSettled em lotes).
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          return { id: sub.id, ok: true };
        } catch (err: any) {
          const statusCode = err?.statusCode ?? 0;
          // 404/410 = subscrição morta. 403 = VAPID mal configurado mas
          // não vamos apagar por isso. 429 = rate-limited, tentar de novo depois.
          if (statusCode === 404 || statusCode === 410) {
            return { id: sub.id, ok: false, dead: true };
          }
          return { id: sub.id, ok: false, dead: false };
        }
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) sentCount++;
        if (r.value.dead) toDelete.push(r.value.id);
      }
    }

    // Limpa subscrições mortas em bloco
    if (toDelete.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", toDelete);
    }

    return new Response(
      JSON.stringify({ sent: sentCount, cleaned: toDelete.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});