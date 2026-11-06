import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, ArrowDownToLine, ArrowRight, BadgeCheck, Check, CircleHelp, ExternalLink, LoaderCircle, LockKeyhole, Quote, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkFunctionCallPermission, getVerifierConfiguration, type FunctionCallPermissionCheck } from "@/lib/near-rpc";
import { formatAssetAmount, formatUnits, getFlowNode, getMilestoneAssetDisplay, sha256Hex, shorten } from "@/lib/milestone-utils";
import { getIntentAssets, requestDrySettlementQuote, type IntentAsset, type IntentAssetsResponse, type SettlementQuoteResponse } from "@/lib/intents-client";
import type { DeliverableVerificationResponse, NearNetwork, OnChainMilestone } from "@/lib/proofpay-types";

const FLOW_NODES = ["Employer Vault", "TEE AI Inspection", "Policy Guard Check", "Cross-Chain Intent Payout"] as const;

function sourceForMilestone(milestone: OnChainMilestone, assets: IntentAssetsResponse, contractId: string): IntentAsset | undefined {
  if (milestone.asset_id.toLowerCase() !== contractId.toLowerCase()) {
    return assets.sourceAssets.find((token) => token.contractAddress?.toLowerCase() === milestone.asset_id.toLowerCase());
  }
  return assets.sourceAssets.find((token) => token.assetId === "nep141:wrap.near");
}

function targetForMilestone(milestone: OnChainMilestone, assets: IntentAssetsResponse): IntentAsset | undefined {
  const chain = milestone.destination_chain.toLowerCase();
  if (chain === "ethereum" || chain === "eth") return assets.destinations.ethereumUsdc[0];
  if (chain === "solana" || chain === "sol") return assets.destinations.solanaSol[0];
  if (chain === "bitcoin" || chain === "btc") return assets.destinations.bitcoinBtc[0];
  return undefined;
}

function deadlineDisplay(raw: string | number): string {
  try {
    const nanos = BigInt(raw);
    const date = new Date(Number(nanos / 1_000_000n));
    return Number.isNaN(date.getTime()) ? String(raw) : date.toLocaleString();
  } catch {
    return String(raw);
  }
}

function explorerUrl(network: NearNetwork, txHash: string): string {
  return `https://explorer.${network}.near.org/transactions/${encodeURIComponent(txHash)}`;
}

export function EscrowFlowVisualizer({
  milestone,
  network,
  verifierPreview,
}: {
  milestone: OnChainMilestone;
  network: NearNetwork;
  verifierPreview: DeliverableVerificationResponse | null;
}) {
  const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() ?? "";
  const activeNode = getFlowNode(milestone.status, milestone.proof_hash);
  const sourceDisplay = getMilestoneAssetDisplay(milestone, contractId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [permission, setPermission] = useState<FunctionCallPermissionCheck | null>(null);
  const [verifierAccount, setVerifierAccount] = useState<string | null>(null);
  const [keyFingerprint, setKeyFingerprint] = useState<string | null>(null);
  const [configuredKeyMatches, setConfiguredKeyMatches] = useState<boolean | null>(null);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionCheckedFor, setPermissionCheckedFor] = useState<string | null>(null);
  const [intentAssets, setIntentAssets] = useState<IntentAssetsResponse | null>(null);
  const [quote, setQuote] = useState<SettlementQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const attestation = milestone.attestation;
  const permissionRequestId = attestation?.verifier_key && contractId ? `${network}|${contractId}|${attestation.verifier_key}` : null;
  const currentPermission = permissionRequestId && permissionCheckedFor === permissionRequestId ? permission : null;
  const currentVerifierAccount = permissionRequestId && permissionCheckedFor === permissionRequestId ? verifierAccount : null;
  const currentKeyFingerprint = permissionRequestId && permissionCheckedFor === permissionRequestId ? keyFingerprint : null;
  const currentConfiguredKeyMatches = permissionRequestId && permissionCheckedFor === permissionRequestId ? configuredKeyMatches : null;
  const permissionLoadingForCurrentKey = permissionRequestId !== null && (permissionLoading || permissionCheckedFor !== permissionRequestId);
  const autoOpenedToken = useRef<string | null>(null);
  useEffect(() => {
    const token = attestation
      ? `${milestone.id}:${attestation.timestamp}:${attestation.reasoning_hash}`
      : verifierPreview
        ? `${milestone.id}:${verifierPreview.signedPayload.createdAt}`
        : null;
    if (token && autoOpenedToken.current !== token) {
      autoOpenedToken.current = token;
      setDrawerOpen(true);
    }
  }, [milestone.id, attestation?.timestamp, attestation?.reasoning_hash, verifierPreview?.signedPayload.createdAt]);

  useEffect(() => {
    let active = true;
    setPermission(null);
    setVerifierAccount(null);
    setKeyFingerprint(null);
    setConfiguredKeyMatches(null);
    setPermissionCheckedFor(null);
    if (!attestation?.verifier_key || !contractId) {
      setPermissionLoading(false);
      return () => { active = false; };
    }
    const requestId = `${network}|${contractId}|${attestation.verifier_key}`;
    setPermissionLoading(true);
    void (async () => {
      try {
        const config = await getVerifierConfiguration(contractId, network);
        const matches = config.publicKey === attestation.verifier_key;
        const [scope, digest] = await Promise.all([
          checkFunctionCallPermission(config.accountId, attestation.verifier_key, contractId, network),
          sha256Hex(attestation.verifier_key),
        ]);
        if (!active) return;
        setVerifierAccount(config.accountId);
        setConfiguredKeyMatches(matches);
        setPermission(scope);
        setKeyFingerprint(`sha256:${digest}`);
        setPermissionCheckedFor(requestId);
      } catch (error) {
        if (!active) return;
        setPermission({ verified: false, state: "unavailable", receiverId: null, methodNames: [], allowanceYocto: null, reason: error instanceof Error ? error.message.slice(0, 240) : "Key permission could not be verified." });
        setPermissionCheckedFor(requestId);
      } finally {
        if (active) setPermissionLoading(false);
      }
    })();
    return () => { active = false; };
  }, [attestation?.verifier_key, contractId, network]);

  const requestQuote = useCallback(async () => {
    setQuoteError(null);
    setQuote(null);
    setQuoteLoading(true);
    try {
      const assets = intentAssets ?? await getIntentAssets(AbortSignal.timeout(12_000));
      setIntentAssets(assets);
      const sourceAsset = sourceForMilestone(milestone, assets, contractId);
      const targetAsset = targetForMilestone(milestone, assets);
      if (!sourceAsset) throw new Error("The milestone’s funded token does not match a supported NEAR/USDC source asset in the live registry.");
      if (!targetAsset) throw new Error("The requested destination token is not available in the current 1Click registry.");
      if (!milestone.payout_recipient) throw new Error("The milestone does not contain a destination address.");
      const result = await requestDrySettlementQuote({
        sourceAsset: sourceAsset.assetId,
        targetAsset: targetAsset.assetId,
        targetAddress: milestone.payout_recipient,
        amount: milestone.amount,
      }, AbortSignal.timeout(18_000));
      setQuote(result);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : "A signed dry quote is currently unavailable.");
    } finally {
      setQuoteLoading(false);
    }
  }, [contractId, intentAssets, milestone,]);

  const chainPayload = useMemo(() => attestation ? {
    milestone_id: attestation.milestone_id,
    verifier_key: attestation.verifier_key,
    result: attestation.result,
    reasoning_hash: attestation.reasoning_hash,
    timestamp: attestation.timestamp,
  } : null, [attestation]);

  const attackSimulation = () => toast.error("Blocked by Function-Call Policy", {
    description: "Simulation only. No wallet signature, transaction, or network broadcast was created.",
  });

  return (
    <section className="glass-panel rounded-xl p-4 sm:p-5" aria-label="Escrow flow visualizer">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-proof/15 bg-proof/[0.05] text-proof"><ArrowDownToLine size={14} /></span><h2 className="text-xs font-semibold text-white">Milestone lifecycle</h2></div><p className="mt-1.5 text-[9px] text-slate-500">Active stage follows NEAR contract state · refreshes with the milestone record</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {(attestation || verifierPreview) && <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}><BadgeCheck size={12} />Inspect attestation</Button>}
          <Button size="sm" variant="secondary" onClick={attackSimulation}><AlertOctagon size={12} className="text-red-300" />Simulate Adversarial Attack</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-2 md:grid-cols-4 md:gap-0">
        {FLOW_NODES.map((node, index) => {
          const active = index === activeNode;
          const complete = index < activeNode;
          return <div key={node} className="relative flex items-center gap-3 md:flex-col md:items-stretch md:gap-0">
            {index < FLOW_NODES.length - 1 && <div className={`absolute left-[14px] top-[31px] h-[calc(100%-16px)] w-px md:left-[calc(50%+15px)] md:top-[15px] md:h-px md:w-[calc(100%-30px)] ${complete ? "bg-proof/60" : "bg-white/[0.08]"}`} />}
            <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-500 md:mx-auto ${active ? "border-proof/50 bg-proof/[0.1] text-proof shadow-[0_0_22px_rgba(0,236,66,.24)] animate-pulse-soft" : complete ? "border-proof/30 bg-proof/[0.06] text-proof" : "border-white/[0.09] bg-[#0c1119] text-slate-600"}`}>
              {complete ? <Check size={14} /> : index === 0 ? <LockKeyhole size={13} /> : index === 1 ? <ShieldCheck size={13} /> : index === 2 ? <ShieldAlert size={13} /> : <ArrowRight size={13} />}
            </div>
            <div className="pb-2 md:mt-3 md:px-2 md:text-center">
              <p className={`text-[10px] font-medium ${active ? "text-proof" : complete ? "text-slate-300" : "text-slate-600"}`}>{node}</p>
              <p className="mt-1 text-[8px] text-slate-600">{active ? milestone.status === "disputed" ? "DISPUTE HOLD" : milestone.status === "payout_pending" ? "PAYOUT PENDING" : "CURRENT CONTRACT STAGE" : complete ? "RECORDED" : "AWAITING"}</p>
            </div>
          </div>;
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] pt-3 text-[9px] text-slate-600"><span>Milestone #{milestone.id} · {milestone.status.replaceAll("_", " ")}</span><span className="font-mono">Deadline {deadlineDisplay(milestone.deadline)}</span></div>

      {drawerOpen && <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
        <aside role="dialog" aria-modal="true" aria-labelledby="attestation-drawer-title" className="flex h-full w-full max-w-[560px] flex-col border-l border-white/[0.09] bg-[#0d131d] shadow-2xl animate-fade-up">
          <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6"><div><p className="mono-label text-[9px] text-proof">MILESTONE #{milestone.id}</p><h2 id="attestation-drawer-title" className="mt-1 text-base font-semibold text-white">Attestation evidence</h2><p className="mt-1 text-[9px] text-slate-500">On-chain record and independently checked key scope.</p></div><button onClick={() => setDrawerOpen(false)} aria-label="Close attestation evidence" className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.05] hover:text-white"><X size={15} /></button></div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
            <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
              <div className="flex items-center justify-between"><h3 className="text-[10px] font-semibold text-white">TEE-style signed payload</h3><span className="rounded-full border border-amber-200/15 bg-amber-200/[0.03] px-2 py-1 text-[8px] text-amber-100">Software/mock · not hardware-backed</span></div>
              {verifierPreview ? <>
                <p className="mt-2 text-[9px] leading-relaxed text-slate-500">This fixed-schema dry-run payload is signed by the verifier service key. A valid software signature does not establish a hardware TEE, and this preview has not written an attestation.</p>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-white/[0.05] bg-black/20 p-3 font-mono text-[8px] leading-relaxed text-slate-300">{JSON.stringify(verifierPreview.signedPayload, null, 2)}</pre>
                <p className="mt-2 break-all rounded-lg border border-white/[0.05] bg-black/20 p-2.5 font-mono text-[8px] leading-relaxed text-slate-500">Ed25519 signature · {verifierPreview.teeSignatureMode}<br />{verifierPreview.teeSignature}</p>
                <p className="mt-2 text-[9px] text-slate-600">Verifier preview: {verifierPreview.writeStatus.replaceAll("_", " ")} · passed {String(verifierPreview.passed)}</p>
              </> : chainPayload ? <>
                <p className="mt-2 text-[9px] leading-relaxed text-slate-500">The contract stores this attestation record, but not a TEE signature or hardware measurement. Request a dry verifier preview from the contractor panel to receive the separate software-signed payload.</p>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg border border-white/[0.05] bg-black/20 p-3 font-mono text-[8px] leading-relaxed text-slate-300">{JSON.stringify(chainPayload, null, 2)}</pre>
              </> : <p className="mt-3 text-[9px] leading-relaxed text-slate-500">No on-chain attestation is recorded yet. A dry verifier preview, if requested, is separately labeled and does not change contract state.</p>}
            </section>

            <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
              <div className="flex items-center gap-2"><LockKeyhole size={13} className="text-proof" /><h3 className="text-[10px] font-semibold text-white">Restricted key fingerprint</h3></div>
              {attestation ? <>
                <p className="mt-2 break-all font-mono text-[8px] leading-relaxed text-slate-400">Pinned key: {attestation.verifier_key}</p>
                <p className="mt-1 break-all font-mono text-[8px] text-slate-600">Fingerprint: {currentKeyFingerprint ?? "Computing SHA-256…"}</p>
                <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 ${currentPermission?.verified ? "border-proof/15 bg-proof/[0.035]" : "border-amber-200/15 bg-amber-200/[0.025]"}`}>
                  {permissionLoadingForCurrentKey ? <LoaderCircle size={12} className="mt-0.5 animate-spin text-slate-400" /> : currentPermission?.verified ? <Check size={12} className="mt-0.5 text-proof" /> : <CircleHelp size={12} className="mt-0.5 text-amber-200" />}
                  <div><p className={`text-[9px] font-medium ${currentPermission?.verified ? "text-proof" : "text-amber-100"}`}>{permissionLoadingForCurrentKey ? "Checking NEAR access-key scope…" : currentPermission?.verified ? "Function-Call scope verified by RPC" : "Restricted scope not verified"}</p><p className="mt-1 text-[8px] leading-relaxed text-slate-500">{currentPermission?.reason ?? "NEAR access-key permission has not been checked."}</p></div>
                </div>
                {currentPermission?.verified && <p className="mt-2 font-mono text-[8px] text-slate-500">Account {currentVerifierAccount} · method {currentPermission.methodNames.join(", ")} · receiver {currentPermission.receiverId}</p>}
                {currentConfiguredKeyMatches === false && <p className="mt-2 text-[8px] leading-relaxed text-amber-100/80">The attestation key differs from the contract’s current verifier configuration; this may be a rotated key. The access-key query above checked the historical key on the configured verifier account.</p>}
                <p className="mt-3 text-[8px] leading-relaxed text-slate-600">Important: the contract pins verifier key metadata but cannot identify which access key signed a receipt. The RPC permission result proves only the queried key’s current scope; the fingerprint alone proves no permissions.</p>
              </> : <p className="mt-2 text-[9px] text-slate-500">The on-chain attestation does not contain a verifier key yet.</p>}
            </section>

            <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
              <div className="flex items-center gap-2"><Quote size={13} className="text-proof" /><h3 className="text-[10px] font-semibold text-white">1Click solver quote</h3><span className="ml-auto rounded-full border border-white/[0.07] px-2 py-1 text-[8px] text-slate-500">DRY PREVIEW</span></div>
              {milestone.destination_chain.toLowerCase() === "near" ? <p className="mt-3 text-[9px] leading-relaxed text-slate-500">This milestone pays on NEAR; a cross-chain solver quote is not applicable.</p> : <>
                <p className="mt-2 text-[9px] leading-relaxed text-slate-500">Fetch a signed quote for {formatAssetAmount(milestone.amount, sourceDisplay)} {sourceDisplay.symbol} to the recorded destination. Dry mode never returns a fundable deposit address.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void requestQuote()} disabled={quoteLoading}><Quote size={12} />{quoteLoading ? "Requesting quote…" : quote ? "Refresh dry quote" : "Request 1Click quote"}</Button>
                {quoteError && <p role="alert" className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/[0.025] px-3 py-2.5 text-[9px] leading-relaxed text-amber-100">{quoteError}</p>}
                {quote && <div className="mt-3 space-y-2 rounded-lg border border-proof/10 bg-proof/[0.025] p-3">
                  <p className="flex items-center gap-1.5 text-[9px] font-medium text-proof"><ShieldCheck size={11} />Signed quote verified · dry: true</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[8px]"><span className="text-slate-600">Indicative output</span><span className="text-right font-mono text-slate-200">{quote.quote.amountOutFormatted} {quote.targetAsset.symbol}</span><span className="text-slate-600">Provider minimum output</span><span className="text-right font-mono text-slate-200">{formatUnits(quote.quote.minAmountOut, quote.targetAsset.decimals)} {quote.targetAsset.symbol}</span><span className="text-slate-600">Indicative rate</span><span className="text-right font-mono text-slate-300">{quote.quote.signedIndicativeRate}</span><span className="text-slate-600">Minimum rate</span><span className="text-right font-mono text-slate-300">{quote.quote.signedMinimumRate}</span><span className="text-slate-600">Provider time estimate</span><span className="text-right font-mono text-slate-300">{quote.quote.timeEstimateSeconds}s{quote.quote.under30SecondsEstimate ? " · under 30s estimate" : ""}</span><span className="text-slate-600">Refund fee (provider units)</span><span className="text-right font-mono text-slate-300">{quote.quote.fees.refundFee ?? "Not returned"}</span><span className="text-slate-600">Withdraw fee (provider units)</span><span className="text-right font-mono text-slate-300">{quote.quote.fees.withdrawFee ?? "Not returned"}</span></div>
                  <p className="break-all border-t border-white/[0.05] pt-2 font-mono text-[8px] text-slate-600">Asset {quote.sourceAsset.symbol} → {quote.targetAsset.blockchain} {quote.targetAsset.symbol}<br />Expires {quote.quote.expiresAt ?? "Not returned"}</p>
                  <p className="flex items-start gap-1.5 border-t border-white/[0.05] pt-2 text-[8px] leading-relaxed text-amber-100/80"><CircleHelp size={10} className="mt-0.5 shrink-0" />{quote.guarantees.note}</p>
                  <p className="text-[8px] text-slate-600">No deposit address · no funds moved · estimate is not a settlement SLA.</p>
                </div>}
              </>}
            </section>

            {milestone.bridge_tx_ref && <p className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 text-[9px] text-slate-500"><ExternalLink size={11} />Bridge reference: <span className="font-mono text-slate-300">{shorten(milestone.bridge_tx_ref, 16, 8)}</span></p>}
            {verifierPreview?.attestationTxHash && <a href={explorerUrl(network, verifierPreview.attestationTxHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[9px] text-proof hover:underline">Verifier transaction {shorten(verifierPreview.attestationTxHash, 12, 6)} <ExternalLink size={10} /></a>}
          </div>
          <div className="border-t border-white/[0.06] px-5 py-3 text-[8px] leading-relaxed text-slate-600 sm:px-6">Quote data is a signed preview, not a promise of execution. Cross-chain completion requires a configured adapter and confirmed reconciliation.</div>
        </aside>
      </div>}
    </section>
  );
}
