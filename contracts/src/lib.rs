use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey,
};

mod receipts;
pub use receipts::ProofReceipt;

/// JSON-safe representation of a fungible token balance (decimal string on the wire).
pub type Balance = U128;

const DEFAULT_DEADLINE_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;
const MAX_PROOF_REQUIREMENTS_BYTES: usize = 2_048;
const MAX_PROOF_HASH_BYTES: usize = 256;
const MAX_PROOF_URL_BYTES: usize = 2_048;
const MAX_REASONING_HASH_BYTES: usize = 256;
const MAX_BRIDGE_REFERENCE_BYTES: usize = 512;
const MAX_VIEW_LIMIT: u64 = 50;
const CALLBACK_RESULT_LIMIT: usize = 64;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct MilestoneInput {
    pub title: String,
    pub description: String,
    pub amount: Balance,
    pub deadline_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MilestoneStatus {
    Pending,
    Attested,
    PayoutPending,
    Released,
    Disputed,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    NativeNear,
    Nep141,
    CrossChainIntent,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Attestation {
    pub milestone_id: u64,
    /// Pinned verifier key metadata. NEAR contracts cannot inspect the key that signed a receipt;
    /// the dedicated verifier account's Function-Call Key permissions are enforced by NEAR itself.
    pub verifier_key: PublicKey,
    pub result: bool,
    pub reasoning_hash: String,
    pub timestamp: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Milestone {
    pub id: u64,
    pub employer: AccountId,
    pub contractor: AccountId,
    pub amount: Balance,
    pub deadline: U64,
    pub proof_hash: String,
    pub proof_url: String,
    pub proof_requirements: String,
    pub status: MilestoneStatus,
    pub auto_release_limit: Balance,
    /// For native NEAR this is the current contract account; for NEP-141 it is the token contract.
    pub asset_id: AccountId,
    pub asset_kind: AssetKind,
    pub destination_chain: String,
    pub payout_recipient: String,
    pub attestation: Option<Attestation>,
    pub pending_previous_status: Option<MilestoneStatus>,
    pub pending_final_status: Option<MilestoneStatus>,
    /// Adapter selected when this payout starts; stays fixed until reconciliation or failed dispatch.
    pub pending_bridge_adapter: Option<AccountId>,
    pub payout_target: Option<String>,
    pub bridge_tx_ref: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DisputeResolution {
    PayContractor,
    RefundEmployer,
}

/// NEP-141 `ft_transfer_call` message used to create a funded milestone.
#[near(serializers = [json])]
pub struct FtMilestoneMessage {
    pub contractor: AccountId,
    pub auto_release_limit: Balance,
    pub proof_requirements: String,
    pub deadline: Option<U64>,
    pub destination_chain: Option<String>,
    pub payout_recipient: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ProofPayEscrow {
    owner: AccountId,
    verifier_account_id: AccountId,
    verifier_public_key: PublicKey,
    bridge_adapter_id: Option<AccountId>,
    next_milestone_id: u64,
    milestones: LookupMap<u64, Milestone>,
    allowed_ft_tokens: LookupMap<AccountId, bool>,
    used_bridge_refs: LookupMap<String, bool>,
}

#[near]
impl ProofPayEscrow {
    #[init]
    pub fn new(verifier_id: AccountId, verifier_public_key: PublicKey) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            verifier_account_id: verifier_id,
            verifier_public_key,
            bridge_adapter_id: None,
            next_milestone_id: 0,
            milestones: LookupMap::new(b"m".to_vec()),
            allowed_ft_tokens: LookupMap::new(b"t".to_vec()),
            used_bridge_refs: LookupMap::new(b"r".to_vec()),
        }
    }

    /// Create a native-NEAR milestone. The attached deposit is the exact escrow principal.
    /// New milestones default to a 30-day deadline and a NEAR payout to `contractor`.
    #[payable]
    pub fn create_milestone(
        &mut self,
        contractor: AccountId,
        auto_release_limit: Balance,
        proof_requirements: String,
    ) -> Milestone {
        let now = env::block_timestamp();
        let deadline = now
            .checked_add(DEFAULT_DEADLINE_NS)
            .expect("Default deadline overflow");
        self.create_native_milestone(
            contractor.clone(),
            auto_release_limit,
            proof_requirements,
            U64(deadline),
            "NEAR".to_string(),
            contractor.to_string(),
        )
    }

    /// Explicit-options native-NEAR variant for callers that need a custom deadline or destination.
    #[payable]
    pub fn create_milestone_with_options(
        &mut self,
        contractor: AccountId,
        auto_release_limit: Balance,
        proof_requirements: String,
        deadline: U64,
        destination_chain: String,
        payout_recipient: String,
    ) -> Milestone {
        self.create_native_milestone(
            contractor,
            auto_release_limit,
            proof_requirements,
            deadline,
            destination_chain,
            payout_recipient,
        )
    }

    /// Compatibility entrypoint for the existing dashboard's single-milestone create transaction.
    /// Multi-milestone arrays are deliberately rejected; create one independently funded milestone
    /// per call so each liability and dispute has a single, auditable state machine.
    #[payable]
    pub fn create_escrow(
        &mut self,
        provider: AccountId,
        destination_chain: String,
        payout_recipient: String,
        milestones: Vec<MilestoneInput>,
    ) -> Milestone {
        assert_eq!(
            milestones.len(),
            1,
            "Create one milestone per funded transaction"
        );
        let input = milestones
            .into_iter()
            .next()
            .expect("Milestone is required");
        assert!(input.title.len() <= 160, "Milestone title is too long");
        assert!(
            input.description.len() <= MAX_PROOF_REQUIREMENTS_BYTES,
            "Milestone description is too long"
        );
        let proof_requirements = if input.description.trim().is_empty() {
            input.title
        } else {
            format!("{}: {}", input.title, input.description)
        };
        assert!(
            proof_requirements.len() <= MAX_PROOF_REQUIREMENTS_BYTES,
            "Proof requirements are too long"
        );
        self.create_funded_milestone(
            env::predecessor_account_id(),
            provider,
            input.amount,
            U64(input.deadline_ns),
            U128(0),
            proof_requirements,
            env::current_account_id(),
            if destination_chain.eq_ignore_ascii_case("NEAR") {
                AssetKind::NativeNear
            } else {
                AssetKind::CrossChainIntent
            },
            destination_chain,
            payout_recipient,
        )
    }

    /// NEP-141 receiver hook. Tokens must first be allowlisted by the contract owner.
    /// A malformed or unauthorized call panics, causing the FT contract to refund the transfer.
    #[payable]
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            1,
            "NEP-141 receiver call must attach 1 yoctoNEAR"
        );
        assert!(
            self.allowed_ft_tokens
                .get(&token_id)
                .copied()
                .unwrap_or(false),
            "Fungible token is not allowlisted"
        );
        assert!(amount.0 > 0, "Milestone amount must be positive");
        assert!(msg.len() <= 4_096, "NEP-141 milestone message is too large");

        let request: FtMilestoneMessage =
            serde_json::from_str(&msg).expect("Invalid milestone message JSON");
        let now = env::block_timestamp();
        let deadline = request.deadline.unwrap_or_else(|| {
            U64(now
                .checked_add(DEFAULT_DEADLINE_NS)
                .expect("Default deadline overflow"))
        });
        let destination_chain = request
            .destination_chain
            .unwrap_or_else(|| "NEAR".to_string());
        let payout_recipient = request
            .payout_recipient
            .unwrap_or_else(|| request.contractor.to_string());
        let asset_kind = if destination_chain.eq_ignore_ascii_case("NEAR") {
            AssetKind::Nep141
        } else {
            AssetKind::CrossChainIntent
        };

        self.create_funded_milestone(
            sender_id,
            request.contractor,
            amount,
            deadline,
            request.auto_release_limit,
            request.proof_requirements,
            token_id,
            asset_kind,
            destination_chain,
            payout_recipient,
        );
        PromiseOrValue::Value(U128(0))
    }

    /// Contractor submits a hash and a fetchable evidence URI. The contract never fetches the URI.
    pub fn submit_proof(&mut self, milestone_id: u64, proof_hash: String, proof_url: String) {
        let caller = env::predecessor_account_id();
        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            caller, milestone.contractor,
            "Only the contractor may submit proof"
        );
        assert_eq!(
            milestone.status,
            MilestoneStatus::Pending,
            "Milestone is not accepting proof"
        );
        assert!(
            env::block_timestamp() <= milestone.deadline.0,
            "Milestone deadline has passed"
        );
        assert!(
            valid_reference(&proof_hash, MAX_PROOF_HASH_BYTES),
            "Invalid proof hash"
        );
        assert!(
            valid_proof_url(&proof_url),
            "Proof URL must use https://, ipfs://, or ar://"
        );

        milestone.proof_hash = proof_hash;
        milestone.proof_url = proof_url;
        milestone.attestation = None;
        self.milestones.insert(milestone_id, milestone);
    }

    /// Record a verifier result for the current proof. Only direct calls from the configured
    /// verifier account are accepted. The NEAR runtime, not contract code, enforces the key scope.
    pub fn record_attestation(&mut self, milestone_id: u64, passed: bool, reasoning_hash: String) {
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            0,
            "Attestation calls cannot attach funds"
        );
        assert_eq!(
            env::predecessor_account_id(),
            self.verifier_account_id,
            "Only the configured verifier account may attest"
        );
        assert!(
            valid_reference(&reasoning_hash, MAX_REASONING_HASH_BYTES),
            "Invalid reasoning hash"
        );

        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            milestone.status,
            MilestoneStatus::Pending,
            "Milestone is not awaiting attestation"
        );
        assert!(
            !milestone.proof_hash.is_empty(),
            "Proof must be submitted before attestation"
        );

        milestone.attestation = Some(Attestation {
            milestone_id,
            verifier_key: self.verifier_public_key.clone(),
            result: passed,
            reasoning_hash: reasoning_hash.clone(),
            timestamp: U64(env::block_timestamp()),
        });
        milestone.status = if passed {
            MilestoneStatus::Attested
        } else {
            MilestoneStatus::Pending
        };
        self.milestones.insert(milestone_id, milestone);
        emit_event(
            "attestation_recorded",
            json!({"milestone_id": milestone_id, "passed": passed, "reasoning_hash": reasoning_hash}),
        );
    }

    /// Release to the configured payout recipient when attested. Anyone may trigger payout when
    /// amount <= auto_release_limit; otherwise the employer must explicitly call this method.
    pub fn release_payout(&mut self, milestone_id: u64) {
        let caller = env::predecessor_account_id();
        let milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            milestone.status,
            MilestoneStatus::Attested,
            "Milestone must be attested before release"
        );
        if milestone.amount.0 > milestone.auto_release_limit.0 {
            assert_eq!(
                caller, milestone.employer,
                "Only the employer can release above auto_release_limit"
            );
        }
        self.queue_payout(
            milestone_id,
            milestone.payout_recipient,
            MilestoneStatus::Released,
            MilestoneStatus::Attested,
        );
    }

    /// Either party can freeze an unsettled milestone for arbitration.
    pub fn raise_dispute(&mut self, milestone_id: u64) {
        let caller = env::predecessor_account_id();
        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert!(
            caller == milestone.employer || caller == milestone.contractor,
            "Only the employer or contractor may dispute"
        );
        assert!(
            matches!(
                milestone.status,
                MilestoneStatus::Pending | MilestoneStatus::Attested
            ),
            "Milestone cannot be disputed in its current state"
        );
        milestone.status = MilestoneStatus::Disputed;
        self.milestones.insert(milestone_id, milestone);
        emit_event(
            "dispute_raised",
            json!({"milestone_id": milestone_id, "raised_by": caller}),
        );
    }

    /// The owner is the initial arbitrator. Resolution remains asynchronous and retryable.
    pub fn resolve_dispute(&mut self, milestone_id: u64, resolution: DisputeResolution) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only the arbitrator may resolve a dispute"
        );
        let milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            milestone.status,
            MilestoneStatus::Disputed,
            "Milestone is not disputed"
        );
        let (recipient, final_status) = match resolution {
            DisputeResolution::PayContractor => (
                milestone.payout_recipient.clone(),
                MilestoneStatus::Released,
            ),
            DisputeResolution::RefundEmployer => {
                (milestone.employer.to_string(), MilestoneStatus::Refunded)
            }
        };
        self.queue_payout(
            milestone_id,
            recipient,
            final_status,
            MilestoneStatus::Disputed,
        );
    }

    /// Owner-managed allowlist prevents arbitrary token contracts from creating fictitious assets.
    pub fn set_ft_token_allowed(&mut self, token_id: AccountId, allowed: bool) {
        self.assert_owner();
        self.allowed_ft_tokens.insert(token_id.clone(), allowed);
        emit_event(
            "ft_token_allowlist_updated",
            json!({"token_id": token_id, "allowed": allowed}),
        );
    }

    /// Rotate verifier identity/key together. Install the matching restricted Function-Call Key
    /// on the verifier account before switching this setting.
    pub fn set_verifier(&mut self, verifier_id: AccountId, verifier_public_key: PublicKey) {
        self.assert_owner();
        self.verifier_account_id = verifier_id;
        self.verifier_public_key = verifier_public_key;
    }

    /// Future intents use this adapter; in-flight payouts keep their per-milestone pinned adapter.
    pub fn set_bridge_adapter(&mut self, adapter_id: Option<AccountId>) {
        self.assert_owner();
        self.bridge_adapter_id = adapter_id;
    }

    /// Reconcile a cross-chain intent after the trusted adapter reports external finality.
    /// This is an authorization boundary, not a cryptographic bridge proof verifier.
    pub fn confirm_cross_chain_payout(&mut self, milestone_id: u64, bridge_tx_ref: String) {
        let caller = env::predecessor_account_id();
        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            milestone.asset_kind,
            AssetKind::CrossChainIntent,
            "Milestone is not a cross-chain intent"
        );
        assert_eq!(
            milestone.status,
            MilestoneStatus::PayoutPending,
            "No cross-chain payout is pending"
        );
        assert_eq!(
            milestone.pending_bridge_adapter.as_ref(),
            Some(&caller),
            "Only the adapter pinned to this payout may reconcile"
        );
        assert!(
            milestone.pending_previous_status.is_none(),
            "Bridge source assets have not been transferred yet"
        );
        assert!(
            valid_reference(&bridge_tx_ref, MAX_BRIDGE_REFERENCE_BYTES),
            "Invalid bridge transaction reference"
        );
        assert!(
            !self
                .used_bridge_refs
                .get(&bridge_tx_ref)
                .copied()
                .unwrap_or(false),
            "Bridge transaction reference already used"
        );
        let final_status = milestone
            .pending_final_status
            .take()
            .expect("Missing final payout status");
        milestone.status = final_status;
        milestone.pending_previous_status = None;
        milestone.pending_bridge_adapter = None;
        milestone.bridge_tx_ref = Some(bridge_tx_ref.clone());
        self.used_bridge_refs.insert(bridge_tx_ref.clone(), true);
        self.milestones.insert(milestone_id, milestone);
        emit_event(
            "cross_chain_payout_reconciled",
            json!({"milestone_id": milestone_id, "bridge_tx_ref": bridge_tx_ref}),
        );
    }

    /// Private callback for native NEAR and NEP-141 transfer promises.
    #[private]
    pub fn on_payout_resolved(&mut self, milestone_id: u64) -> MilestoneStatus {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Expected exactly one payout result"
        );
        let transfer_succeeded = env::promise_result_checked(0, CALLBACK_RESULT_LIMIT).is_ok();
        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert_eq!(
            milestone.status,
            MilestoneStatus::PayoutPending,
            "No payout is pending"
        );

        let previous_status = milestone
            .pending_previous_status
            .take()
            .expect("Missing retry state");
        let next_status = if !transfer_succeeded {
            milestone.pending_final_status = None;
            milestone.payout_target = None;
            milestone.pending_bridge_adapter = None;
            previous_status
        } else if milestone.asset_kind == AssetKind::CrossChainIntent {
            milestone.pending_previous_status = None;
            emit_event(
                "cross_chain_payout_intent",
                json!({
                    "milestone_id": milestone_id,
                    "destination_chain": milestone.destination_chain,
                    "recipient": milestone.payout_target,
                    "asset_id": milestone.asset_id,
                    "amount": milestone.amount.0.to_string(),
                    "bridge_adapter": milestone.pending_bridge_adapter,
                    "resolution": milestone.pending_final_status,
                }),
            );
            MilestoneStatus::PayoutPending
        } else {
            milestone
                .pending_final_status
                .take()
                .expect("Missing final payout status")
        };
        milestone.status = next_status;
        self.milestones.insert(milestone_id, milestone.clone());
        emit_event(
            if !transfer_succeeded {
                "payout_failed"
            } else if milestone.asset_kind == AssetKind::CrossChainIntent {
                "cross_chain_source_funded"
            } else {
                "payout_completed"
            },
            json!({"milestone_id": milestone_id, "status": next_status}),
        );
        next_status
    }

    pub fn get_milestone(&self, milestone_id: u64) -> Option<Milestone> {
        self.milestones.get(&milestone_id).cloned()
    }

    pub fn list_milestones(&self, from_index: u64, limit: u64) -> Vec<Milestone> {
        let safe_limit = limit.min(MAX_VIEW_LIMIT);
        (from_index..self.next_milestone_id)
            .take(safe_limit as usize)
            .filter_map(|id| self.milestones.get(&id).cloned())
            .collect()
    }

    /// Return a deterministic, employer-address-free receipt only after release is finalized.
    pub fn generate_proof_receipt(&self, milestone_id: u64) -> ProofReceipt {
        let milestone = self.get_milestone_or_panic(milestone_id);
        receipts::generate(env::current_account_id(), &milestone)
    }

    pub fn verifier_configuration(&self) -> (AccountId, PublicKey) {
        (
            self.verifier_account_id.clone(),
            self.verifier_public_key.clone(),
        )
    }

    fn create_native_milestone(
        &mut self,
        contractor: AccountId,
        auto_release_limit: Balance,
        proof_requirements: String,
        deadline: U64,
        destination_chain: String,
        payout_recipient: String,
    ) -> Milestone {
        let amount = U128(env::attached_deposit().as_yoctonear());
        let asset_kind = if destination_chain.eq_ignore_ascii_case("NEAR") {
            AssetKind::NativeNear
        } else {
            AssetKind::CrossChainIntent
        };
        self.create_funded_milestone(
            env::predecessor_account_id(),
            contractor,
            amount,
            deadline,
            auto_release_limit,
            proof_requirements,
            env::current_account_id(),
            asset_kind,
            destination_chain,
            payout_recipient,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_funded_milestone(
        &mut self,
        employer: AccountId,
        contractor: AccountId,
        amount: Balance,
        deadline: U64,
        auto_release_limit: Balance,
        proof_requirements: String,
        asset_id: AccountId,
        asset_kind: AssetKind,
        destination_chain: String,
        payout_recipient: String,
    ) -> Milestone {
        assert_ne!(employer, contractor, "Employer and contractor must differ");
        assert!(amount.0 > 0, "Milestone amount must be positive");
        assert!(
            !proof_requirements.trim().is_empty()
                && proof_requirements.len() <= MAX_PROOF_REQUIREMENTS_BYTES,
            "Proof requirements must contain 1–2048 bytes"
        );
        assert!(
            deadline.0 > env::block_timestamp(),
            "Deadline must be in the future"
        );
        assert!(
            !destination_chain.trim().is_empty() && destination_chain.len() <= 40,
            "Invalid destination chain"
        );
        assert!(
            !payout_recipient.trim().is_empty() && payout_recipient.len() <= 128,
            "Invalid payout recipient"
        );
        if destination_chain.eq_ignore_ascii_case("NEAR") {
            payout_recipient
                .parse::<AccountId>()
                .expect("NEAR payout recipient must be a valid account ID");
        }

        let id = self.next_milestone_id;
        self.next_milestone_id = self
            .next_milestone_id
            .checked_add(1)
            .expect("Milestone ID overflow");
        let milestone = Milestone {
            id,
            employer,
            contractor,
            amount,
            deadline,
            proof_hash: String::new(),
            proof_url: String::new(),
            proof_requirements,
            status: MilestoneStatus::Pending,
            auto_release_limit,
            asset_id,
            asset_kind,
            destination_chain,
            payout_recipient,
            attestation: None,
            pending_previous_status: None,
            pending_final_status: None,
            pending_bridge_adapter: None,
            payout_target: None,
            bridge_tx_ref: None,
        };
        self.milestones.insert(id, milestone.clone());
        emit_event(
            "milestone_created",
            json!({"milestone_id": id, "employer": milestone.employer, "contractor": milestone.contractor, "amount": milestone.amount.0.to_string(), "asset_id": milestone.asset_id, "asset_kind": milestone.asset_kind}),
        );
        milestone
    }

    fn queue_payout(
        &mut self,
        milestone_id: u64,
        recipient: String,
        final_status: MilestoneStatus,
        previous_status: MilestoneStatus,
    ) {
        assert!(
            final_status == MilestoneStatus::Released || final_status == MilestoneStatus::Refunded,
            "Invalid final payout status"
        );
        let mut milestone = self.get_milestone_or_panic(milestone_id);
        assert!(
            !recipient.trim().is_empty() && recipient.len() <= 128,
            "Invalid payout recipient"
        );
        milestone.status = MilestoneStatus::PayoutPending;
        milestone.pending_previous_status = Some(previous_status);
        milestone.pending_final_status = Some(final_status);
        milestone.payout_target = Some(recipient.clone());
        let asset_kind = milestone.asset_kind;
        let amount = milestone.amount.0;
        let asset_id = milestone.asset_id.clone();
        let destination_chain = milestone.destination_chain.clone();
        let dispatch_adapter = if asset_kind == AssetKind::CrossChainIntent {
            Some(
                self.bridge_adapter_id
                    .clone()
                    .expect("Bridge adapter is not configured"),
            )
        } else {
            None
        };
        milestone.pending_bridge_adapter = dispatch_adapter.clone();
        self.milestones.insert(milestone_id, milestone.clone());

        if asset_kind == AssetKind::CrossChainIntent {
            emit_event(
                "cross_chain_payout_dispatching",
                json!({
                    "milestone_id": milestone_id,
                    "destination_chain": destination_chain,
                    "recipient": recipient,
                    "asset_id": asset_id,
                    "amount": amount.to_string(),
                    "bridge_adapter": dispatch_adapter.clone(),
                    "resolution": final_status,
                }),
            );
        }

        let recipient_account: AccountId = if asset_kind == AssetKind::CrossChainIntent {
            dispatch_adapter
                .clone()
                .expect("Bridge adapter is not configured")
        } else {
            recipient
                .parse()
                .expect("NEAR payout target must be a valid account ID")
        };
        let transfer_is_ft = asset_kind == AssetKind::Nep141
            || (asset_kind == AssetKind::CrossChainIntent && asset_id != env::current_account_id());
        let transfer_promise = if transfer_is_ft {
            let args = json!({
                "receiver_id": recipient_account,
                "amount": amount.to_string(),
                "memo": format!("ProofPay milestone {}", milestone_id),
            })
            .to_string()
            .into_bytes();
            Promise::new(asset_id).function_call(
                "ft_transfer".to_string(),
                args,
                NearToken::from_yoctonear(1),
                Gas::from_tgas(30),
            )
        } else {
            Promise::new(recipient_account).transfer(NearToken::from_yoctonear(amount))
        };
        let callback_args = json!({"milestone_id": milestone_id})
            .to_string()
            .into_bytes();
        let callback = Promise::new(env::current_account_id()).function_call(
            "on_payout_resolved".to_string(),
            callback_args,
            NearToken::from_yoctonear(0),
            Gas::from_tgas(15),
        );
        transfer_promise.then(callback).detach();
    }

    fn get_milestone_or_panic(&self, milestone_id: u64) -> Milestone {
        self.milestones
            .get(&milestone_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Milestone not found"))
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only the contract owner may configure the contract"
        );
    }
}

fn valid_reference(value: &str, max_bytes: usize) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_whitespace)
}

fn valid_proof_url(value: &str) -> bool {
    value.len() <= MAX_PROOF_URL_BYTES
        && (value.starts_with("https://")
            || value.starts_with("ipfs://")
            || value.starts_with("ar://"))
        && !value.chars().any(char::is_whitespace)
}

fn emit_event(event: &str, data: near_sdk::serde_json::Value) {
    let line = json!({
        "standard": "proofpay",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{line}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, PromiseResult};

    fn verifier_key() -> PublicKey {
        "ed25519:11111111111111111111111111111111".parse().unwrap()
    }

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn set_context(predecessor: &str, deposit: u128, timestamp: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("proofpay.testnet"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(timestamp);
        testing_env!(builder.build());
    }

    #[allow(deprecated)]
    fn set_callback_context(timestamp: u64, result: PromiseResult) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("proofpay.testnet"))
            .predecessor_account_id(account("proofpay.testnet"))
            .signer_account_id(account("proofpay.testnet"))
            .block_timestamp(timestamp);
        near_sdk::test_utils::testing_env_with_promise_results(builder.build(), result);
    }

    fn contract() -> ProofPayEscrow {
        set_context("owner.testnet", 0, 10);
        ProofPayEscrow::new(account("verifier.testnet"), verifier_key())
    }

    fn create_native(contract: &mut ProofPayEscrow, amount: u128, auto_limit: u128) -> Milestone {
        set_context("employer.testnet", amount, 100);
        contract.create_milestone(
            account("contractor.testnet"),
            U128(auto_limit),
            "Upload the signed project bundle".to_string(),
        )
    }

    fn submit_and_attest(contract: &mut ProofPayEscrow, milestone_id: u64, passed: bool) {
        set_context("contractor.testnet", 0, 200);
        contract.submit_proof(
            milestone_id,
            "sha256:0123456789abcdef".to_string(),
            "ipfs://bafy-proof".to_string(),
        );
        set_context("verifier.testnet", 0, 300);
        contract.record_attestation(milestone_id, passed, "sha256:reasoning".to_string());
    }

    #[test]
    fn native_creation_records_the_requested_state_and_exact_attached_balance() {
        let mut contract = contract();
        let milestone = create_native(&mut contract, 10, 10);
        assert_eq!(milestone.id, 0);
        assert_eq!(milestone.employer, account("employer.testnet"));
        assert_eq!(milestone.contractor, account("contractor.testnet"));
        assert_eq!(milestone.amount, U128(10));
        assert_eq!(milestone.status, MilestoneStatus::Pending);
        assert_eq!(milestone.auto_release_limit, U128(10));
        assert_eq!(milestone.asset_id, account("proofpay.testnet"));
        assert_eq!(milestone.asset_kind, AssetKind::NativeNear);
        assert_eq!(milestone.deadline, U64(100 + DEFAULT_DEADLINE_NS));
        assert!(milestone.proof_hash.is_empty());
        assert_eq!(
            contract.get_milestone(0).unwrap().proof_requirements,
            "Upload the signed project bundle"
        );
    }

    #[test]
    #[should_panic(expected = "Milestone amount must be positive")]
    fn native_creation_rejects_zero_deposit() {
        let mut contract = contract();
        create_native(&mut contract, 0, 0);
    }

    #[test]
    #[should_panic(expected = "Employer and contractor must differ")]
    fn creation_rejects_self_escrow() {
        let mut contract = contract();
        set_context("employer.testnet", 10, 100);
        contract.create_milestone(
            account("employer.testnet"),
            U128(10),
            "Requirement".to_string(),
        );
    }

    #[test]
    fn only_the_contractor_can_submit_a_bounded_content_addressed_proof() {
        let mut contract = contract();
        create_native(&mut contract, 10, 10);
        set_context("attacker.testnet", 0, 200);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.submit_proof(
                0,
                "sha256:abcdef0123456789".into(),
                "ipfs://bafy-proof".into(),
            );
        }));
        assert!(result.is_err());
        set_context("contractor.testnet", 0, 200);
        contract.submit_proof(
            0,
            "sha256:abcdef0123456789".into(),
            "ipfs://bafy-proof".into(),
        );
        let saved = contract.get_milestone(0).unwrap();
        assert_eq!(saved.proof_hash, "sha256:abcdef0123456789");
        assert_eq!(saved.status, MilestoneStatus::Pending);
    }

    #[test]
    fn only_the_configured_verifier_account_can_attest_and_the_result_is_advisory() {
        let mut contract = contract();
        create_native(&mut contract, 10, 10);
        set_context("contractor.testnet", 0, 200);
        contract.submit_proof(
            0,
            "sha256:abcdef0123456789".into(),
            "https://example.org/proof".into(),
        );
        set_context("attacker.testnet", 0, 300);
        let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.record_attestation(0, true, "sha256:reasoning".into());
        }));
        assert!(unauthorized.is_err());

        set_context("verifier.testnet", 0, 301);
        contract.record_attestation(0, false, "sha256:reasoning".into());
        let saved = contract.get_milestone(0).unwrap();
        assert_eq!(saved.status, MilestoneStatus::Pending);
        let attestation = saved.attestation.unwrap();
        assert!(!attestation.result);
        assert_eq!(attestation.milestone_id, 0);
        assert_eq!(attestation.verifier_key, verifier_key());
        assert_eq!(attestation.timestamp, U64(301));
    }

    #[test]
    fn permissionless_release_is_allowed_only_within_the_configured_budget_and_callback_settles() {
        let mut contract = contract();
        create_native(&mut contract, 10, 10);
        submit_and_attest(&mut contract, 0, true);
        set_context("keeper.testnet", 0, 400);
        contract.release_payout(0);
        assert_eq!(
            contract.get_milestone(0).unwrap().status,
            MilestoneStatus::PayoutPending
        );
        set_callback_context(500, PromiseResult::Successful(Vec::new()));
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Only the employer can release above auto_release_limit")]
    fn caller_cannot_release_above_auto_release_budget() {
        let mut contract = contract();
        create_native(&mut contract, 10, 9);
        submit_and_attest(&mut contract, 0, true);
        set_context("keeper.testnet", 0, 400);
        contract.release_payout(0);
    }

    #[test]
    fn failed_native_transfer_restores_attested_state_for_retry() {
        let mut contract = contract();
        create_native(&mut contract, 10, 0);
        submit_and_attest(&mut contract, 0, true);
        set_context("employer.testnet", 0, 400);
        contract.release_payout(0);
        set_callback_context(500, PromiseResult::Failed);
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Attested);
        assert_eq!(
            contract.get_milestone(0).unwrap().pending_final_status,
            None
        );
        set_context("employer.testnet", 0, 600);
        contract.release_payout(0);
        set_callback_context(700, PromiseResult::Successful(Vec::new()));
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Released);
    }

    #[test]
    fn receipt_is_deterministic_after_release_and_does_not_disclose_employer() {
        let mut contract = contract();
        create_native(&mut contract, 42, 42);
        submit_and_attest(&mut contract, 0, true);
        set_context("keeper.testnet", 0, 400);
        contract.release_payout(0);
        set_callback_context(500, PromiseResult::Successful(Vec::new()));
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Released);

        let receipt = contract.generate_proof_receipt(0);
        let again = contract.generate_proof_receipt(0);
        assert_eq!(receipt.commitment, again.commitment);
        assert!(receipt.commitment.starts_with("sha256:"));
        assert_eq!(receipt.status, MilestoneStatus::Released);
        assert_eq!(receipt.contractor, account("contractor.testnet"));
        let json = serde_json::to_string(&receipt).unwrap();
        assert!(!json.contains("employer"));
        assert!(!json.contains("employer.testnet"));
    }

    #[test]
    #[should_panic(expected = "Receipt is available only after payout is released")]
    fn receipt_is_not_available_before_payout_finality() {
        let mut contract = contract();
        create_native(&mut contract, 42, 42);
        submit_and_attest(&mut contract, 0, true);
        let _ = contract.generate_proof_receipt(0);
    }

    #[test]
    fn dispute_locks_release_and_owner_resolution_refunds_employer() {
        let mut contract = contract();
        create_native(&mut contract, 10, 10);
        submit_and_attest(&mut contract, 0, true);
        set_context("contractor.testnet", 0, 400);
        contract.raise_dispute(0);
        assert_eq!(
            contract.get_milestone(0).unwrap().status,
            MilestoneStatus::Disputed
        );
        set_context("owner.testnet", 0, 500);
        contract.resolve_dispute(0, DisputeResolution::RefundEmployer);
        assert_eq!(
            contract.get_milestone(0).unwrap().payout_target,
            Some("employer.testnet".into())
        );
        set_callback_context(600, PromiseResult::Successful(Vec::new()));
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Refunded);
    }

    #[test]
    fn ft_receiver_requires_allowlisted_token_and_records_token_asset() {
        let mut contract = contract();
        set_context("owner.testnet", 0, 150);
        contract.set_ft_token_allowed(account("token.testnet"), true);
        set_context("token.testnet", 1, 200);
        let msg = json!({
            "contractor": "contractor.testnet",
            "auto_release_limit": "10",
            "proof_requirements": "Publish API docs",
            "deadline": "1000"
        })
        .to_string();
        let unused = contract.ft_on_transfer(account("employer.testnet"), U128(10), msg);
        assert!(matches!(unused, PromiseOrValue::Value(U128(0))));
        let saved = contract.get_milestone(0).unwrap();
        assert_eq!(saved.amount, U128(10));
        assert_eq!(saved.asset_id, account("token.testnet"));
        assert_eq!(saved.asset_kind, AssetKind::Nep141);
    }

    #[test]
    fn nep141_release_uses_transfer_callback_before_marking_released() {
        let mut contract = contract();
        set_context("owner.testnet", 0, 150);
        contract.set_ft_token_allowed(account("token.testnet"), true);
        set_context("token.testnet", 1, 200);
        let msg = json!({
            "contractor": "contractor.testnet",
            "auto_release_limit": "10",
            "proof_requirements": "Publish API docs"
        })
        .to_string();
        let _ = contract.ft_on_transfer(account("employer.testnet"), U128(10), msg);
        set_context("contractor.testnet", 0, 300);
        contract.submit_proof(
            0,
            "sha256:abcdef0123456789".into(),
            "ipfs://bafy-proof".into(),
        );
        set_context("verifier.testnet", 0, 400);
        contract.record_attestation(0, true, "sha256:reasoning".into());
        set_context("employer.testnet", 0, 500);
        contract.release_payout(0);
        assert_eq!(
            contract.get_milestone(0).unwrap().status,
            MilestoneStatus::PayoutPending
        );
        set_callback_context(600, PromiseResult::Successful(b"null".to_vec()));
        assert_eq!(contract.on_payout_resolved(0), MilestoneStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Fungible token is not allowlisted")]
    fn ft_receiver_rejects_unapproved_tokens() {
        let mut contract = contract();
        set_context("untrusted-token.testnet", 1, 200);
        let msg = json!({
            "contractor": "contractor.testnet",
            "auto_release_limit": "10",
            "proof_requirements": "Requirement"
        })
        .to_string();
        let _ = contract.ft_on_transfer(account("employer.testnet"), U128(10), msg);
    }

    #[test]
    fn cross_chain_release_emits_pending_intent_until_authorized_reconciliation() {
        let mut contract = contract();
        set_context("owner.testnet", 0, 50);
        contract.set_bridge_adapter(Some(account("bridge.testnet")));
        set_context("employer.testnet", 10, 100);
        contract.create_escrow(
            account("contractor.testnet"),
            "Ethereum".to_string(),
            "0x1234abcd".to_string(),
            vec![MilestoneInput {
                title: "Bridge payout".to_string(),
                description: "Deliver verified work".to_string(),
                amount: U128(10),
                deadline_ns: 2_000,
            }],
        );
        set_context("contractor.testnet", 0, 200);
        contract.submit_proof(
            0,
            "sha256:abcdef0123456789".into(),
            "ipfs://bafy-proof".into(),
        );
        set_context("verifier.testnet", 0, 300);
        contract.record_attestation(0, true, "sha256:reasoning".into());
        set_context("employer.testnet", 0, 400);
        contract.release_payout(0);
        assert_eq!(
            contract.get_milestone(0).unwrap().status,
            MilestoneStatus::PayoutPending
        );
        set_context("owner.testnet", 0, 420);
        contract.set_bridge_adapter(Some(account("bridge-v2.testnet")));
        set_context("bridge.testnet", 0, 425);
        let premature = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_cross_chain_payout(0, "0xbridge-tx".into());
        }));
        assert!(premature.is_err());
        set_callback_context(450, PromiseResult::Successful(Vec::new()));
        assert_eq!(
            contract.on_payout_resolved(0),
            MilestoneStatus::PayoutPending
        );
        assert_eq!(
            contract.get_milestone(0).unwrap().pending_previous_status,
            None
        );
        assert_eq!(
            contract.get_milestone(0).unwrap().pending_bridge_adapter,
            Some(account("bridge.testnet"))
        );

        set_context("attacker.testnet", 0, 500);
        let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_cross_chain_payout(0, "0xbridge-tx".into());
        }));
        assert!(unauthorized.is_err());
        set_context("bridge-v2.testnet", 0, 501);
        let rotated_adapter = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.confirm_cross_chain_payout(0, "0xbridge-tx".into());
        }));
        assert!(rotated_adapter.is_err());
        set_context("bridge.testnet", 0, 502);
        contract.confirm_cross_chain_payout(0, "0xbridge-tx".into());
        let saved = contract.get_milestone(0).unwrap();
        assert_eq!(saved.status, MilestoneStatus::Released);
        assert_eq!(saved.bridge_tx_ref.as_deref(), Some("0xbridge-tx"));
        assert_eq!(saved.pending_bridge_adapter, None);
    }
}
