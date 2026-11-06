import { describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVerifierFunctionCallPermission,
  createVerifierFunctionCallKey,
  createVerifierFunctionCallPolicy,
  generateAndStoreVerifierKey,
  isExpectedAccessKeyPermissionRejection,
  readVerifierKeyFile,
} from "./keyManager.js";

describe("verifier Function-Call key policy", () => {
  it("generates an Ed25519 key with exactly the escrow receiver and record_attestation method", () => {
    const generated = createVerifierFunctionCallKey("proofpay.testnet", {
      networkId: "testnet",
      allowanceYocto: 123n,
    });
    const policy = createVerifierFunctionCallPolicy("proofpay.testnet", 123n);

    expect(generated.publicKey).toMatch(/^ed25519:/);
    expect(generated.privateKey).toMatch(/^ed25519:/);
    expect(generated.receiverId).toBe("proofpay.testnet");
    expect(generated.methodNames).toEqual(["record_attestation"]);
    expect(generated.allowanceYocto).toBe("123");
    expect(policy).toEqual({
      receiverId: "proofpay.testnet",
      methodNames: ["record_attestation"],
      allowanceYocto: "123",
    });
  });

  it("rejects zero gas allowance and invalid contract IDs before key provisioning", () => {
    expect(() => createVerifierFunctionCallKey("not a near account")).toThrow(/valid NEAR account ID/);
    expect(() => createVerifierFunctionCallPolicy("proofpay.testnet", 0n)).toThrow(/greater than zero/);
  });

  it("stores generated private keys in an owner-only file and reads matching key material", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofpay-key-manager-"));
    const keyFile = join(directory, ".secrets", "verifier.json");
    try {
      const generated = await generateAndStoreVerifierKey({
        networkId: "testnet",
        rpcUrl: "https://rpc.testnet.near.org",
        verifierAccountId: "verifier.testnet",
        contractAccountId: "proofpay.testnet",
        allowanceYocto: 456n,
        keyFile,
      });
      const loaded = await readVerifierKeyFile(keyFile);
      const mode = (await stat(keyFile)).mode & 0o777;

      expect(mode).toBe(0o600);
      expect(loaded.publicKey).toBe(generated.publicKey);
      expect(loaded.receiverId).toBe("proofpay.testnet");
      expect(loaded.methodNames).toEqual(["record_attestation"]);
      await expect(
        generateAndStoreVerifierKey({
          networkId: "testnet",
          rpcUrl: "https://rpc.testnet.near.org",
          verifierAccountId: "verifier.testnet",
          contractAccountId: "proofpay.testnet",
          allowanceYocto: 456n,
          keyFile,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts only the exact Function-Call permission and excludes payout and ownership methods", () => {
    expect(() =>
      assertVerifierFunctionCallPermission(
        {
          FunctionCall: {
            receiver_id: "proofpay.testnet",
            method_names: ["record_attestation"],
            allowance: "250000000000000000000000",
          },
        },
        "proofpay.testnet",
        250000000000000000000000n,
      ),
    ).not.toThrow();
    expect(() =>
      assertVerifierFunctionCallPermission(
        {
          FunctionCall: {
            receiver_id: "proofpay.testnet",
            method_names: ["record_attestation"],
            allowance: "1000000000000000000000000",
          },
        },
        "proofpay.testnet",
        250000000000000000000000n,
      ),
    ).toThrow(/does not match the configured limit/);
    expect(() =>
      assertVerifierFunctionCallPermission(
        {
          FunctionCall: {
            receiver_id: "proofpay.testnet",
            method_names: ["record_attestation"],
            allowance: null,
          },
        },
        "proofpay.testnet",
      ),
    ).toThrow(/finite gas allowance/);

    for (const method of ["release_payout", "transfer", "transfer_all", "set_bridge_adapter", "set_verifier"]) {
      expect(() =>
        assertVerifierFunctionCallPermission(
          {
            FunctionCall: {
              receiver_id: "proofpay.testnet",
              method_names: ["record_attestation", method],
            },
          },
          "proofpay.testnet",
        ),
      ).toThrow(/exactly record_attestation/);
    }
    expect(() => assertVerifierFunctionCallPermission("FullAccess", "proofpay.testnet")).toThrow(/not a Function-Call/);
    expect(() =>
      assertVerifierFunctionCallPermission(
        { FunctionCall: { receiver_id: "other.testnet", method_names: ["record_attestation"] } },
        "proofpay.testnet",
      ),
    ).toThrow(/receiver must be exactly/);
  });

  it("classifies method-permission rejection but not unrelated RPC failures", () => {
    expect(
      isExpectedAccessKeyPermissionRejection({
        InvalidTxError: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: "transfer_all" } } },
      }),
    ).toBe(true);
    expect(
      isExpectedAccessKeyPermissionRejection({
        status: {
          Failure: {
            ActionError: {
              kind: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: "transfer_all" } } },
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      isExpectedAccessKeyPermissionRejection({
        error_data: { InvalidAccessKeyError: { MethodNameMismatch: { method_name: "transfer_all" } } },
      }),
    ).toBe(true);
    expect(
      isExpectedAccessKeyPermissionRejection(
        Object.assign(new Error("RPC transaction rejected"), {
          type: "MethodNameMismatch",
          method_name: "transfer_all",
        }),
      ),
    ).toBe(true);
    expect(
      isExpectedAccessKeyPermissionRejection({
        InvalidAccessKeyError: { FunctionCallAccessKeyMethodNotAllowed: { method_name: "transfer_all" } },
      }),
    ).toBe(true);
    expect(isExpectedAccessKeyPermissionRejection(new Error("FunctionCallAccessKeyMethodNotAllowed"))).toBe(false);
    expect(isExpectedAccessKeyPermissionRejection({ message: "MethodNameMismatch: transfer_all" })).toBe(false);
    expect(
      isExpectedAccessKeyPermissionRejection({
        InvalidAccessKeyError: { MethodNameMismatch: { method_name: "release_payout" } },
      }),
    ).toBe(false);
    expect(isExpectedAccessKeyPermissionRejection(new Error("Network request timed out"))).toBe(false);
    expect(isExpectedAccessKeyPermissionRejection(new Error("MethodNotFound"))).toBe(false);
  });
});
