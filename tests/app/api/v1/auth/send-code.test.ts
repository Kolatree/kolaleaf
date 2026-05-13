import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    userIdentifier: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/pending-email-verification", () => ({
  issuePendingEmailCode: vi.fn(),
}));

vi.mock("@/lib/auth/pending-phone-verification", () => ({
  issuePendingPhoneCode: vi.fn(),
}));

import { POST } from "@/app/api/v1/auth/send-code/route";
import { prisma } from "@/lib/db/client";
import { issuePendingEmailCode } from "@/lib/auth/pending-email-verification";
import { issuePendingPhoneCode } from "@/lib/auth/pending-phone-verification";

const mockIdentFind = vi.mocked(prisma.userIdentifier.findUnique);
const mockIssue = vi.mocked(issuePendingEmailCode);
const mockIssuePhone = vi.mocked(issuePendingPhoneCode);

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/auth/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/auth/send-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssue.mockResolvedValue({ ok: true, delivered: true });
  });

  it("returns 400 malformed_json for invalid JSON", async () => {
    const req = new Request("http://localhost/api/v1/auth/send-code", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("malformed_json");
  });

  it("returns 422 validation_failed when email is missing (Zod)", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("validation_failed");
    expect(json.fields?.email).toBeInstanceOf(Array);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("returns 422 when email is present but malformed (Zod)", async () => {
    const res = await POST(postRequest({ email: "notanemail" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("validation_failed");
    expect(json.fields?.email).toBeInstanceOf(Array);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("returns 422 when email is the wrong type (non-string)", async () => {
    const res = await POST(postRequest({ email: 12345 }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("validation_failed");
    expect(json.fields?.email).toBeInstanceOf(Array);
  });

  it("returns 200 and does NOT issue a code when email is owned by a verified user (enumeration-proof)", async () => {
    mockIdentFind.mockResolvedValueOnce({
      id: "id1",
      userId: "u1",
      type: "EMAIL",
      identifier: "taken@b.com",
      verified: true,
    } as never);

    const res = await POST(postRequest({ email: "taken@b.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("issues a code when email is free (no identifier at all)", async () => {
    mockIdentFind.mockResolvedValueOnce(null);

    const res = await POST(postRequest({ email: "new@b.com" }));
    expect(res.status).toBe(200);
    expect(mockIssue).toHaveBeenCalledWith({ email: "new@b.com" });
  });

  it("issues a code when the email exists only as an UNverified identifier", async () => {
    // An existing-but-unverified UserIdentifier is a legacy shape; the new
    // flow does not create User rows pre-verification, so this branch is
    // mostly for pre-existing rows. We still allow a fresh pending code to
    // go out so the user can complete the wizard.
    mockIdentFind.mockResolvedValueOnce({
      id: "id1",
      userId: "u-legacy",
      type: "EMAIL",
      identifier: "legacy@b.com",
      verified: false,
    } as never);

    const res = await POST(postRequest({ email: "legacy@b.com" }));
    expect(res.status).toBe(200);
    expect(mockIssue).toHaveBeenCalledWith({ email: "legacy@b.com" });
  });

  it("normalises email casing and whitespace before lookup and issue", async () => {
    mockIdentFind.mockResolvedValueOnce(null);
    await POST(postRequest({ email: "  A@B.COM  " }));
    expect(mockIdentFind).toHaveBeenCalledWith({
      where: { identifier: "a@b.com" },
    });
    expect(mockIssue).toHaveBeenCalledWith({ email: "a@b.com" });
  });

  it("still returns 200 when the issuer is rate-limited (never leaks state)", async () => {
    mockIdentFind.mockResolvedValueOnce(null);
    mockIssue.mockResolvedValueOnce({
      ok: false,
      reason: "rate_limited",
      retryAfterMs: 3_600_000,
    });

    const res = await POST(postRequest({ email: "ratelimited@b.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("still returns 200 when the issuer throws (Resend down) — failure is logged, not surfaced", async () => {
    mockIdentFind.mockResolvedValueOnce(null);
    mockIssue.mockRejectedValueOnce(new Error("Resend outage"));

    const res = await POST(postRequest({ email: "down@b.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

// 4-lens review fix (pr-test-analyzer #1): phone-branch coverage.
// The shape-sniff in route.ts dispatches `{ type: 'phone', value }`
// bodies to issuePendingPhoneCode. Mirrors the email tests above so
// a contract drift on either side trips a specific failure.
describe("POST /api/v1/auth/send-code — phone variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssuePhone.mockResolvedValue({ ok: true, delivered: true });
  });

  it("issues a phone code on { type: phone, value: +E.164 }", async () => {
    mockIdentFind.mockResolvedValueOnce(null);
    const res = await POST(
      postRequest({ type: "phone", value: "+61400000000" }),
    );
    expect(res.status).toBe(200);
    expect(mockIssuePhone).toHaveBeenCalledWith({ phone: "+61400000000" });
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("returns 200 and does NOT issue when phone is owned by a verified user", async () => {
    mockIdentFind.mockResolvedValueOnce({
      id: "pid1",
      userId: "u1",
      type: "PHONE",
      identifier: "+61400000000",
      verified: true,
    } as never);
    const res = await POST(
      postRequest({ type: "phone", value: "+61400000000" }),
    );
    expect(res.status).toBe(200);
    expect(mockIssuePhone).not.toHaveBeenCalled();
  });

  it("returns 422 with fields.value when phone is malformed", async () => {
    const res = await POST(postRequest({ type: "phone", value: "+abc" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("validation_failed");
    expect(json.fields?.value).toBeInstanceOf(Array);
    expect(mockIssuePhone).not.toHaveBeenCalled();
  });

  it("returns 422 when type is unknown", async () => {
    const res = await POST(postRequest({ type: "sms", value: "+61400000000" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("validation_failed");
  });

  it("returns 422 when value is missing on a phone-shape body", async () => {
    const res = await POST(postRequest({ type: "phone" }));
    expect(res.status).toBe(422);
    expect(mockIssuePhone).not.toHaveBeenCalled();
  });

  it("still returns 200 on phone send_failed (always 200 contract)", async () => {
    mockIdentFind.mockResolvedValueOnce(null);
    mockIssuePhone.mockResolvedValueOnce({
      ok: false,
      reason: "send_failed",
      providerError: "Twilio 500",
    });
    const res = await POST(
      postRequest({ type: "phone", value: "+61400000000" }),
    );
    expect(res.status).toBe(200);
  });
});
