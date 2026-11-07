import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, actions } from "near-api-js";
import dotenv from "dotenv";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWED_METHODS = ["record_attestation"] as const;
const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
const DEFAULT_ALLOWANCE_YOCTO = "250000000000000000000000"; // 0.25 NEAR, for gas only.
const DEFAULT_KEY_FILE = ".secrets/verifier-function-call-key.json";
const GAS_LIMIT = 30_000_000_000_000n;

export interface GeneratedVerifierKey {
  publicKey: string;
  privateKey: string;
  networkId: string;
  receiverId: string;
  methodNames: readonly string[];
  allowanceYocto: string;
  createdAt: string;
}

export interface VerifierFunctionCallPolicy {
  receiverId: string;
  methodNames: readonly string[];
  allowanceYocto: string;
}

export interface KeyManagerConfig {
  networkId: string;
  rpcUrl: string;
  verifierAccountId: string;
  contractAccountId: string;
  allowanceYocto: bigint;
  keyFile: string;
}

export function validateAccountId(value: string, label: string): string {
  const accountId = value.trim();
  if (
    accountId.length < 2 ||
    accountId.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(accountId)
  ) {
    throw new Error(`${label} must be a valid NEAR account ID`);
  }
  return accountId;
}

/**
 * Build the only permission ProofPay gives its verifier agent: one receiver, one method.
 * The protocol itself prohibits attached NEAR deposits for Function-Call keys.
 */
export function createVerifierFunctionCallKey(
  contractAccountId: string,
  options: { networkId?: string; allowanceYocto?: bigint } = {},
): GeneratedVerifierKey {
  const receiverId = validateAccountId(contractAccountId, "Escrow contract account");
  const allowanceYocto = options.allowanceYocto ?? BigInt(DEFAULT_ALLOWANCE_YOCTO);
  if (allowanceYocto <= 0n) {
    throw new Error("Function-Call key gas allowance must be greater than zero");
  }

  const keyPair = KeyPair.fromRandom("ed25519");
  const policy = createVerifierFunctionCallPolicy(receiverId, allowanceYocto);

  return {
    publicKey: keyPair.getPublicKey().toString(),
    privateKey: keyPair.toString(),
    networkId: options.networkId ?? "testnet",
    receiverId: policy.receiverId,
    methodNames: policy.methodNames,
    allowanceYocto: policy.allowanceYocto,
    createdAt: new Date().toISOString(),
  };
}

/** Return the permission derived from near-api-js' protocol Function-Call AccessKey model. */
export function createVerifierFunctionCallPolicy(
  contractAccountId: string,
  allowanceYocto = BigInt(DEFAULT_ALLOWANCE_YOCTO),
): VerifierFunctionCallPolicy {
  const receiverId = validateAccountId(contractAccountId, "Escrow contract account");
  if (allowanceYocto <= 0n) {
    throw new Error("Function-Call key gas allowance must be greater than zero");
  }
  const accessKey = actions.functionCallAccessKey(receiverId, [...ALLOWED_METHODS], allowanceYocto);
  const functionCallPermission = accessKey.permission.functionCall;
  if (!functionCallPermission) {
    throw new Error("near-api-js did not construct a Function-Call AccessKey permission");
  }
  return {
    receiverId: functionCallPermission.receiverId,
    methodNames: [...functionCallPermission.methodNames],
    allowanceYocto: functionCallPermission.allowance?.toString() ?? allowanceYocto.toString(),
  };
}

/** Strictly require the on-chain key to have exactly one receiver and one allowed method. */
export function assertVerifierFunctionCallPermission(
  permission: unknown,
  expectedContractId: string,
  expectedAllowanceYocto?: bigint,
): void {
  if (permission === null || typeof permission !== "object" || !("FunctionCall" in permission)) {
    throw new Error("Verifier key is not a Function-Call Access Key");
  }

  const functionCall = (permission as { FunctionCall?: unknown }).FunctionCall;
  if (functionCall === null || typeof functionCall !== "object") {
    throw new Error("Verifier key has an invalid Function-Call permission payload");
  }

  const view = functionCall as {
    receiver_id?: unknown;
    method_names?: unknown;
    allowance?: unknown;
  };
  if (view.receiver_id !== expectedContractId) {
    throw new Error(`Verifier key receiver must be exactly ${expectedContractId}`);
  }
  if (
    !Array.isArray(view.method_names) ||
    view.method_names.length !== ALLOWED_METHODS.length ||
    view.method_names[0] !== ALLOWED_METHODS[0]
  ) {
    throw new Error("Verifier key must allow exactly record_attestation and no other methods");
  }
  if (view.allowance === undefined || view.allowance === null) {
    throw new Error("Verifier Function-Call key must have a finite gas allowance");
  }
  let allowance: bigint;
  try {
    allowance = BigInt(String(view.allowance));
  } catch {
    throw new Error("Verifier Function-Call key has an invalid gas allowance");
  }
  if (allowance <= 0n) {
    throw new Error("Verifier Function-Call key gas allowance must be greater than zero");
  }
  if (expectedAllowanceYocto !== undefined && allowance > expectedAllowanceYocto) {
    throw new Error("Verifier Function-Call key gas allowance exceeds the configured limit");
  }
}

export function isExpectedAccessKeyPermissionRejection(error: unknown): boolean {
  const expectedVariants = new Set([
    "MethodNameMismatch",
    "FunctionCallAccessKeyMethodNotAllowed",
    "AccessKeyMethodNameMismatchActionError",
  ]);
  const errorCodeFields = ["name", "type", "error_type", "errorType", "error_code", "errorCode", "code"];
  const envelopeFields = [
    "data", "error_data", "errorData", "cause", "error", "errors", "details", "context", "status", "Failure", "failure",
    "ActionError", "action_error", "kind", "InvalidTxError", "InvalidAccessKeyError",
  ];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12 || value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((entry) => visit(entry, depth + 1));
    if (seen.has(value)) return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const hasExpectedMethod = (candidate: unknown): boolean => {
      if (candidate === null || typeof candidate !== "object") return false;
      const fields = candidate as Record<string, unknown>;
      return fields.method_name === "transfer_all" || fields.methodName === "transfer_all";
    };

    for (const variant of expectedVariants) {
      if (hasExpectedMethod(record[variant])) return true;
      if (
        errorCodeFields.some((field) => record[field] === variant) &&
        (record.method_name === "transfer_all" || record.methodName === "transfer_all")
      ) {
        return true;
      }
    }
    if (value instanceof Error && value.name === "MethodNameMismatch" && hasExpectedMethod(record)) return true;

    return envelopeFields.some((field) => visit(record[field], depth + 1));
  };

  return visit(error, 0);
}

export function loadKeyManagerConfig(env: NodeJS.ProcessEnv = process.env): KeyManagerConfig {
  const networkId = (env.NEAR_NETWORK ?? "testnet").trim().toLowerCase();
  if (!networkId) throw new Error("NEAR_NETWORK cannot be empty");

  const rpcUrl = env.NEAR_RPC_URL?.trim() || DEFAULT_RPC_URL;
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("NEAR_RPC_URL must use HTTPS outside localhost");
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error("NEAR_RPC_URL must be a valid URL");
    throw error;
  }

  const verifierAccountId = validateAccountId(
    env.NEAR_VERIFIER_ACCOUNT_ID ?? "",
    "NEAR_VERIFIER_ACCOUNT_ID",
  );
  const contractAccountId = validateAccountId(
    env.NEAR_CONTRACT_ACCOUNT_ID ?? "",
    "NEAR_CONTRACT_ACCOUNT_ID",
  );
  const allowanceText = env.NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO ?? DEFAULT_ALLOWANCE_YOCTO;
  if (!/^\d+$/.test(allowanceText)) {
    throw new Error("NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO must be a non-negative integer");
  }
  const allowanceYocto = BigInt(allowanceText);
  if (allowanceYocto <= 0n) {
    throw new Error("NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO must be greater than zero");
  }

  return {
    networkId,
    rpcUrl,
    verifierAccountId,
    contractAccountId,
    allowanceYocto,
    keyFile: resolve(env.NEAR_VERIFIER_KEY_FILE?.trim() || DEFAULT_KEY_FILE),
  };
}

/** Generate and store the private key with owner-only permissions; never log its secret. */
export async function generateAndStoreVerifierKey(config: KeyManagerConfig): Promise<GeneratedVerifierKey> {
  const key = createVerifierFunctionCallKey(config.contractAccountId, {
    networkId: config.networkId,
    allowanceYocto: config.allowanceYocto,
  });
  await mkdir(dirname(config.keyFile), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(dirname(config.keyFile), 0o700);
  const handle = await open(config.keyFile, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(key, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  await chmod(config.keyFile, 0o600);
  return key;
}

export async function readVerifierKeyFile(filePath: string): Promise<GeneratedVerifierKey> {
  const fileInfo = await lstat(filePath);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new Error("Verifier key path must be a regular file, not a symlink");
  }
  if (process.platform !== "win32" && (fileInfo.mode & 0o077) !== 0) {
    throw new Error("Verifier key file permissions are too broad; expected owner-only mode 0600");
  }
  const text = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Verifier key file is not valid JSON: ${filePath}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Verifier key file must contain a JSON object");
  }
  const key = parsed as Partial<GeneratedVerifierKey>;
  if (
    typeof key.publicKey !== "string" ||
    typeof key.privateKey !== "string" ||
    typeof key.networkId !== "string" ||
    typeof key.receiverId !== "string" ||
    typeof key.allowanceYocto !== "string" ||
    typeof key.createdAt !== "string" ||
    !Array.isArray(key.methodNames)
  ) {
    throw new Error("Verifier key file is missing key or permission metadata");
  }
  const keyPair = KeyPair.fromString(key.privateKey as Parameters<typeof KeyPair.fromString>[0]);
  if (keyPair.getPublicKey().toString() !== key.publicKey) {
    throw new Error("Verifier key file public and private keys do not match");
  }
  if (key.receiverId !== validateAccountId(key.receiverId, "Stored receiver account")) {
    throw new Error("Verifier key file contains a non-canonical receiver account");
  }
  if (key.methodNames.length !== 1 || key.methodNames[0] !== ALLOWED_METHODS[0]) {
    throw new Error("Verifier key file does not describe the required single-method permission");
  }
  if (!/^\d+$/.test(key.allowanceYocto) || BigInt(key.allowanceYocto) <= 0n) {
    throw new Error("Verifier key file has an invalid Function-Call gas allowance");
  }
  return key as GeneratedVerifierKey;
}

/** Add the generated key to the verifier account using a separate, privileged provisioning key. */
export async function provisionVerifierFunctionCallKey(
  config: KeyManagerConfig,
  generatedKey: GeneratedVerifierKey,
  provisionerPrivateKey: string,
): Promise<void> {
  if (config.networkId !== "testnet") {
    throw new Error("Refusing to provision verifier Function-Call keys outside NEAR testnet");
  }
  if (generatedKey.receiverId !== config.contractAccountId) {
    throw new Error("Generated key receiver does not match the configured escrow contract");
  }
  if (generatedKey.networkId !== config.networkId) {
    throw new Error("Generated key network does not match NEAR_NETWORK");
  }
  if (generatedKey.allowanceYocto !== config.allowanceYocto.toString()) {
    throw new Error("Generated key allowance does not match NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO");
  }
  if (generatedKey.methodNames.length !== 1 || generatedKey.methodNames[0] !== ALLOWED_METHODS[0]) {
    throw new Error("Refusing to provision a key with broader than record_attestation permission");
  }

  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const actualNetwork = await provider.getNetworkId();
  if (actualNetwork !== config.networkId) {
    throw new Error(`RPC network mismatch: configured ${config.networkId}, endpoint reports ${actualNetwork}`);
  }
  const provisioner = KeyPairSigner.fromSecretKey(
    provisionerPrivateKey as Parameters<typeof KeyPairSigner.fromSecretKey>[0],
  );
  const verifierAccount = new Account(config.verifierAccountId, provider, provisioner);
  await verifierAccount.addFunctionCallAccessKey({
    publicKey: PublicKey.from(generatedKey.publicKey),
    contractId: config.contractAccountId,
    methodNames: [...ALLOWED_METHODS],
    allowance: config.allowanceYocto,
  });

  const onChainKey = await verifierAccount.getAccessKey(generatedKey.publicKey);
  assertVerifierFunctionCallPermission(
    onChainKey.permission,
    config.contractAccountId,
    config.allowanceYocto,
  );
}

export async function verifyKeyOnChain(
  config: KeyManagerConfig,
  generatedKey: GeneratedVerifierKey,
): Promise<void> {
  if (generatedKey.receiverId !== config.contractAccountId) {
    throw new Error("Key metadata receiver does not match NEAR_CONTRACT_ACCOUNT_ID");
  }
  if (generatedKey.networkId !== config.networkId) {
    throw new Error("Key metadata network does not match NEAR_NETWORK");
  }
  if (generatedKey.methodNames.length !== 1 || generatedKey.methodNames[0] !== ALLOWED_METHODS[0]) {
    throw new Error("Key metadata does not describe the required single-method permission");
  }
  if (generatedKey.allowanceYocto !== config.allowanceYocto.toString()) {
    throw new Error("Key metadata allowance does not match NEAR_VERIFIER_KEY_ALLOWANCE_YOCTO");
  }
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const actualNetwork = await provider.getNetworkId();
  if (actualNetwork !== config.networkId) {
    throw new Error(`RPC network mismatch: configured ${config.networkId}, endpoint reports ${actualNetwork}`);
  }
  const verifierAccount = new Account(config.verifierAccountId, provider);
  const onChainKey = await verifierAccount.getAccessKey(generatedKey.publicKey);
  assertVerifierFunctionCallPermission(
    onChainKey.permission,
    config.contractAccountId,
    config.allowanceYocto,
  );
}

function loadRootAndWorkspaceEnv(): void {
  dotenv.config({ path: resolve(process.cwd(), "../.env"), override: false });
  dotenv.config({ path: resolve(process.cwd(), ".env"), override: false });
  const projectRootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  dotenv.config({ path: projectRootEnv, override: false });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  loadRootAndWorkspaceEnv();
  if (command === "provision" && !process.env.NEAR_VERIFIER_PROVISIONER_PRIVATE_KEY?.trim()) {
    // This file is intentionally separate from the verifier service's .env and is loaded only here.
    dotenv.config({ path: resolve(process.cwd(), ".env.provisioner"), override: true });
  }
  const config = loadKeyManagerConfig();

  if (command === "generate") {
    const key = await generateAndStoreVerifierKey(config);
    console.log(`Generated restricted verifier key: ${key.publicKey}`);
    console.log(`Private key saved with mode 0600: ${config.keyFile}`);
    console.log(`Permission: ${key.receiverId}::${key.methodNames.join(",")}; gas allowance ${key.allowanceYocto} yoctoNEAR`);
    console.log(`Set NEAR_VERIFIER_PUBLIC_KEY=${key.publicKey} for the contract deployment/initialization.`);
    return;
  }

  if (command === "provision") {
    const provisionerPrivateKey = process.env.NEAR_VERIFIER_PROVISIONER_PRIVATE_KEY?.trim();
    if (!provisionerPrivateKey) {
      throw new Error("NEAR_VERIFIER_PROVISIONER_PRIVATE_KEY is required; it must be a temporary Full-Access key for NEAR_VERIFIER_ACCOUNT_ID and is never saved by this command");
    }
    const key = await readVerifierKeyFile(config.keyFile);
    await provisionVerifierFunctionCallKey(config, key, provisionerPrivateKey);
    console.log(`Provisioned and verified ${key.publicKey} on ${config.verifierAccountId}.`);
    console.log(`Allowed call: ${config.contractAccountId}::record_attestation only.`);
    return;
  }

  throw new Error("Usage: key:generate | key:provision (testnet provisioning requires explicit signer credentials)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
