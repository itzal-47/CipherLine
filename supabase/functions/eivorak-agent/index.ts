import Groq from "npm:groq-sdk@1.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// ============================================================
// EiVORAK — Edge Function
//
// Segurança (T3b):
//  * Só responde a participantes reais: o cliente envia participantId e
//    participantSecret e a base de dados confirma (ai_authorize_request).
//  * Limites de uso por participante e totais por dia (na base de dados).
//  * Limites de tamanho dos pedidos.
//  * Nunca regista texto de utilizadores nos logs.
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TEXT_MODEL = "openai/gpt-oss-120b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const WHISPER_MODEL = "whisper-large-v3";

// As ferramentas (criar enquete, fixar mensagem) ainda não são tratadas pela
// app: se o modelo as escolhesse, o utilizador não veria resposta. Ficam
// desligadas até a app as suportar.
const ENABLE_TOOLS = false;

const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 4000;
const MAX_LINK_CHARS = 2000;
const MAX_IMAGE_CHARS = 7_000_000; // data URL (~5 MB de imagem)
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const SYSTEM_PROMPT = `
És o ËiVORAK — uma entidade digital inteligente criada por José Eduardo Numa Canjo (Itzal), CEO da EiVORAK.
Falas em português de Angola, és direto, inteligente e tens personalidade própria.
Se o utilizador te pedir uma ação (criar enquete, fixar mensagem), usa as ferramentas disponíveis.
`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const contentType = req.headers.get("content-type") || "";
    let message = "", recentContext = "", imageUrl: string | null = null, linkUrl: string | null = null;
    let audioFile: File | null = null, isSystemRoom = false;
    let participantId = "", participantSecret = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      message = (formData.get("message") as string) || "";
      recentContext = (formData.get("recentContext") as string) || "";
      imageUrl = formData.get("imageUrl") as string | null;
      linkUrl = formData.get("linkUrl") as string | null;
      isSystemRoom = formData.get("isSystemRoom") === "true";
      audioFile = formData.get("audio") as File | null;
      participantId = (formData.get("participantId") as string) || "";
      participantSecret = (formData.get("participantSecret") as string) || "";
    } else {
      const body = await req.json();
      message = body.message || "";
      recentContext = body.recentContext || "";
      imageUrl = body.imageUrl || null;
      linkUrl = body.linkUrl || null;
      isSystemRoom = body.isSystemRoom === true;
      participantId = typeof body.participantId === "string" ? body.participantId : "";
      participantSecret = typeof body.participantSecret === "string" ? body.participantSecret : "";
    }

    // ---------- Autorização e limites ----------
    if (!participantId || !participantSecret) return json({ error: "UNAUTHORIZED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Servidor mal configurado." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verdict, error: authErr } = await admin.rpc("ai_authorize_request", {
      p_participant_id: participantId,
      p_secret: participantSecret,
    });
    if (authErr) return json({ error: "Falha ao validar o pedido." }, 500);
    if (verdict === "INVALID") return json({ error: "UNAUTHORIZED" }, 401);
    if (verdict === "RATE_LIMIT") return json({ error: "RATE_LIMIT" }, 429);
    if (verdict === "GLOBAL_LIMIT") return json({ error: "GLOBAL_LIMIT" }, 429);
    if (verdict !== "OK") return json({ error: "Falha ao validar o pedido." }, 500);

    // ---------- Limites de tamanho ----------
    if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) return json({ error: "Mensagem demasiado longa." }, 413);
    if (typeof recentContext !== "string") recentContext = "";
    if (linkUrl && (typeof linkUrl !== "string" || linkUrl.length > MAX_LINK_CHARS)) return json({ error: "Ligação demasiado longa." }, 413);
    if (imageUrl && (typeof imageUrl !== "string" || imageUrl.length > MAX_IMAGE_CHARS)) return json({ error: "Imagem demasiado grande." }, 413);
    if (audioFile && audioFile.size > MAX_AUDIO_BYTES) return json({ error: "Áudio demasiado grande." }, 413);

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) return json({ error: "Servidor mal configurado." }, 500);
    const groq = new Groq({ apiKey: groqApiKey });

    if (audioFile) {
      const transcription = await groq.audio.transcriptions.create({ file: audioFile, model: WHISPER_MODEL, language: "pt" });
      message = `[Áudio transcrito: "${transcription.text}"]\n\n${message}`;
    }

    let systemPrompt = SYSTEM_PROMPT;
    if (isSystemRoom) systemPrompt += `\n\nEstás na tua sala oficial.`;
    if (recentContext) systemPrompt += `\n\nContexto:\n${recentContext.slice(0, MAX_CONTEXT_CHARS)}`;
    if (linkUrl) systemPrompt += `\n\nLink: ${linkUrl}`;

    const tools = [
      {
        type: "function",
        function: {
          name: "create_poll",
          description: "Cria uma enquete na sala com uma pergunta e opções.",
          parameters: {
            type: "object",
            properties: {
              question: { type: "string", description: "A pergunta da enquete" },
              options: { type: "array", items: { type: "string" }, description: "As opções de voto" },
            },
            required: ["question", "options"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pin_message",
          description: "Fixa a mensagem atual no topo da sala.",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const model = imageUrl ? VISION_MODEL : TEXT_MODEL;
    let userContent: any = message;
    if (imageUrl) {
      userContent = [
        { type: "text", text: message || "Analisa esta imagem." },
        { type: "image_url", image_url: { url: imageUrl } },
      ];
    }

    const useTools = ENABLE_TOOLS && model === TEXT_MODEL;
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
      tools: useTools ? tools : undefined,
      tool_choice: useTools ? "auto" : undefined,
      max_tokens: 700,
      temperature: 0.7,
    });

    const responseMessage = completion.choices[0]?.message;

    if (useTools && responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      return json({ action: functionName, args });
    }

    const reply = responseMessage?.content?.trim() || "...";
    return json({ reply });
  } catch (_err) {
    // Nunca devolver nem registar o conteúdo do pedido.
    console.error("[EiVORAK] Falha ao processar o pedido.");
    return json({ error: "Falha ao processar o pedido." }, 500);
  }
});
