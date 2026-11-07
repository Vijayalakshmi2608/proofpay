# ProofPay

**Milestone escrow for global work: lock funds on NEAR, verify deliverables, and quote cross-chain payouts without giving an AI agent withdrawal authority.**

| Demo resource | Status |
| --- | --- |
| Live dashboard | Not publicly deployed yet. Add a stable public URL before submission; use the local quickstart below meanwhile. |
| Demo post / video | Not recorded yet. Add the public X post URL after recording. The timed voiceover draft is in [SUBMISSION_HELP.md](SUBMISSION_HELP.md). |
| Source repository | Use the public repository URL selected for the submission; this workspace does not publish that URL in the README. |

## The problem and the solution

Independent contractors often rely on trust, invoices, and manual dispute handling when work and payment cross borders. Employers face the reverse risk: releasing payment before they can verify that the agreed deliverable arrived. ProofPay makes the milestone, evidence reference, verifier decision, and release policy observable in a NEAR contract. It adds dry cross-chain quote previews without presenting a quote as a completed payout.

| Workflow concern | Typical manual workflow | ProofPay prototype |
| --- | --- | --- |
| Custody | Platform, employer, or a separate escrow provider controls the funds and process. | The NEAR escrow contract holds native NEAR or an owner-allowlisted NEP-141 token for a milestone. |
| Evidence | Links, chat messages, and approval records live in separate systems. | The contract records a proof hash/URI and a verifier attestation tied to a milestone. The contract does not fetch or judge the linked file itself. |
| Agent authority | A service credential may have broad account access if it is misconfigured. | The verifier key policy is scoped to one contract receiver and `record_attestation`; NEAR rejects other methods before contract execution. |
| Cross-chain payout | A quote, source deposit, bridge execution, and destination finality may be separate manual steps. | The service can request a signed 1Click quote in dry mode. A real cross-chain adapter and finality proof are not implemented here. |
| Timing and price | Estimates can be mistaken for commitments. | The UI displays provider quote fields as estimates; it does not promise execution, a fixed fee, or settlement in under 30 seconds. |

## Quickstart: do X -> see Y

This path targets a local demo in under two minutes **after Node.js, pnpm, and dependencies are available**. A first clone or dependency download may take longer. The repository URL has not been made public in this workspace, so replace the clone URL with the one used for judging.

### 1. Clone and install

```bash
export REPO_URL='https://github.com/YOUR_ORG/ProofPay.git' # replace with the public repository URL

git clone "$REPO_URL" proofpay
cd proofpay
corepack enable
pnpm install
cp .env.example .env
```

The example environment uses `NEXT_PUBLIC_DEMO_MODE=true`, heuristic verifier mode, dry quotes, and disabled on-chain verifier writes. No wallet key or API key is needed for the local demo.

### 2. Start the app and verifier

In terminal 1:

```bash
pnpm dev
```

In terminal 2:

```bash
pnpm dev:verifier
```

Open `http://localhost:3000` to see the dashboard. Demo mode does not sign wallet transactions or move funds.

### 3. Run the screening flow

In terminal 3, from the repository root:

```bash
npm run test:demo
```

**See:** the existing dashboard/verifier HTTP smoke test, then a six-step deterministic local escrow mock. The mock prints the milestone transition, a mock attestation reference, and a dry 1Click quote when the provider responds. If the external quote API is unavailable, the script prints a bounded warning and continues; it does not create a deposit address or make a non-dry request. This is a screening harness, not a NEAR Testnet deployment or on-chain transaction report.

To produce the task-specified submission JSON without submitting it:

```bash
npm run prepare:submission
```

The utility writes the JSON payload to stdout and validation notes to stderr. Supply an alternate idea with `npm run prepare:submission -- --idea 'Your 20-2000 character idea'` or `--idea-file path/to/idea.txt`.

## NEAR ecosystem primitives

### NEAR Intents and 1Click

NEAR Intents lets a user express an outcome and lets off-chain solvers compete to provide a quote; accepted intents are then executed through the relevant settlement contracts.[4] The 1Click API exposes a dry request mode that returns a quote without executing the swap. A normal origin-chain flow then requires a deposit and status tracking. Quote expiry, signed minimum output, and the provider's `timeEstimate` are data to display—not guarantees of execution or settlement speed.[5]

ProofPay's verifier service requests quotes from the live token registry, verifies the provider-signed response, and limits supported source/destination identities. The dashboard proxy forces `dry: true`. The current live registry is reachable, but recent dry quote attempts have failed closed with an upstream error. The contract can emit a cross-chain intent after handing the source asset to a configured adapter; this repository does not include a live adapter, destination-chain transfer, or independent destination-finality verifier. NEAR Intents is therefore an integration point and quote preview here, not a completed bridge.

### Function-Call Access Keys

NEAR Function-Call keys can be restricted to one receiver contract and selected method names. They cannot attach NEAR to calls, and an optional finite allowance bounds gas spending.[1] ProofPay creates a verifier key limited to the escrow receiver and the single method `record_attestation`; a separate privileged provisioner is needed to add that key to the verifier account. The key's allowance is a gas budget, not a milestone spending limit.

A NEAR contract sees the verifier account as the caller; it cannot inspect which access key signed the transaction. The contract also pins a configured verifier public key in the attestation record, but that field does not prove which transaction key was used. The actual method restriction is enforced by the NEAR runtime before the contract call.

### Sub-accounts

NEAR named accounts can create sub-accounts within their own namespace, and each sub-account is a distinct account rather than an account automatically controlled by its parent.[2] A production deployment can use a dedicated verifier account such as a separately managed child account to isolate balances and keys from an employer's or app operator's primary account. ProofPay's key-manager supports a configured verifier account; it does not create sub-accounts automatically. A single-key, Function-Call-only account can be difficult to recover or reconfigure, so operators must plan key rotation and account recovery before deployment.[1]

### NEAR AI Cloud and TEE integration

NEAR AI Cloud documents private inference using hardware-backed Trusted Execution Environments and cryptographic attestation; supported response signatures can be verified against the attested signer.[3] ProofPay is **not currently integrated with NEAR AI Cloud**. The verifier uses heuristic or OpenAI-compatible review plus deterministic checks, and its TEE-style Ed25519 wrapper is a software signature/mock—not hardware isolation, a NEAR AI Cloud attestation report, or proof that code ran in a TEE.

The service boundary is designed so a future integration can obtain NEAR AI Cloud attestation evidence and validate the required report/signature before attaching it to a verification result. Until that work is implemented and independently checked, judges should treat the existing signature only as integrity evidence for a fixed software payload.

## Security and policy guardrails

- The verifier does not receive an employer's Full-Access key. It uses a dedicated Function-Call key with receiver `<escrow contract>` and method `record_attestation` only. The key manager checks this exact scope and a finite gas allowance before the service may sign.
- A `release_payout` or `transfer_all` call signed by that verifier key should be rejected by NEAR at the access-key method check. The contract does not return an error named `PolicyLimitExceeded` for this attack: the protocol-level failure is a method-permission rejection. The contract's separate over-limit caller check is `Only the employer can release above auto_release_limit`.
- The contract permits any caller to trigger a release only when the milestone is attested and `amount <= auto_release_limit`; above the limit, only the employer can release. The auto-release limit applies in the escrow asset's base units, not an inferred USD value.
- The contract cannot verify an access-key identity inside `record_attestation`. Its configured verifier-account check and the NEAR-level key allowlist are complementary controls, not the same control.
- Deliverable fields are untrusted. Deterministic criteria and fixed response schemas remain authoritative; prompt text cannot choose a contract method or change the response structure.
- Cross-chain intent status remains pending until an adapter reports the external result. Do not infer destination-chain finality from a quote or a local toast.
- The `Simulate Adversarial Attack` control is a local UI simulation. It does not sign or broadcast a transaction. The screening script likewise uses a local mock unless a separately configured live testnet procedure is run.

For a real testnet deployment, read the deployment and key-provisioning steps below, set up a dedicated verifier key, and run `npm run verify:key-permissions` from `agent-verifier` only after configuring an authorized testnet account. That command sends a negative test transaction to NEAR Testnet and verifies the structured method-denial error. Do not place a Full-Access private key in the agent service.

## Testnet setup and current integration boundaries

The Rust contract supports native NEAR and allowlisted NEP-141 escrow, proof submission, verifier-account attestations, budget-gated release, disputes, and asynchronous transfer reconciliation. It cannot independently attest to source-file contents or cross-chain destination completion. For deployment, provide a funded testnet account, a deployed testnet verifier Function-Call key, and the public verifier key in `.env`; then run:

```bash
pnpm build
pnpm deploy:testnet
```

The deployment script uses the authenticated `near` CLI keychain. It does not create or provision the verifier key itself. The deterministic `scripts/test-reproducibility.ts` uses illustrative USD fixture units; it is not evidence of a $500 fiat conversion, a deployment, a testnet transaction, or an on-chain `Released` status.

## Hackathon submission and code diff

The repository's `HACKATHON.md` is a ProofPay-maintained checklist, not the official organizer spec. The payload utility follows the exact fields supplied in the coding request—`projectName`, `tracks`, `idea`, and `requestId`—and does not POST the result. NEAR Protocol's public announcement describes additional application information such as team lead, email, team size, NEAR account, repository link, demo post, and short description.[6] Confirm the organizer's current API schema before sending the four-field payload.

**Pre-window baseline:** `d0d9ed11e1b5e4883e30112df5cbfc90d9bccea8` (`Add scoped verifier Function-Call key tooling`, 2026-10-30), the latest repository commit before the announced opening. NEAR Protocol announced the submission window opens on 2026-11-01 at 00:00 UTC and lasts two weeks.[6] This baseline is a Git timestamp comparison, not a claim about organizer acceptance or an end date. To inspect the exact committed diff after the submission artifacts are checkpointed:

```bash
git log --reverse --oneline d0d9ed11e1b5e4883e30112df5cbfc90d9bccea8..HEAD
git diff --stat d0d9ed11e1b5e4883e30112df5cbfc90d9bccea8..HEAD
git diff d0d9ed11e1b5e4883e30112df5cbfc90d9bccea8..HEAD
```

## Advanced security and receipt features

The dashboard's **Rogue AI security sandbox** simulates a prompt-injected verifier requesting $5,000 against an illustrative $1,000 policy limit. Its `PolicyLimitExceeded(Requested: 5000, Allowed: 1000)` text is mock output only, not an on-chain panic. A real restricted NEAR Function-Call key cannot invoke `release_payout`; NEAR denies the method before contract execution.

Released, successfully attested work can produce a contract-view SHA-256 receipt commitment. The receipt page and accountant CSV omit the employer account. This is selective disclosure of receipt fields, not a zero-knowledge proof, hardware attestation, or independent validation of source work.

The **SolverQuotes** panel switches among native Ethereum USDC, Solana SOL and Bitcoin BTC destinations using the filtered live registry and signature-verified `dry: true` quotes. It never executes a payout or displays a fundable address. Provider errors are reported as such; no quote values are fabricated.

Run `npm run zip` to create `proofpay-hackathon-bundle.zip`; the packager includes source and safe environment examples, and excludes dependency/build/VCS folders and secret `.env*` files. `npm run test:demo` runs repository tests, the available HTTP smoke check, the bounded local security/1Click reproducibility flow, then packages the bundle. With no local services running, the HTTP smoke step is explicitly skipped. The total target is under 30 seconds on a warm install; external provider latency is bounded by a short timeout.

## License

ProofPay is released under the [MIT License](LICENSE).

## References

[1]: https://docs.near.org/protocol/accounts-contracts/access-keys "NEAR Docs: Access Keys"
[2]: https://docs.near.org/protocol/accounts-contracts/account-id "NEAR Docs: Account ID and Sub-Accounts"
[3]: https://docs.near.ai/cloud/private-inference "NEAR AI Cloud: Private Inference"
[4]: https://docs.near.org/chain-abstraction/intents/overview "NEAR Docs: Intents Overview"
[5]: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request "NEAR Intents: 1Click Request Guide"
[6]: https://x.com/NEARProtocol/status/2113017143096963080 "NEAR Protocol: Hackathon Submission Window Announcement"
