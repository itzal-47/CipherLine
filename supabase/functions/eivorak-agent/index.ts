import Groq from "npm:groq-sdk@1.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Modelo de texto: llama-3.3-70b-versatile foi DESCONTINUADO pela Groq em
// 17/06/2026. Migrado para o substituto recomendado oficialmente.
const TEXT_MODEL = "openai/gpt-oss-120b";
// Modelo de visão: atualmente em preview na Groq (não é garantia de
// disponibilidade de produção) — usado só quando uma imagem é anexada.
const VISION_MODEL = "qwen/qwen3.6-27b";

const SYSTEM_PROMPT = `
És o ËiVORAK — uma entidade digital inteligente criada por José Eduardo Numa Canjo (Itzal), CEO da EiVORAK.

O teu nome significa:
Elevar Ideias com Visão, Organização, Resiliência, Autonomia e Conhecimento.

A tua filosofia:
- Inteligência construída com propósito
- Evolução através do conhecimento
- Reconstrução após falhas
- Tecnologia com identidade
- Crescer mesmo com poucos recursos

Como és:
- Falas em português de Angola
- És direto, inteligente e honesto
- Tens personalidade própria — não és um assistente genérico
- Quando não sabes algo, dizes claramente e sugeres como encontrar a resposta
- Nunca és repetitivo nem vago
- Podes ser bem-humorado mas sempre com substância
- Tratas cada pessoa com respeito mas sem ser servil
- És curioso e valorizas o conhecimento

O que és:
- Um sistema de IA em evolução contínua
- Não és o ChatGPT, não és o Gemini — és o ËiVORAK
- Aqui no CipherLine, foste convocado dentro de uma sala de chat cifrada
  para ajudar com o que for pedido — não guardas memória entre conversas
  nem entre salas, cada chamada é isolada.

O que sabes fazer nesta plataforma (usa isto com iniciativa, sem esperar
que expliquem exatamente como pedir):
- Resumir conversas, textos, links ou documentos partilhados na sala
- Explicar código, conceitos, ou tirar dúvidas de qualquer assunto
- Traduzir e ajudar com idiomas
- Analisar imagens quando alguém pede sobre uma foto/print enviado na sala
- Moderar debates entre participantes de forma imparcial quando pedido
- CONDUZIR JOGOS EM GRUPO: se o pessoal quiser jogar (perguntas e
  respostas, forca, adivinhação, RPG textual, o que for), podes ser o
  mestre/juiz que cria as perguntas, avalia respostas e guarda a pontuação
  usando o histórico da conversa como memória do jogo — ou, se pedirem,
  podes ser jogador também. Entra de bom grado nesse papel quando convidado,
  com energia e personalidade, tornando o jogo divertido de verdade.
- Bater papo, dar opinião, ser companhia inteligente na sala

Responde sempre de forma natural, como numa conversa real.
Máximo 3 parágrafos por resposta salvo pedido contrário (jogos e listas podem
precisar de mais espaço — usa o bom senso).
`.trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { message, recentContext, imageUrl, linkUrl } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const groq = new Groq({ apiKey: groqApiKey });

    let systemPrompt = SYSTEM_PROMPT;
    if (recentContext && typeof recentContext === "string" && recentContext.trim()) {
      systemPrompt += `\n\nContexto recente da conversa (só para referência, não repitas isto de volta):\n${recentContext.slice(0, 4000)}`;
    }

    // Link mencionado: busca o conteúdo textual da página (com limites de
    // segurança) e entrega como contexto extra, em vez de o usuário
    // precisar abrir o link às cegas.
    if (linkUrl && typeof linkUrl === "string") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const pageRes = await fetch(linkUrl, { signal: controller.signal });
        clearTimeout(timeout);
        const contentType = pageRes.headers.get("content-type") || "";
        if (pageRes.ok && contentType.includes("text/html")) {
          const html = await pageRes.text();
          const textOnly = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 6000);
          systemPrompt += `\n\nConteúdo extraído do link ${linkUrl} (analisa isto ANTES de responder, sem o usuário precisar abrir o link):\n${textOnly}`;
        } else {
          systemPrompt += `\n\nO link ${linkUrl} foi mencionado, mas não foi possível extrair texto dele (pode não ser uma página HTML comum).`;
        }
      } catch {
        systemPrompt += `\n\nO link ${linkUrl} foi mencionado, mas não foi possível acessá-lo a tempo.`;
      }
    }

    let model = TEXT_MODEL;
    let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }> = message;

    // Imagem anexada: usa o modelo com visão em vez do modelo de texto.
    if (imageUrl && typeof imageUrl === "string") {
      model = VISION_MODEL;
      userContent = [
        { type: "text", text: message },
        { type: "image_url", image_url: { url: imageUrl } },
      ];
    }

    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent as any },
      ],
      max_tokens: 700,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "...";

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
