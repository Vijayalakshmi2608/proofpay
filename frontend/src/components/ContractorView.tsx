import { useMemo, useState, type FormEvent } from "react";
import { Check, FileUp, LoaderCircle, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { isValidProofUrl, sha256Hex, shorten } from "@/lib/milestone-utils";
import { requestDryVerification, type VerifierDeliverable } from "@/lib/verifier-client";
import type { DeliverableVerificationResponse, OnChainMilestone } from "@/lib/proofpay-types";

type DeliverableKind = "github_commit" | "file_hash" | "raw_text";

function parseGithubCommit(raw: string): { repository: string; commitHash: string } | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "commit") return null;
    const commitHash = parts[3].replace(/\.(?:patch|diff)$/i, "");
    if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(commitHash)) return null;
    return { repository: `${parts[0]}/${parts[1]}`, commitHash: commitHash.toLowerCase() };
  } catch {
    return null;
  }
}

function normalizeFileHash(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/^(?:sha256:|0x)/, "");
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function ContractorView({
  milestone,
  isDemoMode,
  onRefresh,
  onDemoProof,
  onVerifierResult,
}: {
  milestone: OnChainMilestone;
  isDemoMode: boolean;
  onRefresh: () => Promise<void>;
  onDemoProof: (input: { milestoneId: number; proofHash: string; proofUrl: string }) => void;
  onVerifierResult: (result: DeliverableVerificationResponse) => void;
}) {
  const { accountId, connect, submitProofTransaction } = useWallet();
  const [kind, setKind] = useState<DeliverableKind>("github_commit");
  const [proofUrl, setProofUrl] = useState(milestone.proof_url || "");
  const [evidence, setEvidence] = useState("");
  const [lastDeliverable, setLastDeliverable] = useState<VerifierDeliverable | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [preview, setPreview] = useState<DeliverableVerificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidenceLabel = kind === "github_commit" ? "GitHub commit URL" : kind === "file_hash" ? "SHA-256 file hash" : "Deliverable text";
  const existingProof = Boolean(milestone.proof_hash && milestone.proof_url);
  const isContractor = accountId === milestone.contractor;
  const isSubmittable = !existingProof && milestone.status === "pending";

  const helper = useMemo(() => {
    if (kind === "github_commit") return "Paste a GitHub commit URL. Its SHA is recorded onchain and the verifier checks repository files against the employer criteria.";
    if (kind === "file_hash") return "Paste a 64-character SHA-256 digest. File-hash attestation passes only if the employer's on-chain criteria configured the same expected hash.";
    return "Paste the exact text to attest. The SHA-256 of these exact bytes is submitted as the on-chain proof hash.";
  }, [kind]);

async function prepareDeliverable(): Promise<{ proofHash: string; proofUrlValue: string; deliverable: VerifierDeliverable }> {
    const proofUrlValue = proofUrl.trim();
    if (!isValidProofUrl(proofUrlValue)) throw new Error("Proof URL must be a no-whitespace https://, ipfs://, or ar:// link.");
    if (kind === "github_commit") {
      const parsed = parseGithubCommit(evidence);
      if (!parsed) throw new Error("Enter a valid https://github.com/OWNER/REPO/commit/HASH URL.");
      return { proofHash: parsed.commitHash, proofUrlValue, deliverable: { kind: "github_commit", ...parsed } };
    }
    if (kind === "file_hash") {
      const digest = normalizeFileHash(evidence);
      if (!digest) throw new Error("Enter a 64-character SHA-256 hexadecimal hash.");
      return { proofHash: `sha256:${digest}`, proofUrlValue, deliverable: { kind: "file_hash", hash: digest } };
    }
    if (!evidence.trim()) throw new Error("Paste the exact text deliverable to calculate its proof hash.");
    return { proofHash: `sha256:${await sha256Hex(evidence)}`, proofUrlValue, deliverable: { kind: "raw_text", text: evidence } };
  }

  async function submitProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let prepared: Awaited<ReturnType<typeof prepareDeliverable>>;
    try {
      prepared = await prepareDeliverable();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Proof data is invalid.");
      return;
    }
    setLastDeliverable(prepared.deliverable);
    if (isDemoMode || milestone.demoOnly) {
      onDemoProof({ milestoneId: milestone.id, proofHash: prepared.proofHash, proofUrl: prepared.proofUrlValue });
      toast.success("Demo proof submitted", { description: "Illustrative only — no NEAR transaction was sent." });
      return;
    }
    if (!accountId) {
      connect();
      setError("Connect the contractor NEAR wallet before submitting proof.");
      return;
    }
    if (!isContractor) {
      setError(`Connect as ${milestone.contractor} to submit proof for this milestone.`);
      return;
    }
    setSubmitting(true);
    try {
      await submitProofTransaction({ milestoneId: milestone.id, proofHash: prepared.proofHash, proofUrl: prepared.proofUrlValue });
      toast.success("Proof submitted on NEAR", { description: `Milestone #${milestone.id} · transaction confirmed by Wallet Selector` });
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The NEAR wallet transaction failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runDryVerifier() {
    setError(null);
    let deliverable = lastDeliverable;
    if (!deliverable && kind === "github_commit") {
      const parsed = parseGithubCommit(evidence || proofUrl);
      if (parsed) deliverable = { kind: "github_commit", ...parsed };
    } else if (!deliverable && kind === "file_hash") {
      const digest = normalizeFileHash(evidence || milestone.proof_hash);
      if (digest) deliverable = { kind: "file_hash", hash: digest };
    } else if (!deliverable && kind === "raw_text" && evidence.trim()) {
      deliverable = { kind: "raw_text", text: evidence };
    }
    if (!deliverable) {
      setError("Enter the same deliverable that was submitted onchain, then request a verifier preview.");
      return;
    }
    setVerifying(true);
    try {
      const result = await requestDryVerification(milestone.id, deliverable, AbortSignal.timeout(25_000));
      setPreview(result);
      onVerifierResult(result);
      toast.success(result.passed ? "Verifier preview passed" : "Verifier preview did not pass", { description: "Dry run only — no on-chain attestation was submitted." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The verifier preview could not be completed.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/[0.07] bg-[#101620]/70 p-4 sm:p-5" aria-labelledby={`contractor-view-${milestone.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-proof/15 bg-proof/[0.05] text-proof"><FileUp size={15} /></div><div><h3 id={`contractor-view-${milestone.id}`} className="text-xs font-semibold text-white">Contractor proof</h3><p className="mt-1 text-[9px] text-slate-500">Paste a commit, artifact hash, or text deliverable.</p></div></div>
        {existingProof && <span className="inline-flex items-center gap-1 rounded-full border border-proof/15 bg-proof/[0.04] px-2 py-1 text-[9px] text-proof"><Check size={10} />Onchain proof</span>}
      </div>

      <form onSubmit={(event) => void submitProof(event)} className="mt-4 space-y-3">
        <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-slate-400">Deliverable type</span><select value={kind} onChange={(event) => setKind(event.target.value as DeliverableKind)} className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090d14] px-3 text-[10px] text-slate-200 focus:border-proof/35 focus:outline-none"><option value="github_commit">GitHub commit URL</option><option value="file_hash">File SHA-256</option><option value="raw_text">Raw text</option></select></label>
        {kind === "raw_text" ? <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-slate-400">Exact text</span><textarea rows={4} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Paste the text that will be hashed and checked against the milestone criteria…" className="w-full resize-y rounded-lg border border-white/[0.08] bg-[#090d14] px-3 py-2 text-[10px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-proof/35 focus:outline-none" /></label> : <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-slate-400">{evidenceLabel}</span><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder={kind === "github_commit" ? "https://github.com/org/repo/commit/…" : "64 hex characters"} className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090d14] px-3 font-mono text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-proof/35 focus:outline-none" /></label>}
        <label className="block"><span className="mb-1.5 block text-[9px] font-medium text-slate-400">Proof link (https, IPFS, or Arweave)</span><input value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="https://github.com/org/repo/commit/…" className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090d14] px-3 font-mono text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-proof/35 focus:outline-none" /></label>
        <p className="text-[9px] leading-relaxed text-slate-600">{helper}</p>
        {existingProof && <p className="truncate rounded-md border border-white/[0.05] bg-black/10 px-2.5 py-2 font-mono text-[9px] text-slate-500">Recorded hash: {shorten(milestone.proof_hash, 20, 10)}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-300/15 bg-red-300/[0.04] px-3 py-2 text-[9px] leading-relaxed text-red-100">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t border-white/[0.05] pt-3">
          {isSubmittable ? <Button type="submit" size="sm" disabled={submitting || verifying}>
            {submitting ? <><LoaderCircle size={13} className="animate-spin" />Submitting…</> : isDemoMode ? <><Send size={12} />Simulate proof submit</> : <><Send size={12} />Submit proof onchain</>}
          </Button> : existingProof ? <Button type="button" size="sm" variant="secondary" disabled={verifying || isDemoMode || milestone.demoOnly || milestone.status !== "pending"} onClick={() => void runDryVerifier()}>
            {verifying ? <><LoaderCircle size={13} className="animate-spin" />Inspecting…</> : <><ShieldCheck size={12} />Request verifier preview</>}
          </Button> : <Button type="button" size="sm" variant="secondary" disabled>Proof submission unavailable</Button>}
        </div>
        {preview && <div className={`rounded-lg border px-3 py-2.5 ${preview.passed ? "border-proof/15 bg-proof/[0.035]" : "border-amber-200/15 bg-amber-200/[0.025]"}`}>
          <p className={`text-[10px] font-medium ${preview.passed ? "text-proof" : "text-amber-100"}`}>{preview.passed ? "Verifier preview passed" : "Verifier preview needs review"} <span className="ml-1 font-mono text-[8px] text-slate-500">· DRY RUN</span></p>
          <p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">{preview.reasoning}</p>
          <p className="mt-2 flex items-center gap-1 text-[8px] text-slate-600"><LockKeyhole size={10} />Software signature only · no hardware TEE or on-chain write</p>
        </div>}
      </form>
    </section>
  );
}
