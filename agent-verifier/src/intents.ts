import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { z } from "zod";
import { config } from "./config.js";
import { validateAccountId } from "./keyManager.js";

const API_ORIGIN = "https://1click.chaindefuser.com";
const ETH_NATIVE_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const NEAR_WRAP_ASSET_ID = "nep141:wrap.near";
const NEAR_USDC_ASSET_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR_USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ETH_NATIVE_USDC_ASSET_ID = `nep141:eth-${ETH_NATIVE_USDC}.omft.near`;
const SOL_NATIVE_ASSET_ID = "nep141:sol.omft.near";
const BTC_NATIVE_ASSET_ID = "nep141:btc.omft.near";
const MAX_API_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const QUOTE_DEADLINE_MS = 3 * 60_000;
const U128_MAX = (1n << 128n) - 1n;

const tokenSchema = z.object({
  assetId: z.string().min(1).max(256),
  decimals: z.number().int().min(0).max(36),
  blockchain: z.string().min(1).max(32),
  symbol: z.string().min(1).max(32),
  price: z.number().finite().nonnegative(),
  priceUpdatedAt: z.string().datetime(),
  contractAddress: z.string().max(256).optional(),
}).passthrough();

const quoteBodySchema = z.object({
  quote: z.object({
    amountIn: z.string().regex(/^\d+$/),
    amountInFormatted: z.string().min(1).max(100),
    amountInUsd: z.string().min(1).max(100),
    minAmountIn: z.string().regex(/^\d+$/),
    amountOut: z.string().regex(/^\d+$/),
    amountOutFormatted: z.string().min(1).max(100),
    amountOutUsd: z.string().min(1).max(100),
    minAmountOut: z.string().regex(/^\d+$/),
    timeEstimate: z.number().finite().nonnegative(),
    depositAddress: z.string().min(1).max(256).optional(),
    depositMemo: z.string().max(256).optional(),
    deadline: z.string().datetime().optional(),
    timeWhenInactive: z.string().datetime().optional(),
    refundFee: z.string().regex(/^\d+$/).optional(),
    withdrawFee: z.string().regex(/^\d+$/).optional(),
  }).passthrough(),
  signature: z.string().min(1).max(2_048),
  timestamp: z.union([z.string().min(1).max(80), z.number().finite()]),
}).passthrough();

export const settlementQuoteRequestSchema = z.object({
  sourceAsset: z.string().min(1).max(256),
  targetAsset: z.string().min(1).max(256),
  targetAddress: z.string().min(2).max(128),
  amount: z.string().regex(/^\d{1,38}$/),
  refundAddress: z.string().min(2).max(64).optional(),
  dry: z.boolean().default(true),
}).strict();

export type SettlementQuoteRequest = z.input<typeof settlementQuoteRequestSchema>;

export interface SupportedAsset {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
}

export interface SettlementQuote {
  provider: "near-intents-1click";
  dry: boolean;
  sourceAsset: SupportedAsset;
  targetAsset: SupportedAsset;
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
  deposit: { address: string | null; memo: string | null };
  guarantees: {
    signedQuoteVerified: true;
    executionGuaranteed: false;
    settlementTimeGuaranteed: false;
    note: string;
  };
}

export interface IntentsDependencies {
  fetchImpl?: typeof fetch;
  verifySignature?: (response: unknown) => boolean | Promise<boolean>;
  useTokenCache?: boolean;
  requestTimeoutMs?: number;
}

export class IntentsServiceError extends Error {
  constructor(readonly httpStatus: number, message: string) {
    super(message);
    this.name = "IntentsServiceError";
  }
}

let tokenCache: { expiresAt: number; tokens: SupportedAsset[] } | undefined;

function fetcher(deps: IntentsDependencies): typeof fetch {
  return deps.fetchImpl ?? fetch;
}

async function readJson(response: Response): Promise<unknown> {
  const statedLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(statedLength) && statedLength > MAX_API_BYTES) {
    throw new Error("1Click response exceeded the configured size limit");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_API_BYTES) {
    throw new Error("1Click response exceeded the configured size limit");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("1Click returned malformed JSON");
  }
}

function apiHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (config.NEAR_INTENTS_API_KEY) headers["X-API-Key"] = config.NEAR_INTENTS_API_KEY;
  return headers;
}

export async function getSupportedIntentAssets(
  deps: IntentsDependencies = {},
): Promise<SupportedAsset[]> {
  const useCache = deps.useTokenCache !== false && deps.fetchImpl === undefined;
  if (useCache && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.tokens;

  const response = await fetcher(deps)(`${API_ORIGIN}/v0/tokens`, {
    method: "GET",
    headers: apiHeaders(),
    signal: AbortSignal.timeout(deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`1Click token registry returned HTTP ${response.status}`);
  const parsed = z.array(tokenSchema).max(20_000).safeParse(await readJson(response));
  if (!parsed.success) throw new Error("1Click token registry did not match the supported schema");
  const tokens: SupportedAsset[] = parsed.data.map((token) => ({
    assetId: token.assetId,
    decimals: token.decimals,
    blockchain: token.blockchain.toLowerCase(),
    symbol: token.symbol.toUpperCase(),
    price: token.price,
    priceUpdatedAt: token.priceUpdatedAt,
    ...(token.contractAddress ? { contractAddress: token.contractAddress } : {}),
  }));
  if (useCache) tokenCache = { expiresAt: Date.now() + 30_000, tokens };
  return tokens;
}

export function isSupportedSourceAsset(token: SupportedAsset): boolean {
  return token.blockchain === "near" && (
    (token.assetId.toLowerCase() === NEAR_WRAP_ASSET_ID &&
      token.contractAddress?.toLowerCase() === "wrap.near" &&
      token.decimals === 24 && ["NEAR", "WNEAR"].includes(token.symbol)) ||
    (token.assetId.toLowerCase() === NEAR_USDC_ASSET_ID &&
      token.contractAddress?.toLowerCase() === NEAR_USDC_CONTRACT &&
      token.decimals === 6 && token.symbol === "USDC")
  );
}

export function isSupportedTargetAsset(token: SupportedAsset): boolean {
  return (
    (token.blockchain === "eth" && token.symbol === "USDC" && token.decimals === 6 &&
      token.assetId.toLowerCase() === ETH_NATIVE_USDC_ASSET_ID &&
      token.contractAddress?.toLowerCase() === ETH_NATIVE_USDC) ||
    (token.blockchain === "sol" && token.symbol === "SOL" && token.decimals === 9 &&
      token.assetId.toLowerCase() === SOL_NATIVE_ASSET_ID && token.contractAddress === undefined) ||
    (token.blockchain === "btc" && token.symbol === "BTC" && token.decimals === 8 &&
      token.assetId.toLowerCase() === BTC_NATIVE_ASSET_ID && token.contractAddress === undefined)
  );
}

function validateTargetAddress(blockchain: string, rawAddress: string): string {
  const address = rawAddress.trim();
  if (address !== rawAddress || /[\u0000-\u001f\u007f\s]/.test(address)) {
    throw new IntentsServiceError(400, "Target address contains whitespace or control characters");
  }
  const valid = blockchain === "eth"
    ? /^0x[a-fA-F0-9]{40}$/.test(address)
    : blockchain === "sol"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
      : blockchain === "btc"
        ? /^(bc1[ac-hj-np-z02-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address)
        : false;
  if (!valid) throw new IntentsServiceError(400, `Target address is not a valid ${blockchain} address`);
  return address;
}

function assertIntegerAmount(amount: string): bigint {
  const parsed = BigInt(amount);
  if (parsed <= 0n || parsed > U128_MAX) throw new IntentsServiceError(400, "Amount must be a positive U128 base-unit integer");
  return parsed;
}

function rateString(inputAmount: string, outputAmount: string, inputDecimals: number, outputDecimals: number): string {
  const input = BigInt(inputAmount);
  const output = BigInt(outputAmount);
  if (input <= 0n) throw new Error("Quote input amount must be positive");
  const precision = 12n;
  const scale = 10n ** precision;
  const numerator = output * (10n ** BigInt(inputDecimals)) * scale;
  const denominator = input * (10n ** BigInt(outputDecimals));
  const scaled = numerator / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(Number(precision), "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function validateProviderQuoteAmounts(quote: z.infer<typeof quoteBodySchema>["quote"]): void {
  const values = [quote.amountIn, quote.minAmountIn, quote.amountOut, quote.minAmountOut, quote.refundFee, quote.withdrawFee]
    .filter((value): value is string => value !== undefined)
    .map((value) => BigInt(value));
  if (values.some((value) => value > U128_MAX) || BigInt(quote.amountIn) <= 0n || BigInt(quote.minAmountIn) <= 0n || BigInt(quote.amountOut) <= 0n || BigInt(quote.minAmountOut) <= 0n || BigInt(quote.minAmountOut) > BigInt(quote.amountOut)) {
    throw new Error("1Click quote amounts are outside supported U128 bounds or violate minimum-output invariants");
  }
}

export async function getSettlementQuote(
  input: SettlementQuoteRequest,
  deps: IntentsDependencies = {},
): Promise<SettlementQuote> {
  const request = settlementQuoteRequestSchema.parse(input);
  if (request.dry === false && !config.INTENTS_ALLOW_FUNDABLE_QUOTES) {
    throw new IntentsServiceError(403, "Non-dry 1Click quotes are disabled; set INTENTS_ALLOW_FUNDABLE_QUOTES=true explicitly");
  }
  if (request.dry === false && config.NODE_ENV !== "production") {
    throw new IntentsServiceError(403, "Fundable 1Click quotes are only enabled in production configuration");
  }
  const amount = assertIntegerAmount(request.amount);
  const tokens = await getSupportedIntentAssets(deps);
  const source = tokens.find((token) => token.assetId === request.sourceAsset);
  const target = tokens.find((token) => token.assetId === request.targetAsset);
  if (!source || !isSupportedSourceAsset(source)) {
    throw new IntentsServiceError(400, "Source asset must be native NEAR, wrapped NEAR, or USDC on NEAR in the live token registry");
  }
  if (!target || !isSupportedTargetAsset(target)) {
    throw new IntentsServiceError(400, "Target asset must be native Ethereum USDC, Solana SOL, or Bitcoin BTC in the live token registry");
  }
  const targetAddress = validateTargetAddress(target.blockchain, request.targetAddress);
  const refundAddress = request.refundAddress ?? config.NEAR_INTENTS_REFUND_ADDRESS;
  if (!refundAddress) throw new IntentsServiceError(503, "NEAR_INTENTS_REFUND_ADDRESS is required for NEAR-origin quotes");
  try {
    validateAccountId(refundAddress, "NEAR Intents refund account");
  } catch {
    throw new IntentsServiceError(400, "Refund address must be a valid NEAR account ID for NEAR-origin quotes");
  }

  const body = {
    dry: request.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: config.INTENTS_SLIPPAGE_BPS,
    originAsset: source.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: target.assetId,
    amount: amount.toString(),
    recipient: targetAddress,
    recipientType: "DESTINATION_CHAIN",
    refundTo: refundAddress,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + QUOTE_DEADLINE_MS).toISOString(),
  };
  const response = await fetcher(deps)(`${API_ORIGIN}/v0/quote`, {
    method: "POST",
    headers: apiHeaders(true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`1Click quote request returned HTTP ${response.status}`);
  const raw = await readJson(response);
  const parsed = quoteBodySchema.safeParse(raw);
  if (!parsed.success) throw new Error("1Click quote did not match the documented response schema");

  let signatureVerified = false;
  try {
    signatureVerified = await (deps.verifySignature ?? ((quote) => verifyQuoteSignature(quote as never)))(raw);
  } catch {
    signatureVerified = false;
  }
  if (!signatureVerified) throw new Error("1Click quote signature verification failed");

  const quote = parsed.data.quote;
  validateProviderQuoteAmounts(quote);
  return {
    provider: "near-intents-1click",
    dry: request.dry,
    sourceAsset: source,
    targetAsset: target,
    targetAddress,
    quote: {
      amountIn: quote.amountIn,
      amountInFormatted: quote.amountInFormatted,
      amountInUsd: quote.amountInUsd,
      minAmountIn: quote.minAmountIn,
      amountOut: quote.amountOut,
      amountOutFormatted: quote.amountOutFormatted,
      amountOutUsd: quote.amountOutUsd,
      minAmountOut: quote.minAmountOut,
      signedIndicativeRate: rateString(quote.amountIn, quote.amountOut, source.decimals, target.decimals),
      signedMinimumRate: rateString(quote.amountIn, quote.minAmountOut, source.decimals, target.decimals),
      timeEstimateSeconds: quote.timeEstimate,
      under30SecondsEstimate: quote.timeEstimate < 30,
      fees: { refundFee: quote.refundFee ?? null, withdrawFee: quote.withdrawFee ?? null },
      expiresAt: quote.deadline ?? null,
    },
    signature: {
      verified: true,
      value: parsed.data.signature,
      timestamp: parsed.data.timestamp,
    },
    deposit: {
      address: request.dry ? null : quote.depositAddress ?? null,
      memo: request.dry ? null : quote.depositMemo ?? null,
    },
    guarantees: {
      signedQuoteVerified: true,
      executionGuaranteed: false,
      settlementTimeGuaranteed: false,
      note: "The provider-signed minAmountOut is a quote bound, not a promise that execution will complete. timeEstimate is an estimate after the source deposit confirms, not a sub-30-second SLA. Dry quotes cannot be funded.",
    },
  };
}
