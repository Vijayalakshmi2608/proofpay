import { describe, expect, it } from "vitest";

describe("ProofPay dashboard source invariants", () => {
  it("uses NEAR RPC for live state and labels illustrative demo data", async () => {
    const fs = await import("node:fs/promises");
    const page = await fs.readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page).toContain("DEMO · ILLUSTRATIVE STATE");
    expect(page).toContain('listMilestones(contractId, network');
    expect(page).toContain("12_000");
    expect(page).toContain("Grouped by funding asset");
    expect(page).toContain("CreateMilestoneModal");
    expect(page).toContain("ContractorView");
    expect(page).toContain("EscrowFlowVisualizer");
    expect(page).toContain("SolverQuotes");
    expect(page).toContain("AttackSandbox");
    expect(page).toContain("SelectiveDisclosureReceipt");
    expect(page).toContain("The contract controls escrow state");
    expect(page).not.toContain("Sum of active milestone amounts · no USD conversion");
  });
});
