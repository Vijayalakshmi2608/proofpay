export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = process.env.VERIFIER_API_BASE_URL?.trim() || "http://127.0.0.1:3002";
  let upstreamUrl: string;
  try {
    upstreamUrl = new URL("/api/intents/assets", baseUrl).toString();
  } catch {
    return Response.json({ error: "verifier_not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const upstream = await fetch(upstreamUrl, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const body = await upstream.text();
    if (body.length > 64_000) return Response.json({ error: "asset_response_too_large" }, { status: 502, headers: { "cache-control": "no-store" } });
    return new Response(body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "intents_service_unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
