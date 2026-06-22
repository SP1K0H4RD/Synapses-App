export async function generateMedicalMap(
  materiaisBrutos: string, 
  objetivos: string, 
  extensao: number,
  centralTopic: string,
  apiKey?: string,
  accessToken?: string
): Promise<string> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const getApiCandidateUrls = (path: string): URL[] => {
    const appUrlRaw = (globalThis as any).__APP_URL__ as string | undefined;
    const appUrl = typeof appUrlRaw === "string" ? appUrlRaw.trim() : "";
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
    const basePath =
      pathname.endsWith("/") ? pathname : lastSegment.includes(".") ? pathname.replace(/[^/]+$/, "") : `${pathname}/`;

    const urls = [
      ...(appUrl ? [new URL(path, appUrl)] : []),
      new URL(path.replace(/^\//, ""), `${origin}${basePath}`),
      new URL(path, origin)
    ];
    const seen = new Set<string>();
    return urls.filter((u) => {
      const key = u.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  if (!accessToken) {
    throw new Error("Faça login para continuar.");
  }

  const isRetryableError = (status: number | null, message: string) => {
    const msg = (message || "").toLowerCase();
    if (status === 429 || status === 503) return true;
    if (msg.includes("429")) return true;
    if (msg.includes("quota")) return true;
    if (msg.includes("overloaded")) return true;
    if (msg.includes("rate limit")) return true;
    return false;
  };

  const parseObjectives = (raw: string): string[] => {
    const bloomVerbs =
      /^(Entender|Analisar|Compreender|Descrever|Explicar|Discutir|Identificar|Aplicar|Avaliar|Sintetizar|Conhecer|Definir|Citar|Reconhecer|Diferenciar|Relacionar|Indicar|Listar|Nomear|Escrever|Relatar|Revisar|Localizar|Esquematizar|Utilizar|Organizar|Generalizar|Classificar|Comparar|Contrastear|Criticar|Justificar|Planejar|Propor|Formular|Criar|Construir)\s+/i;

    return raw
      .split("\n")
      .map((o) => {
        let cleaned = o.replace(/^\d+[\.\-\)]\s*|^\-\s*/, "").trim();
        cleaned = cleaned.replace(/\s*\([^)]*\)/g, "").trim();
        cleaned = cleaned.replace(bloomVerbs, "");
        return cleaned.trim();
      })
      .filter((o) => o.length > 2);
  };

  const listObjectives = parseObjectives(String(objetivos || ""));
  if (listObjectives.length === 0) throw new Error("Nenhum objetivo identificado.");

  const extensionPerObjective = Math.floor(extensao / listObjectives.length);

  const callJson = async <T>(path: string, body: unknown): Promise<T> => {
    const candidates = getApiCandidateUrls(path);
    let lastError: unknown = null;

    for (const apiUrl of candidates) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        });

        const contentType = response.headers.get("content-type") || "";
        const parsedBody = contentType.includes("application/json")
          ? await response.json().catch(() => ({}))
          : await response.text().catch(() => "");

        if (!response.ok) {
          const errorMessage = (() => {
            if (typeof parsedBody === "object" && parsedBody && "error" in (parsedBody as any)) return String((parsedBody as any).error);
            if (typeof parsedBody === "string" && parsedBody.trim().length > 0) return parsedBody;
            return `Erro ${response.status}`;
          })();

          if (response.status === 404) {
            lastError = new Error(`Erro 404 em ${apiUrl.toString()}`);
            continue;
          }

          const error = new Error(errorMessage) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }

        return (parsedBody as T) ?? ({} as T);
      } catch (e) {
        lastError = e;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error("Falha ao chamar a API.");
  };

  const callJsonWithRetry = async <T>(
    path: string,
    body: unknown,
    retries = 5,
    delayMs = 15000
  ): Promise<T> => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await callJson<T>(path, body);
      } catch (e: any) {
        lastError = e;
        const status = typeof e?.status === "number" ? e.status : null;
        const message = typeof e?.message === "string" ? e.message : String(e || "");
        if (!isRetryableError(status, message) || attempt === retries - 1) throw e;
        await delay(delayMs);
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error("Falha ao chamar a API.");
  };

  const start = await callJson<{ sessionId: string }>("/api/start-generation", { objetivos });
  const sessionId = String((start as any)?.sessionId || "");
  if (!sessionId) throw new Error("Falha ao iniciar a sessão de geração.");

  let finalMarkdown = `# ${centralTopic}\n\n`;

  for (const objective of listObjectives) {
    const data = await callJsonWithRetry<{ markdown: string }>("/api/generate-block", {
      sessionId,
      materiaisBrutos,
      objective,
      centralTopic,
      apiKey,
      extensionPerObjective,
    });
    finalMarkdown += String((data as any)?.markdown || "").trim() + "\n\n";
  }

  return finalMarkdown.trim();
}
