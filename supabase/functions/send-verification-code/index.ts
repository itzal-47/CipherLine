import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
    // ============================================================
    // AUTENTICAÇÃO — só utilizadores autenticados podem pedir código.
    // ============================================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identifica QUEM está a chamar, a partir do JWT — nunca confiamos
    // no email do corpo como prova de identidade.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Só pode pedir código para o PRÓPRIO email — impede uso da tua
    // infraestrutura como canal de spam para terceiros.
    const normalizedEmail = email.trim().toLowerCase();
    const callerEmail = (user.email || "").trim().toLowerCase();
    if (normalizedEmail !== callerEmail) {
      return new Response(
        JSON.stringify({ error: "Só é possível enviar código para o próprio email" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Rate limit simples: no máximo 3 códigos por email em 10 minutos.
    // Evita spam mesmo por parte do próprio utilizador (cliques repetidos,
    // bots, etc.).
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("email_verification_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", normalizedEmail)
      .gte("created_at", tenMinAgo);

    if (!countErr && (count ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Aguarde alguns minutos." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Gera o código via RPC (service_role, autorizado)
    const { data: code, error: rpcError } = await supabase
      .rpc("generate_verification_code", { p_email: normalizedEmail });

    if (rpcError || !code) {
      return new Response(
        JSON.stringify({ error: "Failed to generate code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CipherLine <onboarding@resend.dev>",
        to: [normalizedEmail],
        subject: "Código de Verificação — CipherLine",
        html: `
          <div style="font-family: monospace; background: #0a0e0a; color: #00ff41; padding: 40px; text-align: center;">
            <h1 style="color: #00ff41; letter-spacing: 4px; font-size: 24px;">CIPHERLINE</h1>
            <p style="color: #888; font-size: 12px; letter-spacing: 2px;">CÓDIGO DE VERIFICAÇÃO</p>
            <div style="display: inline-block; border: 1px solid #00ff41; padding: 20px 40px; margin: 20px 0; font-size: 32px; letter-spacing: 12px; color: #00ff41; font-weight: bold;">
              ${code}
            </div>
            <p style="color: #666; font-size: 11px;">Este código expira em 10 minutos.</p>
          </div>
        `,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      return new Response(
        JSON.stringify({ error: `Failed to send email: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});