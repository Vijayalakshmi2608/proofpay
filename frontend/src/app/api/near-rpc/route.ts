export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const RPC_URLS = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
} as const;
const ALLOWED_RPC_METHODS = new Set([
  "query",
  "status",
  "block",
  "gas_price",
  "validators",
  "EXPERIMENTAL_protocol_config",
  "EXPERIMENTAL_tx_status",
  "tx",
  "broadcast_tx_commit",
  "broadcast_tx_async",
  "send_tx",
]);
const ALLOWED_QUERY_TYPES = new Set([
  "call_function",
  "view_account",
  "view_access_key",
  "view_access_key_list",
]);

type JsonRecord = Record<string, unknown>;

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRpcRequest(value: unknown): value is JsonRecord {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") return false;
  if (!(typeof value.id === "string" || typeof value.id === "number" || value.id === null)) return false;
  if (!ALLOWED_RPC_METHODS.has(value.method)) return false;
  if (value.params !== undefined && !isRecord(value.params) && !Array.isArray(value.params)) return false;

  if (value.method === "query") {
    if (!isRecord(value.params) || typeof value.params.request_type !== "string") return false;
    if (!ALLOWED_QUERY_TYPES.has(value.params.request_type)) return false;
  }

  return true;
}

export async function POST(request: Request) {
  const network = new URL(request.url).searchParams.get("network");
  if (network !== "testnet" && network !== "mainnet") return jsonError("unsupported_network", 400);

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REQUEST_BYTES) return jsonError("request_too_large", 413);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return jsonError("invalid_request", 400);
  }
  if (!body || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) return jsonError("request_too_large", 413);

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return jsonError("invalid_json", 400);
  }
  if (!isValidRpcRequest(payload)) return jsonError("unsupported_rpc_request", 400);

  try {
    const upstream = await fetch(RPC_URLS[network], {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const responseBody = await upstream.text();
    if (new TextEncoder().encode(responseBody).byteLength > MAX_RESPONSE_BYTES) return jsonError("rpc_response_too_large", 502);

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.warn("near_rpc_proxy_unavailable", timedOut ? "timeout" : "upstream unavailable");
    return jsonError(timedOut ? "rpc_timeout" : "rpc_unavailable", timedOut ? 504 : 502);
  }
}
