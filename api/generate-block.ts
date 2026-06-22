export const config = { runtime: "edge" };

export default async function handler(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({ error: "Endpoint descontinuado. Use /api/generate-map." }), {
    status: 410,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
