import { describe, expect, it, vi } from "vitest";
import { getSettlementQuote, type SupportedAsset } from "./intents.js";

const updated = "2026-11-01T09:30:00.000Z";
const ethUsdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const nearUsdcContract = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const assets: SupportedAsset[] = [
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 6.5, priceUpdatedAt: updated, contractAddress: "wrap.near" },
  { assetId: `nep141:${nearUsdcContract}`, decimals: 6, blockchain: "near", symbol: "USDC", price: 1, priceUpdatedAt: updated, contractAddress: nearUsdcContract },
  { assetId: `nep141:eth-${ethUsdc}.omft.near`, decimals: 6, blockchain: "eth", symbol: "USDC", price: 1, priceUpdatedAt: updated, contractAddress: ethUsdc },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 160, priceUpdatedAt: updated },
  { assetId: "nep141:btc.omft.near", decimals: 8, blockchain: "btc", symbol: "BTC", price: 90_000, priceUpdatedAt: updated },
  { assetId: "nep141:other.near", decimals: 18, blockchain: "near", symbol: "OTHER", price: 2, priceUpdatedAt: updated },
  { assetId: "nep141:fake-wrap.near", decimals: 24, blockchain: "near", symbol: "WNEAR", price: 6.5, priceUpdatedAt: updated, contractAddress: "fake-wrap.near" },
  { assetId: "nep141:fake-usdc.near", decimals: 6, blockchain: "near", symbol: "USDC", price: 1, priceUpdatedAt: updated, contractAddress: "fake-usdc.near" },
  { assetId: `nep141:eth-0x${"1".repeat(40)}.omft.near`, decimals: 6, blockchain: "eth", symbol: "USDC", price: 1, priceUpdatedAt: updated, contractAddress: `0x${"1".repeat(40)}` },
  { assetId: "nep141:sol-fake.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 160, priceUpdatedAt: updated },
  { assetId: "nep141:btc-fake.omft.near", decimals: 8, blockchain: "btc", symbol: "BTC", price: 90_000, priceUpdatedAt: updated },
];

const signedQuote = {
  quote: {
    amountIn: "1000000000000000000000000",
    amountInFormatted: "1",
    amountInUsd: "6.50",
    minAmountIn: "1000000000000000000000000",
    amountOut: "1000000",
    amountOutFormatted: "1",
    amountOutUsd: "6.49",
    minAmountOut: "990000",
    timeEstimate: 27,
    depositAddress: "dry-only-never-funded",
    depositMemo: "dry-only-memo",
    deadline: "2026-11-01T09:31:00.000Z",
    refundFee: "10",
    withdrawFee: "20",
  },
  signature: "provider-signature",
  timestamp: "2026-11-01T09:30:00.000Z",
};

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v0/tokens")) {
      return new Response(JSON.stringify(assets), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v0/quote")) {
      return new Response(JSON.stringify(signedQuote), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("getSettlementQuote", () => {
  it("formats a verified dry NEAR-to-Ethereum-USDC quote without exposing a fundable deposit address", async () => {
    const { fetchImpl, calls } = mockFetch();
    const result = await getSettlementQuote({
      sourceAsset: assets[0]!.assetId,
      targetAsset: assets[2]!.assetId,
      targetAddress: `0x${"1".repeat(40)}`,
      amount: "1000000000000000000000000",
      refundAddress: "proofpay.near",
    }, { fetchImpl, verifySignature: () => true, useTokenCache: false });

    expect(result.provider).toBe("near-intents-1click");
    expect(result.dry).toBe(true);
    expect(result.quote.signedIndicativeRate).toBe("1");
    expect(result.quote.signedMinimumRate).toBe("0.99");
    expect(result.quote.timeEstimateSeconds).toBe(27);
    expect(result.quote.under30SecondsEstimate).toBe(true);
    expect(result.deposit).toEqual({ address: null, memo: null });
    expect(result.guarantees.executionGuaranteed).toBe(false);
    expect(result.signature.verified).toBe(true);
    expect(calls).toHaveLength(2);
    const requestBody = JSON.parse(String(calls[1]?.init?.body)) as { dry: boolean; originAsset: string; destinationAsset: string; deadline: string };
    expect(requestBody.dry).toBe(true);
    expect(requestBody.originAsset).toBe(assets[0]!.assetId);
    expect(requestBody.destinationAsset).toBe(assets[2]!.assetId);
    expect(Date.parse(requestBody.deadline)).toBeGreaterThan(Date.now());
    expect(Date.parse(requestBody.deadline)).toBeLessThan(Date.now() + 4 * 60_000);
  });

  it("accepts native SOL and BTC destinations only when their registry entries are native assets", async () => {
    for (const target of [assets[3]!, assets[4]!]) {
      const { fetchImpl } = mockFetch();
      await expect(getSettlementQuote({
        sourceAsset: assets[1]!.assetId,
        targetAsset: target.assetId,
        targetAddress: target.blockchain === "sol" ? "1".repeat(32) : `bc1q${"a".repeat(38)}`,
        amount: "1000000",
        refundAddress: "proofpay.near",
      }, { fetchImpl, verifySignature: () => true, useTokenCache: false })).resolves.toMatchObject({
        targetAsset: { assetId: target.assetId },
        dry: true,
      });
    }
  });

  it("rejects unsupported source assets and provider responses with invalid signatures", async () => {
    const { fetchImpl } = mockFetch();
    await expect(getSettlementQuote({
      sourceAsset: assets[5]!.assetId,
      targetAsset: assets[2]!.assetId,
      targetAddress: `0x${"1".repeat(40)}`,
      amount: "1000000",
      refundAddress: "proofpay.near",
    }, { fetchImpl, verifySignature: () => true, useTokenCache: false })).rejects.toThrow("Source asset must be");

    const badSignatureFetch = mockFetch();
    await expect(getSettlementQuote({
      sourceAsset: assets[0]!.assetId,
      targetAsset: assets[2]!.assetId,
      targetAddress: `0x${"1".repeat(40)}`,
      amount: "1000000000000000000000000",
      refundAddress: "proofpay.near",
    }, { fetchImpl: badSignatureFetch.fetchImpl, verifySignature: () => false, useTokenCache: false })).rejects.toThrow("signature verification failed");
  });

  it("rejects same-symbol tokens that do not match canonical registry identities", async () => {
    for (const spoofSource of [assets[6]!, assets[7]!]) {
      const { fetchImpl } = mockFetch();
      await expect(getSettlementQuote({
        sourceAsset: spoofSource.assetId,
        targetAsset: assets[2]!.assetId,
        targetAddress: `0x${"1".repeat(40)}`,
        amount: "1000000",
        refundAddress: "proofpay.near",
      }, { fetchImpl, verifySignature: () => true, useTokenCache: false })).rejects.toThrow("Source asset must be");
    }

    for (const spoofTarget of [assets[8]!, assets[9]!, assets[10]!]) {
      const { fetchImpl } = mockFetch();
      await expect(getSettlementQuote({
        sourceAsset: assets[0]!.assetId,
        targetAsset: spoofTarget.assetId,
        targetAddress: spoofTarget.blockchain === "eth" ? `0x${"1".repeat(40)}` : spoofTarget.blockchain === "sol" ? "1".repeat(32) : `bc1q${"a".repeat(38)}`,
        amount: "1000000",
        refundAddress: "proofpay.near",
      }, { fetchImpl, verifySignature: () => true, useTokenCache: false })).rejects.toThrow("Target asset must be");
    }
  });
});
