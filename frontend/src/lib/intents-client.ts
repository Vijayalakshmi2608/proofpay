export interface IntentAsset {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
}

export interface IntentAssetsResponse {
  provider: "near-intents-1click";
  quotesDefaultDry: true;
  sourceAssets: IntentAsset[];
  destinations: {
    ethereumUsdc: IntentAsset[];
    solanaSol: IntentAsset[];
    bitcoinBtc: IntentAsset[];
  };
}

export interface SettlementQuoteResponse {
  provider: "near-intents-1click";
  dry: true;
  sourceAsset: IntentAsset;
  targetAsset: IntentAsset;
  targetAddress: string;
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    signedIndicativeRate: string;
    signedMinimumRate: string;
    timeEstimateSeconds: number;
    under30SecondsEstimate: boolean;
    fees: { refundFee: string | null; withdrawFee: string | null };
    expiresAt: string | null;
  };
  signature: { verified: true; value: string; timestamp: string | number };
  deposit: { address: null; memo: null };
  guarantees: {
    signedQuoteVerified: true;
    executionGuaranteed: false;
    settlementTimeGuaranteed: false;
    note: string;
  };
}

export type SettlementQuoteRequest = { sourceAsset: string; targetAsset: string; targetAddress: string; amount: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string" ? data.message : isRecord(data) && typeof data.error === "string" ? data.error : `Request failed with HTTP ${response.status}.`;
    throw new Error(message.slice(0, 300));
  }
  if (!isRecord(data)) throw new Error("The 1Click service returned an invalid response.");
  return data as T;
}

export async function getIntentAssets(signal?: AbortSignal): Promise<IntentAssetsResponse> {
  return readJson<IntentAssetsResponse>(await fetch("/api/intents/assets", { headers: { accept: "application/json" }, cache: "no-store", signal }));
}

export async function requestDrySettlementQuote(input: SettlementQuoteRequest, signal?: AbortSignal): Promise<SettlementQuoteResponse> {
  const response = await readJson<SettlementQuoteResponse>(await fetch("/api/intents/quote", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...input, dry: true }),
    cache: "no-store",
    signal,
  }));
  if (response.provider !== "near-intents-1click" || response.dry !== true || response.signature?.verified !== true || response.deposit?.address !== null) {
    throw new Error("The 1Click response was not a verified, non-fundable dry quote.");
  }
  return response;
}
