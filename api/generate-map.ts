import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const retryWithDelay = async <T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> => {
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

const getBearerToken = (request: Request): string | null => {
  const raw = request.headers.get("authorization") || "";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

const parseObjectives = (objetivosRaw: string): string[] => {
  const bloomVerbs =
    /^(Entender|Analisar|Compreender|Descrever|Explicar|Discutir|Identificar|Aplicar|Avaliar|Sintetizar|Conhecer|Definir|Citar|Reconhecer|Diferenciar|Relacionar|Indicar|Listar|Nomear|Escrever|Relatar|Revisar|Localizar|Esquematizar|Utilizar|Organizar|Generalizar|Classificar|Comparar|Contrastear|Criticar|Justificar|Planejar|Propor|Formular|Criar|Construir)\s+/i;

  return String(objetivosRaw || "")
    .split("\n")
    .map((o) => {
      let cleaned = o.replace(/^\d+[\.\-\)]\s*|^\-\s*/, "").trim();
      cleaned = cleaned.replace(/\s*\([^)]*\)/g, "").trim();
      cleaned = cleaned.replace(bloomVerbs, "");
      return cleaned.trim();
    })
    .filter((o) => o.length > 2);
};

export const config = { runtime: "edge" };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: "Supabase não configurado." }, { status: 500 });
    }

    try {
      const accessToken = getBearerToken(request);
      if (!accessToken) {
        return Response.json({ error: "Faça login para continuar." }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const { materiaisBrutos, objetivos, centralTopic, apiKey, extensao } = body || {};

      const usedApiKey = apiKey || process.env.GEMINI_API_KEY;
      if (!usedApiKey) {
        return Response.json({ error: "Gemini API Key is required." }, { status: 400 });
      }

      const central = String(centralTopic || "").trim();
      if (!central) {
        return Response.json({ error: "Tópico central é obrigatório." }, { status: 400 });
      }

      const objectivesList = parseObjectives(String(objetivos || ""));
      if (objectivesList.length === 0) {
        return Response.json({ error: "Nenhum objetivo identificado." }, { status: 400 });
      }

      const totalExtensionRaw = typeof extensao === "number" ? extensao : Number(extensao);
      const totalExtension = Number.isFinite(totalExtensionRaw) ? Math.max(100, Math.floor(totalExtensionRaw)) : 500;
      const extensionPerObjective = Math.floor(totalExtension / objectivesList.length);

      const sb = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });

      const { data: userData, error: userError } = await sb.auth.getUser();
      const user = userData?.user;
      if (userError || !user) {
        return Response.json({ error: "Sessão inválida. Faça login novamente." }, { status: 401 });
      }

      const { data: allowed, error: rpcError } = await sb.rpc("use_tokens", { p_user_id: user.id, cost: 10 });
      if (rpcError) {
        return Response.json({ error: "Falha ao validar tokens." }, { status: 500 });
      }
      if (allowed !== true) {
        return Response.json({ error: "Tokens insuficientes. Você precisa de pelo menos 10 tokens." }, { status: 402 });
      }

      const ai = new GoogleGenAI({ apiKey: usedApiKey });
      const materiais = String(materiaisBrutos || "");

      let finalMarkdown = `# ${central}\n\n`;

      for (const objective of objectivesList) {
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
5. VOLUME: Detalhe exaustivamente para atingir cerca de ${extensionPerObjective} palavras para ESTE objetivo.
6. RAMIFICAÇÃO: Crie múltiplas ramificações laterais para melhorar o design visual.

Gere o Markdown começando diretamente em ## ${objective}.`;

        const prompt = `
MATERIAIS DE ESTUDO (Use como fonte absoluta):
${materiais.substring(0, 45000)}

TÓPICO CENTRAL DO MAPA: ${central}
OBJETIVO ESPECÍFICO DESTE RAMO: ${objective}

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

        finalMarkdown += branchText.trim() + "\n\n";
        await delay(1000);
      }

      return Response.json({ markdown: finalMarkdown.trim() }, { status: 200 });
    } catch (error: any) {
      return Response.json({ error: String(error?.message || "Internal Server Error") }, { status: 500 });
    }
  },
};

