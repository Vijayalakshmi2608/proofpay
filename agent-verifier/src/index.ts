import express, { type Express } from "express";
import cors from "cors";
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { attest } from "./attestation.js";
import { AttestorServiceError, inspectDeliverable } from "./attestor.js";
import { config } from "./config.js";
import { getSettlementQuote, getSupportedIntentAssets, IntentsServiceError, isSupportedSourceAsset, isSupportedTargetAsset, settlementQuoteRequestSchema } from "./intents.js";
import { attestRequestSchema, deliverableVerificationRequestSchema } from "./schema.js";

export const app: Express = express();
const allowedOrigins = config.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

function hasAttestorBearerToken(authorization: string | undefined): boolean {
  if (!config.ATTESTOR_API_TOKEN || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(config.ATTESTOR_API_TOKEN);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "48kb" }));

app.get("/health", (_request, response) => {
  response.json({ service: "proofpay-agent-verifier", status: "ok", mode: config.VERIFIER_MODE });
});

app.post("/v1/attest", async (request, response) => {
  const parsed = attestRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }
  try {
    response.json({ attestation: await attest(parsed.data) });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.status(502).json({ error: "invalid_model_response", message: "The verifier response did not match the attestation schema." });
      return;
    }
    console.error("attestation_failed", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: "attestation_failed", message: "The verifier could not complete this review. No funds were moved." });
  }
});

app.post("/api/verify", async (request, response) => {
  if (config.ATTESTOR_ALLOW_ONCHAIN_WRITES) {
    if (!config.ATTESTOR_API_TOKEN) {
      response.status(503).json({ error: "live_write_gate_unconfigured" });
      return;
    }
    if (!hasAttestorBearerToken(request.get("authorization"))) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  const parsed = deliverableVerificationRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }
  try {
    response.json(await inspectDeliverable(parsed.data));
  } catch (error) {
    if (error instanceof AttestorServiceError) {
      response.status(error.httpStatus).json({ error: "verification_failed", message: error.message });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({ error: "invalid_request", details: error.flatten() });
      return;
    }
    console.error("deliverable_verification_failed", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: "verification_failed", message: "The verifier could not complete this review." });
  }
});

app.get("/api/intents/assets", async (_request, response) => {
  try {
    const tokens = await getSupportedIntentAssets();
    response.json({
      provider: "near-intents-1click",
      quotesDefaultDry: true,
      sourceAssets: tokens.filter(isSupportedSourceAsset),
      destinations: {
        ethereumUsdc: tokens.filter((token) => token.blockchain === "eth" && isSupportedTargetAsset(token)),
        solanaSol: tokens.filter((token) => token.blockchain === "sol" && isSupportedTargetAsset(token)),
        bitcoinBtc: tokens.filter((token) => token.blockchain === "btc" && isSupportedTargetAsset(token)),
      },
    });
  } catch (error) {
    console.error("intents_token_registry_failed", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: "token_registry_unavailable" });
  }
});

app.post("/api/intents/quote", async (request, response) => {
  const parsed = settlementQuoteRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }
  try {
    response.json(await getSettlementQuote(parsed.data));
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "invalid_request", details: error.flatten() });
      return;
    }
    if (error instanceof IntentsServiceError) {
      response.status(error.httpStatus).json({ error: "quote_unavailable", message: error.message });
      return;
    }
    console.error("intents_quote_failed", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: "quote_unavailable", message: "1Click could not provide a verified quote." });
  }
});

app.use((_request, response) => response.status(404).json({ error: "not_found" }));

if (config.NODE_ENV !== "test") {
  app.listen(config.PORT, config.HOST, () => console.info(`ProofPay verifier listening on http://${config.HOST}:${config.PORT}`));
}
