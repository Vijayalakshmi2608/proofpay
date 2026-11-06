import { ArrowUpRight, CheckCircle2, ChevronRight, Clock3, LockKeyhole, ShieldAlert } from "lucide-react";
import { formatAssetAmount, getMilestoneAssetDisplay, getMilestoneBadge, getMilestoneTitle, isAutoReleaseEligible, shorten } from "@/lib/milestone-utils";
import type { OnChainMilestone } from "@/lib/proofpay-types";

export function MilestoneCard({ milestone, onSelect }: { milestone: OnChainMilestone; onSelect: (milestone: OnChainMilestone) => void }) {
  const badge = getMilestoneBadge(milestone);
  const eligible = isAutoReleaseEligible(milestone);
  const isAttested = milestone.status === "attested";
  const isReleased = milestone.status === "released";
  const isDisputed = milestone.status === "disputed" || milestone.status === "refunded";
  const title = getMilestoneTitle(milestone);
  const asset = getMilestoneAssetDisplay(milestone);

  return (
    <article className={`group rounded-xl border bg-[#101620]/85 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.15] hover:bg-[#131b27] sm:p-5 ${isAttested || isReleased ? "border-proof/15 shadow-[0_0_24px_rgba(0,236,66,.05)]" : "border-white/[0.07]"}`}>
      <button className="w-full text-left focus-visible:outline-none" onClick={() => onSelect(milestone)} aria-label={`Open ${title}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${isDisputed ? "border-red-300/15 bg-red-300/[0.05] text-red-200" : isAttested || isReleased ? "border-proof/20 bg-proof/[0.07] text-proof" : "border-white/[0.07] bg-white/[0.035] text-slate-400"}`}>
              {isDisputed ? <ShieldAlert size={16} /> : isAttested || isReleased ? <CheckCircle2 size={16} /> : <LockKeyhole size={15} />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{title}</p>
              <p className="mt-1 truncate text-[10px] text-slate-500">#{milestone.id} <span className="mx-1 text-slate-700">·</span> {milestone.destination_chain}</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium ${badge.className}`}>
            {milestone.status === "payout_pending" ? <Clock3 size={10} className="animate-pulse" /> : <i className={`h-1.5 w-1.5 rounded-full ${isAttested || isReleased ? "bg-proof" : isDisputed ? "bg-red-300" : "bg-slate-400"}`} />}
            {badge.label}
          </span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="mono-label text-[8px] text-slate-600">LOCKED AMOUNT</p>
            <p className="mt-1 font-mono text-xl tracking-tight text-white">{formatAssetAmount(milestone.amount, asset)} <span className="text-[11px] text-slate-500">{asset.symbol}</span></p>
          </div>
          <div className="text-right">
            <p className="mono-label text-[8px] text-slate-600">AUTO-APPROVE THRESHOLD</p>
            <p className={`mt-1 font-mono text-xs ${eligible ? "text-proof" : "text-slate-300"}`}>{formatAssetAmount(milestone.auto_release_limit, asset)} {asset.symbol}</p>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-white/[0.055] bg-black/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 text-[9px]">
            <span className="flex items-center gap-1.5 text-slate-500"><i className={`h-1.5 w-1.5 rounded-full ${eligible ? "bg-proof" : "bg-amber-200/80"}`} />{milestone.auto_release_limit === "0" ? "Employer approval required" : eligible ? "Within auto-approve limit" : "Above auto-approve limit"}</span>
            <span className="font-mono text-slate-600">{shorten(milestone.contractor, 10, 5)}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={`h-full rounded-full transition-all duration-500 ${eligible ? "bg-proof shadow-[0_0_10px_rgba(0,236,66,.55)]" : "bg-amber-200/60"}`} style={{ width: milestone.auto_release_limit === "0" ? "0%" : eligible ? "100%" : "58%" }} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.055] pt-3">
          <div className="min-w-0">
            <p className="mono-label text-[8px] text-slate-600">PROOF HASH</p>
            <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{milestone.proof_hash ? shorten(milestone.proof_hash, 14, 8) : "Not submitted"}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500 transition group-hover:text-proof">Inspect <ChevronRight size={13} /><ArrowUpRight size={11} /></span>
        </div>
      </button>
    </article>
  );
}
