import { describe, it, expect, vi, beforeEach } from "vitest";

// Phone-side mirror of pending-email-verification.test.ts. Same
// state machine, different dispatch primitive (sendSms instead of
// enqueueEmail) and different hash scheme (bcrypt instead of
// sha256). The tests cover the rate-limit window, claim
// preservation, send-failed propagation, and the verify state
// machine (no_token / wrong_code / expired / used / too_many_attempts).

vi.mock("@/lib/db/client", () => ({
  prisma: {
    pendingVerification: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn().mockResolvedValue({ ok: true, id: "sms-1" }),
}));

import {
  issuePendingPhoneCode,
  verifyPendingPhoneCode,
} from "@/lib/auth/pending-phone-verification";
import {
  PHONE_CODE_TTL_MINUTES,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CLAIM_WINDOW_MINUTES,
  PHONE_CODE_SENDS_PER_HOUR,
} from "@/lib/auth/constants";
import { prisma } from "@/lib/db/client";
import { sendSms } from "@/lib/sms";

const mockSend = vi.mocked(sendSms);
const mockUpsert = vi.mocked(prisma.pendingVerification.upsert);
const mockFindUnique = vi.mocked(prisma.pendingVerification.findUnique);
const mockUpdate = vi.mocked(prisma.pendingVerification.update);

const PHONE = "+61400000000";

describe("issuePendingPhoneCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ ok: true, id: "sms-1" });
  });

  const existingRow = (overrides: Record<string, unknown> = {}) => ({
    id: "p1",
    kind: "PHONE",
    identifier: PHONE,
    codeHash: "$2b$04$old",
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    verifiedAt: null,
    claimExpiresAt: null,
    sendCount: 0,
    sendWindowStart: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

  it("returns rate_limited when sendCount has hit the cap inside the active window", async () => {
    mockFindUnique.mockResolvedValueOnce(
      existingRow({
        sendCount: PHONE_CODE_SENDS_PER_HOUR,
        sendWindowStart: new Date(Date.now() - 10 * 60 * 1000),
      }) as never,
    );
    const result = await issuePendingPhoneCode({ phone: PHONE });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "rate_limited") {
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60 * 60 * 1000);
    } else {
      throw new Error(`Expected rate_limited, got ${JSON.stringify(result)}`);
    }
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("resets the send window when the last send was > 1 hour ago", async () => {
    mockFindUnique.mockResolvedValueOnce(
      existingRow({
        sendCount: PHONE_CODE_SENDS_PER_HOUR,
        sendWindowStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }) as never,
    );
    mockUpsert.mockResolvedValueOnce({ id: "p1" } as never);

    const result = await issuePendingPhoneCode({ phone: PHONE });
    expect(result.ok).toBe(true);

    const call = mockUpsert.mock.calls[0][0] as {
      update: { sendCount: number };
    };
    expect(call.update.sendCount).toBe(1);
  });

  it("blocks resend during a live claim window (claim preservation)", async () => {
    mockFindUnique.mockResolvedValueOnce(
      existingRow({
        verifiedAt: new Date(Date.now() - 60_000),
        claimExpiresAt: new Date(Date.now() + 5 * 60_000),
      }) as never,
    );

    const result = await issuePendingPhoneCode({ phone: PHONE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("claim_in_flight");
    }
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("upserts a fresh row with kind=PHONE, attempts=0, and dispatches SMS", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({ id: "p1" } as never);

    const result = await issuePendingPhoneCode({ phone: PHONE });

    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0] as {
      where: { kind_identifier: { kind: string; identifier: string } };
      create: Record<string, unknown>;
    };
    expect(call.where.kind_identifier.kind).toBe("PHONE");
    expect(call.where.kind_identifier.identifier).toBe(PHONE);
    expect(call.create.kind).toBe("PHONE");
    expect(call.create.identifier).toBe(PHONE);
    expect(call.create.attempts).toBe(0);
    expect(call.create.verifiedAt).toBeNull();
    expect(call.create.codeHash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
    expect(mockSend).toHaveBeenCalledTimes(1);
    const smsCall = mockSend.mock.calls[0][0] as { to: string; body: string };
    expect(smsCall.to).toBe(PHONE);
    expect(smsCall.body).toContain("Kolaleaf verification code");
    expect(smsCall.body).toContain(`${PHONE_CODE_TTL_MINUTES} minutes`);
  });

  it("returns send_failed when the SMS provider reports an error", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({ id: "p1" } as never);
    mockSend.mockResolvedValueOnce({ ok: false, error: "Twilio: 500" });

    const result = await issuePendingPhoneCode({ phone: PHONE });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "send_failed") {
      expect(result.providerError).toBe("Twilio: 500");
    } else {
      throw new Error(`Expected send_failed, got ${JSON.stringify(result)}`);
    }
  });
});

describe("verifyPendingPhoneCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no_token when nothing found", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const out = await verifyPendingPhoneCode({ phone: PHONE, code: "123456" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_token");
  });

  it("returns used when verifiedAt is set but claim window has closed", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "p1",
      kind: "PHONE",
      identifier: PHONE,
      codeHash: "$2b$04$h",
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      verifiedAt: new Date(Date.now() - 60 * 60_000),
      claimExpiresAt: new Date(Date.now() - 60_000),
    } as never);
    const out = await verifyPendingPhoneCode({ phone: PHONE, code: "123456" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("used");
  });

  it("returns expired when expiresAt is in the past", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "p1",
      kind: "PHONE",
      identifier: PHONE,
      codeHash: "$2b$04$h",
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
    } as never);
    const out = await verifyPendingPhoneCode({ phone: PHONE, code: "123456" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("expired");
  });

  it("returns too_many_attempts when attempts already at cap", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "p1",
      kind: "PHONE",
      identifier: PHONE,
      codeHash: "$2b$04$h",
      expiresAt: new Date(Date.now() + 60_000),
      attempts: PHONE_CODE_MAX_ATTEMPTS,
      verifiedAt: null,
      claimExpiresAt: null,
    } as never);
    const out = await verifyPendingPhoneCode({ phone: PHONE, code: "123456" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("too_many_attempts");
  });

  it("returns ok and opens claim window on correct code", async () => {
    // Pre-compute a real bcrypt hash so verifySmsCode matches.
    const { generateSmsCode } = await import("@/lib/auth/phone");
    const { code, hash } = generateSmsCode();
    mockFindUnique.mockResolvedValueOnce({
      id: "p1",
      kind: "PHONE",
      identifier: PHONE,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
    } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    const out = await verifyPendingPhoneCode({ phone: PHONE, code });

    expect(out.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0] as {
      data: { verifiedAt: Date; claimExpiresAt: Date };
    };
    expect(call.data.verifiedAt).toBeInstanceOf(Date);
    const claimWindowMs = PHONE_CLAIM_WINDOW_MINUTES * 60 * 1000;
    const driftMs =
      call.data.claimExpiresAt.getTime() - (Date.now() + claimWindowMs);
    expect(Math.abs(driftMs)).toBeLessThan(5000);
  });

  it("increments attempts and reports wrong_code on a bad code", async () => {
    const { generateSmsCode } = await import("@/lib/auth/phone");
    const { hash } = generateSmsCode(); // a hash that does NOT match '999999'
    mockFindUnique.mockResolvedValueOnce({
      id: "p1",
      kind: "PHONE",
      identifier: PHONE,
      codeHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      verifiedAt: null,
      claimExpiresAt: null,
    } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    const out = await verifyPendingPhoneCode({ phone: PHONE, code: "999999" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("wrong_code");
    const call = mockUpdate.mock.calls[0][0] as {
      data: { attempts: { increment: number } };
    };
    expect(call.data.attempts.increment).toBe(1);
  });
});
