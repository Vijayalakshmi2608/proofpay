#!/usr/bin/env bash
set -euo pipefail

# Export local .env entries for this one deployment invocation when present.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${NEAR_CONTRACT_ACCOUNT_ID:?Set NEAR_CONTRACT_ACCOUNT_ID to the funded testnet account}"
: "${NEAR_VERIFIER_ACCOUNT_ID:?Set NEAR_VERIFIER_ACCOUNT_ID to a dedicated verifier account}"
: "${NEAR_VERIFIER_PUBLIC_KEY:?Set NEAR_VERIFIER_PUBLIC_KEY to the verifier ed25519 Function-Call public key}"

if [[ "$NEAR_VERIFIER_PUBLIC_KEY" != ed25519:* ]]; then
  echo "NEAR_VERIFIER_PUBLIC_KEY must be an ed25519: public key." >&2
  exit 1
fi
if ! command -v near >/dev/null 2>&1; then
  echo "near-cli-rs ('near') was not found. Install it and authenticate your testnet signer first." >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/Cargo is required. Install rustup and add wasm32-unknown-unknown before deploying." >&2
  exit 1
fi

cat >&2 <<EOF
Verifier key prerequisite:
  $NEAR_VERIFIER_ACCOUNT_ID must be a dedicated account whose only access key is a
  Function-Call Key restricted to receiver $NEAR_CONTRACT_ACCOUNT_ID, method
  record_attestation. Function-Call keys cannot attach NEAR deposits; configure a finite
  gas allowance via NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO (0.25 NEAR by default). Configure
  this at the NEAR account level; contract code cannot inspect which public key signed an invocation.
EOF

cargo build --manifest-path contracts/Cargo.toml --target wasm32-unknown-unknown --release
WASM="contracts/target/wasm32-unknown-unknown/release/proofpay_escrow.wasm"
near contract deploy "$NEAR_CONTRACT_ACCOUNT_ID" use-file "$WASM" without-init-call network-config testnet sign-with-keychain send
INIT_ARGS=$(printf '{"verifier_id":"%s","verifier_public_key":"%s"}' "$NEAR_VERIFIER_ACCOUNT_ID" "$NEAR_VERIFIER_PUBLIC_KEY")
near contract call-function as-transaction "$NEAR_CONTRACT_ACCOUNT_ID" new json-args "$INIT_ARGS" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$NEAR_CONTRACT_ACCOUNT_ID" network-config testnet sign-with-keychain send
