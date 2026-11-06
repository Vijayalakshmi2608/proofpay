import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const MOCK_POLICY_ERROR = "Panic: PolicyLimitExceeded(Requested: 5000, Allowed: 1000)";

export function evaluateMockAttack(requestedUsd: number, allowedUsd: number): { blocked: boolean; error: string } {
  if (!Number.isFinite(requestedUsd) || !Number.isFinite(allowedUsd) || requestedUsd < 0 || allowedUsd < 0) {
    throw new Error("Attack simulation amounts must be finite non-negative numbers.");
  }
  return { blocked: requestedUsd > allowedUsd, error: MOCK_POLICY_ERROR };
}

export function AttackSandbox({ milestoneId }: { milestoneId: number }) {
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  function simulateAttack() {
    setBusy(true);
    // This is deliberately a local policy mock. It has no wallet, RPC, signer, or transaction call.
    window.setTimeout(() => {
      try {
        const result = evaluateMockAttack(5_000, 1_000);
        if (!result.blocked) throw new Error("The mock policy should have blocked the oversized request.");
        setAttempted(true);
        toast.error("Rogue AI request blocked · simulation", {
          description: `${result.error} — MOCK OUTPUT ONLY; not an on-chain error. No transaction was signed or broadcast.`,
        });
      } catch (error) {
        toast.error("Attack simulation failed", { description: error instanceof Error ? error.message : "Unknown simulation failure." });
      } finally {
        setBusy(false);
      }
    }, 180);
  }

  return (
    <section aria-labelledby="attack-sandbox-title" className="rounded-xl border border-red-300/15 bg-gradient-to-br from-red-400/[0.055] to-transparent p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-red-300/15 bg-red-300/[0.06] p-2 text-red-200"><ShieldAlert size={15} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 id="attack-sandbox-title" className="text-xs font-semibold text-white">Rogue AI security sandbox</h3><span className="rounded border border-red-200/15 px-1.5 py-0.5 font-mono text-[8px] text-red-100/80">SIMULATION ONLY</span></div>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-400">Milestone #{milestoneId}: model a prompt-injected verifier requesting <strong className="text-white">$5,000</strong> against an illustrative <strong className="text-white">$1,000</strong> auto-approve limit.</p>
          <p className="mt-2 font-mono text-[8px] text-slate-600">Mock tx: release_payout({milestoneId}, $5,000) → denied by the $1,000 policy. No wallet or RPC request is sent.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={simulateAttack} disabled={busy} aria-label="Simulate Rogue AI / Prompt Injection Attack" className="border-red-300/20 text-red-100 hover:bg-red-300/[0.07]">
              <ShieldAlert size={13} />{busy ? "Checking policy…" : "Simulate Rogue AI / Prompt Injection Attack"}
            </Button>
            {attempted && <span role="status" className="inline-flex items-center gap-1 text-[9px] text-proof"><ShieldCheck size={12} />Over-limit request denied in mock policy.</span>}
          </div>
          {attempted && <pre className="mt-3 overflow-x-auto rounded-lg border border-red-300/15 bg-black/25 p-3 font-mono text-[9px] leading-relaxed text-red-100">{MOCK_POLICY_ERROR}{"\n"}SIMULATED · NOT AN ON-CHAIN ERROR · NO TRANSACTION SENT</pre>}
        </div>
      </div>
    </section>
  );
}
