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

vi.mock("@/lib/kyc/sumsub/kyc-service", () => ({
  getKycStatus: vi.fn(),
}));

import { GET } from "@/app/api/v1/kyc/status/route";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { getKycStatus } from "@/lib/kyc/sumsub/kyc-service";

const mockAuth = vi.mocked(requireAuth);
const mockGet = vi.mocked(getKycStatus);

function req(): Request {
  return new Request("http://localhost/api/v1/kyc/status");
}

describe("GET /api/v1/kyc/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 with canonical {error, reason: unauthenticated} envelope on AuthError", async () => {
    // Phase 2 review fix (api-contract-001): error responses now use the
    // canonical ErrorEnvelope shape declared in _schemas.ts.
    mockAuth.mockRejectedValueOnce(new AuthError(401, "Unauthenticated"));
    const res = await GET(req());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string; reason: string };
    expect(json.reason).toBe("unauthenticated");
    expect(typeof json.error).toBe("string");
  });

  it("returns 500 with reason=kyc_status_failed on unexpected error", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockGet.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; reason: string };
    expect(json.reason).toBe("kyc_status_failed");
  });

  it("returns the status from the service", async () => {
    mockAuth.mockResolvedValueOnce({ userId: "u1" } as never);
    mockGet.mockResolvedValueOnce({ status: "PENDING" } as never);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("PENDING");
  });
});
