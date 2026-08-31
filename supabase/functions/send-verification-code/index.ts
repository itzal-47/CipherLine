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
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Generate a 6-digit code via the RPC function
    const { data: code, error: rpcError } = await supabase
      .rpc("generate_verification_code", { p_email: email });

    if (rpcError || !code) {
      return new Response(
        JSON.stringify({ error: "Failed to generate code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Send the code via Resend (HTTP API — works on Supabase Edge Functions,
    // unlike raw SMTP which is blocked on ports 25/465/587)
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
        to: [email],
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

