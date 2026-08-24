import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { record } = await req.json();
    const roomId = record?.room_id;
    const senderId = record?.sender_id;

    if (!roomId || !senderId) {
      return new Response(JSON.stringify({ error: "Missing room_id or sender_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all participants in the room except the sender
    const { data: participants, error: pErr } = await supabase
      .from("participants")
      .select("id")
      .eq("room_id", roomId)
      .neq("id", senderId);

    if (pErr || !participants || participants.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const participantIds = participants.map((p) => p.id);

    // Get push subscriptions for those participants
    const { data: subscriptions, error: sErr } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .in("participant_id", participantIds);

    if (sErr || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get room code for the notification
    const { data: room } = await supabase
      .from("rooms")
      .select("code")
      .eq("id", roomId)
      .single();

    const roomCode = room?.code || "CANAL";

    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") as string;
    if (!vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: "VAPID_PRIVATE_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Send push to each subscription
    // Note: We use Web Push protocol via the subscription endpoint
    // Since we can't use the web-push npm library easily in Deno,
    // we send a simple JSON payload to each subscription endpoint
    const payload = JSON.stringify({
      title: "CIPHERLINE",
      body: `Nova mensagem em ${roomCode}`,
    });

    let sentCount = 0;
    for (const sub of subscriptions) {
      try {
        const subscription = sub.subscription;
        // Use the Web Push API by sending to the subscription endpoint
        // This is a simplified version - full VAPID signing requires
        // the web-push library or manual JWT signing
        const response = await fetch(subscription.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "TTL": "3600",
          },
          body: new TextEncoder().encode(payload),
        }).catch(() => null);

        if (response && response.ok) sentCount++;
      } catch {
        // Continue to next subscription on error
      }
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
