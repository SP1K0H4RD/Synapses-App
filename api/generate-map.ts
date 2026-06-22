export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify({ error: "Endpoint descontinuado. Use /api/start-generation e /api/generate-block." }), {
    status: 410,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
