import type { DeliverableVerificationResponse } from "./proofpay-types";

export type VerifierDeliverable =
  | { kind: "github_commit"; repository: string; commitHash: string }
  | { kind: "raw_text"; text: string }
  | { kind: "file_hash"; hash: string; fileName?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function requestDryVerification(milestoneId: number, deliverable: VerifierDeliverable, signal?: AbortSignal): Promise<DeliverableVerificationResponse> {
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ milestoneId, deliverable, dryRun: true }),
    cache: "no-store",
    signal,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(value) && typeof value.message === "string" ? value.message : isRecord(value) && typeof value.error === "string" ? value.error : `Verifier returned HTTP ${response.status}.`;
    throw new Error(message.slice(0, 300));
  }
  if (!isRecord(value) || value.milestoneId !== milestoneId || typeof value.passed !== "boolean" || typeof value.reasoning !== "string" || typeof value.teeSignature !== "string" || !isRecord(value.signedPayload) || !Array.isArray(value.checks)) {
    throw new Error("Verifier response did not match the signed ProofPay payload contract.");
  }
  if (typeof value.teePublicKey !== "string" || typeof value.teeSignatureMode !== "string" || typeof value.reasoningHash !== "string") {
    throw new Error("Verifier response did not include the public signing key or reasoning hash.");
  }
  return value as unknown as DeliverableVerificationResponse;
}
