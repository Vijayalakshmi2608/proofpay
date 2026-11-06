# ProofPay Hackathon Submission Checklist (Local Draft)

> This is a ProofPay-maintained checklist, not an official NEAR hackathon specification. The organizer's authoritative `HACKATHON.md` and current application API schema were not supplied in this repository. Confirm all requirements with the organizers before submitting.

## Project details

- Project name: `ProofPay`
- User-provided track list: `realworld`, `agents`, `security`, `business` (confirm that these remain valid organizer track identifiers).
- Idea payload: 20-2,000 characters explaining the contractor payment problem, ProofPay's milestone escrow workflow, and NEAR primitives.
- The local `npm run prepare:submission` utility formats `projectName`, `tracks`, `idea`, and a generated UUID `requestId`; it prints JSON only and does not send a POST.

## Evidence and disclosures

- Link to a public source repository and hosted dashboard only after those links are available.
- Link to a recorded X demo only after the video/post is published.
- Label deterministic mock transactions as mock; do not call them testnet transactions.
- Identify the TEE-style Ed25519 wrapper as a software mock unless real hardware attestation is integrated.
- Identify 1Click requests as dry quote previews; do not claim bridge execution, guaranteed settlement, or payout finality without an implemented and verified adapter.
- Describe the receipt as a SHA-256 commitment with selective disclosure, not as a zero-knowledge proof.

## Before sending any application

1. Obtain and read the official organizer instructions and the current `/api/applications` request schema.
2. Confirm required team/contact/account fields and allowed track identifiers.
3. Replace local/demo evidence with real public links only when available.
4. Review the generated payload and submit it only through the organizer's documented process.
