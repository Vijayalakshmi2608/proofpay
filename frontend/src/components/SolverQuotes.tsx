import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, LoaderCircle, RefreshCw } from "lucide-react";
import { getIntentAssets, requestDrySettlementQuote, type IntentAsset, type SettlementQuoteResponse } from "@/lib/intents-client";
import { formatUnits, getMilestoneAssetDisplay } from "@/lib/milestone-utils";
import type { OnChainMilestone } from "@/lib/proofpay-types";
import { Button } from "@/components/ui/button";

type DestinationKey = "ethereumUsdc" | "solanaSol" | "bitcoinBtc";
const DESTINATIONS: Array<{ key: DestinationKey; label: string; symbol: string; chain: string }> = [
  { key: "ethereumUsdc", label: "Ethereum", symbol: "USDC", chain: "ETH" },
  { key: "solanaSol", label: "Solana", symbol: "SOL", chain: "SOL" },
  { key: "bitcoinBtc", label: "Bitcoin", symbol: "BTC", chain: "BTC" },
];

function matchingSource(assets: IntentAsset[], milestone: OnChainMilestone): IntentAsset | undefined {
  const display = getMilestoneAssetDisplay(milestone);
  if (display.symbol === "NEAR") return assets.find((asset) => asset.blockchain.toLowerCase() === "near" && ["NEAR", "WNEAR"].includes(asset.symbol.toUpperCase()));
  if (display.symbol === "USDC") return assets.find((asset) => asset.blockchain.toLowerCase() === "near" && asset.symbol.toUpperCase() === "USDC" &&
    (asset.contractAddress?.toLowerCase() === milestone.asset_id.toLowerCase() || asset.assetId.toLowerCase().endsWith(milestone.asset_id.toLowerCase())));
  return undefined;
}

function defaultTarget(destination: DestinationKey, milestone: OnChainMilestone): string {
  return milestone.destination_chain.toLowerCase() === DESTINATIONS.find((item) => item.key === destination)?.label.toLowerCase()
    ? milestone.payout_recipient
    : "";
}

export function SolverQuotes({ milestone }: { milestone: OnChainMilestone }) {
  const [destination, setDestination] = useState<DestinationKey>("ethereumUsdc");
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof getIntentAssets>> | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [targetAddress, setTargetAddress] = useState(() => defaultTarget("ethereumUsdc", milestone));
  const [quote, setQuote] = useState<SettlementQuoteResponse | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingAssets(true);
    getIntentAssets(controller.signal).then(setAssets).catch((failure: unknown) => {
      if (!controller.signal.aborted) setAssetError(failure instanceof Error ? failure.message.slice(0, 180) : "The live asset list is unavailable.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingAssets(false); });
    return () => controller.abort();
  }, []);

  const sourceAsset = useMemo(() => assets ? matchingSource(assets.sourceAssets, milestone) : undefined, [assets, milestone]);
  const destinationAssets = assets?.destinations[destination] ?? [];
  const targetAsset = destinationAssets[0];
  const destinationMeta = DESTINATIONS.find((item) => item.key === destination)!;

  async function fetchQuote() {
    setError(null);
    setQuote(null);
    if (!sourceAsset) { setError("A supported source asset could not be matched to this milestone."); return; }
    if (!targetAsset) { setError(`The live registry has no supported ${destinationMeta.chain} ${destinationMeta.symbol} destination.`); return; }
    if (!targetAddress.trim()) { setError(`Enter a ${destinationMeta.label} recipient address to request a dry quote.`); return; }
    setQuoting(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 13_000);
    try {
      const result = await requestDrySettlementQuote({ sourceAsset: sourceAsset.assetId, targetAsset: targetAsset.assetId, targetAddress: targetAddress.trim(), amount: milestone.amount }, controller.signal);
      if (result.dry !== true || result.deposit.address !== null || result.signature.verified !== true) throw new Error("Quote failed the verified dry-only safety checks.");
      setQuote(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.slice(0, 220) : "The live 1Click quote request failed.");
    } finally {
      window.clearTimeout(timeout);
      setQuoting(false);
    }
  }

  return (
    <section aria-labelledby="solver-quotes-title" className="glass-panel rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ArrowLeftRight size={14} className="text-proof" /><h3 id="solver-quotes-title" className="text-xs font-semibold text-white">Cross-chain solver quote</h3></div><p className="mt-1 text-[9px] text-slate-500">Live NEAR Intents 1Click · dry preview only · no deposit address or transfer</p></div><Button variant="secondary" onClick={fetchQuote} disabled={quoting || loadingAssets}><RefreshCw size={12} className={quoting ? "animate-spin" : ""} />{quoting ? "Requesting…" : "Get dry quote"}</Button></div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Payout destination">
        {DESTINATIONS.map((item) => <button key={item.key} type="button" aria-pressed={destination === item.key} onClick={() => { setDestination(item.key); setTargetAddress(defaultTarget(item.key, milestone)); setQuote(null); setError(null); }} className={`rounded-lg border px-3 py-2 text-left transition ${destination === item.key ? "border-proof/30 bg-proof/[0.06] text-white" : "border-white/[0.07] bg-white/[0.015] text-slate-400 hover:border-white/15"}`}><span className="block text-[10px] font-medium">{item.label}</span><span className="mt-0.5 block font-mono text-[8px] text-slate-500">Native {item.symbol}</span></button>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-[8px] text-slate-500">{destinationMeta.label} recipient address<input value={targetAddress} onChange={(event) => setTargetAddress(event.target.value)} maxLength={128} autoComplete="off" spellCheck={false} placeholder={destinationMeta.symbol === "USDC" ? "0x…" : destinationMeta.symbol === "SOL" ? "Solana address" : "bc1…"} className="mt-1 h-9 w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 font-mono text-[10px] text-white placeholder:text-slate-700 focus:border-proof/30 focus:outline-none" /></label>
        <div className="text-right text-[8px] text-slate-500">Source <span className="font-mono text-slate-300">{sourceAsset?.symbol ?? (loadingAssets ? "loading…" : "unsupported")}</span><span className="mx-1 text-slate-700">·</span>Milestone amount in exact base units</div>
      </div>
      {assetError && <p role="status" className="mt-3 rounded-lg border border-amber-200/10 bg-amber-200/[0.025] p-2 text-[9px] text-amber-100/80">Live token registry unavailable: {assetError}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-300/15 bg-red-300/[0.035] p-2 text-[9px] text-red-100">Quote unavailable: {error}</p>}
      {quoting && <p className="mt-3 flex items-center gap-2 text-[9px] text-slate-400"><LoaderCircle size={12} className="animate-spin text-proof" />Requesting a signature-verified dry quote…</p>}
      {quote && <div role="status" className="mt-4 rounded-lg border border-proof/15 bg-proof/[0.035] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="mono-label text-[8px] text-proof">SIGNED QUOTE · VERIFIED</p><p className="mt-1 font-mono text-sm text-white">{quote.quote.amountOutFormatted}</p><p className="mt-1 text-[8px] text-slate-500">Provider minimum output: {formatUnits(quote.quote.minAmountOut, quote.targetAsset.decimals)} {quote.targetAsset.symbol}</p></div><span className="rounded border border-white/[0.08] px-2 py-1 font-mono text-[8px] text-slate-300">{quote.quote.timeEstimateSeconds}s estimate</span></div><p className="mt-2 break-all font-mono text-[8px] text-slate-500">Rate {quote.quote.signedIndicativeRate} {quote.targetAsset.symbol}/{quote.sourceAsset.symbol}<span className="mx-1 text-slate-700">·</span>Expires {quote.quote.expiresAt ?? "not specified"}</p><p className="mt-2 text-[8px] text-slate-500">Provider fees (base units) · refund: {quote.quote.fees.refundFee ?? "not supplied"} · withdraw: {quote.quote.fees.withdrawFee ?? "not supplied"}</p><p className="mt-2 text-[8px] leading-relaxed text-amber-100/70">A provider quote is not a payout or settlement guarantee. This dry quote has no deposit address and cannot be funded.</p></div>}
    </section>
  );
}
