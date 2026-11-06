export type NearNetwork = "testnet" | "mainnet";

export type MilestoneStatus =
  | "pending"
  | "attested"
  | "payout_pending"
  | "released"
  | "disputed"
  | "refunded";

export type AssetKind = "native_near" | "nep141" | "cross_chain_intent";

export interface OnChainAttestation {
  milestone_id: number | string;
  verifier_key: string;
  result: boolean;
  reasoning_hash: string;
  timestamp: string | number;
}

export interface OnChainMilestone {
  id: number;
  employer: string;
  contractor: string;
  amount: string;
  deadline: string;
  proof_hash: string;
  proof_url: string;
  proof_requirements: string;
  status: MilestoneStatus;
  auto_release_limit: string;
  asset_id: string;
  asset_kind: AssetKind;
  destination_chain: string;
  payout_recipient: string;
  attestation: OnChainAttestation | null;
  pending_previous_status?: MilestoneStatus | null;
  pending_final_status?: MilestoneStatus | null;
  pending_bridge_adapter?: string | null;
  payout_target?: string | null;
  bridge_tx_ref?: string | null;
  demoOnly?: boolean;
  submittedTxHash?: string;
}

export interface AttestorCheck {
  name: string;
  passed: boolean;
  evidence: string;
}

export interface DeliverableVerificationResponse {
  milestoneId: number;
  passed: boolean;
  checks: AttestorCheck[];
  attestationTxHash: string | null;
  reasoning: string;
  reasoningHash: string;
  writeStatus: "submitted" | "dry_run" | "writes_disabled" | "criteria_failed";
  teeSignature: string;
  teePublicKey: string;
  teeSignatureMode: "configured-software-key" | "ephemeral-mock-key";
  signedPayload: {
    version: "proofpay-mock-tee-attestation-v1";
    milestoneId: number;
    passed: boolean;
    checks: AttestorCheck[];
    reasoning: string;
    reasoningHash: string;
    aiReview: {
      status: "approved" | "revision_requested" | "rejected";
      score: number;
      confidence: number;
      summary: string;
      evidence: Array<{ requirement: string; result: "met" | "partial" | "unmet"; explanation: string }>;
      model: string;
      createdAt: string;
    };
    attestationTxHash: string | null;
    writeStatus: "submitted" | "dry_run" | "writes_disabled" | "criteria_failed";
    createdAt: string;
  };
}
