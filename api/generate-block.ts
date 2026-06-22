import { GoogleGenAI } from "@google/genai";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type NodeRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, listener: (chunk: Buffer | string) => void) => void;
};

type NodeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

// #region debug-point A:report-helper
const reportDebug = (hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}) => {
  const debugServerUrl = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
  const sessionId = process.env.DEBUG_SESSION_ID || "generate-block-timeout";
  fetch(debugServerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

const getHeaderValue = (request: NodeRequest, name: string): string => {
  const value = request.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
};

const corsHeaders = (request: NodeRequest): Record<string, string> => {
  const origin = getHeaderValue(request, "origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
};

const sendJson = (request: NodeRequest, response: NodeResponse, body: unknown, status = 200): void => {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  const headers = { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" };
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
  response.end(payload);
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

const getBearerToken = (request: NodeRequest): string | null => {
  const raw = getHeaderValue(request, "authorization");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

const readJsonBody = async (request: NodeRequest): Promise<Record<string, unknown>> => {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body as Record<string, unknown>;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body || "{}");
  }

  if (Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8") || "{}");
  }

  if (typeof request.on !== "function") {
    return {};
  }

  const rawBody = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on?.("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on?.("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on?.("error", reject);
  });

  return rawBody ? JSON.parse(rawBody) : {};
};

const handleRequest = async (request: NodeRequest, response: NodeResponse): Promise<void> => {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      response.setHeader(key, value);
    }
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(request, response, { error: "Method not allowed" }, 405);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    sendJson(request, response, { error: "Supabase não configurado." }, 500);
    return;
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    sendJson(request, response, { error: "Faça login para continuar." }, 401);
    return;
  }

  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const { sessionId, materiaisBrutos, objective, centralTopic, apiKey, extensionPerObjective } = body || {};

    // #region debug-point A:request-start
    reportDebug("A", "api/generate-block.ts:95", "handler entered", {
      hasSessionId: Boolean(sessionId),
      hasApiKey: Boolean(apiKey || process.env.GEMINI_API_KEY),
      materiaisLength: String(materiaisBrutos || "").length,
      objectiveLength: String(objective || "").length,
      centralTopicLength: String(centralTopic || "").length,
    });
    // #endregion

    if (!sessionId) {
      sendJson(request, response, { error: "Sessão de geração ausente." }, 400);
      return;
    }

    const usedApiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!usedApiKey) {
      sendJson(request, response, { error: "Gemini API Key is required." }, 400);
      return;
    }

    const materiais = String(materiaisBrutos || "");
    const obj = String(objective || "").trim();
    const topic = String(centralTopic || "").trim();
    const wordsRaw = typeof extensionPerObjective === "number" ? extensionPerObjective : Number(extensionPerObjective);
    const words = Number.isFinite(wordsRaw) ? Math.max(100, Math.floor(wordsRaw)) : 500;

    if (!materiais || !obj || !topic) {
      sendJson(request, response, { error: "Parâmetros inválidos." }, 400);
      return;
    }

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

    // #region debug-point B:gemini-start
    const geminiStartedAt = Date.now();
    reportDebug("B", "api/generate-block.ts:154", "starting Gemini interaction", {
      model: "gemini-3.5-flash",
      promptLength: prompt.length,
      systemInstructionLength: sysInst.length,
    });
    // #endregion
    const interaction = await retryWithDelay(() =>
      ai.interactions.create({
        model: "gemini-3.5-flash",
        input: prompt,
        system_instruction: sysInst,
      })
    );
    // #region debug-point B:gemini-end
    reportDebug("B", "api/generate-block.ts:164", "Gemini interaction finished", {
      durationMs: Date.now() - geminiStartedAt,
      stepCount: Array.isArray((interaction as any)?.steps) ? (interaction as any).steps.length : 0,
    });
    // #endregion

    let branchText = "";
    const steps = ((interaction as any)?.steps ?? []) as any[];
    for (const step of steps) {
      if (step?.type === "model_output") {
        const textContent = (step as any).content?.find((c: any) => c.type === "text");
        if (textContent?.text) branchText += textContent.text;
      }
    }

    // #region debug-point C:supabase-start
    const supabaseStartedAt = Date.now();
    reportDebug("C", "api/generate-block.ts:178", "starting Supabase consume RPC", {
      hasAccessToken: Boolean(accessToken),
      hasSupabaseUrl: Boolean(supabaseUrl),
    });
    // #endregion
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_generation_session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_session_id: String(sessionId) }),
    });
    // #region debug-point C:supabase-end
    reportDebug("C", "api/generate-block.ts:193", "Supabase consume RPC finished", {
      durationMs: Date.now() - supabaseStartedAt,
      status: rpcResponse.status,
      ok: rpcResponse.ok,
    });
    // #endregion

    const rpcContentType = rpcResponse.headers.get("content-type") || "";
    const rpcPayload = rpcContentType.includes("application/json")
      ? await rpcResponse.json().catch(() => null)
      : await rpcResponse.text().catch(() => "");

    if (!rpcResponse.ok) {
      sendJson(request, response, { error: "Falha ao validar sessão de geração." }, 500);
      return;
    }

    const allowed =
      typeof rpcPayload === "boolean"
        ? rpcPayload
        : typeof rpcPayload === "string"
          ? rpcPayload.toLowerCase() === "true"
          : Boolean(rpcPayload);

    if (!allowed) {
      sendJson(request, response, { error: "Sessão expirada ou inválida." }, 403);
      return;
    }

    // #region debug-point D:response-ready
    reportDebug("D", "api/generate-block.ts:212", "returning success response", {
      markdownLength: branchText.trim().length,
    });
    // #endregion
    sendJson(request, response, { markdown: branchText.trim() }, 200);
  } catch (error: any) {
    const message = String(error?.message || "Internal Server Error");
    // #region debug-point E:catch
    reportDebug("E", "api/generate-block.ts:217", "handler failed", {
      message,
      name: String(error?.name || ""),
    });
    // #endregion
    const status = isRetryableGeminiError(message) ? 429 : 500;
    sendJson(request, response, { error: message }, status);
  }
};

export default async function handler(request: NodeRequest, response: NodeResponse): Promise<void> {
  await handleRequest(request, response);
}
