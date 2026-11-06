import { useState } from "react";
import { Clipboard, Download, FileCheck2, LoaderCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { viewContract } from "@/lib/near-rpc";
import { proofReceiptCsv, proofReceiptShareUrl, parseProofReceipt, type ProofReceipt } from "@/lib/receipt-utils";
import type { NearNetwork, OnChainMilestone } from "@/lib/proofpay-types";

export function SelectiveDisclosureReceipt({ milestone, network, isDemoMode }: { milestone: OnChainMilestone; network: NearNetwork; isDemoMode: boolean }) {
  const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() ?? "";
  const [receipt, setReceipt] = useState<ProofReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const available = !isDemoMode && milestone.status === "released" && Boolean(contractId);

  async function loadReceipt() {
    setLoading(true);
    try {
      if (!contractId) throw new Error("Configure the public escrow contract ID before generating a receipt.");
      const raw = await viewContract<unknown>(contractId, "generate_proof_receipt", { milestone_id: milestone.id }, network, AbortSignal.timeout(10_000));
      const parsed = parseProofReceipt(raw);
      if (parsed.milestone_id !== milestone.id || parsed.contract_id !== contractId) throw new Error("Receipt identity did not match the selected contract milestone.");
      setReceipt(parsed);
      toast.success("Contract receipt loaded", { description: "The released-work record omits the employer wallet address." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the contract receipt.";
      toast.error("Receipt unavailable", { description: message.slice(0, 200) });
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!receipt) return;
    const blob = new Blob(["\uFEFF", proofReceiptCsv(receipt)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `proofpay-receipt-${receipt.milestone_id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyShareLink() {
    if (!receipt) return;
    const link = proofReceiptShareUrl(window.location.origin, receipt.milestone_id, network, receipt.commitment);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Receipt link copied", { description: "The link discloses no employer account address." });
    } catch {
      toast.error("Could not copy receipt link", { description: link });
    }
  }

  return (
    <section aria-labelledby="selective-receipt-title" className="glass-panel rounded-xl p-4">
      <div className="flex items-start gap-3"><div className="rounded-lg border border-proof/15 bg-proof/[0.05] p-2 text-proof"><FileCheck2 size={15} /></div><div className="min-w-0 flex-1"><h3 id="selective-receipt-title" className="text-xs font-semibold text-white">Selective-disclosure work receipt</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-500">Creates a contract-backed SHA-256 commitment and an accountant-ready CSV without the employer account. This is a hash commitment, not a zero-knowledge proof.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={loadReceipt} disabled={!available || loading}><LoaderCircle size={12} className={loading ? "animate-spin" : ""} />{loading ? "Reading contract…" : receipt ? "Refresh receipt" : "Generate receipt"}</Button><Button variant="secondary" onClick={downloadCsv} disabled={!receipt}><Download size={12} />Export CSV</Button><Button variant="secondary" onClick={copyShareLink} disabled={!receipt}><Share2 size={12} />Copy share link</Button></div>
        {!available && <p className="mt-2 text-[8px] text-amber-100/70">A verified receipt is available only for a released live-chain milestone with a configured contract. Demo/sample state cannot produce a verified receipt.</p>}
        {receipt && <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/15 p-3"><p className="mono-label text-[8px] text-proof">RELEASED RECEIPT · MILESTONE #{receipt.milestone_id}</p><p className="mt-2 break-all font-mono text-[8px] text-slate-300">{receipt.commitment}</p><p className="mt-2 flex items-center gap-1.5 text-[8px] text-slate-500"><Clipboard size={10} />Employer wallet address is not part of this receipt or share URL.</p></div>}
      </div></div>
    </section>
  );
}
