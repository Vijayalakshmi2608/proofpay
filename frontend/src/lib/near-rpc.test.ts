import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkFunctionCallPermission, getVerifierConfiguration, listMilestones } from "./near-rpc";

const rpcFetch = vi.fn();

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function viewResponse(value: unknown): Response {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return jsonResponse({ jsonrpc: "2.0", result: { result: bytes } });
}

beforeEach(() => {
  rpcFetch.mockReset();
  vi.stubGlobal("fetch", rpcFetch);
});

afterEach(() => vi.unstubAllGlobals());

const milestone = (id: number) => ({
  id,
  employer: "employer.testnet",
  contractor: "contractor.testnet",
  amount: "1000000000000000000000000",
  deadline: "1790000000000000000",
  proof_hash: "",
  proof_url: "",
  proof_requirements: "{}",
  status: "pending",
  auto_release_limit: "0",
  asset_id: "proofpay.testnet",
  asset_kind: "native_near",
  destination_chain: "NEAR",
  payout_recipient: "contractor.testnet",
  attestation: null,
});

describe("NEAR RPC contract reads", () => {
  it("parses and sorts milestone records from the bounded list view", async () => {
    rpcFetch.mockResolvedValueOnce(viewResponse([milestone(2), milestone(9)]));
    const records = await listMilestones("proofpay.testnet", "testnet");
    expect(records.map((record) => record.id)).toEqual([9, 2]);
    expect(rpcFetch.mock.calls[0]?.[0]).toBe("/api/near-rpc?network=testnet");
    const body = JSON.parse(String((rpcFetch.mock.calls[0]?.[1] as RequestInit).body)) as { params: { method_name: string; args_base64: string } };
    expect(body.params.method_name).toBe("list_milestones");
    expect(JSON.parse(Buffer.from(body.params.args_base64, "base64").toString("utf8"))).toEqual({ from_index: 0, limit: 50 });
  });

  it("parses the contract-pinned verifier account and public key", async () => {
    rpcFetch.mockResolvedValueOnce(viewResponse(["verifier.testnet", "ed25519:abc"]));
    await expect(getVerifierConfiguration("proofpay.testnet", "testnet")).resolves.toEqual({ accountId: "verifier.testnet", publicKey: "ed25519:abc" });
  });

  it("verifies only the exact record_attestation Function-Call scope with a finite allowance", async () => {
    rpcFetch.mockResolvedValueOnce(jsonResponse({ result: { permission: { FunctionCall: { receiver_id: "proofpay.testnet", method_names: ["record_attestation"], allowance: "250000000000000000000000" } } } }));
    const result = await checkFunctionCallPermission("verifier.testnet", "ed25519:abc", "proofpay.testnet", "testnet");
    expect(result).toMatchObject({ verified: true, state: "verified", methodNames: ["record_attestation"] });
  });

  it("reports FullAccess, other methods, wildcard scopes, and unlimited allowance as unverified", async () => {
    rpcFetch.mockResolvedValueOnce(jsonResponse({ result: { permission: "FullAccess" } }));
    await expect(checkFunctionCallPermission("verifier.testnet", "ed25519:full", "proofpay.testnet", "testnet")).resolves.toMatchObject({ verified: false, state: "full_access" });

    rpcFetch.mockResolvedValueOnce(jsonResponse({ result: { permission: { FunctionCall: { receiver_id: "proofpay.testnet", method_names: ["record_attestation", "release_payout"], allowance: "10" } } } }));
    await expect(checkFunctionCallPermission("verifier.testnet", "ed25519:wide", "proofpay.testnet", "testnet")).resolves.toMatchObject({ verified: false, state: "scope_mismatch" });

    rpcFetch.mockResolvedValueOnce(jsonResponse({ result: { permission: { FunctionCall: { receiver_id: "proofpay.testnet", method_names: ["record_attestation"], allowance: null } } } }));
    await expect(checkFunctionCallPermission("verifier.testnet", "ed25519:unlimited", "proofpay.testnet", "testnet")).resolves.toMatchObject({ verified: false, state: "scope_mismatch" });
  });
});
