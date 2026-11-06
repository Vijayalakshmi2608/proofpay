import type { NearNetwork } from "./proofpay-types";

export interface ProofReceipt {
  version: "proofpay-selective-disclosure-receipt-v1";
  contract_id: string;
  milestone_id: number;
  status: "released";
  contractor: string;
  amount: string;
  asset_id: string;
  asset_kind: "native_near" | "nep141" | "cross_chain_intent";
  proof_hash: string;
  reasoning_hash: string;
  verified_at_ns: string | number;
  commitment: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseProofReceipt(value: unknown): ProofReceipt {
  if (!isRecord(value) || Object.hasOwn(value, "employer")) {
    throw new Error("Receipt is malformed or contains a private employer field.");
  }
  const allowedKinds = ["native_near", "nep141", "cross_chain_intent"];
  const id = Number(value.milestone_id);
  if (value.version !== "proofpay-selective-disclosure-receipt-v1" || value.status !== "released" ||
      !Number.isSafeInteger(id) || id < 0 || typeof value.contract_id !== "string" ||
      typeof value.contractor !== "string" || typeof value.amount !== "string" || !/^\d{1,39}$/.test(value.amount) ||
      typeof value.asset_id !== "string" || !allowedKinds.includes(String(value.asset_kind)) ||
      typeof value.proof_hash !== "string" || !value.proof_hash || typeof value.reasoning_hash !== "string" ||
      typeof value.commitment !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.commitment) ||
      !(typeof value.verified_at_ns === "string" || typeof value.verified_at_ns === "number")) {
    throw new Error("Receipt does not match the released-work schema.");
  }
  return {
    version: value.version,
    contract_id: value.contract_id,
    milestone_id: id,
    status: "released",
    contractor: value.contractor,
    amount: value.amount,
    asset_id: value.asset_id,
    asset_kind: value.asset_kind as ProofReceipt["asset_kind"],
    proof_hash: value.proof_hash,
    reasoning_hash: value.reasoning_hash,
    verified_at_ns: value.verified_at_ns,
    commitment: value.commitment,
  };
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function proofReceiptCsv(receipt: ProofReceipt): string {
  const fields: Array<[string, string]> = [
    ["receipt_version", receipt.version],
    ["contract_id", receipt.contract_id],
    ["milestone_id", String(receipt.milestone_id)],
    ["status", receipt.status],
    ["contractor", receipt.contractor],
    ["amount_base_units", receipt.amount],
    ["asset_id", receipt.asset_id],
    ["asset_kind", receipt.asset_kind],
    ["proof_hash", receipt.proof_hash],
    ["reasoning_hash", receipt.reasoning_hash],
    ["verified_at_ns", String(receipt.verified_at_ns)],
    ["commitment", receipt.commitment],
  ];
  return `${fields.map(([key, value]) => `${csvCell(key)},${csvCell(value)}`).join("\r\n")}\r\n`;
}

export function proofReceiptShareUrl(origin: string, milestoneId: number, network: NearNetwork, commitment: string): string {
  const url = new URL("/receipt", origin);
  url.searchParams.set("milestoneId", String(milestoneId));
  url.searchParams.set("network", network);
  url.searchParams.set("commitment", commitment);
  return url.toString();
}
