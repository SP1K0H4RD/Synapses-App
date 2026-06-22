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
    return Response.json({ error: "Endpoint descontinuado. Use /api/generate-map." }, { status: 410 });
  }
};
