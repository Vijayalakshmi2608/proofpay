"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeftRight, BadgeCheck, CheckCircle2, ChevronRight, CircleHelp, Clock3, Filter, Layers3, LoaderCircle, LockKeyhole, Menu, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { CreateMilestoneModal, type CreateMilestoneSubmission } from "@/components/CreateMilestoneModal";
import { MilestoneCard } from "@/components/MilestoneCard";
import { ContractorView } from "@/components/ContractorView";
import { EscrowFlowVisualizer } from "@/components/EscrowFlowVisualizer";
import { AttackSandbox } from "@/components/AttackSandbox";
import { SolverQuotes } from "@/components/SolverQuotes";
import { SelectiveDisclosureReceipt } from "@/components/SelectiveDisclosureReceipt";
import { useWallet } from "@/components/wallet-provider";
import { formatAssetAmount, getMilestoneAssetDisplay, getMilestoneBadge, getMilestoneTitle, shorten, type MilestoneAssetDisplay } from "@/lib/milestone-utils";
import { listMilestones } from "@/lib/near-rpc";
import type { DeliverableVerificationResponse, OnChainMilestone } from "@/lib/proofpay-types";

const DEMO_MILESTONES: OnChainMilestone[] = [
  {
    id: 24,
    employer: "studio.proofpay.testnet",
    contractor: "parallel-studio.near",
    amount: "3200000000000000000000000",
    deadline: "1794000000000000000",
    proof_hash: "",
    proof_url: "",
    proof_requirements: JSON.stringify({ title: "Responsive checkout delivery", requiredPhrases: ["responsive checkout", "accessibility review"] }),
    status: "pending",
    auto_release_limit: "1500000000000000000000000",
    asset_id: "proofpay.testnet",
    asset_kind: "cross_chain_intent",
    destination_chain: "Ethereum",
    payout_recipient: "0x000000000000000000000000000000000000dEaD",
    attestation: null,
    demoOnly: true,
  },
  {
    id: 23,
    employer: "orbit-labs.near",
    contractor: "mosaic-commerce.near",
    amount: "1800000000000000000000000",
    deadline: "1792500000000000000",
    proof_hash: "b27d102d8644d3a11ffb58e9bbdc27e94cccd3e36151ce2c5a493ef92c65f93b",
    proof_url: "https://github.com/mosaic-commerce/payments/commit/b27d102d8644d3a11ffb58e9bbdc27e94cccd3e36151ce2c5a493ef92c65f93b",
    proof_requirements: JSON.stringify({ title: "Payments API documentation", requiredPhrases: ["payments api", "error handling"] }),
    status: "pending",
    auto_release_limit: "0",
    asset_id: "proofpay.testnet",
    asset_kind: "native_near",
    destination_chain: "NEAR",
    payout_recipient: "mosaic-commerce.near",
    attestation: null,
    demoOnly: true,
  },
  {
    id: 22,
    employer: "proofpay-labs.near",
    contractor: "lattice-security.near",
    amount: "850000000000000000000000",
    deadline: "1791000000000000000",
    proof_hash: "c19e5d141099532088e1bbf06f4694cf5e845c7f3fc040357148765dcac76b42",
    proof_url: "https://github.com/lattice-security/audit/commit/c19e5d141099532088e1bbf06f4694cf5e845c7f3fc040357148765dcac76b42",
    proof_requirements: JSON.stringify({ title: "Protocol security review", requiredPhrases: ["risk assessment", "remediation plan"] }),
    status: "attested",
    auto_release_limit: "1000000000000000000000000",
    asset_id: "proofpay.testnet",
    asset_kind: "native_near",
    destination_chain: "NEAR",
    payout_recipient: "lattice-security.near",
    attestation: {
      milestone_id: 22,
      verifier_key: "ed25519:11111111111111111111111111111111",
      result: true,
      reasoning_hash: "sha256:6d20ab34e1b538a6bb7cd3a53256056cfb67b9eef82cc9151abd7d04f10d26e6",
      timestamp: "1790000000000000000",
    },
    demoOnly: true,
  },
];

function shortHashFromOutcome(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.transaction && typeof record.transaction === "object") {
    const transaction = record.transaction as Record<string, unknown>;
    if (typeof transaction.hash === "string") return transaction.hash;
  }
  if (record.transaction_outcome && typeof record.transaction_outcome === "object") {
    const outcome = record.transaction_outcome as Record<string, unknown>;
    if (typeof outcome.id === "string") return outcome.id;
  }
  return null;
}

function sumLockedByAsset(milestones: OnChainMilestone[]): Array<MilestoneAssetDisplay & { amount: string }> {
  const totals = new Map<string, { asset: MilestoneAssetDisplay; amount: bigint }>();
  for (const milestone of milestones) {
    if (milestone.status === "released" || milestone.status === "refunded") continue;
    const asset = getMilestoneAssetDisplay(milestone);
    const key = asset.assetId.toLowerCase();
    const current = totals.get(key) ?? { asset, amount: 0n };
    current.amount += BigInt(milestone.amount);
    totals.set(key, current);
  }
  return [...totals.values()].map(({ asset, amount }) => ({ ...asset, amount: amount.toString() }));
}

export default function Home() {
  const { accountId, connect, createMilestoneTransaction, network } = useWallet();
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID?.trim() ?? "";
  const [milestones, setMilestones] = useState<OnChainMilestone[]>(isDemoMode ? DEMO_MILESTONES : []);
  const [loading, setLoading] = useState(!isDemoMode);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(isDemoMode ? DEMO_MILESTONES[0]?.id ?? null : null);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("Milestones");
  const [filter, setFilter] = useState("All milestones");
  const [search, setSearch] = useState("");
  const [previews, setPreviews] = useState<Record<number, DeliverableVerificationResponse>>({});
  const inFlight = useRef<Promise<OnChainMilestone[]> | null>(null);

  const refreshMilestones = useCallback((quiet = false): Promise<OnChainMilestone[]> => {
    if (inFlight.current) return inFlight.current;
    if (!quiet) setRefreshing(true);
    const task = (async () => {
      try {
        if (isDemoMode) {
          setMilestones(DEMO_MILESTONES);
          setLoadError(null);
          setLastSync(new Date());
          return DEMO_MILESTONES;
        }
        if (!contractId) throw new Error("Set NEXT_PUBLIC_NEAR_CONTRACT_ID to read live milestone state.");
        const records = await listMilestones(contractId, network, AbortSignal.timeout(10_000));
        setMilestones(records);
        setLoadError(null);
        setLastSync(new Date());
        return records;
      } catch (error) {
        const message = error instanceof Error ? error.message : "NEAR contract state could not be loaded.";
        setLoadError(message.slice(0, 240));
        if (!isDemoMode) setMilestones([]);
        return [];
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();
    inFlight.current = task;
    void task.finally(() => { inFlight.current = null; });
    return task;
  }, [contractId, isDemoMode, network]);

  useEffect(() => {
    void refreshMilestones();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshMilestones(true);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [refreshMilestones]);

  useEffect(() => {
    const toggleMenu = () => setMenuOpen((open) => !open);
    window.addEventListener("proofpay:toggle-menu", toggleMenu);
    return () => window.removeEventListener("proofpay:toggle-menu", toggleMenu);
  }, []);

  useEffect(() => {
    if (selectedId !== null && !milestones.some((item) => item.id === selectedId)) setSelectedId(milestones[0]?.id ?? null);
    else if (selectedId === null && milestones[0]) setSelectedId(milestones[0].id);
  }, [milestones, selectedId]);

  const selectedMilestone = useMemo(() => milestones.find((item) => item.id === selectedId) ?? null, [milestones, selectedId]);
  const visibleMilestones = useMemo(() => milestones.filter((item) => {
    const badge = getMilestoneBadge(item).label;
    const matchesTab = filter === "All milestones" || (filter === "Active" ? item.status !== "released" && item.status !== "refunded" : filter === "Needs proof" ? item.status === "pending" && !item.proof_hash : filter === "Review" ? item.status === "pending" && Boolean(item.proof_hash) : badge === "Payout Released");
    const haystack = `${getMilestoneTitle(item)} ${item.employer} ${item.contractor} ${item.destination_chain} ${item.id}`.toLowerCase();
    return matchesTab && haystack.includes(search.toLowerCase());
  }), [filter, milestones, search]);

  const activeCount = milestones.filter((item) => item.status !== "released" && item.status !== "refunded").length;
  const proofCount = milestones.filter((item) => item.status === "pending" && Boolean(item.proof_hash)).length;
  const attestedCount = milestones.filter((item) => item.status === "attested").length;

  async function createMilestone(input: CreateMilestoneSubmission) {
    setCreating(true);
    try {
      if (isDemoMode) {
        const id = Math.max(0, ...milestones.map((item) => item.id)) + 1;
        const sample: OnChainMilestone = {
          id,
          employer: accountId ?? "demo-employer.near",
          contractor: input.contractorAccountId,
          amount: input.amountBaseUnits,
          deadline: input.deadlineNs,
          proof_hash: "",
          proof_url: "",
          proof_requirements: input.proofRequirements,
          status: "pending",
          auto_release_limit: input.autoReleaseLimitBaseUnits,
          asset_id: input.fundingAsset === "USDC" ? (process.env.NEXT_PUBLIC_NEAR_USDC_CONTRACT?.trim() || "usdc-not-configured") : (contractId || "proofpay.testnet"),
          asset_kind: input.destinationChain === "NEAR" ? (input.fundingAsset === "NEAR" ? "native_near" : "nep141") : "cross_chain_intent",
          destination_chain: input.destinationChain,
          payout_recipient: input.payoutRecipient,
          attestation: null,
          demoOnly: true,
        };
        setMilestones((previous) => [sample, ...previous]);
        setSelectedId(id);
        setModalOpen(false);
        toast.success("Demo milestone created", { description: "Illustrative only — the wallet was not asked to sign or fund it." });
        return;
      }
      if (!accountId) {
        connect();
        throw new Error("Connect the employer NEAR wallet, then resubmit the form.");
      }
      const outcome = await createMilestoneTransaction(input);
      const txHash = shortHashFromOutcome(outcome);
      toast.success("Milestone transaction confirmed", { description: txHash ? `NEAR transaction ${shorten(txHash, 12, 6)}` : "Refreshing the contract milestone list." });
      const records = await refreshMilestones();
      if (records[0]) setSelectedId(records[0].id);
      setModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet transaction failed.";
      toast.error("Milestone was not created", { description: message });
      throw error;
    } finally {
      setCreating(false);
    }
  }

  function updateDemoProof(input: { milestoneId: number; proofHash: string; proofUrl: string }) {
    setMilestones((previous) => previous.map((item) => item.id === input.milestoneId ? { ...item, proof_hash: input.proofHash, proof_url: input.proofUrl } : item));
  }

  function addVerifierPreview(result: DeliverableVerificationResponse) {
    setPreviews((previous) => ({ ...previous, [result.milestoneId]: result }));
  }

  const lockedTotals = useMemo(() => sumLockedByAsset(milestones), [milestones]);

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100">
      <div className="fixed inset-0 -z-0 bg-grid-fade bg-[size:44px_44px] opacity-[.18] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1680px]">
        <aside className={`${menuOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-white/[0.06] bg-[#0b0f17]/95 px-4 py-5 backdrop-blur-xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:bg-[#0b0f17]/80`}>
          <div className="flex items-center gap-3 px-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl border border-proof/20 bg-proof/[0.07] text-proof shadow-[0_0_20px_rgba(0,236,66,.1)]"><CheckCircle2 size={18} /></div><div><div className="text-[15px] font-semibold tracking-[-.04em] text-white">proof<span className="text-proof">pay</span></div><div className="mono-label mt-0.5 text-[8px] text-slate-600">VERIFIABLE ESCROW</div></div><button className="ml-auto rounded p-1 text-slate-500 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={16} /></button></div>
          <div className="mt-9 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><p className="mono-label text-[8px] text-slate-600">NETWORK</p><div className="mt-2 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-proof shadow-[0_0_8px_rgba(0,236,66,.8)]" /><span className="text-xs text-slate-300">NEAR {network === "testnet" ? "Testnet" : "Mainnet"}</span></div><p className="mt-1 truncate pl-3.5 font-mono text-[8px] text-slate-600">{contractId || "Contract not configured"}</p></div>
          <nav className="mt-8 space-y-1" aria-label="Main navigation">{[{label:"Milestones",icon:Layers3},{label:"Policy",icon:ShieldCheck},{label:"Activity",icon:Activity}].map(({label,icon:Icon}) => <button key={label} onClick={() => { setActiveSection(label); setMenuOpen(false); if (label !== "Milestones") document.getElementById("policy-notes")?.scrollIntoView({ behavior: "smooth" }); }} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs transition ${activeSection === label ? "border border-white/[0.07] bg-white/[0.055] text-white" : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200"}`}><Icon size={15} className={activeSection === label ? "text-proof" : "text-slate-500"} />{label}{label === "Milestones" && <span className="ml-auto rounded-md bg-white/[0.055] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{milestones.length}</span>}</button>)}</nav>
          <div className="mt-auto rounded-xl border border-proof/10 bg-gradient-to-br from-proof/[0.055] to-transparent p-3.5"><div className="flex items-center gap-2"><LockKeyhole size={13} className="text-proof" /><p className="text-[10px] font-medium text-slate-200">Proof-gated payouts</p></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">The contract controls escrow state. A quote preview is not a payout.</p><div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[8px]"><span className="text-slate-600">DATA SOURCE</span><span className={isDemoMode ? "text-amber-200" : "text-proof"}>{isDemoMode ? "DEMO SAMPLE" : "NEAR RPC"}</span></div></div>
        </aside>
        {menuOpen && <button aria-label="Close navigation overlay" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-30 bg-black/55 lg:hidden" />}

        <main className="min-w-0 flex-1">
          <Navbar isDemoMode={isDemoMode} activeSection={activeSection} onMenuClick={() => setMenuOpen((open) => !open)} />
          <div className="mx-auto max-w-[1320px] px-4 pb-12 pt-8 sm:px-7 lg:px-10 xl:px-12">
            <section className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div><div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-proof/15 bg-proof/[0.04] px-2.5 py-1 text-[9px] text-proof/90"><span className={`h-1.5 w-1.5 rounded-full ${isDemoMode ? "bg-amber-200" : "animate-pulse bg-proof"}`} />{isDemoMode ? "DEMO · ILLUSTRATIVE STATE" : `LIVE · NEAR ${network.toUpperCase()} RPC`}</div><h1 className="text-[27px] font-semibold tracking-[-.045em] text-white sm:text-[32px]">Milestones, <span className="text-slate-500">secured by proof.</span></h1><p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">Fund work in NEAR or configured USDC. Inspect proof, verifier scope, and cross-chain quote terms without confusing a preview for a transfer.</p></div>
              <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void refreshMilestones()} disabled={refreshing}><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Refresh RPC</Button><Button onClick={() => setModalOpen(true)}><Plus size={14} />Create milestone</Button></div>
            </section>

            {isDemoMode && <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200/10 bg-amber-200/[0.025] px-3 py-2.5 text-[9px] leading-relaxed text-slate-400"><CircleHelp size={12} className="mt-0.5 shrink-0 text-amber-200/80" /><span>Sample milestones are illustrative only. Create/proof actions stay local, and verifier/key/quote data must not be treated as live chain evidence.</span></div>}
            {loadError && !isDemoMode && <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-red-300/15 bg-red-300/[0.035] px-3 py-2.5 text-[9px] leading-relaxed text-red-100"><ShieldAlert size={12} className="mt-0.5 shrink-0" /><span>Live contract state unavailable: {loadError}</span></div>}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="glass-panel green-glow relative overflow-hidden rounded-xl p-4 sm:p-5"><div className="flex items-center justify-between"><p className="text-[10px] text-slate-500">Funds in active escrow</p><LockKeyhole size={14} className="text-proof" /></div><div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">{lockedTotals.length ? lockedTotals.map((item) => <span key={item.assetId} className="font-mono text-xl text-white sm:text-2xl">{formatAssetAmount(item.amount, item)}<span className="ml-1.5 text-[10px] text-proof">{item.symbol}</span></span>) : <span className="font-mono text-xl text-white sm:text-2xl">0<span className="ml-1.5 text-[10px] text-proof">NEAR</span></span>}</div><p className="mt-2 text-[8px] text-slate-600">Grouped by funding asset · no USD conversion</p></div>
              <div className="glass-panel rounded-xl p-4 sm:p-5"><div className="flex items-center justify-between"><p className="text-[10px] text-slate-500">Active milestones</p><Layers3 size={14} className="text-slate-400" /></div><p className="mt-3 font-mono text-2xl text-white">{String(activeCount).padStart(2, "0")}</p><p className="mt-2 text-[8px] text-slate-600">Not released or refunded</p></div>
              <div className="glass-panel rounded-xl p-4 sm:p-5"><div className="flex items-center justify-between"><p className="text-[10px] text-slate-500">Proof awaiting review</p><Clock3 size={14} className="text-amber-200" /></div><p className="mt-3 font-mono text-2xl text-white">{String(proofCount).padStart(2, "0")}</p><p className="mt-2 text-[8px] text-slate-600">Pending status with proof submitted</p></div>
              <div className="glass-panel rounded-xl p-4 sm:p-5"><div className="flex items-center justify-between"><p className="text-[10px] text-slate-500">AI attested</p><BadgeCheck size={14} className="text-proof" /></div><p className="mt-3 font-mono text-2xl text-white">{String(attestedCount).padStart(2, "0")}</p><p className="mt-2 text-[8px] text-slate-600">Derived from contract status</p></div>
            </div>

            <section className="mt-7" aria-labelledby="milestones-heading">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2"><h2 id="milestones-heading" className="text-sm font-semibold text-white">Milestone workspace</h2><span className="rounded-md bg-white/[0.055] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{visibleMilestones.length}</span></div><p className="mt-1 text-[9px] text-slate-500">Contract records refresh every 12 seconds while the page is visible.</p></div><div className="flex items-center gap-2"><label className="relative min-w-0 flex-1 sm:w-[220px] sm:flex-none"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search milestone or account" className="h-9 w-full rounded-lg border border-white/[0.07] bg-[#0a0e15] pl-8 pr-3 text-[10px] text-white placeholder:text-slate-600 focus:border-white/15 focus:outline-none" /></label><button aria-label="Cycle milestone filters" onClick={() => setFilter(filter === "All milestones" ? "Active" : "All milestones")} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 text-[10px] text-slate-400 transition hover:bg-white/[0.04]"><Filter size={12} /><span className="hidden sm:inline">Filter</span></button></div></div>
              <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-white/[0.055]">{["All milestones", "Active", "Needs proof", "Review", "Completed"].map((tab) => <button key={tab} onClick={() => setFilter(tab)} className={`relative whitespace-nowrap px-3 py-2.5 text-[10px] transition ${filter === tab ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>{tab}{filter === tab && <span className="absolute inset-x-3 bottom-0 h-px bg-proof shadow-[0_0_8px_rgba(0,236,66,.5)]" />}</button>)}</div>
              {loading ? <div className="flex items-center justify-center gap-2 py-16 text-[10px] text-slate-500"><LoaderCircle size={14} className="animate-spin text-proof" />Reading milestone state from NEAR RPC…</div> : visibleMilestones.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleMilestones.map((milestone) => <MilestoneCard key={`${milestone.demoOnly ? "demo" : "chain"}-${milestone.id}`} milestone={milestone} onSelect={(item) => { setSelectedId(item.id); document.getElementById("selected-milestone")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />)}</div> : <div className="glass-panel rounded-xl px-6 py-12 text-center"><Search size={18} className="mx-auto text-slate-600" /><p className="mt-3 text-xs text-slate-300">{loadError && !isDemoMode ? "No live records loaded" : "No milestones match this view"}</p><p className="mt-1 text-[9px] text-slate-600">{loadError && !isDemoMode ? "Retry the RPC connection or configure the escrow contract." : "Create a milestone or clear the current search/filter."}</p></div>}
              {!isDemoMode && milestones.length === 50 && <p className="mt-3 text-[8px] text-slate-600">Showing up to the contract view's first 50 records; the view can be paginated for older milestones.</p>}
            </section>

            {selectedMilestone && <section id="selected-milestone" className="mt-7 scroll-mt-24 space-y-4" aria-labelledby="selected-milestone-heading">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mono-label text-[8px] text-proof">SELECTED MILESTONE · #{selectedMilestone.id}</p><h2 id="selected-milestone-heading" className="mt-1 text-lg font-semibold text-white">{getMilestoneTitle(selectedMilestone)}</h2><p className="mt-1 text-[9px] text-slate-500">Employer {shorten(selectedMilestone.employer, 10, 6)} <span className="mx-1 text-slate-700">·</span> Contractor {shorten(selectedMilestone.contractor, 10, 6)}</p></div><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] ${getMilestoneBadge(selectedMilestone).className}`}>{getMilestoneBadge(selectedMilestone).label}</span><span className="font-mono text-[9px] text-slate-500">{formatAssetAmount(selectedMilestone.amount, getMilestoneAssetDisplay(selectedMilestone))} {getMilestoneAssetDisplay(selectedMilestone).symbol}</span></div></div>
              <EscrowFlowVisualizer key={`flow-${selectedMilestone.id}`} milestone={selectedMilestone} network={network} verifierPreview={previews[selectedMilestone.id] ?? null} />
              <ContractorView key={`contractor-${selectedMilestone.id}`} milestone={selectedMilestone} isDemoMode={isDemoMode} onRefresh={async () => { await refreshMilestones(); }} onDemoProof={updateDemoProof} onVerifierResult={addVerifierPreview} />
              <SolverQuotes key={`quotes-${selectedMilestone.id}`} milestone={selectedMilestone} />
              <AttackSandbox key={`attack-${selectedMilestone.id}`} milestoneId={selectedMilestone.id} />
              <SelectiveDisclosureReceipt key={`receipt-${selectedMilestone.id}`} milestone={selectedMilestone} network={network} isDemoMode={isDemoMode} />
            </section>}

            <section id="policy-notes" className="mt-7 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4"><div className="flex items-center gap-2"><ShieldCheck size={13} className="text-proof" /><h3 className="text-[10px] font-semibold text-white">Policy guard</h3></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">The verifier uses a dedicated Function-Call key scoped to `record_attestation`. The drawer asks NEAR RPC for the pinned key's current permission; a public-key fingerprint alone is not proof of scope.</p><button onClick={() => selectedMilestone?.attestation && document.getElementById("selected-milestone")?.scrollIntoView({ behavior: "smooth" })} className="mt-3 text-[9px] text-proof hover:underline">Inspect selected attestation</button></div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4"><div className="flex items-center gap-2"><ArrowLeftRight size={13} className="text-slate-400" /><h3 className="text-[10px] font-semibold text-white">Settlement boundary</h3></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">1Click quotes are signature-verified previews. The contract records cross-chain payout intent, but a quote does not dispatch funds; an adapter must be configured and its result reconciled onchain.</p><p className="mt-3 flex items-center gap-1.5 text-[8px] text-amber-100/70"><CircleHelp size={10} />Provider timing is an estimate, not a sub-30-second SLA.</p></div>
            </section>

            <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/[0.05] pt-4 text-[8px] text-slate-700 sm:flex-row"><div>Non-custodial by design <span className="mx-1">·</span> Built on NEAR</div><div className="flex items-center gap-4"><span className="flex items-center gap-1"><span className={`h-1 w-1 rounded-full ${loadError && !isDemoMode ? "bg-red-300" : "bg-proof/70"}`} />{isDemoMode ? "Sample data" : loadError ? "RPC unavailable" : "RPC connected"}</span><span className="flex items-center gap-1"><Clock3 size={9} />{lastSync ? `Updated ${lastSync.toLocaleTimeString()}` : "Waiting for RPC"}</span></div></footer>
          </div>
        </main>
      </div>
      {modalOpen && <CreateMilestoneModal onClose={() => setModalOpen(false)} onCreate={createMilestone} isSubmitting={creating} employerAccountId={accountId} />}
    </div>
  );
}
