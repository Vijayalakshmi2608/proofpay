import { describe, expect, it } from "vitest";
import { evaluateDemo } from "./attestation.js";

const base = {
  escrowId: "escrow-42",
  milestoneId: "milestone-1",
  title: "Design delivery",
  requirements: ["Provide responsive design screens", "Include design system tokens"],
};

describe("demo attestation", () => {
  it("returns one evidence decision per requirement and a bounded score", () => {
    const result = evaluateDemo({
      ...base,
      submission: { text: "Provide responsive design screens for desktop. Include the design system tokens.", references: [] },
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.status).toBe("approved");
    expect(result.summary).toContain("advisory only");
  });

  it("rejects submissions with little matching evidence", () => {
    const result = evaluateDemo({ ...base, submission: { text: "Work in progress.", references: [] } });
    expect(result.status).toBe("rejected");
    expect(result.evidence.every((item) => item.result === "unmet")).toBe(true);
  });
});
