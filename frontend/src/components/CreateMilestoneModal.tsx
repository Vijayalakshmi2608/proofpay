import { useState, type ChangeEvent, type FormEvent } from "react";
import { AlertTriangle, FileCheck2, LoaderCircle, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decimalToBaseUnits } from "@/lib/near-amount";

export type FundingAsset = "NEAR" | "USDC";
export type PayoutNetwork = "NEAR" | "Ethereum" | "Solana" | "Bitcoin";

export interface CreateMilestoneSubmission {
  title: string;
  contractorAccountId: string;
  fundingAsset: FundingAsset;
  amountBaseUnits: string;
  autoReleaseLimitBaseUnits: string;
  proofRequirements: string;
  deadlineNs: string;
  destinationChain: PayoutNetwork;
  payoutRecipient: string;
}

const nearAccountPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

function validateRecipient(network: PayoutNetwork, value: string): boolean {
  if (network === "NEAR") return nearAccountPattern.test(value);
  if (network === "Ethereum") return /^0x[a-fA-F0-9]{40}$/.test(value);
  if (network === "Solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  return /^(bc1[ac-hj-np-z02-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(value);
}

export function CreateMilestoneModal({ onClose, onCreate, isSubmitting, employerAccountId }: {
  onClose: () => void;
  onCreate: (input: CreateMilestoneSubmission) => Promise<void>;
  isSubmitting: boolean;
  employerAccountId: string | null;
}) {
  const usdcContractId = process.env.NEXT_PUBLIC_NEAR_USDC_CONTRACT?.trim() ?? "";
  const usdcConfigured = Boolean(usdcContractId);
  const [title, setTitle] = useState("");
  const [contractor, setContractor] = useState("");
  const [fundingAsset, setFundingAsset] = useState<FundingAsset>("NEAR");
  const [destinationChain, setDestinationChain] = useState<PayoutNetwork>("NEAR");
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [autoLimit, setAutoLimit] = useState("0");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [checklistText, setChecklistText] = useState("Deliverable meets the agreed acceptance criteria");
  const [error, setError] = useState<string | null>(null);
  const isLiveMode = process.env.NEXT_PUBLIC_DEMO_MODE === "false";

  const handleChecklistFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 24_000 || !/\.(txt|md)$/i.test(file.name)) {
      setError("Upload a .txt or .md proof checklist smaller than 24 KB.");
      event.currentTarget.value = "";
      return;
    }
    try {
      setChecklistText(await file.text());
      setError(null);
      toast.success("Proof checklist loaded", { description: file.name });
    } catch {
      setError("The proof checklist could not be read.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const trimmedTitle = title.trim();
      const contractorAccountId = contractor.trim();
      if (trimmedTitle.length < 3 || trimmedTitle.length > 160) throw new Error("Title must be 3–160 characters.");
      if (!nearAccountPattern.test(contractorAccountId)) throw new Error("Enter a valid NEAR contractor account ID.");
      if (employerAccountId && employerAccountId === contractorAccountId) throw new Error("Employer and contractor accounts must be different.");
      if (fundingAsset === "USDC" && !usdcConfigured) throw new Error("Set NEXT_PUBLIC_NEAR_USDC_CONTRACT to enable USDC funding.");
      const decimals = fundingAsset === "NEAR" ? 24 : 6;
      const amountBaseUnits = decimalToBaseUnits(amount, decimals, fundingAsset);
      const autoReleaseLimitBaseUnits = decimalToBaseUnits(autoLimit || "0", decimals, fundingAsset);
      if (BigInt(amountBaseUnits) <= 0n) throw new Error("Milestone amount must be greater than zero.");
      if (BigInt(autoReleaseLimitBaseUnits) > BigInt(amountBaseUnits)) throw new Error("Auto-approve threshold cannot exceed the milestone amount.");
      const days = Number(deadlineDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Deadline must be from 1 to 365 days.");
      const checklist = checklistText.split(/\r?\n/).map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
      if (checklist.length < 1 || checklist.length > 20 || checklist.some((item) => item.length > 500)) throw new Error("Add 1–20 checklist criteria, each no longer than 500 characters.");
      const proofRequirements = JSON.stringify({ title: trimmedTitle, requiredPhrases: checklist });
      if (new TextEncoder().encode(proofRequirements).byteLength > 2_048) throw new Error("The structured proof checklist exceeds the contract’s 2,048-byte limit.");
      const recipient = destinationChain === "NEAR" ? contractorAccountId : payoutRecipient.trim();
      if (!validateRecipient(destinationChain, recipient)) throw new Error(`Enter a valid ${destinationChain} payout address.`);
      const deadlineNs = (BigInt(Date.now() + days * 86_400_000) * 1_000_000n).toString();
      await onCreate({
        title: trimmedTitle,
        contractorAccountId,
        fundingAsset,
        amountBaseUnits,
        autoReleaseLimitBaseUnits,
        proofRequirements,
        deadlineNs,
        destinationChain,
        payoutRecipient: recipient,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please check the milestone details.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="create-milestone-title" className="max-h-[94vh] w-full max-w-[650px] overflow-y-auto rounded-t-2xl border border-white/[0.09] bg-[#0e141e] shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/[0.06] bg-[#0e141e]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div><p className="mono-label text-[9px] text-proof">EMPLOYER WORKSPACE</p><h2 id="create-milestone-title" className="mt-1 text-lg font-semibold text-white">Create a milestone</h2><p className="mt-1 text-[11px] text-slate-500">Funds lock in the escrow contract; payout needs proof and policy approval.</p></div>
          <button onClick={onClose} disabled={isSubmitting} aria-label="Close create milestone form" className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.05] hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5 px-5 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Milestone title</span><input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Deliver the mobile checkout flow" className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 text-xs text-white placeholder:text-slate-600 focus:border-proof/45 focus:outline-none" /></label>
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Contractor NEAR account</span><input required autoCapitalize="none" autoCorrect="off" value={contractor} onChange={(event) => setContractor(event.target.value.toLowerCase())} placeholder="contractor.near" className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-proof/45 focus:outline-none" /></label>
            <label><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Funding asset</span><select value={fundingAsset} onChange={(event) => setFundingAsset(event.target.value as FundingAsset)} className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 text-xs text-white focus:border-proof/45 focus:outline-none"><option value="NEAR">NEAR · native</option><option value="USDC" disabled={!usdcConfigured}>USDC · NEP-141 {!usdcConfigured ? "(not configured)" : ""}</option></select></label>
            <label><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Payout network</span><select value={destinationChain} onChange={(event) => { const next = event.target.value as PayoutNetwork; setDestinationChain(next); if (next !== "NEAR") setPayoutRecipient(""); }} className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 text-xs text-white focus:border-proof/45 focus:outline-none"><option value="NEAR">NEAR</option><option value="Ethereum">Ethereum · native USDC</option><option value="Solana">Solana · native SOL</option><option value="Bitcoin">Bitcoin · native BTC</option></select></label>
            <label><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Amount <span className="font-mono text-slate-500">{fundingAsset}</span></span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={fundingAsset === "NEAR" ? "1.25" : "25.00"} className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-proof/45 focus:outline-none" /><span className="mt-1.5 block text-[9px] text-slate-600">Maximum precision: {fundingAsset === "NEAR" ? "24" : "6"} decimal places.</span></label>
            <label><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Auto-approve threshold <span className="font-mono text-slate-500">{fundingAsset}</span></span><input inputMode="decimal" value={autoLimit} onChange={(event) => setAutoLimit(event.target.value)} placeholder="0 = employer approval" className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-proof/45 focus:outline-none" /><span className="mt-1.5 block text-[9px] text-slate-600">Must use the same token units as the milestone. 0 means employer approval.</span></label>
            <label><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Deadline (days)</span><input type="number" min="1" max="365" value={deadlineDays} onChange={(event) => setDeadlineDays(event.target.value)} className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 font-mono text-xs text-white focus:border-proof/45 focus:outline-none" /></label>
            {destinationChain !== "NEAR" && <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-medium text-slate-300">Contractor payout address</span><input required autoCapitalize="none" autoCorrect="off" value={payoutRecipient} onChange={(event) => setPayoutRecipient(event.target.value.trim())} placeholder={destinationChain === "Ethereum" ? "0x…" : destinationChain === "Solana" ? "Solana address" : "bc1…"} className="h-10 w-full rounded-lg border border-white/[0.09] bg-[#090d14] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-proof/45 focus:outline-none" /><span className="mt-1.5 block text-[9px] text-slate-600">Payout routing is recorded in the milestone. Cross-chain execution still requires a configured adapter.</span></label>}
          </div>

          {fundingAsset === "USDC" && <p className="rounded-lg border border-amber-200/10 bg-amber-200/[0.025] px-3 py-2.5 text-[9px] leading-relaxed text-amber-100/80">USDC funding uses the configured token’s `ft_transfer_call`. The escrow owner must have allowlisted this token contract before funding can succeed. Confirm the account and network in your wallet.</p>}

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
            <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 size={14} className="text-proof" /><div><p className="text-[11px] font-medium text-white">Proof checklist</p><p className="mt-0.5 text-[9px] text-slate-500">One criterion per line; the on-chain criteria are stored with this milestone.</p></div></div><label className="cursor-pointer"><span className="flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2 py-1.5 text-[9px] text-slate-400 transition hover:border-proof/25 hover:text-proof"><Upload size={11} />Upload .txt/.md</span><input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(event) => void handleChecklistFile(event)} /></label></div>
            <textarea required rows={4} maxLength={5_000} value={checklistText} onChange={(event) => setChecklistText(event.target.value)} placeholder="The deliverable includes…&#10;The API returns…" className="mt-3 w-full resize-y rounded-lg border border-white/[0.08] bg-[#090d14] px-3 py-2.5 text-[11px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-proof/35 focus:outline-none" />
            <p className="mt-2 text-[9px] text-slate-600">Checklist text is stored as criteria data. It cannot change verifier rules or transaction permissions.</p>
          </div>

          {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300/15 bg-red-300/[0.04] px-3 py-2.5 text-[10px] leading-relaxed text-red-100"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</div>}
          <div className="flex items-start gap-2 rounded-lg border border-amber-200/10 bg-amber-200/[0.025] px-3 py-2.5 text-[9px] leading-relaxed text-slate-500"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-200/80" /><span>The selected funding token is deposited in the escrow contract. Cross-chain quotes are dry previews; payouts will not execute until an adapter is configured. The wallet will show the NEAR transaction before signing.</span></div>
          <div className="flex flex-col-reverse gap-2 border-t border-white/[0.06] pt-4 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" disabled={isSubmitting || (isLiveMode && !employerAccountId)} className="sm:min-w-[190px]">{isSubmitting ? <><LoaderCircle size={14} className="animate-spin" />Confirming…</> : "Review & create"}</Button></div>
        </form>
      </section>
    </div>
  );
}
