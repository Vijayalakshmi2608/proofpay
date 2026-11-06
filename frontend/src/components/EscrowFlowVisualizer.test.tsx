// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { FunctionCallPermissionCheck } from "@/lib/near-rpc";
import type { OnChainMilestone } from "@/lib/proofpay-types";
import { EscrowFlowVisualizer } from "./EscrowFlowVisualizer";

const rpcMocks = vi.hoisted(() => ({ getVerifierConfiguration: vi.fn(), checkFunctionCallPermission: vi.fn() }));
vi.mock("@/lib/near-rpc", () => rpcMocks);
vi.mock("@/lib/milestone-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/milestone-utils")>();
  return { ...actual, sha256Hex: vi.fn(async () => "mock-key-digest") };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const milestone: OnChainMilestone = {
  id: 7,
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
  destination_chain: "Ethereum",
  payout_recipient: "0x0000000000000000000000000000000000000001",
  attestation: null,
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_NEAR_CONTRACT_ID", "proofpay.testnet");
  rpcMocks.getVerifierConfiguration.mockReset();
  rpcMocks.checkFunctionCallPermission.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const verifiedScope: FunctionCallPermissionCheck = {
  verified: true,
  state: "verified",
  receiverId: "proofpay.testnet",
  methodNames: ["record_attestation"],
  allowanceYocto: "250000000000000000000000",
  reason: "Exact Function-Call permission verified by RPC.",
};

function withAttestation(key: string): OnChainMilestone {
  return {
    ...milestone,
    attestation: {
      milestone_id: 7,
      verifier_key: key,
      result: true,
      reasoning_hash: `reason-${key}`,
      timestamp: "1710000000000000000",
    },
  };
}

describe("EscrowFlowVisualizer", () => {
  it("renders the four lifecycle nodes and simulates the blocked policy without broadcasting", () => {
    render(<EscrowFlowVisualizer milestone={milestone} network="testnet" verifierPreview={null} />);
    expect(screen.getByText("Employer Vault")).toBeTruthy();
    expect(screen.getByText("TEE AI Inspection")).toBeTruthy();
    expect(screen.getByText("Policy Guard Check")).toBeTruthy();
    expect(screen.getByText("Cross-Chain Intent Payout")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Simulate Adversarial Attack/ }));
    expect(toast.error).toHaveBeenCalledWith("Blocked by Function-Call Policy", expect.objectContaining({ description: expect.stringContaining("No wallet signature, transaction, or network broadcast") }));
  });

  it("hides the old verified scope immediately while a rotated attestation key is being checked", async () => {
    let configuredKey = "ed25519:key-a";
    let resolveKeyB!: (result: FunctionCallPermissionCheck) => void;
    const pendingKeyB = new Promise<FunctionCallPermissionCheck>((resolve) => { resolveKeyB = resolve; });
    rpcMocks.getVerifierConfiguration.mockImplementation(async () => ({ accountId: "verifier.testnet", publicKey: configuredKey }));
    rpcMocks.checkFunctionCallPermission.mockImplementation((_account: string, key: string) => key === "ed25519:key-a" ? Promise.resolve(verifiedScope) : pendingKeyB);

    const { rerender } = render(<EscrowFlowVisualizer milestone={withAttestation("ed25519:key-a")} network="testnet" verifierPreview={null} />);
    await screen.findByText("Function-Call scope verified by RPC");
    expect(screen.getByText(/Fingerprint: sha256:/)).toBeTruthy();

    configuredKey = "ed25519:key-b";
    rerender(<EscrowFlowVisualizer milestone={withAttestation("ed25519:key-b")} network="testnet" verifierPreview={null} />);
    expect(screen.queryByText("Function-Call scope verified by RPC")).toBeNull();
    expect(screen.getByText("Checking NEAR access-key scope…")).toBeTruthy();

    resolveKeyB(verifiedScope);
    await waitFor(() => expect(screen.getByText("Function-Call scope verified by RPC")).toBeTruthy());
    expect(screen.getByText("Pinned key: ed25519:key-b")).toBeTruthy();
  });
});
