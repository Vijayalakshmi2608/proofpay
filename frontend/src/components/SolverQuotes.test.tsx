// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntentAssets, requestDrySettlementQuote } from "@/lib/intents-client";
import type { OnChainMilestone } from "@/lib/proofpay-types";
import { SolverQuotes } from "./SolverQuotes";

vi.mock("@/lib/intents-client", () => ({ getIntentAssets: vi.fn(), requestDrySettlementQuote: vi.fn() }));

const assets = {
  provider: "near-intents-1click" as const,
  quotesDefaultDry: true as const,
  sourceAssets: [
    { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "WNEAR", price: 5, priceUpdatedAt: "2026-01-01T00:00:00.000Z", contractAddress: "wrap.near" },
  ],
  destinations: {
    ethereumUsdc: [{ assetId: "nep141:eth-usdc.omft.near", decimals: 6, blockchain: "eth", symbol: "USDC", price: 1, priceUpdatedAt: "2026-01-01T00:00:00.000Z" }],
    solanaSol: [{ assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 100, priceUpdatedAt: "2026-01-01T00:00:00.000Z" }],
    bitcoinBtc: [{ assetId: "nep141:btc.omft.near", decimals: 8, blockchain: "btc", symbol: "BTC", price: 60_000, priceUpdatedAt: "2026-01-01T00:00:00.000Z" }],
  },
};
const mockQuote = {
  provider: "near-intents-1click" as const, dry: true as const, sourceAsset: assets.sourceAssets[0], targetAsset: assets.destinations.solanaSol[0], targetAddress: "11111111111111111111111111111111",
  quote: { amountIn: "1000000000000000000000000", amountInFormatted: "1 WNEAR", amountInUsd: "5", minAmountIn: "1", amountOut: "50000000", amountOutFormatted: "0.05 SOL", amountOutUsd: "5", minAmountOut: "49000000", signedIndicativeRate: "0.05", signedMinimumRate: "0.049", timeEstimateSeconds: 18, under30SecondsEstimate: true, fees: { refundFee: null, withdrawFee: null }, expiresAt: null },
  signature: { verified: true as const, value: "sig", timestamp: "now" }, deposit: { address: null, memo: null },
  guarantees: { signedQuoteVerified: true as const, executionGuaranteed: false as const, settlementTimeGuaranteed: false as const, note: "Quote only" },
};
const milestone: OnChainMilestone = {
  id: 7, employer: "employer.testnet", contractor: "contractor.testnet", amount: "1000000000000000000000000", deadline: "1790000000000000000", proof_hash: "", proof_url: "", proof_requirements: "{}", status: "pending", auto_release_limit: "0", asset_id: "proofpay.testnet", asset_kind: "native_near", destination_chain: "Ethereum", payout_recipient: "0x1111111111111111111111111111111111111111", attestation: null,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SolverQuotes", () => {
  it("offers all three supported destinations and requests only a verified dry quote", async () => {
    vi.mocked(getIntentAssets).mockResolvedValue(assets);
    vi.mocked(requestDrySettlementQuote).mockResolvedValue(mockQuote);
    render(<SolverQuotes milestone={milestone} />);
    await screen.findByText("Native BTC");
    fireEvent.click(screen.getByRole("button", { name: /Solana/ }));
    fireEvent.change(screen.getByLabelText("Solana recipient address"), { target: { value: "11111111111111111111111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Get dry quote" }));
    await waitFor(() => expect(requestDrySettlementQuote).toHaveBeenCalledWith({ sourceAsset: "nep141:wrap.near", targetAsset: "nep141:sol.omft.near", targetAddress: "11111111111111111111111111111111", amount: milestone.amount }, expect.any(AbortSignal)));
    const quoteCard = await screen.findByRole("status");
    expect(quoteCard.textContent).toContain("0.05 SOL");
    expect(screen.getByText(/no deposit address and cannot be funded/i)).toBeTruthy();
  });
});
