import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isExpectedAccessKeyPermissionRejection,
  loadKeyManagerConfig,
  readVerifierKeyFile,
  verifyKeyOnChain,
} from "./keyManager.js";

const GAS_LIMIT = 30_000_000_000_000n;

function loadRootAndWorkspaceEnv(): void {
  dotenv.config({ path: resolve(process.cwd(), "../.env"), override: false });
  dotenv.config({ path: resolve(process.cwd(), ".env"), override: false });
  dotenv.config({
    path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))),
    override: false,
  });
}

function flattenError(error: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const withCause = error as Error & { cause?: unknown };
    const extra: string[] = [];
    for (const key of Object.getOwnPropertyNames(error)) {
      if (["name", "message", "stack", "cause"].includes(key)) continue;
      try {
        extra.push(flattenError((error as unknown as Record<string, unknown>)[key], depth + 1));
      } catch {
        // Some SDK error properties may be getters that throw; preserve other fields.
      }
    }
    return `${error.name}: ${error.message} ${extra.join(" ")} ${flattenError(withCause.cause, depth + 1)}`;
  }
  if (error && typeof error === "object") {
    try {
      const record = error as Record<string, unknown>;
      return `${JSON.stringify(error)} ${Object.values(record).map((item) => flattenError(item, depth + 1)).join(" ")}`;
    } catch {
      return String(error);
    }
  }
  return String(error ?? "");
}

export async function verifyKeyPermissions(): Promise<void> {
  loadRootAndWorkspaceEnv();
  const config = loadKeyManagerConfig();
  if (config.networkId !== "testnet") {
    throw new Error("Refusing to broadcast the negative permission test outside NEAR testnet");
  }

  let keyFile;
  try {
    keyFile = await readVerifierKeyFile(config.keyFile);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const privateKey = process.env.NEAR_VERIFIER_PRIVATE_KEY?.trim() || keyFile?.privateKey;
  if (!privateKey) {
    throw new Error(
      "Provide NEAR_VERIFIER_PRIVATE_KEY or generate a verifier key with `npm run key:generate`. The key must never be Full-Access.",
    );
  }
  const keyPair = KeyPair.fromString(privateKey as Parameters<typeof KeyPair.fromString>[0]);
  const publicKey = keyPair.getPublicKey().toString();
  if (keyFile && keyFile.publicKey !== publicKey) {
    throw new Error("NEAR_VERIFIER_PRIVATE_KEY does not match the generated verifier key file");
  }

  const keyMetadata = keyFile ?? {
    publicKey,
    privateKey,
    networkId: config.networkId,
    receiverId: config.contractAccountId,
    methodNames: ["record_attestation"],
    allowanceYocto: config.allowanceYocto.toString(),
    createdAt: "loaded-from-environment",
  };
  await verifyKeyOnChain(config, keyMetadata);

  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const agentSigner = new KeyPairSigner(keyPair);
  const agentAccount = new Account(config.verifierAccountId, provider, agentSigner);

  let outcome: unknown;
  try {
    outcome = await agentAccount.signAndSendTransaction({
      receiverId: config.contractAccountId,
      actions: [actions.functionCall("transfer_all", {}, GAS_LIMIT, 0n)],
      throwOnFailure: false,
      retries: 0,
    });
  } catch (error) {
    const detail = flattenError(error);
    if (isExpectedAccessKeyPermissionRejection(error)) {
      console.log("PASS: testnet rejected transfer_all under the verifier key's Function-Call AccessKeyPermission.");
      console.log(`Verified permission: ${config.contractAccountId}::record_attestation only.`);
      console.log(`NEAR RPC rejection: ${detail}`);
      return;
    }
    throw new Error(`Unauthorized transfer_all was rejected for an unexpected reason: ${detail}`, { cause: error });
  }

  const outcomeDetail = flattenError(outcome);
  if (isExpectedAccessKeyPermissionRejection(outcome)) {
    console.log("PASS: testnet rejected transfer_all under the verifier key's Function-Call AccessKeyPermission.");
    console.log(`Verified permission: ${config.contractAccountId}::record_attestation only.`);
    console.log(`NEAR RPC rejection outcome: ${outcomeDetail}`);
    return;
  }

  throw new Error(
    `SECURITY FAILURE: the unauthorized transfer_all result did not contain NEAR's exact structured method-denial error for transfer_all; no key restriction was confirmed. RPC outcome: ${outcomeDetail}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyKeyPermissions().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
