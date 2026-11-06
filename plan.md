# ProofPay Dashboard Implementation Plan

## Scope and implementation approach

Continue the existing Next.js 14 App Router dashboard in `/frontend`; do not replace its wallet-selector setup, route, theme, or verifier service. Keep the single page at `/` and split its current page-level forms and details into the requested reusable components. Preserve demo mode when `NEXT_PUBLIC_DEMO_MODE` is enabled; when a contract ID is configured and demo mode is disabled, read milestone state and the connected account balance from NEAR RPC. Refresh contract views periodically and after wallet actions. Use Wallet Selector for user-signed `create_milestone_with_options`, `ft_transfer_call` for explicitly configured/allowlisted NEP-141 USDC, and `submit_proof` transactions; keep NEAR yocto and USDC micro-unit arithmetic exact and never expose verifier secrets or make a user wallet simulate an access-key attack.

Add a small browser-safe NEAR JSON-RPC layer for `list_milestones`, `verifier_configuration`, account balance, and `view_access_key`. Display real contract statuses as the source of truth. An attestation drawer may display on-chain attestation fields and a separately returned verifier signature, but must identify a software/mock signature as non-hardware evidence and must not imply that the contract proves which access key signed the call. Hash the pinned public key locally and verify its Function-Call permission from RPC before describing its scope; clearly state that a fingerprint alone proves nothing.

Add same-origin Next.js proxy routes for verifier analysis and 1Click assets/quotes, forwarding only bounded JSON requests to the existing service. Request quotes with `dry: true` and display only provider-signed quote fields, minimum output, available fees, and the provider's time estimate. The provider signature verifies origin/integrity, not execution or settlement. Do not promise a guaranteed rate, fee, or under-30-second settlement; show “under 30s estimate” only when the returned estimate is below 30 seconds, and label it as an estimate. Do not show a deposit address for dry quotes or imply a payout was executed. Cross-chain payout remains adapter-dependent.

The adversarial-attack control is a local, non-broadcast simulation that produces the requested red “Blocked by Function-Call Policy” toast; it must never send a payout transaction. The quote panel and drawer explain that a quote is not a payout and that the current bridge adapter is not live.

## Project structure

- `/contracts/src/lib.rs`: existing NEAR state machine; `list_milestones` returns up to 50 records per call, and `verifier_configuration` exposes the pinned verifier identity/key.
- `/frontend/src/app/page.tsx`: dashboard composition, live/demo mode, milestone refresh, and selected milestone state.
- `/frontend/src/app/api/attest/route.ts`: existing advisory review proxy; add same-origin quote/assets and dry verification proxy routes under `/api` as needed.
- `/frontend/src/components/Navbar.tsx`: Wallet Selector connection, active NEAR network, and RPC account balance.
- `/frontend/src/components/CreateMilestoneModal.tsx`: employer form, exact decimal amounts, NEAR or configured NEP-141 USDC funding, payout destination, checklist text/file import, and wallet-signed milestone creation. USDC is offered only when its token contract is configured; the escrow must have allowlisted that token.
- `/frontend/src/components/MilestoneCard.tsx`: status badges, budget threshold, proof hash, and selected-milestone entry point.
- `/frontend/src/components/ContractorView.tsx`: proof link/hash entry, optional text-file hash calculation, wallet-signed `submit_proof`, and read-only verifier analysis.
- `/frontend/src/components/EscrowFlowVisualizer.tsx`: four-node lifecycle flow, real contract-state highlighting, attestation/permission/quote drawer, and safe attack simulation.
- `/frontend/src/components/wallet-provider.tsx`: existing Wallet Selector context plus narrowly scoped milestone/proof signing methods.
- `/frontend/src/lib/near-rpc.ts`: typed, bounded NEAR JSON-RPC view calls, account balance and Function-Call-key scope verification.
- `/frontend/src/lib/near-amount.ts`: exact decimal-to-base-unit conversion for 24-decimal yoctoNEAR and 6-decimal USDC; reuse rather than float arithmetic.
- `/frontend/public/manus-routes.json`: keep the sole page route `/`; API routes remain excluded.
- `/agent-verifier/src/intents.ts`: existing 1Click live registry/quote client; the UI consumes its strict supported-asset response and signed quote contract.

## Design system

**Design Movement:** A restrained cybernetic escrow control room: forensic financial terminal meets modern Web3 operations console.

**Core Principles:** Evidence before claims; clear custody and permission boundaries; live contract state over illustrative metrics; dense but calm operator controls.

**Color Philosophy:** Obsidian `#0B0F17` keeps the interface quiet and high-contrast. Electric proof green `#00EC42` means verified or active, not decorative success. Amber marks waiting or estimates; red is reserved for blocked or failed actions.

**Layout Paradigm:** Keep the existing left-rail workspace structure, then use a top utility bar and a vertically sequenced milestone workspace. Cards expand into focused detail rather than scattering the workflow across unrelated pages. The lifecycle flow runs horizontally at wide widths and stacks on narrow screens.

**Signature Elements:** Thin green edge glows on active contract stages; compact monospaced chain facts (hashes, account IDs, amounts); a four-node line that advances from vault to payout only from observed contract state.

**Interaction Philosophy:** Every wallet action names the exact transaction and has an explicit pending/confirmed/error state. Read-only quote and verifier preview actions never resemble a signed payout. The attack simulation is visibly labeled simulation-only.

**Animation:** Use short opacity/translate transitions for drawers, a slow pulse only for an actively refreshed node, and a brief spinner while awaiting RPC or wallet actions. Respect `prefers-reduced-motion`; do not animate settlement completion without a confirmed chain status.

**Typography System:** Reuse the current Inter/system sans stack for headings and body, and IBM Plex Mono/SF Mono for account IDs, amounts, hashes, and RPC-derived timestamps. Keep labels small and uppercase only for metadata.

**Brand Essence:** Verifiable milestone escrow for employers and independent contractors, distinguished by on-chain proof gates and explicit permission boundaries. Personality: precise, calm, accountable.

**Brand Voice:** Headlines are confident but never promise finality before chain confirmation; microcopy separates preview, estimate, submitted, and finalized states. Examples: “Funds stay locked until the milestone clears.” “Quote preview only — no deposit address or transfer is created.”

**Wordmark & Logo:** Reuse the existing ProofPay check-and-bracket mark and wordmark; do not introduce a competing decorative logo.

**Signature Brand Color:** Proof green `#00EC42`, reserved for verified chain facts and the current lifecycle node.

## Screening and submission artifacts

`scripts/test-reproducibility.ts` will be a fast, headless deterministic local mock. It will print the six requested screening stages, model the $500/$1,000 and $5,000/$1,000 policy cases in fixture units, and use a valid `sha256:<hex>` proof value rather than broadcasting the abbreviated `0xabc123...` placeholder. It will request only a dry 1Click quote with a strict timeout and report provider unavailability without producing a deposit address. It will not deploy or claim a NEAR Testnet transaction: no testnet signer, initialized test contract, funded token, or live verifier key is part of the repository configuration. The current restricted key is permitted only to call `record_attestation`, so NEAR rejects `release_payout` before contract execution with a method-permission error; the contract-level over-budget branch independently returns `Only the employer can release above auto_release_limit`, not `PolicyLimitExceeded`.

The root `test:demo` script will preserve the existing browser-to-verifier HTTP smoke path and then run the deterministic screening script. It must be read-only outside its local fixtures and remain bounded by short timeouts. `scripts/prepare-submission.ts` will format and validate the exact four-field JSON payload and provided fixed track list, generate a UUID request ID, and print to stdout without POSTing to the application endpoint. The referenced `HACKATHON.md` is not present in the repository, so no additional organizer fields or dates will be invented.

Replace the README with judge-facing setup, comparison, security and ecosystem sections, a local quickstart, a truthful demo link state, and inline official-source references. Add `SUBMISSION_HELP.md` with the requested 45-second X-video timeline. Explain NEAR AI Cloud and sub-accounts as integration/design context only: this code currently uses an Ed25519 software mock signature and a dedicated configured verifier account, not NEAR AI Cloud attestation or automatic sub-account creation. The README must distinguish 1Click quotes from adapter-driven cross-chain settlement and avoid rate, fee, TEE, or timing guarantees the implementation cannot substantiate.

## External 1Click facts and constraints

The current official 1Click quickstart says `dry: true` returns a quote without executing the swap, and gives an ISO deadline request field; a separate official guide states that quote signatures authenticate the payload origin and integrity. The overview describes a full quote → deposit → execution/status flow. Therefore the UI may show a verified quote and the provider's estimate, but must not call those an execution or settlement guarantee. The live token list is the asset-ID source of truth.

Sources: [1Click overview](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api), [quote request and dry mode](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request), [signature verification](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature), [supported assets](https://docs.near-intents.org/resources/asset-support).


## Advanced security, receipt, solver and packaging follow-up

Keep the existing one-page NEAR dashboard and add the new features under `frontend/src/components` (the actual component root in this repository). `AttackSandbox.tsx` is a local, visibly simulated adversarial flow: it models a rogue verifier asking for $5,000 when the illustrative limit is $1,000 and shows the requested `Panic: PolicyLimitExceeded(Requested: 5000, Allowed: 1000)` text only as mock output. It must not broadcast or label the toast as a real on-chain error: NEAR's restricted key rejects the forbidden `release_payout` method before contract execution, and the existing contract-level rejection is different.

Add `contracts/src/receipts.rs` and expose `generate_proof_receipt(milestone_id)` as a read-only contract view that only issues a receipt for a released milestone with a passing attestation and nonempty proof hash. The deterministic SHA-256 commitment uses domain-separated canonical fields (contract, milestone, contractor, amount/asset, work hash and attestation evidence) and explicitly excludes the employer account. The JSON receipt is an accountant-friendly disclosed record plus the commitment; it is a hash commitment, not a zero-knowledge proof. The frontend downloads a CSV and makes a shareable `/receipt` link that re-fetches and checks the contract view. Demo/sample milestones cannot create a verified chain receipt.

Add `SolverQuotes.tsx` for destination toggles covering native Ethereum USDC, Solana SOL and Bitcoin BTC. It selects assets from the service's filtered live registry, accepts a destination address, converts the milestone's source base units exactly, and requests only signature-verified `dry: true` quotes through the existing same-origin proxy. If the upstream provider fails, show a bounded error; never show a fabricated quote or fundable address. Add the new receipt page to the route manifest.

Add root `scripts/package-project.ts` using `archiver`, run through the existing TypeScript toolchain as `npm run zip`, and produce `proofpay-hackathon-bundle.zip`. Include repository source and required root docs while excluding dependency/build/VCS directories, secret `.env*` values other than safe `.env.example` templates, symlinks and the output archive itself; validate required inputs and report path and size. Create `HACKATHON.md` only as a clearly labeled local submission checklist because the organizer specification remains unavailable; do not represent it as an official spec.

Update `npm run test:demo` to run all unit tests, the HTTP demo smoke, deterministic attack/receipt checks, a time-bounded live dry 1Click query that warns rather than fabricates output if the provider fails, and ZIP packaging. Keep the total target under 30 seconds, use explicit timeouts, and ensure no testnet write or non-dry quote is sent.