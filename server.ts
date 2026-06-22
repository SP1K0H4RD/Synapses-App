import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const keepAlive = setInterval(() => {}, 1 << 30);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use((req, res, next) => {
    const origin = req.headers.origin || "*";
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });

  app.use(express.json({ limit: "50mb" }));

  // Helper for retries with delay
  const retryWithDelay = async <T>(fn: () => Promise<T>, retries = 5, delay = 15000): Promise<T> => {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || "";
      const isQuotaError = errorMsg.includes('429') || errorMsg.toLowerCase().includes('quota') || errorMsg.includes('503') || errorMsg.toLowerCase().includes('overloaded');
      
      if (retries <= 0 || !isQuotaError) throw error;
      
      console.warn(`[GEMINI SERVER] Falha temporária. Retentando em ${delay/1000}s... (${retries} restantes)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithDelay(fn, retries - 1, delay);
    }
  };

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

  const getBearerToken = (req: express.Request): string | null => {
    const raw = req.header("authorization") || "";
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith("bearer ")) return null;
    const token = trimmed.slice(7).trim();
    return token.length > 0 ? token : null;
  };

  const createSupabaseForRequest = (accessToken: string) => {
    return createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
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

  app.post("/api/generate-map", (_req, res) => {
    res.status(410).json({ error: "Endpoint descontinuado. Use /api/start-generation e /api/generate-block." });
  });

  app.post("/api/start-generation", async (req, res) => {
    const { objetivos } = req.body as Record<string, unknown>;

    if (!isSupabaseConfigured) {
      return res.status(500).json({ error: "Supabase não configurado no servidor." });
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Faça login para continuar." });
    }

    const objectivesList = parseObjectives(typeof objetivos === "string" ? objetivos : "");
    if (objectivesList.length === 0) {
      return res.status(400).json({ error: "Nenhum objetivo identificado." });
    }

    try {
      const sb = createSupabaseForRequest(accessToken);
      const { data: userData, error: userError } = await sb.auth.getUser();
      const user = userData?.user;
      if (userError || !user) {
        return res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
      }

      const { data: sessionId, error: rpcError } = await sb.rpc("start_generation_session", {
        p_objectives_count: objectivesList.length,
        cost: 10,
      });

      if (rpcError) {
        return res.status(500).json({ error: "Falha ao iniciar sessão de geração." });
      }
      if (!sessionId) {
        return res.status(402).json({ error: "Tokens insuficientes. Você precisa de pelo menos 10 tokens." });
      }

      res.json({ sessionId });
    } catch (error: any) {
      console.error("[SERVER ERROR]", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  app.post("/api/generate-block", async (req, res) => {
    const { sessionId, materiaisBrutos, objective, centralTopic, apiKey, extensionPerObjective } = req.body as Record<string, unknown>;

    if (!isSupabaseConfigured) {
      return res.status(500).json({ error: "Supabase não configurado no servidor." });
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Faça login para continuar." });
    }

    const usedApiKey = (typeof apiKey === "string" ? apiKey : "") || process.env.GEMINI_API_KEY;
    if (!usedApiKey) {
      return res.status(400).json({ error: "Gemini API Key is required." });
    }

    const sid = typeof sessionId === "string" ? sessionId.trim() : "";
    const obj = typeof objective === "string" ? objective.trim() : "";
    const topic = typeof centralTopic === "string" ? centralTopic.trim() : "";
    const materiais = typeof materiaisBrutos === "string" ? materiaisBrutos : "";
    const wordsRaw =
      typeof extensionPerObjective === "number" && Number.isFinite(extensionPerObjective)
        ? extensionPerObjective
        : Number(extensionPerObjective);
    const words = Number.isFinite(wordsRaw) ? Math.max(100, Math.floor(wordsRaw)) : 500;

    if (!sid || !obj || !topic || !materiais) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    try {
      const sb = createSupabaseForRequest(accessToken);
      const { data: userData, error: userError } = await sb.auth.getUser();
      const user = userData?.user;
      if (userError || !user) {
        return res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
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

      const interaction = await retryWithDelay(
        () =>
          ai.interactions.create({
            model: "gemini-3.5-flash",
            input: prompt,
            system_instruction: sysInst,
          }),
        2,
        2000
      );

      let branchText = "";
      for (const step of interaction.steps) {
        if (step.type === "model_output") {
          const textContent = (step as any).content?.find((c: any) => c?.type === "text");
          if (textContent?.text) branchText += String(textContent.text);
        }
      }

      const { data: allowed, error: consumeError } = await sb.rpc("consume_generation_session", { p_session_id: sid });
      if (consumeError) {
        return res.status(500).json({ error: "Falha ao validar sessão de geração." });
      }
      if (allowed !== true) {
        return res.status(403).json({ error: "Sessão expirada ou inválida." });
      }

      res.json({ markdown: branchText.trim() });
    } catch (error: any) {
      console.error("[SERVER ERROR]", error);
      const message = String(error?.message || "Internal Server Error");
      const msg = message.toLowerCase();
      const retryable =
        msg.includes("429") || msg.includes("quota") || msg.includes("503") || msg.includes("overloaded") || msg.includes("rate limit");
      res.status(retryable ? 429 : 500).json({ error: message });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    clearInterval(keepAlive);
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  clearInterval(keepAlive);
  console.error("[SERVER FATAL]", error);
  process.exit(1);
});
