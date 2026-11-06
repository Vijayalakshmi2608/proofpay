use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

use super::{AssetKind, Milestone, MilestoneStatus};

const RECEIPT_DOMAIN: &str = "proofpay:selective-disclosure-receipt:v1";

/// Public accountant-friendly receipt data. Employer identity is intentionally omitted.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct ProofReceipt {
    pub version: String,
    pub contract_id: AccountId,
    pub milestone_id: u64,
    pub status: MilestoneStatus,
    pub contractor: AccountId,
    pub amount: U128,
    pub asset_id: AccountId,
    pub asset_kind: AssetKind,
    pub proof_hash: String,
    pub reasoning_hash: String,
    pub verified_at_ns: U64,
    pub commitment: String,
}

/// Builds a stable, domain-separated commitment for released work. Each value is length-prefixed.
pub fn generate(contract_id: AccountId, milestone: &Milestone) -> ProofReceipt {
    assert_eq!(
        milestone.status,
        MilestoneStatus::Released,
        "Receipt is available only after payout is released"
    );
    let attestation = milestone
        .attestation
        .as_ref()
        .expect("Released milestone has no attestation");
    assert!(attestation.result, "Receipt requires a passing attestation");
    assert!(
        !milestone.proof_hash.trim().is_empty(),
        "Receipt requires a submitted proof hash"
    );

    let verified_at_ns = attestation.timestamp;
    let asset_kind = match milestone.asset_kind {
        AssetKind::NativeNear => "native_near",
        AssetKind::Nep141 => "nep141",
        AssetKind::CrossChainIntent => "cross_chain_intent",
    };
    let fields = [
        RECEIPT_DOMAIN.to_string(),
        contract_id.to_string(),
        milestone.id.to_string(),
        "released".to_string(),
        milestone.contractor.to_string(),
        milestone.amount.0.to_string(),
        milestone.asset_id.to_string(),
        asset_kind.to_string(),
        milestone.proof_hash.clone(),
        attestation.reasoning_hash.clone(),
        verified_at_ns.0.to_string(),
    ];
    let mut preimage = Vec::new();
    for field in fields {
        let bytes = field.as_bytes();
        preimage.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        preimage.extend_from_slice(bytes);
    }
    let digest = env::sha256(&preimage);
    let commitment = format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );

    ProofReceipt {
        version: "proofpay-selective-disclosure-receipt-v1".to_string(),
        contract_id,
        milestone_id: milestone.id,
        status: MilestoneStatus::Released,
        contractor: milestone.contractor.clone(),
        amount: milestone.amount,
        asset_id: milestone.asset_id.clone(),
        asset_kind: milestone.asset_kind,
        proof_hash: milestone.proof_hash.clone(),
        reasoning_hash: attestation.reasoning_hash.clone(),
        verified_at_ns,
        commitment,
    }
}
