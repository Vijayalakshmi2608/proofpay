// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateMilestoneModal, type CreateMilestoneSubmission } from "./CreateMilestoneModal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_NEAR_USDC_CONTRACT", "usdc.testnet");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText("e.g. Deliver the mobile checkout flow"), { target: { value: "Build payment API" } });
  fireEvent.change(screen.getByPlaceholderText("contractor.near"), { target: { value: "contractor.near" } });
}

describe("CreateMilestoneModal", () => {
  it("submits USDC funding and threshold as exact six-decimal base units", async () => {
    const onCreate = vi.fn(async (_input: CreateMilestoneSubmission) => {});
    render(<CreateMilestoneModal onClose={vi.fn()} onCreate={onCreate} isSubmitting={false} employerAccountId="employer.near" />);
    fireEvent.change(screen.getByLabelText("Funding asset"), { target: { value: "USDC" } });
    fillRequiredFields();
    fireEvent.change(screen.getByPlaceholderText("25.00"), { target: { value: "12.345678" } });
    fireEvent.change(screen.getByPlaceholderText("0 = employer approval"), { target: { value: "3.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Review & create" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const input = onCreate.mock.calls[0]?.[0];
    expect(input).toMatchObject({ fundingAsset: "USDC", amountBaseUnits: "12345678", autoReleaseLimitBaseUnits: "3250000", contractorAccountId: "contractor.near", destinationChain: "NEAR", payoutRecipient: "contractor.near" });
    expect(input?.deadlineNs).toMatch(/^\d+$/);
  });

  it("rejects USDC precision beyond the token's six decimal places", async () => {
    const onCreate = vi.fn(async (_input: CreateMilestoneSubmission) => {});
    render(<CreateMilestoneModal onClose={vi.fn()} onCreate={onCreate} isSubmitting={false} employerAccountId="employer.near" />);
    fireEvent.change(screen.getByLabelText("Funding asset"), { target: { value: "USDC" } });
    fillRequiredFields();
    fireEvent.change(screen.getByPlaceholderText("25.00"), { target: { value: "1.0000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Review & create" }));

    expect((await screen.findByRole("alert")).textContent).toContain("6 decimal places");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
