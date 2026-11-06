import { describe, expect, it } from "vitest";
import { parseProofReceipt, proofReceiptCsv, proofReceiptShareUrl } from "./receipt-utils";

const rawReceipt = {
  version: "proofpay-selective-disclosure-receipt-v1",
  contract_id: "proofpay.testnet",
  milestone_id: 9,
  status: "released",
  contractor: "contractor.testnet",
  amount: "2500000000000000000000000",
  asset_id: "proofpay.testnet",
  asset_kind: "native_near",
  proof_hash: "sha256:abcd",
  reasoning_hash: "sha256:ef01",
  verified_at_ns: "1700000000000000000",
  commitment: `sha256:${"a".repeat(64)}`,
};

describe("selective-disclosure receipt utilities", () => {
  it("accepts a released receipt and produces an accountant CSV without employer identity", () => {
    const receipt = parseProofReceipt(rawReceipt);
    const csv = proofReceiptCsv(receipt);
    expect(csv).toContain('"status","released"');
    expect(csv).toContain('"contractor","contractor.testnet"');
    expect(csv).toContain('"commitment","sha256:');
    expect(csv).not.toContain("employer");
    expect(csv).not.toContain("employer.testnet");
  });

  it("rejects a receipt response that exposes an employer field", () => {
    expect(() => parseProofReceipt({ ...rawReceipt, employer: "employer.testnet" })).toThrow(/private employer field/i);
  });

  it("creates a share link with only milestone, network and commitment", () => {
    const url = new URL(proofReceiptShareUrl("https://proofpay.example", 9, "mainnet", rawReceipt.commitment));
    expect(url.pathname).toBe("/receipt");
    expect(url.searchParams.get("milestoneId")).toBe("9");
    expect(url.searchParams.get("network")).toBe("mainnet");
    expect(url.searchParams.get("commitment")).toBe(rawReceipt.commitment);
    expect(url.toString()).not.toContain("employer");
  });
});
