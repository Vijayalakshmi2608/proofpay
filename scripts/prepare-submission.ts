import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

const TRACKS = ["realworld", "agents", "security", "business"] as const;
const DEFAULT_IDEA =
  "ProofPay addresses the trust gap in global contractor payments by holding milestone funds in a NEAR escrow contract until deliverables are submitted and independently checked. A verifier account uses a finite Function-Call key restricted to record_attestation, while the contract keeps payout authority behind milestone status and employer budget rules. NEAR Intents 1Click provides dry cross-chain quote previews for supported destinations. The current TEE-style signature is a software mock, and actual cross-chain settlement still requires a production adapter.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ApplicationPayload {
  projectName: "ProofPay";
  tracks: string[];
  idea: string;
  requestId: string;
}

function readIdeaArgument(args: string[]): string | undefined {
  const inline = args.find((value) => value.startsWith("--idea="));
  if (inline) return inline.slice("--idea=".length);
  const ideaIndex = args.indexOf("--idea");
  if (ideaIndex >= 0) {
    const value = args[ideaIndex + 1];
    if (!value) throw new Error("--idea requires a value");
    return value;
  }
  const fileIndex = args.indexOf("--idea-file");
  if (fileIndex >= 0) {
    const path = args[fileIndex + 1];
    if (!path) throw new Error("--idea-file requires a path");
    return undefined;
  }
  return undefined;
}

async function loadIdea(args: string[]): Promise<string> {
  const fileIndex = args.indexOf("--idea-file");
  if (fileIndex >= 0) {
    const path = args[fileIndex + 1];
    if (!path) throw new Error("--idea-file requires a path");
    const cwd = resolve(process.cwd());
    const rootDir = basename(cwd) === "agent-verifier" ? resolve(cwd, "..") : cwd;
    return (await readFile(isAbsolute(path) ? path : resolve(rootDir, path), "utf8")).trim();
  }
  return (readIdeaArgument(args) ?? process.env.PROOFPAY_SUBMISSION_IDEA ?? DEFAULT_IDEA).trim();
}

function validate(payload: ApplicationPayload): void {
  const keys = Object.keys(payload).sort();
  const expectedKeys = ["idea", "projectName", "requestId", "tracks"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Payload contains unexpected or missing top-level fields");
  }
  if (payload.projectName !== "ProofPay") throw new Error('projectName must be exactly "ProofPay"');
  if (JSON.stringify(payload.tracks) !== JSON.stringify(TRACKS)) {
    throw new Error(`tracks must exactly match ${JSON.stringify(TRACKS)}`);
  }
  const ideaLength = Array.from(payload.idea).length;
  if (ideaLength < 20 || ideaLength > 2_000) {
    throw new Error(`idea must contain 20-2000 Unicode characters; received ${ideaLength}`);
  }
  if (!UUID_V4.test(payload.requestId)) throw new Error("requestId must be a valid UUID v4");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.error("Usage: npm run prepare:submission [-- --idea <text> | --idea-file <path>]");
    console.error("Prints the task-specified JSON payload only; it does not send a POST request.");
    return;
  }

  const payload: ApplicationPayload = {
    projectName: "ProofPay",
    tracks: [...TRACKS],
    idea: await loadIdea(args),
    requestId: randomUUID(),
  };
  validate(payload);
  console.error(`Validated ProofPay payload: idea=${Array.from(payload.idea).length} chars; requestId=${payload.requestId}`);
  console.log(JSON.stringify(payload, null, 2));
  console.error("Not submitted: verify the current organizer API schema before POSTing.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Submission payload invalid: ${message}`);
  process.exitCode = 1;
});
