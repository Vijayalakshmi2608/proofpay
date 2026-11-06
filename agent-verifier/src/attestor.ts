import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import { Account, actions, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { z } from "zod";
import { attest } from "./attestation.js";
import { config } from "./config.js";
import {
  assertVerifierFunctionCallPermission,
  loadKeyManagerConfig,
  readVerifierKeyFile,
  verifyKeyOnChain,
} from "./keyManager.js";
import {
  attestRequestSchema,
  attestorSignedPayloadSchema,
  deliverableVerificationRequestSchema,
  deliverableVerificationResponseSchema,
  type AttestRequest,
  type Attestation,
  type AttestorCheck,
  type DeliverableVerificationInput,
  type DeliverableVerificationRequest,
  type DeliverableVerificationResponse,
} from "./schema.js";

const U128_MAX = (1n << 128n) - 1n;
const GITHUB_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 10_000;
const MAX_GITHUB_RESPONSE_BYTES = 4_000_000;
const MAX_RPC_RESPONSE_BYTES = 1_000_000;

const criteriaSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  requiredFiles: z.array(z.string().min(1).max(256)).max(20).default([]),
  requiredPhrases: z.array(z.string().min(1).max(500)).max(20).default([]),
  expectedRepository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/).optional(),
  expectedFileHash: z.string().regex(/^(?:sha256:)?[a-fA-F0-9]{64}$/).optional(),
  budgetCeilingYocto: z.string().regex(/^\d{1,39}$/).optional(),
}).strict();

const chainMilestoneSchema = z.object({
  id: z.number().int().safe().nonnegative(),
  employer: z.string().min(2).max(64),
  contractor: z.string().min(2).max(64),
  amount: z.string().regex(/^\d{1,39}$/),
  auto_release_limit: z.string().regex(/^\d{1,39}$/),
  deadline: z.string().regex(/^\d{1,20}$/),
  proof_hash: z.string().max(256),
  proof_url: z.string().max(2_048),
  proof_requirements: z.string().min(1).max(2_048),
  status: z.enum(["pending", "attested", "payout_pending", "released", "disputed", "refunded"]),
}).passthrough();

const githubCommitSchema = z.object({
  sha: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
  commit: z.object({
    message: z.string().max(10_000).optional().default(""),
    tree: z.object({ sha: z.string().regex(/^[a-fA-F0-9]{40}$/) }).passthrough(),
  }).passthrough(),
}).passthrough();

const githubTreeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string().max(1_024) }).passthrough()).max(200_000),
}).passthrough();

export interface ChainMilestone {
  id: number;
  employer: string;
  contractor: string;
  amount: string;
  auto_release_limit: string;
  deadline: string;
  proof_hash: string;
  proof_url: string;
  proof_requirements: string;
  status: "pending" | "attested" | "payout_pending" | "released" | "disputed" | "refunded";
}

export interface GithubInspection {
  sha: string;
  message: string;
  files: string[];
  truncated: boolean;
}

export interface AttestorDependencies {
  getMilestone: (milestoneId: number) => Promise<ChainMilestone>;
  inspectGithub: (repository: string, commitHash: string) => Promise<GithubInspection>;
  review: (request: AttestRequest) => Promise<Attestation>;
  recordAttestation: (milestoneId: number, reasoningHash: string) => Promise<string>;
  allowOnChainWrites: boolean;
  now: () => Date;
}

export class AttestorServiceError extends Error {
  constructor(readonly httpStatus: number, message: string) {
    super(message);
    this.name = "AttestorServiceError";
  }
}

function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  return response.text().then((text) => {
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Upstream response exceeded size limit");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Upstream service returned malformed JSON");
    }
  });
}

async function getMilestoneFromNear(milestoneId: number): Promise<ChainMilestone> {
  const near = loadKeyManagerConfig();
  if (near.networkId !== "testnet") {
    throw new AttestorServiceError(503, "Automated attestation is restricted to NEAR testnet");
  }
  let response: Response;
  try {
    response = await fetch(near.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "proofpay-attestor-view",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: near.contractAccountId,
          method_name: "get_milestone",
          args_base64: Buffer.from(JSON.stringify({ milestone_id: milestoneId })).toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    throw new AttestorServiceError(502, "NEAR testnet RPC query failed");
  }
  if (!response.ok) throw new AttestorServiceError(502, `NEAR testnet RPC returned HTTP ${response.status}`);
  const rpc = await boundedJson(response, MAX_RPC_RESPONSE_BYTES) as {
    error?: unknown;
    result?: { result?: unknown };
  };
  if (rpc.error || !Array.isArray(rpc.result?.result)) {
    throw new AttestorServiceError(502, "NEAR testnet RPC did not return the milestone view result");
  }
  const value = Buffer.from(Uint8Array.from(rpc.result.result as number[])).toString("utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    throw new AttestorServiceError(502, "Milestone view returned malformed JSON");
  }
  if (decoded === null) throw new AttestorServiceError(404, "Milestone was not found on NEAR testnet");
  const milestone = chainMilestoneSchema.safeParse(decoded);
  if (!milestone.success) throw new AttestorServiceError(502, "On-chain milestone state did not match the ProofPay schema");
  return milestone.data;
}

async function inspectGithubCommit(repository: string, commitHash: string): Promise<GithubInspection> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (config.GITHUB_TOKEN) headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
  const commitUrl = `https://api.github.com/repos/${repository}/commits/${commitHash}`;
  const commitResponse = await fetch(commitUrl, {
    headers,
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!commitResponse.ok) {
    throw new AttestorServiceError(commitResponse.status === 404 ? 422 : 502, "GitHub commit lookup failed");
  }
  const commitJson = githubCommitSchema.safeParse(await boundedJson(commitResponse, MAX_GITHUB_RESPONSE_BYTES));
  if (!commitJson.success || commitJson.data.sha.toLowerCase() !== commitHash.toLowerCase()) {
    throw new AttestorServiceError(422, "GitHub did not confirm the requested commit hash");
  }

  const treeUrl = `https://api.github.com/repos/${repository}/git/trees/${commitJson.data.commit.tree.sha}?recursive=1`;
  const treeResponse = await fetch(treeUrl, {
    headers,
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!treeResponse.ok) throw new AttestorServiceError(502, "GitHub commit tree lookup failed");
  const treeJson = githubTreeSchema.safeParse(await boundedJson(treeResponse, MAX_GITHUB_RESPONSE_BYTES));
  if (!treeJson.success) throw new AttestorServiceError(502, "GitHub tree response did not match the expected schema");
  return {
    sha: commitJson.data.sha.toLowerCase(),
    message: commitJson.data.commit.message,
    files: treeJson.data.tree.map((entry) => entry.path),
    truncated: treeJson.data.truncated,
  };
}

function getCriteria(requirements: string): { value?: z.infer<typeof criteriaSchema>; error?: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(requirements) as unknown;
  } catch {
    return { error: "Proof requirements are free-form; provide the documented JSON criteria to enable automatic attestation." };
  }
  const parsed = criteriaSchema.safeParse(decoded);
  if (!parsed.success) return { error: "Proof requirements JSON does not match the allowed criteria schema." };
  const criteria = parsed.data;
  if (criteria.budgetCeilingYocto && BigInt(criteria.budgetCeilingYocto) > U128_MAX) {
    return { error: "Budget ceiling exceeds the NEAR U128 range." };
  }
  if (criteria.requiredFiles.length === 0 && criteria.requiredPhrases.length === 0 && !criteria.expectedRepository && !criteria.expectedFileHash) {
    return { error: "Automatic review requires at least one required file, required phrase, expected repository, or expected file hash." };
  }
  for (const path of criteria.requiredFiles) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
      return { error: "A required file path is not a normalized relative path." };
    }
  }
  return { value: criteria };
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase().replace(/^(?:sha256:|0x)/, "");
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function addCheck(checks: AttestorCheck[], name: string, passed: boolean, evidence: string): void {
  checks.push({ name, passed, evidence: evidence.slice(0, 800) });
}

function parseGithubCommitUrl(rawUrl: string): { repository: string; commitHash: string } | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[2] === "commit") {
      return { repository: `${parts[0]}/${parts[1]}`, commitHash: parts[3].replace(/\.(?:patch|diff)$/, "") };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function buildReviewRequest(
  request: DeliverableVerificationRequest,
  milestone: ChainMilestone,
  criteria: z.infer<typeof criteriaSchema> | undefined,
): AttestRequest {
  const requirements = criteria
    ? [
        ...criteria.requiredFiles.map((path) => `GitHub commit contains required file ${path}`),
        ...criteria.requiredPhrases,
        ...(criteria.expectedRepository ? [`Repository is ${criteria.expectedRepository}`] : []),
      ].slice(0, 20)
    : [milestone.proof_requirements.slice(0, 500)];
  let submissionText: string;
  if (request.deliverable.kind === "raw_text") {
    submissionText = request.deliverable.text;
  } else if (request.deliverable.kind === "github_commit") {
    submissionText = JSON.stringify({ kind: "github_commit", repository: request.deliverable.repository, commitHash: request.deliverable.commitHash });
  } else {
    submissionText = JSON.stringify({ kind: "file_hash", hash: request.deliverable.hash, fileName: request.deliverable.fileName ?? null });
  }
  const references: string[] = [];
  try {
    const url = new URL(milestone.proof_url);
    if (url.protocol === "https:" || url.protocol === "ipfs:") references.push(url.toString());
  } catch {
    // The on-chain proof URL is untrusted metadata; do not pass malformed references to the reviewer.
  }
  return attestRequestSchema.parse({
    escrowId: process.env.NEAR_CONTRACT_ACCOUNT_ID?.trim() || "proofpay.testnet",
    milestoneId: String(milestone.id),
    title: criteria?.title ?? `ProofPay milestone ${milestone.id}`,
    requirements: requirements.length ? requirements : ["Verify the submitted artifact against its on-chain proof hash."],
    submission: { text: submissionText, references },
  });
}

const configuredTeePem = config.TEE_SIGNING_PRIVATE_KEY_PEM.trim();
const teePrivateKey = configuredTeePem
  ? createPrivateKey(configuredTeePem)
  : generateKeyPairSync("ed25519").privateKey;
const teePublicKey = createPublicKey(teePrivateKey).export({ type: "spki", format: "pem" }).toString();
const teeSignatureMode = configuredTeePem ? "configured-software-key" as const : "ephemeral-mock-key" as const;

async function submitOnTestnet(milestoneId: number, reasoningHash: string): Promise<string> {
  const near = loadKeyManagerConfig();
  if (near.networkId !== "testnet") throw new AttestorServiceError(503, "Attestation writes are restricted to NEAR testnet");
  const key = await readVerifierKeyFile(near.keyFile);
  await verifyKeyOnChain(near, key);
  assertVerifierFunctionCallPermission(
    { FunctionCall: { receiver_id: key.receiverId, method_names: key.methodNames, allowance: key.allowanceYocto } },
    near.contractAccountId,
    near.allowanceYocto,
  );
  const signer = KeyPairSigner.fromSecretKey(key.privateKey as Parameters<typeof KeyPairSigner.fromSecretKey>[0]);
  const provider = new JsonRpcProvider({ url: near.rpcUrl });
  const account = new Account(near.verifierAccountId, provider, signer);
  const outcome = await account.signAndSendTransaction({
    receiverId: near.contractAccountId,
    actions: [actions.functionCall(
      "record_attestation",
      { milestone_id: milestoneId, passed: true, reasoning_hash: reasoningHash },
      30_000_000_000_000n,
      0n,
    )],
    throwOnFailure: true,
  });
  const result = outcome as unknown as {
    transaction_outcome?: { id?: unknown };
    transaction?: { hash?: unknown };
  };
  const hash = result.transaction_outcome?.id ?? result.transaction?.hash;
  if (typeof hash !== "string" || hash.length < 16) {
    throw new AttestorServiceError(502, "NEAR transaction was submitted but its transaction hash was not returned");
  }
  return hash;
}

const productionDependencies: AttestorDependencies = {
  getMilestone: getMilestoneFromNear,
  inspectGithub: inspectGithubCommit,
  review: (request) => attest(request),
  recordAttestation: submitOnTestnet,
  allowOnChainWrites: config.ATTESTOR_ALLOW_ONCHAIN_WRITES,
  now: () => new Date(),
};

/**
 * Inspect a submitted deliverable. The on-chain milestone, not request-supplied criteria, is
 * authoritative. AI output is advisory only; it cannot turn a failed objective check into a pass.
 */
export async function inspectDeliverable(
  input: DeliverableVerificationInput,
  overrides: Partial<AttestorDependencies> = {},
): Promise<DeliverableVerificationResponse> {
  const request = deliverableVerificationRequestSchema.parse(input);
  const deps: AttestorDependencies = { ...productionDependencies, ...overrides };
  const milestone = await deps.getMilestone(request.milestoneId);
  const checks: AttestorCheck[] = [];
  addCheck(checks, "milestone_id", milestone.id === request.milestoneId, `On-chain milestone id is ${milestone.id}.`);
  addCheck(checks, "milestone_state", milestone.status === "pending", `On-chain state is ${milestone.status}; automatic attestation requires pending.`);
  addCheck(checks, "proof_submitted", milestone.proof_hash.length > 0 && milestone.proof_url.length > 0, "A non-empty proof hash and proof URL must already be recorded on chain.");

  let amount = 0n;
  let amountValid = false;
  try {
    amount = BigInt(milestone.amount);
    amountValid = amount > 0n && amount <= U128_MAX;
  } catch {
    amountValid = false;
  }
  const criteriaResult = getCriteria(milestone.proof_requirements);
  const criteria = criteriaResult.value;
  let budgetPassed = amountValid;
  const budgetCeilings: bigint[] = [];
  if (config.ATTESTOR_MAX_BUDGET_YOCTO !== "0") budgetCeilings.push(BigInt(config.ATTESTOR_MAX_BUDGET_YOCTO));
  if (criteria?.budgetCeilingYocto) budgetCeilings.push(BigInt(criteria.budgetCeilingYocto));
  for (const ceiling of budgetCeilings) if (amount > ceiling) budgetPassed = false;
  addCheck(
    checks,
    "budget_sanity",
    budgetPassed,
    amountValid
      ? budgetCeilings.length
        ? `Escrow amount ${amount} yoctoNEAR is within configured ceiling${budgetCeilings.length > 1 ? "s" : ""}.`
        : `Escrow amount ${amount} is a positive U128; no additional budget ceiling is configured.`
      : "Escrow amount is not a valid positive U128.",
  );
  addCheck(checks, "criteria_schema", Boolean(criteria), criteria ? "On-chain requirements are valid structured criteria." : criteriaResult.error ?? "Missing structured criteria.");

  const proofHashMatches = (candidate: string): boolean => normalizeHash(milestone.proof_hash) === normalizeHash(candidate);
  if (request.deliverable.kind === "raw_text") {
    const textHash = digest(request.deliverable.text);
    addCheck(checks, "proof_hash_match", proofHashMatches(textHash), "SHA-256 of the submitted text was compared with the on-chain proof hash.");
    const requiredPhrases = criteria?.requiredPhrases ?? [];
    const text = request.deliverable.text.toLocaleLowerCase();
    const missing = requiredPhrases.filter((phrase) => !text.includes(phrase.toLocaleLowerCase()));
    const filesUnsupported = (criteria?.requiredFiles.length ?? 0) > 0;
    const repositoryUnsupported = Boolean(criteria?.expectedRepository);
    const fileHashUnsupported = Boolean(criteria?.expectedFileHash);
    const passed = requiredPhrases.length > 0 && missing.length === 0 && !filesUnsupported && !repositoryUnsupported && !fileHashUnsupported;
    addCheck(
      checks,
      "content_criteria",
      passed,
      filesUnsupported || repositoryUnsupported
        ? "Raw text cannot prove repository identity or file presence. Submit a GitHub commit for repository checks."
        : fileHashUnsupported
          ? "Raw text cannot prove that a file's bytes match expectedFileHash. Submit the file hash or a verified file artifact."
        : requiredPhrases.length
          ? missing.length ? `Required phrases not found: ${missing.slice(0, 5).join(", ")}.` : "All required phrases were found in the submitted text."
          : "No required phrases are available for raw-text verification.",
    );
  } else if (request.deliverable.kind === "file_hash") {
    const normalized = normalizeHash(request.deliverable.hash);
    addCheck(checks, "file_hash_format", /^[a-f0-9]{64}$/.test(normalized), "File digest must be a SHA-256 hexadecimal hash.");
    addCheck(checks, "proof_hash_match", proofHashMatches(normalized), "File digest was compared with the on-chain proof hash.");
    const expectedFileHash = criteria?.expectedFileHash ? normalizeHash(criteria.expectedFileHash) : undefined;
    const expectedHashMatches = Boolean(expectedFileHash && expectedFileHash === normalized);
    addCheck(
      checks,
      "content_criteria",
      expectedHashMatches && !criteria?.requiredFiles.length && !criteria?.requiredPhrases.length && !criteria?.expectedRepository,
      expectedHashMatches
        ? "Digest matches the employer's on-chain expectedFileHash; no repository-tree or text-content requirement was configured."
        : "A file hash alone does not match the employer's on-chain expectedFileHash and cannot prove file presence or text criteria.",
    );
  } else {
    const commit = await deps.inspectGithub(request.deliverable.repository, request.deliverable.commitHash);
    addCheck(checks, "commit_hash_format", /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request.deliverable.commitHash.toLowerCase()), "GitHub commit identifier has a supported 40- or 64-hex format.");
    addCheck(checks, "commit_exists", commit.sha === request.deliverable.commitHash.toLowerCase(), "GitHub API confirmed the exact requested commit.");
    const proofUrl = parseGithubCommitUrl(milestone.proof_url);
    const repoExpected = criteria?.expectedRepository?.toLowerCase();
    const repoBound = (!repoExpected || repoExpected === request.deliverable.repository.toLowerCase()) &&
      (!proofUrl || (proofUrl.repository.toLowerCase() === request.deliverable.repository.toLowerCase() && proofUrl.commitHash.toLowerCase() === request.deliverable.commitHash.toLowerCase()));
    addCheck(checks, "repository_binding", repoBound, repoBound ? "Submitted repository matches the on-chain repository criteria." : "Submitted repository or commit does not match the on-chain proof reference.");
    const missingFiles = (criteria?.requiredFiles ?? []).filter((path) => !commit.files.includes(path));
    const filesPassed = Boolean(criteria?.requiredFiles.length) && !commit.truncated && missingFiles.length === 0;
    addCheck(
      checks,
      "required_files",
      filesPassed,
      commit.truncated
        ? "GitHub marked the recursive tree as truncated; file presence cannot be confirmed safely."
        : missingFiles.length ? `Required repository paths are missing: ${missingFiles.slice(0, 5).join(", ")}.` : filesPassed ? "All required repository paths exist in the commit tree." : "No required repository file list was configured.",
    );
    const missingPhrases = (criteria?.requiredPhrases ?? []).filter((phrase) => !commit.message.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()));
    if (criteria?.requiredPhrases.length) {
      addCheck(checks, "required_phrases", missingPhrases.length === 0, missingPhrases.length ? `Required phrases not found in commit message: ${missingPhrases.slice(0, 5).join(", ")}.` : "All required phrases were found in the commit message.");
    }
    if (criteria?.expectedFileHash) {
      addCheck(checks, "expected_file_hash", false, "GitHub commit metadata and tree listing do not include file bytes; expectedFileHash cannot be verified by this inspection path.");
    }
    addCheck(checks, "proof_hash_match", proofHashMatches(commit.sha), "Confirmed GitHub commit SHA was compared with the on-chain proof hash.");
  }

  const aiRequest = buildReviewRequest(request, milestone, criteria);
  const aiReview = await deps.review(aiRequest);
  const passed = checks.every((check) => check.passed);
  const objectiveReasoning = checks.map((check) => `${check.passed ? "PASS" : "FAIL"}: ${check.name} — ${check.evidence}`).join("\n");
  const reasoning = `${objectiveReasoning}\nAdvisory AI review: ${aiReview.summary}`.slice(0, 2_400);
  const reasoningHash = `sha256:${digest(reasoning)}`;

  let attestationTxHash: string | null = null;
  let writeStatus: z.infer<typeof attestorSignedPayloadSchema>["writeStatus"];
  if (!passed) {
    writeStatus = "criteria_failed";
  } else if (request.dryRun) {
    writeStatus = "dry_run";
  } else if (!deps.allowOnChainWrites) {
    writeStatus = "writes_disabled";
  } else {
    attestationTxHash = await deps.recordAttestation(milestone.id, reasoningHash);
    writeStatus = "submitted";
  }

  const signedPayload = attestorSignedPayloadSchema.parse({
    version: "proofpay-mock-tee-attestation-v1",
    milestoneId: milestone.id,
    passed,
    checks,
    reasoning,
    reasoningHash,
    aiReview,
    attestationTxHash,
    writeStatus,
    createdAt: deps.now().toISOString(),
  });
  const teeSignature = signBytes(null, Buffer.from(JSON.stringify(signedPayload)), teePrivateKey).toString("base64");
  return deliverableVerificationResponseSchema.parse({
    milestoneId: milestone.id,
    passed,
    checks,
    attestationTxHash,
    reasoning,
    reasoningHash,
    writeStatus,
    teeSignature,
    teePublicKey,
    teeSignatureMode,
    signedPayload,
  });
}

const defaultReview: AttestorDependencies["review"] = async (request) => attest(request);

// Keep the module-level dependency surface injectable for deterministic tests without live RPC calls.
productionDependencies.review = (request) => defaultReview(request);
