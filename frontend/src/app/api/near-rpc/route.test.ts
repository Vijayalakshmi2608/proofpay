import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({ jsonrpc: "2.0", id: "test", result: { status: "ok" } }),
);

afterEach(() => {
  fetchMock.mockClear();
  vi.unstubAllGlobals();
});

function rpcRequest(network: string, body: unknown) {
  return new Request(`https://proofpay.example/api/near-rpc?network=${network}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/near-rpc", () => {
  it("forwards read-only contract queries to the fixed Testnet upstream", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      jsonrpc: "2.0",
      id: "proofpay-ui",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: "proofpay-escrow.testnet", method_name: "list_milestones", args_base64: "e30=" },
    };

    const response = await POST(rpcRequest("testnet", payload));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { status: "ok" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rpc.testnet.near.org");
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(init.cache).toBe("no-store");
  });

  it("selects the fixed Mainnet endpoint and permits signed wallet transaction broadcast", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const payload = { jsonrpc: "2.0", id: 1, method: "broadcast_tx_commit", params: { signed_tx_base64: "c2lnbmVkLXR4" } };

    const response = await POST(rpcRequest("mainnet", payload));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://rpc.mainnet.near.org");
  });

  it("rejects unsupported networks, arbitrary RPC methods, and non-view query types", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const unsupportedNetwork = await POST(rpcRequest("custom", { jsonrpc: "2.0", id: 1, method: "status" }));
    const unsupportedMethod = await POST(rpcRequest("testnet", { jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_changes" }));
    const unsupportedQuery = await POST(rpcRequest("testnet", { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call", account_id: "proofpay.testnet" } }));

    expect(unsupportedNetwork.status).toBe(400);
    expect(unsupportedMethod.status).toBe(400);
    expect(unsupportedQuery.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
