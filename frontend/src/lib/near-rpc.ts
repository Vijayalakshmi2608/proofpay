import type { AssetKind, MilestoneStatus, NearNetwork, OnChainAttestation, OnChainMilestone } from "./proofpay-types";

const MAX_RPC_RESPONSE_BYTES = 1_000_000;
const MAX_VIEW_LIMIT = 50;

export class NearRpcError extends Error {
  constructor(message: string, readonly rpcCode?: number) {
    super(message);
    this.name = "NearRpcError";
  }
}

export interface VerifierConfiguration {
  accountId: string;
  publicKey: string;
}

export interface FunctionCallPermissionCheck {
  verified: boolean;
  state: "verified" | "full_access" | "scope_mismatch" | "unavailable";
  receiverId: string | null;
  methodNames: string[];
  allowanceYocto: string | null;
  reason: string;
}

function rpcUrl(network: NearNetwork): string {
  return process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() || `https://rpc.${network}.near.org`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function rpcRequest(network: NearNetwork, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "proofpay-ui", method: "query", params }),
    cache: "no-store",
    signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RPC_RESPONSE_BYTES) throw new NearRpcError("NEAR RPC response exceeded the size limit.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new NearRpcError("NEAR RPC returned malformed JSON.");
  }
  if (!response.ok) throw new NearRpcError(`NEAR RPC returned HTTP ${response.status}.`);
  if (!isRecord(decoded)) throw new NearRpcError("NEAR RPC response had an unexpected shape.");
  if (isRecord(decoded.error)) {
    const error = decoded.error;
    const code = typeof error.code === "number" ? error.code : undefined;
    const message = typeof error.message === "string" ? error.message : "NEAR RPC query failed.";
    throw new NearRpcError(message.slice(0, 400), code);
  }
  return decoded.result;
}

export async function viewContract<T>(
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  network: NearNetwork,
  signal?: AbortSignal,
): Promise<T> {
  if (!contractId.trim()) throw new NearRpcError("NEXT_PUBLIC_NEAR_CONTRACT_ID is not configured.");
  const result = await rpcRequest(network, {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: encodeBase64(JSON.stringify(args)),
  }, signal);
  if (!isRecord(result) || !Array.isArray(result.result) || result.result.length > MAX_RPC_RESPONSE_BYTES) {
    throw new NearRpcError("NEAR RPC did not return a bounded view-function result.");
  }
  const bytes = result.result;
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new NearRpcError("NEAR RPC view result contained invalid bytes.");
  const text = new TextDecoder().decode(Uint8Array.from(bytes as number[]));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NearRpcError("NEAR contract view returned malformed JSON.");
  }
}

function parseStatus(value: unknown): MilestoneStatus {
  const allowed: MilestoneStatus[] = ["pending", "attested", "payout_pending", "released", "disputed", "refunded"];
  if (typeof value !== "string" || !allowed.includes(value as MilestoneStatus)) throw new NearRpcError("Milestone contains an unsupported status.");
  return value as MilestoneStatus;
}

function parseAssetKind(value: unknown): AssetKind {
  const allowed: AssetKind[] = ["native_near", "nep141", "cross_chain_intent"];
  if (typeof value !== "string" || !allowed.includes(value as AssetKind)) throw new NearRpcError("Milestone contains an unsupported asset kind.");
  return value as AssetKind;
}

function parseAttestation(value: unknown): OnChainAttestation | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.verifier_key !== "string" || typeof value.result !== "boolean" || typeof value.reasoning_hash !== "string") {
    throw new NearRpcError("Milestone attestation does not match the contract schema.");
  }
  const milestoneId = Number(value.milestone_id);
  if (!Number.isSafeInteger(milestoneId) || milestoneId < 0) throw new NearRpcError("Attestation contains an invalid milestone ID.");
  const timestamp = typeof value.timestamp === "string" || typeof value.timestamp === "number" ? value.timestamp : "0";
  return { milestone_id: milestoneId, verifier_key: value.verifier_key, result: value.result, reasoning_hash: value.reasoning_hash, timestamp };
}

function parseMilestone(value: unknown): OnChainMilestone {
  if (!isRecord(value)) throw new NearRpcError("Contract returned a malformed milestone.");
  const id = Number(value.id);
  if (!Number.isSafeInteger(id) || id < 0) throw new NearRpcError("Contract returned an invalid milestone ID.");
  const requiredStrings = ["employer", "contractor", "amount", "deadline", "proof_hash", "proof_url", "proof_requirements", "auto_release_limit", "asset_id", "destination_chain", "payout_recipient"] as const;
  for (const field of requiredStrings) if (typeof value[field] !== "string") throw new NearRpcError(`Milestone field ${field} is missing or invalid.`);
  const amount = value.amount as string;
  const autoReleaseLimit = value.auto_release_limit as string;
  if (!/^\d{1,39}$/.test(amount) || !/^\d{1,39}$/.test(autoReleaseLimit)) throw new NearRpcError("Milestone amount fields are not valid U128 strings.");
  return {
    id,
    employer: value.employer as string,
    contractor: value.contractor as string,
    amount,
    deadline: value.deadline as string,
    proof_hash: value.proof_hash as string,
    proof_url: value.proof_url as string,
    proof_requirements: value.proof_requirements as string,
    status: parseStatus(value.status),
    auto_release_limit: autoReleaseLimit,
    asset_id: value.asset_id as string,
    asset_kind: parseAssetKind(value.asset_kind),
    destination_chain: value.destination_chain as string,
    payout_recipient: value.payout_recipient as string,
    attestation: parseAttestation(value.attestation),
    pending_previous_status: typeof value.pending_previous_status === "string" ? parseStatus(value.pending_previous_status) : null,
    pending_final_status: typeof value.pending_final_status === "string" ? parseStatus(value.pending_final_status) : null,
    pending_bridge_adapter: typeof value.pending_bridge_adapter === "string" ? value.pending_bridge_adapter : null,
    payout_target: typeof value.payout_target === "string" ? value.payout_target : null,
    bridge_tx_ref: typeof value.bridge_tx_ref === "string" ? value.bridge_tx_ref : null,
  };
}

export async function listMilestones(contractId: string, network: NearNetwork, signal?: AbortSignal): Promise<OnChainMilestone[]> {
  const rows = await viewContract<unknown>(contractId, "list_milestones", { from_index: 0, limit: MAX_VIEW_LIMIT }, network, signal);
  if (!Array.isArray(rows) || rows.length > MAX_VIEW_LIMIT) throw new NearRpcError("Milestone list exceeded the contract view limit.");
  return rows.map(parseMilestone).sort((a, b) => b.id - a.id);
}

export async function getAccountBalanceYocto(accountId: string, network: NearNetwork, signal?: AbortSignal): Promise<string> {
  const result = await rpcRequest(network, {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  }, signal);
  if (!isRecord(result) || typeof result.amount !== "string" || !/^\d+$/.test(result.amount)) throw new NearRpcError("NEAR RPC returned an invalid account balance.");
  return result.amount;
}

export async function getVerifierConfiguration(contractId: string, network: NearNetwork, signal?: AbortSignal): Promise<VerifierConfiguration> {
  const result = await viewContract<unknown>(contractId, "verifier_configuration", {}, network, signal);
  const accountId = Array.isArray(result) ? result[0] : isRecord(result) ? result.account_id ?? result.verifier_id ?? result["0"] : undefined;
  const publicKey = Array.isArray(result) ? result[1] : isRecord(result) ? result.public_key ?? result.verifier_public_key ?? result["1"] : undefined;
  if (typeof accountId !== "string" || typeof publicKey !== "string") throw new NearRpcError("Verifier configuration did not match the contract response.");
  return { accountId, publicKey };
}

export async function checkFunctionCallPermission(
  accountId: string,
  publicKey: string,
  expectedContractId: string,
  network: NearNetwork,
  signal?: AbortSignal,
): Promise<FunctionCallPermissionCheck> {
  try {
    const result = await rpcRequest(network, {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    }, signal);
    if (!isRecord(result) || result.permission === undefined) throw new NearRpcError("Access-key permission was not returned.");
    if (result.permission === "FullAccess") {
      return { verified: false, state: "full_access", receiverId: null, methodNames: [], allowanceYocto: null, reason: "RPC confirms this is a FullAccess key, not a restricted Function-Call key." };
    }
    if (!isRecord(result.permission)) throw new NearRpcError("Access-key permission had an unexpected shape.");
    const permission = result.permission;
    const rawFunctionCall = permission.FunctionCall ?? permission.function_call ?? (permission.type === "FunctionCall" ? permission : undefined);
    if (!isRecord(rawFunctionCall)) {
      return { verified: false, state: "full_access", receiverId: null, methodNames: [], allowanceYocto: null, reason: "The pinned key is not a Function-Call key." };
    }
    const receiverId = typeof rawFunctionCall.receiver_id === "string" ? rawFunctionCall.receiver_id : null;
    const methodNames = Array.isArray(rawFunctionCall.method_names) ? rawFunctionCall.method_names.filter((item): item is string => typeof item === "string") : [];
    const allowanceYocto = typeof rawFunctionCall.allowance === "string" ? rawFunctionCall.allowance : null;
    const exactScope = receiverId === expectedContractId && methodNames.length === 1 && methodNames[0] === "record_attestation";
    const finiteAllowance = allowanceYocto !== null && /^\d+$/.test(allowanceYocto) && BigInt(allowanceYocto) > 0n;
    if (exactScope && finiteAllowance) {
      return { verified: true, state: "verified", receiverId, methodNames, allowanceYocto, reason: "RPC confirms this pinned key is limited to record_attestation on the escrow contract with a finite allowance." };
    }
    return { verified: false, state: "scope_mismatch", receiverId, methodNames, allowanceYocto, reason: "RPC returned a key scope that does not match the single-method verifier policy." };
  } catch (error) {
    return { verified: false, state: "unavailable", receiverId: null, methodNames: [], allowanceYocto: null, reason: error instanceof Error ? error.message.slice(0, 240) : "Access-key permission could not be verified." };
  }
}
