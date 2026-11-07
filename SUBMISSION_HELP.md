# ProofPay X Demo Post Draft

**Target length:** 45 seconds. Record the real app and a testnet transaction only when one has actually been run. The current reproducibility harness is local/mock; the current 1Click screen is quote-only, recent dry quote requests have received an upstream HTTP 400, and the Ed25519 TEE-style signature is not hardware attestation. Do not fabricate a successful quote, tx hash, or TEE claim for footage.

## Timed script

### 0:00-0:10 — The trust gap

**Voiceover:** “A contractor can deliver across borders and still face delayed payment. An employer can pay before the work is independently checked. ProofPay puts each milestone behind an explicit proof and release policy.”

**Visual:** Show the ProofPay milestone dashboard. Highlight `Escrow Locked` and the proof checklist. If the footage is demo mode, keep the `Illustrative demo` label visible.

### 0:10-0:25 — Proof and restricted verifier

**Voiceover:** “The contractor submits a proof reference. ProofPay checks it against milestone criteria, then a dedicated NEAR Function-Call key can call only `record_attestation`. It cannot call payout methods or transfer NEAR. NEAR rejects an out-of-scope method before the contract runs.”

**Visual:** Show a real RPC-verified key permission and real transaction hash only if available. Otherwise show the local screening output with `MOCK` in frame. Label the current Ed25519 payload signature `software mock - not hardware TEE`.

### 0:25-0:45 — Cross-chain quote and policy attack

**Voiceover:** “For another chain, ProofPay is built to request a signed NEAR Intents 1Click quote; when the provider responds, this is a dry preview, not an instant payout. No deposit address or funds move. Now simulate a five-thousand-dollar release against a one-thousand-dollar limit. The Function-Call scope blocks `release_payout`; the contract separately requires the employer above the limit. The guardrail is visible before an agent can reach payout.”

**Visual:** If a live dry quote succeeds, show its provider estimate and minimum output with the dry-run label; otherwise show the bounded provider error and do not invent quote values. Then click `Simulate Adversarial Attack` and show the red `Blocked by Function-Call Policy` toast. Keep `SIMULATION - NO TRANSACTION SENT` on screen unless an actual testnet rejection has been recorded.

## Suggested X caption

ProofPay: milestone escrow for cross-border work. Proof stays tied to contract state, the verifier key is scoped to attestation, and payout policy stays outside the agent's authority. Quote preview only; no bridge completion or hardware-TEE claim in this demo.

## Before recording

- Replace the demo placeholders with a public dashboard URL and the real repository URL.
- If showing a transaction, confirm its network and hash in an explorer; do not label a mock hash as an on-chain transaction.
- The current contract has no `PolicyLimitExceeded` error. Its over-budget release error is `Only the employer can release above auto_release_limit`; a Function-Call key attempting `release_payout` is expected to fail at NEAR's access-key method check.
- The local repository does not contain `HACKATHON.md`. The public NEAR Protocol announcement describes additional application fields, so confirm the organizer's current submission schema before sending the payload utility's JSON.
