export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 8_000;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) return errorResponse("request_too_large", 413);
  let text: string;
  try {
    text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return errorResponse("request_too_large", 413);
  } catch {
    return errorResponse("invalid_request", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return errorResponse("invalid_json", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return errorResponse("invalid_request", 400);
  const body = JSON.stringify({ ...(parsed as Record<string, unknown>), dry: true });
  const baseUrl = process.env.VERIFIER_API_BASE_URL?.trim() || "http://127.0.0.1:3002";
  let upstreamUrl: string;
  try {
    upstreamUrl = new URL("/api/intents/quote", baseUrl).toString();
  } catch {
    return errorResponse("verifier_not_configured", 503);
  }
  try {
    const upstream = await fetch(upstreamUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(18_000) });
    const responseText = await upstream.text();
    if (responseText.length > 64_000) return errorResponse("quote_response_too_large", 502);
    return new Response(responseText, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch {
    return errorResponse("intents_service_unavailable", 502);
  }
}
