"use client";

import { useState, type FormEvent } from "react";
import { BadgeCheck, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AttestationResult = {
  status: "approved" | "revision_requested" | "rejected";
  score: number;
  confidence: number;
  summary: string;
  evidence: Array<{ requirement: string; result: "met" | "partial" | "unmet"; explanation: string }>;
  model: string;
  createdAt: string;
};

export function AttestationReview({ escrowId, milestoneId, title }: { escrowId: string; milestoneId: string; title: string }) {
  const [requirements, setRequirements] = useState(title);
  const [submission, setSubmission] = useState("");
  const [references, setReferences] = useState("");
  const [result, setResult] = useState<AttestationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          escrowId,
          milestoneId,
          title,
          requirements: requirements.split("\n").map((item) => item.trim()).filter(Boolean),
          submission: {
            text: submission.trim(),
            references: references.split(/\s+/).map((item) => item.trim()).filter(Boolean),
          },
        }),
      });
      const body = await response.json() as { attestation?: AttestationResult; message?: string; error?: string };
      if (!response.ok || !body.attestation) throw new Error(body.message ?? body.error ?? `Verifier returned HTTP ${response.status}.`);
      setResult(body.attestation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verifier request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  const statusTone = result?.status === "approved" ? "text-proof" : result?.status === "revision_requested" ? "text-amber-200" : "text-rose-300";
  return (
    <section className="mt-7 rounded-xl border border-proof/10 bg-[#0a0e15]/75 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2"><Sparkles size={14} className="text-proof"/><h3 className="text-sm font-medium text-white">Deliverable attestation</h3><span className="ml-auto rounded-full border border-proof/15 px-2 py-0.5 text-[9px] text-proof/80">ADVISORY ONLY</span></div>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block"><span className="mb-1.5 block text-[11px] text-slate-400">Requirements · one per line</span><textarea required maxLength={10_000} value={requirements} onChange={(event) => setRequirements(event.target.value)} rows={2} className="w-full resize-y rounded-lg border border-white/[0.08] bg-[#0b0f17] px-3 py-2.5 text-xs text-slate-200 focus:border-proof/30 focus:outline-none" /></label>
        <label className="block"><span className="mb-1.5 block text-[11px] text-slate-400">Submitted deliverable</span><textarea required maxLength={20_000} value={submission} onChange={(event) => setSubmission(event.target.value)} rows={4} placeholder="Describe the completed milestone and evidence for each requirement…" className="w-full resize-y rounded-lg border border-white/[0.08] bg-[#0b0f17] px-3 py-2.5 text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-proof/30 focus:outline-none" /></label>
        <label className="block"><span className="mb-1.5 block text-[11px] text-slate-400">Evidence URLs · optional, separated by spaces</span><input value={references} onChange={(event) => setReferences(event.target.value)} placeholder="https://…" className="w-full rounded-lg border border-white/[0.08] bg-[#0b0f17] px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-proof/30 focus:outline-none" /></label>
        <Button type="submit" variant="secondary" disabled={isLoading || !requirements.trim() || !submission.trim()} className="w-full">{isLoading ? <LoaderCircle size={14} className="animate-spin"/> : <BadgeCheck size={14}/>} {isLoading ? "Reviewing evidence…" : "Request advisory review"}</Button>
      </form>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">A verifier result is evidence for human review only. It does not approve a milestone or move funds.</p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/15 bg-rose-400/[0.04] px-3 py-2 text-[11px] text-rose-200">{error}</p>}
      {result && <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3.5" aria-live="polite"><div className="flex items-center justify-between gap-3"><span className={`text-xs font-semibold uppercase tracking-wide ${statusTone}`}>{result.status.replaceAll("_", " ")}</span><span className="font-mono text-sm text-white">{result.score}<span className="text-slate-500">/100</span></span></div><p className="mt-2 text-[11px] leading-relaxed text-slate-400">{result.summary}</p><div className="mt-3 space-y-2">{result.evidence.map((item, index) => <div key={`${item.requirement}-${index}`} className="border-t border-white/[0.055] pt-2"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="text-slate-300">{item.requirement}</span><span className="shrink-0 text-slate-500">{item.result}</span></div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{item.explanation}</p></div>)}</div><p className="mt-3 font-mono text-[9px] text-slate-600">{result.model} · {new Date(result.createdAt).toLocaleString()}</p></div>}
    </section>
  );
}
