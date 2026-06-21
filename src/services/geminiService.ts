export async function generateMedicalMap(
  materiaisBrutos: string, 
  objetivos: string, 
  extensao: number,
  centralTopic: string,
  apiKey?: string
): Promise<string> {
  const getApiCandidateUrls = (): URL[] => {
    const appUrlRaw = (globalThis as any).__APP_URL__ as string | undefined;
    const appUrl = typeof appUrlRaw === "string" ? appUrlRaw.trim() : "";
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
    const basePath =
      pathname.endsWith("/") ? pathname : lastSegment.includes(".") ? pathname.replace(/[^/]+$/, "") : `${pathname}/`;

    const urls = [
      ...(appUrl ? [new URL("/api/generate-block", appUrl)] : []),
      new URL("api/generate-block", `${origin}${basePath}`),
      new URL("/api/generate-block", origin)
    ];
    const seen = new Set<string>();
    return urls.filter((u) => {
      const key = u.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

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
      const candidates = getApiCandidateUrls();
      let lastError: unknown = null;

      for (const apiUrl of candidates) {
        try {
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
            const contentType = response.headers.get("content-type") || "";
            const errorBody = contentType.includes("application/json")
              ? await response.json().catch(() => ({}))
              : await response.text().catch(() => "");

            const errorMessage =
              typeof errorBody === "object" && errorBody && "error" in errorBody
                ? String((errorBody as any).error)
                : typeof errorBody === "string" && errorBody.trim().length > 0
                  ? errorBody
                  : `Erro ${response.status}`;

            if (response.status === 404) {
              lastError = new Error(`Erro 404 em ${apiUrl.toString()}`);
              continue;
            }

            throw new Error(`${errorMessage}`);
          }

          const data = await response.json().catch(() => ({}));
          return (data as any).markdown || "";
        } catch (e) {
          lastError = e;
        }
      }

      if (lastError instanceof Error) throw lastError;
      throw new Error("Falha ao chamar a API.");
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
