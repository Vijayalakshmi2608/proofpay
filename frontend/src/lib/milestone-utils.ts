import type { AssetKind, OnChainMilestone } from "./proofpay-types";

const YOCTO_PER_NEAR = 10n ** 24n;
const KNOWN_NEAR_USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export interface MilestoneAssetDisplay {
  symbol: string;
  decimals: number | null;
  assetId: string;
}

export function formatUnits(value: string, decimals: number, maxFractionDigits = 6): string {
  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return "—";
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  if (maxFractionDigits <= 0 || decimals === 0) return whole.toLocaleString("en-US");
  const fraction = (raw % scale).toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString("en-US")}.${fraction}` : whole.toLocaleString("en-US");
}

export function formatNear(yocto: string, maxFractionDigits = 4): string {
  return formatUnits(yocto, 24, maxFractionDigits);
}

export function getMilestoneAssetDisplay(
  milestone: Pick<OnChainMilestone, "asset_id" | "asset_kind">,
  escrowContractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() ?? "",
  usdcContractId = process.env.NEXT_PUBLIC_NEAR_USDC_CONTRACT?.trim() || KNOWN_NEAR_USDC_CONTRACT,
): MilestoneAssetDisplay {
  if (milestone.asset_kind === "native_near" || (escrowContractId && milestone.asset_id.toLowerCase() === escrowContractId.toLowerCase())) {
    return { symbol: "NEAR", decimals: 24, assetId: milestone.asset_id };
  }
  if (milestone.asset_id.toLowerCase() === usdcContractId.toLowerCase()) {
    return { symbol: "USDC", decimals: 6, assetId: milestone.asset_id };
  }
  return { symbol: milestone.asset_id.length > 18 ? `${milestone.asset_id.slice(0, 8)}…${milestone.asset_id.slice(-6)}` : milestone.asset_id, decimals: null, assetId: milestone.asset_id };
}

export function formatAssetAmount(value: string, asset: MilestoneAssetDisplay, maxFractionDigits = 4): string {
  if (asset.decimals === null) return `${value} base units`;
  return formatUnits(value, asset.decimals, maxFractionDigits);
}

export function getMilestoneTitle(milestone: Pick<OnChainMilestone, "id" | "proof_requirements">): string {
  try {
    const parsed: unknown = JSON.parse(milestone.proof_requirements);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const title = (parsed as Record<string, unknown>).title;
      if (typeof title === "string" && title.trim()) return title.trim().slice(0, 160);
    }
  } catch {
    // Older milestones may store free-form proof requirements rather than structured JSON.
  }
  return `Milestone #${milestone.id}`;
}

export function getChecklist(milestone: Pick<OnChainMilestone, "proof_requirements">): string[] {
  try {
    const parsed: unknown = JSON.parse(milestone.proof_requirements);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const phrases = (parsed as Record<string, unknown>).requiredPhrases;
      if (Array.isArray(phrases)) return phrases.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Ignore free-form legacy criteria.
  }
  return [];
}

export function getMilestoneBadge(milestone: Pick<OnChainMilestone, "status" | "proof_hash">): { label: string; className: string } {
  if (milestone.status === "released") return { label: "Payout Released", className: "border-proof/20 bg-proof/[0.08] text-proof" };
  if (milestone.status === "attested") return { label: "AI Attested", className: "border-proof/20 bg-proof/[0.08] text-proof" };
  if (milestone.status === "payout_pending") return { label: "Payout Pending", className: "border-amber-300/20 bg-amber-300/[0.06] text-amber-100" };
  if (milestone.status === "disputed") return { label: "Disputed", className: "border-red-300/20 bg-red-300/[0.06] text-red-200" };
  if (milestone.status === "refunded") return { label: "Refunded", className: "border-slate-500/20 bg-white/[0.04] text-slate-300" };
  if (milestone.proof_hash) return { label: "Proof Submitted", className: "border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100" };
  return { label: "Escrow Locked", className: "border-white/[0.09] bg-white/[0.04] text-slate-300" };
}

export function getFlowNode(status: string, proofHash: string): number {
  if (status === "released" || status === "payout_pending") return 3;
  if (status === "attested" || status === "disputed" || status === "refunded") return 2;
  if (proofHash) return 1;
  return 0;
}

export function isValidProofUrl(raw: string): boolean {
  const value = raw.trim();
  return value.length > 0 && value.length <= 2_048 && !/\s/.test(value) && (value.startsWith("https://") || value.startsWith("ipfs://") || value.startsWith("ar://"));
}

export function shorten(value: string, start = 9, end = 6): string {
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function isAutoReleaseEligible(milestone: Pick<OnChainMilestone, "amount" | "auto_release_limit">): boolean {
  try {
    return BigInt(milestone.auto_release_limit) > 0n && BigInt(milestone.amount) <= BigInt(milestone.auto_release_limit);
  } catch {
    return false;
  }
}

export function nearBalanceFromYocto(yocto: string): string {
  return formatUnits(yocto, Number(YOCTO_PER_NEAR.toString().length - 1), 4);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
