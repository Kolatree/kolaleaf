import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(),
  AuthError: class extends Error {
    statusCode: number;
    constructor(statusCode: number, msg: string) {
      super(msg);
      this.name = "AuthError";
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("@/lib/kyc/sumsub", () => ({
  createSumsubClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/kyc/sumsub/kyc-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/kyc/sumsub/kyc-service")
  >("@/lib/kyc/sumsub/kyc-service");
  return { ...actual, initiateKyc: vi.fn() };
});

import { POST } from "@/app/api/v1/kyc/initiate/route";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { initiateKyc, KycRateLimitError } from "@/lib/kyc/sumsub/kyc-service";

const mockAuth = vi.mocked(requireAuth);
const mockInit = vi.mocked(initiateKyc);

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/kyc/initiate", {
    method: "POST",
  });
}

describe("POST /api/v1/kyc/initiate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockRejectedValueOnce(new AuthError(401, "Unauthenticated"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns applicantId + verificationUrl on success", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockInit.mockResolvedValueOnce({
      applicantId: "a1",
      accessToken: "token-1",
      verificationUrl: "https://sumsub.test/v",
    } as never);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applicantId).toBe("a1");
    expect(json.accessToken).toBe("token-1");
  });

  it("returns 409 with reason=kyc_already_verified when KYC is already verified", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockInit.mockRejectedValueOnce(new Error("KYC already verified"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    // Phase 1 review fix: { error, reason } envelope so iOS reason-based
    // dispatch can distinguish 'already verified' from 'already in review'.
    const json = (await res.json()) as { error: string; reason: string };
    expect(json.reason).toBe("kyc_already_verified");
    expect(json.error).toBe("KYC already verified");
  });

  it("returns 409 with reason=kyc_already_in_review when KYC is mid-review", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockInit.mockRejectedValueOnce(new Error("KYC already in review"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; reason: string };
    expect(json.reason).toBe("kyc_already_in_review");
    expect(json.error).toBe("KYC already in review");
  });

  it("returns 429 + Retry-After (seconds) with canonical envelope when rate-limited", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockInit.mockRejectedValueOnce(new KycRateLimitError(90_000));
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("90");
    // Phase 1 review fix: drop body field `retryAfterMs` (undocumented + unit
    // mismatch with /auth/login). { error, reason } envelope; Retry-After
    // header in seconds is canonical.
    const json = (await res.json()) as {
      error: string;
      reason: string;
      retryAfterMs?: number;
    };
    expect(json.reason).toBe("rate_limited");
    expect(typeof json.error).toBe("string");
    expect(json.retryAfterMs).toBeUndefined();
  });

  it("returns 500 with reason=kyc_initiate_failed for unexpected errors", async () => {
    // Phase 1 review fix: 500 path now emits canonical ErrorEnvelope so iOS
    // BackendError decode succeeds and the error is routed via APIError.server.
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockInit.mockRejectedValueOnce(new Error("Sumsub API timeout"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; reason: string };
    expect(json.reason).toBe("kyc_initiate_failed");
    expect(json.error).toBe("Sumsub API timeout");
  });
});
