// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { AttackSandbox, evaluateMockAttack, MOCK_POLICY_ERROR } from "./AttackSandbox";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AttackSandbox", () => {
  it("blocks a $5,000 request over the $1,000 illustrative limit", () => {
    expect(evaluateMockAttack(5_000, 1_000)).toEqual({ blocked: true, error: MOCK_POLICY_ERROR });
    expect(evaluateMockAttack(500, 1_000).blocked).toBe(false);
  });

  it("renders the requested text as a simulation and discloses that no on-chain call was made", async () => {
    render(<AttackSandbox milestoneId={12} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulate Rogue AI / Prompt Injection Attack" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Rogue AI request blocked · simulation", expect.objectContaining({ description: expect.stringContaining(MOCK_POLICY_ERROR) })));
    expect(screen.getByText(/SIMULATED · NOT AN ON-CHAIN ERROR · NO TRANSACTION SENT/)).toBeTruthy();
    expect(screen.getAllByText(/\$5,000/)).toHaveLength(2);
    expect(screen.getAllByText(/\$1,000/)).toHaveLength(2);
  });
});
