"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseProofReceipt, proofReceiptCsv, type ProofReceipt } from "@/lib/receipt-utils";
import { viewContract } from "@/lib/near-rpc";

function ReceiptContent() {
  const params = useSearchParams();
  const milestoneId = params.get("milestoneId") ?? "";
  const expectedCommitment = params.get("commitment") ?? "";
  const rawNetwork = params.get("network");
  const network = rawNetwork === "mainnet" ? "mainnet" : "testnet";
  const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() ?? "";
  const [receipt, setReceipt] = useState<ProofReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReceipt(null);
    setError(null);
    if (!/^\d{1,15}$/.test(milestoneId) || !/^sha256:[0-9a-f]{64}$/.test(expectedCommitment) || !contractId) {
      setError("Receipt link is incomplete or no public escrow contract is configured.");
      return () => controller.abort();
    }
    viewContract<unknown>(contractId, "generate_proof_receipt", { milestone_id: Number(milestoneId) }, network, controller.signal)
      .then(parseProofReceipt)
      .then((parsed) => {
        if (parsed.milestone_id !== Number(milestoneId) || parsed.contract_id !== contractId || parsed.commitment !== expectedCommitment) {
          throw new Error("The contract receipt did not match this link's commitment.");
        }
        setReceipt(parsed);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message.slice(0, 220) : "The contract receipt could not be verified.");
      });
    return () => controller.abort();
  }, [contractId, expectedCommitment, milestoneId, network]);

  function downloadCsv() {
    if (!receipt) return;
    const objectUrl = URL.createObjectURL(new Blob(["\uFEFF", proofReceiptCsv(receipt)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `proofpay-receipt-${receipt.milestone_id}.csv`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return <main className="min-h-screen bg-[#0b0f17] px-5 py-12 text-slate-100"><article className="glass-panel mx-auto max-w-2xl rounded-2xl p-6 sm:p-9"><p className="mono-label text-[9px] text-proof">PROOFPAY · SELECTIVE DISCLOSURE</p><h1 className="mt-3 text-2xl font-semibold text-white">Released work receipt</h1><p className="mt-2 text-xs leading-relaxed text-slate-400">Receipt contents are fetched from the configured NEAR escrow contract. The employer wallet address is intentionally not disclosed.</p>{error ? <p role="alert" className="mt-6 rounded-lg border border-red-300/15 bg-red-300/[0.04] p-3 text-xs text-red-100">Receipt could not be verified: {error}</p> : !receipt ? <p role="status" className="mt-6 animate-pulse text-xs text-slate-500">Checking the contract receipt view…</p> : <><div role="status" className="mt-6 rounded-lg border border-proof/20 bg-proof/[0.04] p-4"><p className="text-[10px] text-proof">Contract view matches the receipt commitment</p><p className="mt-1 font-mono text-[9px] text-slate-300">{receipt.commitment}</p></div><dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">{[["Milestone", `#${receipt.milestone_id}`], ["Status", receipt.status], ["Contractor", receipt.contractor], ["Amount (base units)", `${receipt.amount} (${receipt.asset_id})`], ["Proof hash", receipt.proof_hash], ["Verifier reasoning hash", receipt.reasoning_hash], ["Verified at (ns)", String(receipt.verified_at_ns)], ["Contract", receipt.contract_id]].map(([label, value]) => <div key={label}><dt className="mono-label text-[8px] text-slate-600">{label}</dt><dd className="mt-1 break-all font-mono text-[9px] text-slate-200">{value}</dd></div>)}</dl><p className="mt-6 border-t border-white/[0.06] pt-4 text-[9px] leading-relaxed text-slate-500">The receipt is a deterministic SHA-256 hash commitment over the released milestone evidence. It is not a zero-knowledge proof, auditor signature, or independent guarantee that the work itself is correct.</p><button onClick={downloadCsv} className="mt-5 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] text-white hover:bg-white/[0.04]">Download accountant CSV</button></>}</article></main>;
}

export default function ReceiptPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#0b0f17] p-10 text-sm text-slate-400">Loading receipt…</main>}><ReceiptContent /></Suspense>;
}
