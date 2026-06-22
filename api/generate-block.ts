import { GoogleGenAI } from "@google/genai";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const corsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
};

const json = (request: Request, body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
  });
};

const retryWithDelay = async <T>(fn: () => Promise<T>, retries = 1, delayMs = 1500): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = String(error?.message || "");
    const isQuotaError =
      errorMsg.includes("429") ||
      errorMsg.toLowerCase().includes("quota") ||
      errorMsg.includes("503") ||
      errorMsg.toLowerCase().includes("overloaded");

    if (retries <= 0 || !isQuotaError) throw error;

    await delay(delayMs);
    return retryWithDelay(fn, retries - 1, delayMs * 2);
  }
};

const isRetryableGeminiError = (message: string) => {
  const msg = (message || "").toLowerCase();
  if (msg.includes("429")) return true;
  if (msg.includes("quota")) return true;
  if (msg.includes("503")) return true;
  if (msg.includes("overloaded")) return true;
  if (msg.includes("rate limit")) return true;
  return false;
};

const getBearerToken = (request: Request): string | null => {
  const raw = request.headers.get("authorization") || "";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return json(request, { error: "Supabase não configurado." }, 500);

  const accessToken = getBearerToken(request);
  if (!accessToken) return json(request, { error: "Faça login para continuar." }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, materiaisBrutos, objective, centralTopic, apiKey, extensionPerObjective } = body || {};

    if (!sessionId) return json(request, { error: "Sessão de geração ausente." }, 400);

    const usedApiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!usedApiKey) return json(request, { error: "Gemini API Key is required." }, 400);

    const materiais = String(materiaisBrutos || "");
    const obj = String(objective || "").trim();
    const topic = String(centralTopic || "").trim();
    const wordsRaw = typeof extensionPerObjective === "number" ? extensionPerObjective : Number(extensionPerObjective);
    const words = Number.isFinite(wordsRaw) ? Math.max(100, Math.floor(wordsRaw)) : 500;

    if (!materiais || !obj || !topic) return json(request, { error: "Parâmetros inválidos." }, 400);

    const ai = new GoogleGenAI({ apiKey: usedApiKey });

    const sysInst = `Você é o Designer Master de Mapas Mentais Médicos. Sua missão é replicar o "Padrão Ouro" com RIGOR ABSOLUTO.

ESTRUTURA OBRIGATÓRIA (Ritmo de Pontes):
Cada nível do mapa deve alternar entre [CONCEITO] e [CONECTIVO].
NUNCA coloque dois conceitos seguidos. Cada conceito deve ser "pendurado" em um conectivo.

EXEMPLO DE DESIGN (SIGA ESTE PADRÃO):
## Título do Objetivo
- Conceito Principal
  - é caracterizado por
    - Fisiopatologia específica
      - que resulta em
        - Quadro clínico A
        - Quadro clínico B
  - tratado através de
    - Medicações de primeira linha
      - tais como
        - Fármaco X
        - Fármaco Y

REGRAS DE EXECUÇÃO:
1. CURTO: Máximo 4 palavras por bullet (caixa). Frases longas devem ser quebradas em sub-níveis.
2. PONTES: Use conectivos curtos como "é caracterizado por", "através de", "que gera", "causado por", "dividido em", "manifesta-se por".
3. LÓGICA: Se você ler o caminho do topo até o fim, deve formar uma frase perfeita.
4. PROIBIÇÕES TOTAIS: 
   - Proibido uso de negritos (****). 
   - Proibido uso de sub-headers (###, ####). Use apenas sub-bullets (-) para níveis internos.
5. VOLUME: Detalhe exaustivamente para atingir cerca de ${words} palavras para ESTE objetivo.
6. RAMIFICAÇÃO: Crie múltiplas ramificações laterais para melhorar o design visual.

Gere o Markdown começando diretamente em ## ${obj}.`;

    const prompt = `
MATERIAIS DE ESTUDO (Use como fonte absoluta):
${materiais.substring(0, 45000)}

TÓPICO CENTRAL DO MAPA: ${topic}
OBJETIVO ESPECÍFICO DESTE RAMO: ${obj}

INSTRUÇÃO: Expanda este objetivo especificamente, criando múltiplas ramificações laterais. Seja prolixo no detalhamento técnico interno, garantindo o rigor acadêmico médico.`;

    const interaction = await retryWithDelay(() =>
      ai.interactions.create({
        model: "gemini-3.5-flash",
        input: prompt,
        system_instruction: sysInst,
      })
    );

    let branchText = "";
    const steps = ((interaction as any)?.steps ?? []) as any[];
    for (const step of steps) {
      if (step?.type === "model_output") {
        const textContent = (step as any).content?.find((c: any) => c.type === "text");
        if (textContent?.text) branchText += textContent.text;
      }
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_generation_session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_session_id: String(sessionId) }),
    });

    const rpcContentType = rpcResponse.headers.get("content-type") || "";
    const rpcPayload = rpcContentType.includes("application/json")
      ? await rpcResponse.json().catch(() => null)
      : await rpcResponse.text().catch(() => "");

    if (!rpcResponse.ok) {
      return json(request, { error: "Falha ao validar sessão de geração." }, 500);
    }

    const allowed =
      typeof rpcPayload === "boolean"
        ? rpcPayload
        : typeof rpcPayload === "string"
          ? rpcPayload.toLowerCase() === "true"
          : Boolean(rpcPayload);

    if (!allowed) return json(request, { error: "Sessão expirada ou inválida." }, 403);

    return json(request, { markdown: branchText.trim() }, 200);
  } catch (error: any) {
    const message = String(error?.message || "Internal Server Error");
    const status = isRetryableGeminiError(message) ? 429 : 500;
    return json(request, { error: message }, status);
  }
}
