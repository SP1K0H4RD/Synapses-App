import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const keepAlive = setInterval(() => {}, 1 << 30);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

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

  // API Route for Mind Map Generation (Single Block/Objective)
  app.post("/api/generate-block", async (req, res) => {
    const { materiaisBrutos, objective, centralTopic, apiKey, extensionPerObjective } = req.body;
    
    const usedApiKey = apiKey || process.env.GEMINI_API_KEY;

    if (!usedApiKey) {
      return res.status(400).json({ error: "Gemini API Key is required." });
    }

    try {
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
5. VOLUME: Detalhe exaustivamente para atingir cerca de ${extensionPerObjective} palavras para ESTE objetivo.
6. RAMIFICAÇÃO: Crie múltiplas ramificações laterais para melhorar o design visual.

Gere o Markdown começando diretamente em ## ${objective}.`;
      
      const prompt = `
MATERIAIS DE ESTUDO (Use como fonte absoluta):
${materiaisBrutos.substring(0, 45000)}

TÓPICO CENTRAL DO MAPA: ${centralTopic}
OBJETIVO ESPECÍFICO DESTE RAMO: ${objective}

INSTRUÇÃO: Expanda este objetivo especificamente, criando múltiplas ramificações laterais. Seja prolixo no detalhamento técnico interno, garantindo o rigor acadêmico médico.`;
      
      const interaction = await ai.interactions.create({
        model: "gemini-3.5-flash",
        input: prompt,
        system_instruction: sysInst,
      });

      let branchText = "";
      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const textContent = step.content?.find(c => c.type === 'text');
          if (textContent && textContent.text) {
            branchText += textContent.text;
          }
        }
      }

      res.json({ markdown: branchText.trim() });
    } catch (error: any) {
      console.error("[SERVER ERROR]", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
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
