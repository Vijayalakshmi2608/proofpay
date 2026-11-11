export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 48_000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) return jsonError("request_too_large", 413);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return jsonError("invalid_request", 400);
  }
  if (!body || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) return jsonError("request_too_large", 413);
  try {
    JSON.parse(body);
  } catch {
    return jsonError("invalid_json", 400);
  }

  const baseUrl = process.env.VERIFIER_API_BASE_URL?.trim() || "http://127.0.0.1:3002";
  let verifierUrl: string;
  try {
    verifierUrl = new URL("/v1/attest", baseUrl).toString();
  } catch {
    return jsonError("verifier_not_configured", 503);
  }

  try {
    const upstream = await fetch(verifierUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const responseBody = await upstream.text();
    if (responseBody.length > 64_000) return jsonError("invalid_verifier_response", 502);
    return new Response(responseBody, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.warn("verifier_proxy_unavailable", timedOut ? "timeout" : "upstream unavailable");
    return jsonError(timedOut ? "verifier_timeout" : "verifier_unavailable", timedOut ? 504 : 502);
  }
}
