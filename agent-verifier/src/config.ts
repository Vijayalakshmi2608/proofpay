import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1_024).max(65_535).default(4_000),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  VERIFIER_MODE: z.enum(["heuristic", "openai"]).default("heuristic"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().min(1).max(100).default("gpt-4o-mini"),
  ATTESTATION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.72),
  MAX_DELIVERABLE_CHARS: z.coerce.number().int().min(500).max(100_000).default(20_000),
  GITHUB_TOKEN: z.string().max(200).default(""),
  TEE_SIGNING_PRIVATE_KEY_PEM: z.string().default(""),
  NEAR_INTENTS_API_KEY: z.string().max(512).default(""),
  NEAR_INTENTS_REFUND_ADDRESS: z.string().max(128).default(""),
  INTENTS_ALLOW_FUNDABLE_QUOTES: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  INTENTS_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(500).default(100),
  ATTESTOR_MAX_BUDGET_YOCTO: z.string().regex(/^\d+$/).default("0"),
  ATTESTOR_ALLOW_ONCHAIN_WRITES: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  ATTESTOR_API_TOKEN: z.string().min(0).max(512).default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid verifier environment: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}
if (parsed.data.VERIFIER_MODE === "openai" && !parsed.data.OPENAI_API_KEY) {
  throw new Error("VERIFIER_MODE=openai requires OPENAI_API_KEY; configure it on the verifier service, not the browser.");
}

export const config = parsed.data;
