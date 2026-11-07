const frontend = process.env.DEMO_FRONTEND_URL ?? "http://localhost:3000";
const verifier = process.env.DEMO_VERIFIER_URL ?? "http://localhost:3002";

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
}

try {
  const ready = await Promise.all([frontend, verifier].map(async (base) => {
    try {
      await fetch(base, { signal: AbortSignal.timeout(1_000) });
      return true;
    } catch {
      return false;
    }
  }));
  if (ready.some((value) => !value)) {
    console.log("[SKIP] HTTP demo smoke requires both dashboard and verifier services; deterministic tests continue without running services.");
    process.exit(0);
  }

  const page = await get(frontend);
  const html = await page.text();
  if (!html.includes("ProofPay") || !html.includes("Milestone")) {
    throw new Error("Frontend response is missing ProofPay dashboard markers.");
  }
  console.log("✓ Dashboard responds with ProofPay content");

  const health = await (await get(`${verifier}/health`)).json();
  if (health.service !== "proofpay-agent-verifier" || health.status !== "ok") {
    throw new Error("Verifier health response is not valid.");
  }
  console.log("✓ Verifier health endpoint is ready");

  const response = await fetch(`${frontend}/api/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      escrowId: "demo-01",
      milestoneId: "milestone-01",
      title: "Responsive product dashboard",
      requirements: ["Responsive dashboard layout", "Accessible design components"],
      submission: {
        text: "Delivered a responsive dashboard layout with accessible design components for desktop and mobile breakpoints.",
        references: [],
      },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Attestation proxy returned HTTP ${response.status}`);
  const body = await response.json();
  const proof = body.attestation;
  if (!proof || !["approved", "revision_requested", "rejected"].includes(proof.status) || !Array.isArray(proof.evidence) || proof.evidence.length !== 2) {
    throw new Error("Attestation did not match the expected structured result.");
  }
  console.log(`✓ Same-origin structured attestation: ${proof.status} (${proof.score}/100)`);
  console.log("Demo path passed. Attestation is advisory; no escrow funds were moved.");
} catch (error) {
  console.error(`Demo path failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Start both services with `pnpm dev` and `pnpm dev:verifier`, then retry.");
  process.exitCode = 1;
}
