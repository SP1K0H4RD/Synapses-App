import { GoogleGenAI } from "@google/genai";

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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

  try {
    const body = await request.json().catch(() => ({}));
    const { materiaisBrutos, objective, centralTopic, apiKey, extensionPerObjective } = body || {};

    const usedApiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!usedApiKey) {
      return Response.json({ error: "Gemini API Key is required." }, { status: 400 });
    }

    const materiais = String(materiaisBrutos || "");
    const obj = String(objective || "").trim();
    const topic = String(centralTopic || "").trim();
    const words = Number(extensionPerObjective) || 500;

    if (!materiais || !obj || !topic) {
      return Response.json({ error: "Parâmetros inválidos." }, { status: 400 });
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

    const interaction = await retryWithDelay(() =>
      ai.interactions.create({
        model: "gemini-3.5-flash",
        input: prompt,
        system_instruction: sysInst
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

    return Response.json({ markdown: branchText.trim() }, { status: 200 });
  } catch (error: any) {
    return Response.json({ error: String(error?.message || "Internal Server Error") }, { status: 500 });
  }
  }
};
