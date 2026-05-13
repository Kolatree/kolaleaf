import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/pending-email-verification", () => ({
  verifyPendingEmailCode: vi.fn(),
}));

vi.mock("@/lib/auth/pending-phone-verification", () => ({
  verifyPendingPhoneCode: vi.fn(),
}));

import { POST } from "@/app/api/v1/auth/verify-code/route";
import { verifyPendingEmailCode } from "@/lib/auth/pending-email-verification";
import { verifyPendingPhoneCode } from "@/lib/auth/pending-phone-verification";

const mockVerify = vi.mocked(verifyPendingEmailCode);
const mockVerifyPhone = vi.mocked(verifyPendingPhoneCode);

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/auth/verify-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost/api/v1/auth/verify-code", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 when email is missing or malformed (Zod)", async () => {
    const a = await POST(postRequest({ code: "123456" }));
    expect(a.status).toBe(422);
    const b = await POST(
      postRequest({ email: "not-an-email", code: "123456" }),
    );
    expect(b.status).toBe(422);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 422 when code is not exactly 6 digits (Zod)", async () => {
    const a = await POST(postRequest({ email: "a@b.com", code: "12345" }));
    expect(a.status).toBe(422);
    const b = await POST(postRequest({ email: "a@b.com", code: "abcdef" }));
    expect(b.status).toBe(422);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 422 with fields.email when email is a non-string", async () => {
    const res = await POST(postRequest({ email: 42, code: "123456" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.email).toBeInstanceOf(Array);
  });

  it("returns 400 with no_token reason", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "no_token" });
    const res = await POST(postRequest({ email: "a@b.com", code: "111111" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("no_token");
  });

  it("returns 400 on expired", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "expired" });
    const res = await POST(postRequest({ email: "a@b.com", code: "111111" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("expired");
    expect(json.error).toMatch(/expired/i);
  });

  it("returns 400 on used", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "used" });
    const res = await POST(postRequest({ email: "a@b.com", code: "111111" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("used");
  });

  it("returns 400 on wrong_code with an incorrect message", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "wrong_code" });
    const res = await POST(postRequest({ email: "a@b.com", code: "111111" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("wrong_code");
    expect(json.error).toMatch(/incorrect/i);
  });

  it("returns 429 on too_many_attempts", async () => {
    mockVerify.mockResolvedValueOnce({
      ok: false,
      reason: "too_many_attempts",
    });
    const res = await POST(postRequest({ email: "a@b.com", code: "111111" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.reason).toBe("too_many_attempts");
  });

  it("returns 200 verified=true on success AND does NOT set a session cookie", async () => {
    mockVerify.mockResolvedValueOnce({ ok: true });
    const res = await POST(postRequest({ email: "a@b.com", code: "123456" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verified).toBe(true);
    // Critical: no session until /complete-registration.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("normalises email casing before passing to the verifier", async () => {
    mockVerify.mockResolvedValueOnce({ ok: true });
    await POST(postRequest({ email: "A@B.COM", code: "123456" }));
    expect(mockVerify).toHaveBeenCalledWith({
      email: "a@b.com",
      code: "123456",
    });
  });
});

// 4-lens review fix (pr-test-analyzer #2): phone-branch coverage.
// The shape-sniff dispatches `{ type: 'phone', value, code }` to
// verifyPendingPhoneCode. Locks the wire contract on both rails.
describe("POST /api/v1/auth/verify-code — phone variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches phone-shape body to verifyPendingPhoneCode", async () => {
    mockVerifyPhone.mockResolvedValueOnce({ ok: true });
    const res = await POST(
      postRequest({
        type: "phone",
        value: "+61400000000",
        code: "123456",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyPhone).toHaveBeenCalledWith({
      phone: "+61400000000",
      code: "123456",
    });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 400 wrong_code on phone-branch wrong code", async () => {
    mockVerifyPhone.mockResolvedValueOnce({ ok: false, reason: "wrong_code" });
    const res = await POST(
      postRequest({
        type: "phone",
        value: "+61400000000",
        code: "999999",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("wrong_code");
  });

  it("returns 429 too_many_attempts on phone-branch attempt-cap", async () => {
    mockVerifyPhone.mockResolvedValueOnce({
      ok: false,
      reason: "too_many_attempts",
    });
    const res = await POST(
      postRequest({
        type: "phone",
        value: "+61400000000",
        code: "999999",
      }),
    );
    expect(res.status).toBe(429);
  });

  it("returns 422 with fields.value when phone is malformed", async () => {
    const res = await POST(
      postRequest({
        type: "phone",
        value: "+abc",
        code: "123456",
      }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.value).toBeInstanceOf(Array);
    expect(mockVerifyPhone).not.toHaveBeenCalled();
  });
});
