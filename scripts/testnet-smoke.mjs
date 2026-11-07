import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve("agent-verifier/.env");
try {
  const envText = await readFile(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_whole, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
} catch {
  // A local clone without private Testnet configuration safely skips live checks.
}

const contractId = process.env.NEAR_CONTRACT_ACCOUNT_ID?.trim();
const verifierId = process.env.NEAR_VERIFIER_ACCOUNT_ID?.trim();
const publicKey = process.env.NEAR_VERIFIER_PUBLIC_KEY?.trim();
const rpcUrl = process.env.NEAR_RPC_URL?.trim() || "https://rpc.testnet.near.org";
const milestoneValue = process.env.PROOFPAY_LIVE_SMOKE_MILESTONE_ID?.trim();
const keyFile = resolve("agent-verifier", process.env.NEAR_VERIFIER_KEY_FILE?.trim() || ".secrets/verifier-function-call-key.json");

if (process.env.NEAR_NETWORK?.trim().toLowerCase() !== "testnet" || !contractId || !verifierId || !publicKey || !milestoneValue) {
  console.log("[SKIP] Live Testnet verification needs NEAR_NETWORK=testnet, account/key settings, and PROOFPAY_LIVE_SMOKE_MILESTONE_ID in agent-verifier/.env.");
  process.exit(0);
}

const milestoneId = Number(milestoneValue);
if (!Number.isSafeInteger(milestoneId) || milestoneId < 0) throw new Error("Invalid PROOFPAY_LIVE_SMOKE_MILESTONE_ID");

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "proofpay-live-smoke", method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error("NEAR RPC returned an error");
  return payload.result;
}

async function view(methodName, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

try {
  const account = await rpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: contractId,
  });
  if (!account.code_hash || account.code_hash === "11111111111111111111111111111111") throw new Error("Contract code is not deployed");
  console.log(`[LIVE PASS] Testnet contract deployed: ${contractId} (code hash ${account.code_hash})`);

  const verifierConfig = await view("verifier_configuration");
  if (!Array.isArray(verifierConfig) || verifierConfig[0] !== verifierId || verifierConfig[1] !== publicKey) {
    throw new Error("On-chain verifier configuration does not match the configured account/public key");
  }
  console.log("[LIVE PASS] Contract initialized with the configured verifier identity");

  const permission = await rpc("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: verifierId,
    public_key: publicKey,
  });
  const functionCall = permission.permission?.FunctionCall;
  const remainingAllowance = BigInt(String(functionCall?.allowance ?? "0"));
  const configuredAllowance = BigInt(process.env.NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO || "0");
  if (
    !functionCall ||
    functionCall.receiver_id !== contractId ||
    !Array.isArray(functionCall.method_names) ||
    functionCall.method_names.length !== 1 ||
    functionCall.method_names[0] !== "record_attestation" ||
    remainingAllowance <= 0n ||
    remainingAllowance > configuredAllowance
  ) {
    throw new Error("On-chain key permission is broader than the expected record_attestation-only scope");
  }
  console.log("[LIVE PASS] Function-Call key allows only record_attestation on the escrow contract");

  const milestone = await view("get_milestone", { milestone_id: milestoneId });
  if (!milestone || milestone.id !== milestoneId || !milestone.proof_hash || milestone.attestation?.result !== true) {
    throw new Error(`Milestone ${milestoneId} does not contain a submitted proof and successful attestation`);
  }
  console.log(`[LIVE PASS] Milestone ${milestoneId} has a submitted proof and successful attestation`);
  if (milestone.status !== "released") throw new Error(`Milestone ${milestoneId} status is ${milestone.status}, not released`);
  console.log(`[LIVE PASS] Milestone ${milestoneId} payout is finalized as ${milestone.status}`);

  try {
    const key = JSON.parse(await readFile(keyFile, "utf8"));
    if (key.publicKey !== publicKey || key.receiverId !== contractId || key.methodNames?.length !== 1 || key.methodNames[0] !== "record_attestation") {
      throw new Error("Local key metadata does not match the configured restricted key");
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Local restricted-key metadata is invalid");
    throw error;
  }
} catch (error) {
  console.error(`[LIVE FAIL] ${error instanceof Error ? error.message : "Testnet verification failed"}`);
  process.exitCode = 1;
}
