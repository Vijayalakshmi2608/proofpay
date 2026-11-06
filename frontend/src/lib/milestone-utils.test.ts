import { describe, expect, it } from "vitest";
import type { OnChainMilestone } from "./proofpay-types";
import { formatAssetAmount, getFlowNode, getMilestoneAssetDisplay, getMilestoneBadge, getMilestoneTitle, isAutoReleaseEligible } from "./milestone-utils";

const base: OnChainMilestone = {
  id: 7,
  employer: "employer.near",
  contractor: "contractor.near",
  amount: "12345678",
  deadline: "1790000000000000000",
  proof_hash: "",
  proof_url: "",
  proof_requirements: JSON.stringify({ title: "Ship API", requiredPhrases: ["tests pass"] }),
  status: "pending",
  auto_release_limit: "20000000",
  asset_id: "usdc.testnet",
  asset_kind: "nep141",
  destination_chain: "Ethereum",
  payout_recipient: "0x0000000000000000000000000000000000000001",
  attestation: null,
};

describe("milestone asset display", () => {
  it("formats configured NEP-141 USDC using six decimals", () => {
    const asset = getMilestoneAssetDisplay(base, "escrow.testnet", "usdc.testnet");
    expect(asset.symbol).toBe("USDC");
    expect(formatAssetAmount(base.amount, asset, 6)).toBe("12.345678");
  });

  it("recognizes NEAR-backed cross-chain milestones by the escrow asset ID", () => {
    const asset = getMilestoneAssetDisplay({ asset_id: "escrow.testnet", asset_kind: "cross_chain_intent" }, "escrow.testnet", "usdc.testnet");
    expect(asset).toMatchObject({ symbol: "NEAR", decimals: 24 });
  });

  it("does not guess decimals or symbol for an unconfigured token", () => {
    const asset = getMilestoneAssetDisplay({ asset_id: "some-token.near", asset_kind: "nep141" }, "escrow.testnet", "usdc.testnet");
    expect(asset.decimals).toBeNull();
    expect(formatAssetAmount("123", asset)).toBe("123 base units");
  });
});

describe("milestone state presentation", () => {
  it("uses the stored title and checks thresholds in base units", () => {
    expect(getMilestoneTitle(base)).toBe("Ship API");
    expect(isAutoReleaseEligible(base)).toBe(true);
    expect(isAutoReleaseEligible({ amount: "20000001", auto_release_limit: "20000000" })).toBe(false);
  });

  it("maps contract state to lifecycle nodes and requested labels", () => {
    expect(getFlowNode("pending", "")).toBe(0);
    expect(getFlowNode("pending", "sha256:abc")).toBe(1);
    expect(getFlowNode("attested", "sha256:abc")).toBe(2);
    expect(getFlowNode("payout_pending", "sha256:abc")).toBe(3);
    expect(getMilestoneBadge({ status: "pending", proof_hash: "" }).label).toBe("Escrow Locked");
    expect(getMilestoneBadge({ status: "pending", proof_hash: "sha256:abc" }).label).toBe("Proof Submitted");
    expect(getMilestoneBadge({ status: "attested", proof_hash: "sha256:abc" }).label).toBe("AI Attested");
    expect(getMilestoneBadge({ status: "released", proof_hash: "sha256:abc" }).label).toBe("Payout Released");
  });
});
