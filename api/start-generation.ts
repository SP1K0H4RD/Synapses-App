import { createClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

const getBearerToken = (request: Request): string | null => {
  const raw = request.headers.get("authorization") || "";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

const parseObjectivesCount = (objetivosRaw: string): number => {
  const bloomVerbs =
    /^(Entender|Analisar|Compreender|Descrever|Explicar|Discutir|Identificar|Aplicar|Avaliar|Sintetizar|Conhecer|Definir|Citar|Reconhecer|Diferenciar|Relacionar|Indicar|Listar|Nomear|Escrever|Relatar|Revisar|Localizar|Esquematizar|Utilizar|Organizar|Generalizar|Classificar|Comparar|Contrastear|Criticar|Justificar|Planejar|Propor|Formular|Criar|Construir)\s+/i;

  const list = String(objetivosRaw || "")
    .split("\n")
    .map((o) => {
      let cleaned = o.replace(/^\d+[\.\-\)]\s*|^\-\s*/, "").trim();
      cleaned = cleaned.replace(/\s*\([^)]*\)/g, "").trim();
      cleaned = cleaned.replace(bloomVerbs, "");
      return cleaned.trim();
    })
    .filter((o) => o.length > 2);

  return list.length;
};

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return json({ error: "Supabase não configurado." }, 500);

  const accessToken = getBearerToken(request);
  if (!accessToken) return json({ error: "Faça login para continuar." }, 401);

  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  try {
    const body = await request.json().catch(() => ({}));
    const objetivos = String((body as any)?.objetivos || "");
    const objectivesCount = parseObjectivesCount(objetivos);
    if (objectivesCount <= 0) return json({ error: "Nenhum objetivo identificado." }, 400);

    const { data: userData, error: userError } = await sb.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return json({ error: "Sessão inválida. Faça login novamente." }, 401);

    const { data: sessionId, error: rpcError } = await sb.rpc("start_generation_session", {
      p_objectives_count: objectivesCount,
      cost: 10,
    });

    if (rpcError) return json({ error: "Falha ao iniciar sessão de geração." }, 500);
    if (!sessionId) return json({ error: "Tokens insuficientes. Você precisa de pelo menos 10 tokens." }, 402);

    return json({ sessionId }, 200);
  } catch (error: any) {
    return json({ error: String(error?.message || "Internal Server Error") }, 500);
  }
}

