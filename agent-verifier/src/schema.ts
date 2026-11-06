import { z } from "zod";
import { config } from "./config.js";

export const attestRequestSchema = z.object({
  escrowId: z.string().min(1).max(80),
  milestoneId: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  requirements: z.array(z.string().min(1).max(500)).min(1).max(20),
  submission: z.object({
    text: z.string().min(1).max(config.MAX_DELIVERABLE_CHARS),
    references: z.array(z.string().url().max(2_048)).max(12).default([]),
  }).strict(),
}).strict();

export const attestationSchema = z.object({
  status: z.enum(["approved", "revision_requested", "rejected"]),
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(1_200),
  evidence: z.array(z.object({
    requirement: z.string().min(1).max(500),
    result: z.enum(["met", "partial", "unmet"]),
    explanation: z.string().min(1).max(800),
  }).strict()).min(1).max(20),
  model: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
}).strict();

const repositorySchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
const relativeFilePathSchema = z.string().min(1).max(256).refine((path) => {
  if (path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}, "Expected a normalized repository-relative path");

export const deliverableVerificationRequestSchema = z.object({
  milestoneId: z.number().int().safe().min(0),
  deliverable: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("github_commit"),
      repository: repositorySchema,
      commitHash: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
    }).strict(),
    z.object({
      kind: z.literal("raw_text"),
      text: z.string().min(1).max(config.MAX_DELIVERABLE_CHARS),
    }).strict(),
    z.object({
      kind: z.literal("file_hash"),
      hash: z.string().regex(/^(?:sha256:)?[a-fA-F0-9]{64}$/),
      fileName: relativeFilePathSchema.optional(),
    }).strict(),
  ]),
  dryRun: z.boolean().default(false),
}).strict();

export const attestorCheckSchema = z.object({
  name: z.string().min(1).max(80),
  passed: z.boolean(),
  evidence: z.string().min(1).max(800),
}).strict();

export const attestorSignedPayloadSchema = z.object({
  version: z.literal("proofpay-mock-tee-attestation-v1"),
  milestoneId: z.number().int().safe().nonnegative(),
  passed: z.boolean(),
  checks: z.array(attestorCheckSchema).min(1).max(12),
  reasoning: z.string().min(1).max(2_400),
  reasoningHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  aiReview: attestationSchema,
  attestationTxHash: z.string().min(1).nullable(),
  writeStatus: z.enum(["submitted", "dry_run", "writes_disabled", "criteria_failed"]),
  createdAt: z.string().datetime(),
}).strict();

export const deliverableVerificationResponseSchema = z.object({
  milestoneId: z.number().int().safe().nonnegative(),
  passed: z.boolean(),
  checks: z.array(attestorCheckSchema).min(1).max(12),
  attestationTxHash: z.string().min(1).nullable(),
  reasoning: z.string().min(1).max(2_400),
  reasoningHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  writeStatus: z.enum(["submitted", "dry_run", "writes_disabled", "criteria_failed"]),
  teeSignature: z.string().min(1),
  teePublicKey: z.string().min(1),
  teeSignatureMode: z.enum(["configured-software-key", "ephemeral-mock-key"]),
  signedPayload: attestorSignedPayloadSchema,
}).strict();

export type AttestRequest = z.infer<typeof attestRequestSchema>;
export type Attestation = z.infer<typeof attestationSchema>;
export type DeliverableVerificationRequest = z.output<typeof deliverableVerificationRequestSchema>;
export type DeliverableVerificationInput = z.input<typeof deliverableVerificationRequestSchema>;
export type DeliverableVerificationResponse = z.infer<typeof deliverableVerificationResponseSchema>;
export type AttestorCheck = z.infer<typeof attestorCheckSchema>;
