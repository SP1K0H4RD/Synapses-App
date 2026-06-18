export async function generateMedicalMap(
  materiaisBrutos: string, 
  objetivos: string, 
  extensao: number,
  centralTopic: string,
  apiKey?: string
): Promise<string> {
  // Parse and Clean Objectives
  const listObjectives = objetivos.split('\n')
    .map((o: string) => {
      // Remove numbers/bullets at start (e.g., "1.", "a)", "-")
      let cleaned = o.replace(/^\d+[\.\-\)]\s*|^\-\s*/, '').trim();
      // Remove text in parentheses
      cleaned = cleaned.replace(/\s*\([^)]*\)/g, '').trim();
      // Remove Bloom's Taxonomy verbs and introductory phrases
      const bloomVerbs = /^(Entender|Analisar|Compreender|Descrever|Explicar|Discutir|Identificar|Aplicar|Avaliar|Sintetizar|Conhecer|Definir|Citar|Reconhecer|Diferenciar|Relacionar|Indicar|Listar|Nomear|Escrever|Relatar|Revisar|Localizar|Esquematizar|Utilizar|Organizar|Generalizar|Classificar|Comparar|Contrastear|Criticar|Justificar|Planejar|Propor|Formular|Criar|Construir)\s+/i;
      cleaned = cleaned.replace(bloomVerbs, '');
      return cleaned.trim();
    })
    .filter((o: string) => o.length > 2);

  if (listObjectives.length === 0) {
    throw new Error("Nenhum objetivo identificado.");
  }

  const extensionPerObjective = Math.floor(extensao / listObjectives.length);

  // Retry logic: 5 retries with 15s delay
  const callWithRetry = async (objective: string, retries = 5): Promise<string> => {
    try {
      const apiUrl = new URL("./api/generate-block", window.location.href);
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materiaisBrutos,
          objective,
          centralTopic,
          apiKey,
          extensionPerObjective
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${response.status}`);
      }

      const data = await response.json();
      return data.markdown || "";
    } catch (error: any) {
      if (retries > 0 && (error.message.includes('429') || error.message.includes('quota') || error.message.includes('timeout'))) {
        console.warn(`[GEMINI] Falha no bloco. Retentando em 15s... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 15000));
        return callWithRetry(objective, retries - 1);
      }
      throw error;
    }
  };

  let finalMarkdown = `# ${centralTopic}\n\n`;

  for (const objective of listObjectives) {
    const branchMd = await callWithRetry(objective);
    finalMarkdown += branchMd + "\n\n";
    // Pause between blocks to prevent rate limit spikes
    await new Promise(r => setTimeout(r, 1000));
  }

  return finalMarkdown;
}
