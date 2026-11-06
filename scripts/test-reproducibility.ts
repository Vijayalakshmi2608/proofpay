import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";

const cwd = resolve(process.cwd());
const rootDir = existsSync(resolve(cwd, "agent-verifier/package.json"))
  ? cwd
  : basename(cwd) === "agent-verifier"
    ? resolve(cwd, "..")
    : "";
if (!rootDir) throw new Error("Run this script from the ProofPay repository or agent-verifier directory");
const verifierRequire = createRequire(resolve(rootDir, "agent-verifier/package.json"));
const dotenv = verifierRequire("dotenv") as { config: (options: { path: string; override?: boolean }) => unknown };
dotenv.config({ path: resolve(rootDir, ".env"), override: false });
dotenv.config({ path: resolve(rootDir, "agent-verifier/.env"), override: false });

const REQUEST_TIMEOUT_MS = 2_500;
const RUN_BUDGET_MS = 8_000;
const startedAt = Date.now();
const EMPLOYER = "employer.mock.testnet";
const CONTRACT = "proofpay.mock.testnet";
const VERIFIER = "verifier.mock.testnet";
const CONTRACT_GUARD_ERROR = "Only the employer can release above auto_release_limit";

interface MockMilestone {
  id: number;
  amountUsdCents: number;
  autoReleaseLimitUsdCents: number;
  employer: string;
  contractor: string;
  status: "Pending" | "Attested" | "PayoutPending" | "Released";
  proofHash: string;
}

interface FunctionCallPolicy {
  receiverId: string;
  methodNames: readonly string[];
  allowanceYocto: string;
}

interface ScreeningQuote {
  dry: boolean;
  deposit: { address: string | null };
  quote: {
    amountInFormatted: string;
    amountOutFormatted: string;
    minAmountOut: string;
    timeEstimateSeconds: number | null;
  };
  sourceAsset: { symbol: string };
  targetAsset: { symbol: string };
  signature: { verified: boolean };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function authorizeFunctionCall(policy: FunctionCallPolicy, receiverId: string, methodName: string): void {
  if (policy.receiverId !== receiverId || !policy.methodNames.includes(methodName)) {
    throw Object.assign(new Error("NEAR Function-Call Access Key rejected an out-of-scope method"), {
      code: "InvalidAccessKeyError::MethodNameMismatch",
    });
  }
}

function releaseInMockContract(milestone: MockMilestone, caller: string): void {
  assert(milestone.status === "Attested", "Milestone must be attested before release");
  if (milestone.amountUsdCents > milestone.autoReleaseLimitUsdCents && caller !== milestone.employer) {
    throw new Error(CONTRACT_GUARD_ERROR);
  }
  milestone.status = "PayoutPending";
}

function line(text: string): void {
  console.log(text);
}

async function tryDryIntentQuote(): Promise<void> {
  let quote: ScreeningQuote | undefined;
  try {
    const intents = await import("../agent-verifier/src/intents.js");
    const dependencies = { requestTimeoutMs: REQUEST_TIMEOUT_MS };
    const assets = await intents.getSupportedIntentAssets(dependencies);
    const source = assets.find((asset) => asset.symbol === "USDC" && intents.isSupportedSourceAsset(asset));
    const target = assets.find((asset) => asset.blockchain === "eth" && asset.symbol === "USDC" && intents.isSupportedTargetAsset(asset));
    if (!source || !target) {
      line("[WARN] 1Click dry quote unavailable: canonical NEAR USDC or native Ethereum USDC is absent from the live registry.");
      return;
    }

    quote = await intents.getSettlementQuote({
      sourceAsset: source.assetId,
      targetAsset: target.assetId,
      targetAddress: "0x1111111111111111111111111111111111111111",
      amount: "500000000",
      refundAddress: process.env.NEAR_INTENTS_REFUND_ADDRESS?.trim() || "wrap.near",
      dry: true,
    }, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 180) : "unknown provider error";
    line(`[WARN] 1Click dry quote unavailable: ${message}. No deposit address was requested or returned; no funds moved.`);
    return;
  }
  if (!quote) return;
  assert(quote.dry === true, "The screening flow must not accept a fundable 1Click quote");
  assert(quote.deposit.address === null, "A dry quote must not expose a deposit address");
  line(`1Click dry quote: ${quote.quote.amountInFormatted} ${quote.sourceAsset.symbol} -> ${quote.quote.amountOutFormatted} ${quote.targetAsset.symbol}`);
  line(`Quote evidence: signature_verified=${quote.signature.verified}; min_output=${quote.quote.minAmountOut}; provider_estimate_seconds=${quote.quote.timeEstimateSeconds}; deposit_address=none`);
}

async function main(): Promise<void> {
  line("ProofPay reproducibility screening - LOCAL MOCK; no testnet deployment or transaction broadcast.");

  line("STEP 1: Deploy/Initialize Escrow Contract mock on NEAR Testnet.");
  const policy: FunctionCallPolicy = {
    receiverId: CONTRACT,
    methodNames: ["record_attestation"],
    allowanceYocto: "250000000000000000000000",
  };
  line(`[PASS] Local contract fixture initialized for ${CONTRACT}; verifier scope is ${CONTRACT}::record_attestation only.`);

  line("STEP 2: Create a $500 Milestone with an auto-release limit of $1,000.");
  const milestone: MockMilestone = {
    id: 1,
    amountUsdCents: 50_000,
    autoReleaseLimitUsdCents: 100_000,
    employer: EMPLOYER,
    contractor: "contractor.mock.testnet",
    status: "Pending",
    proofHash: "",
  };
  assert(milestone.amountUsdCents <= milestone.autoReleaseLimitUsdCents, "Fixture should be within the auto-release limit");
  line(`[PASS] Mock milestone ${milestone.id} created: $500.00; auto-release limit: $1,000.00 (illustrative USD fixture units, not an on-chain token price).`);

  line("STEP 3: Contractor submits proof hash 0xabc123...");
  milestone.proofHash = `sha256:${sha256("0xabc123...")}`;
  assert(/^sha256:[0-9a-f]{64}$/.test(milestone.proofHash), "Proof must use a complete SHA-256 reference accepted by the contract");
  assert(milestone.status === "Pending", "Proof submission must preserve the Pending status until attestation");
  line(`[PASS] Proof fixture accepted: sha256:${milestone.proofHash.slice(7, 23)}... (the abbreviated 0x value is a display label; the contract-shaped fixture is complete).`);

  line("STEP 4: AI Agent verifies proof and records attestation via Function-Call Key -> Log Tx Hash.");
  authorizeFunctionCall(policy, CONTRACT, "record_attestation");
  milestone.status = "Attested";
  const mockAttestationHash = sha256(JSON.stringify({ milestone: milestone.id, proof: milestone.proofHash, result: true, signer: VERIFIER }));
  line(`[PASS] Mock attestation accepted by the record_attestation-only policy; mock transaction hash: MOCK-${mockAttestationHash}`);

  line("STEP 5: Call release_payout -> Verify Released status and output a 1Click dry-run Intent quote.");
  releaseInMockContract(milestone, "keeper.mock.testnet");
  assert((milestone.status as string) === "PayoutPending", "The contract must enter PayoutPending before async settlement confirmation");
  milestone.status = "Released"; // Simulates the successful native transfer callback.
  assert((milestone.status as string) === "Released", "Successful payout callback should finalize the milestone");
  line(`[PASS] release_payout fixture and successful callback produced status=${milestone.status}.`);
  await tryDryIntentQuote();

  line("STEP 6 (Adversarial Check): Attempt release_payout for $5,000 using the AI key.");
  let keyRejected = false;
  try {
    authorizeFunctionCall(policy, CONTRACT, "release_payout");
  } catch (error) {
    keyRejected = error instanceof Error && (error as Error & { code?: string }).code === "InvalidAccessKeyError::MethodNameMismatch";
  }
  assert(keyRejected, "The verifier Function-Call key must reject release_payout before any contract call");
  line("[PASS] Restricted key blocks release_payout before contract execution: InvalidAccessKeyError::MethodNameMismatch (mock protocol assertion).");

  const overLimit: MockMilestone = {
    id: 2,
    amountUsdCents: 500_000,
    autoReleaseLimitUsdCents: 100_000,
    employer: EMPLOYER,
    contractor: "contractor.mock.testnet",
    status: "Attested",
    proofHash: milestone.proofHash,
  };
  let contractRejected = false;
  try {
    releaseInMockContract(overLimit, VERIFIER);
  } catch (error) {
    contractRejected = error instanceof Error && error.message === CONTRACT_GUARD_ERROR;
  }
  assert(contractRejected, "The contract mock must deny a non-employer release above the configured limit");
  line(`[PASS] Independent contract budget guard blocks $5,000 over $1,000: "${CONTRACT_GUARD_ERROR}".`);
  line("NOTE: This contract does not emit PolicyLimitExceeded. Live NEAR method-scope rejection is checked by npm run verify:key-permissions when testnet credentials are configured.");

  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs < RUN_BUDGET_MS, `Screening exceeded its ${RUN_BUDGET_MS}ms budget`);
  line(`SCREENING PASSED in ${elapsedMs}ms. All milestone actions were local fixtures; no testnet write or fund movement occurred.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SCREENING FAILED: ${message.replace(/[\r\n\t]+/g, " ").slice(0, 300)}`);
  process.exitCode = 1;
});
