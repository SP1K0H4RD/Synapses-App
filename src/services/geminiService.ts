export async function generateMedicalMap(
  materiaisBrutos: string, 
  objetivos: string, 
  extensao: number,
  centralTopic: string,
  apiKey?: string,
  accessToken?: string
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
      ...(appUrl ? [new URL("/api/generate-map", appUrl)] : []),
      new URL("api/generate-map", `${origin}${basePath}`),
      new URL("/api/generate-map", origin)
    ];
    const seen = new Set<string>();
    return urls.filter((u) => {
      const key = u.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const candidates = getApiCandidateUrls();
  let lastError: unknown = null;

  for (const apiUrl of candidates) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          materiaisBrutos,
          objetivos,
          extensao,
          centralTopic,
          apiKey
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
}
