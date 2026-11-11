import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/verify proxy", () => {
  it("forwards the server-only bearer token and forces dry-run mode", async () => {
    vi.stubEnv("VERIFIER_API_BASE_URL", "https://verifier.example");
    vi.stubEnv("VERIFIER_API_TOKEN", "test-server-secret");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ passed: true }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("https://proofpay.example/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milestoneId: 7, deliverable: { kind: "raw_text", text: "proof" }, dryRun: false }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://verifier.example/api/verify");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-server-secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ milestoneId: 7, dryRun: true });
  });

  it("does not add an authorization header when no server token is configured", async () => {
    vi.stubEnv("VERIFIER_API_BASE_URL", "https://verifier.example");
    vi.stubEnv("VERIFIER_API_TOKEN", "");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ passed: true }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(new Request("https://proofpay.example/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milestoneId: 7, deliverable: { kind: "raw_text", text: "proof" } }),
    }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });
});
