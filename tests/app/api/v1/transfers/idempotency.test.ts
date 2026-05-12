// Idempotency contract tests for POST /api/v1/transfers (C3 / ADV-P6-C1).
//
// Covers:
//   • Header missing → normal create.
//   • Same key + same body → existing transfer returned (no second create).
//   • Same key + different body → 409 idempotency_key_conflict.
//   • Malformed header → 400 invalid_idempotency_key.
//
// We mock `createTransfer` at the route boundary so the route surface
// is exercised without spinning up Postgres. Tests in
// `tests/lib/transfers/idempotency.test.ts` cover the cache-hit /
// hash-mismatch logic at the create() level (those run against a
// transactional sandbox).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/transfers", () => ({
  createTransfer: vi.fn(),
  listTransfers: vi.fn(),
  KycNotVerifiedError: class extends Error {},
  RecipientNotOwnedError: class extends Error {},
  InvalidCorridorError: class extends Error {},
  AmountOutOfRangeError: class extends Error {},
  DailyLimitExceededError: class extends Error {},
  IdempotencyKeyConflictError: class extends Error {
    constructor(key: string) {
      super(
        `Idempotency key ${key} was used previously with a different request body`,
      );
      this.name = "IdempotencyKeyConflictError";
    }
  },
}));

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(),
  requireEmailVerified: vi.fn(),
  AuthError: class extends Error {
    statusCode: number;
    constructor(statusCode: number, msg: string) {
      super(msg);
      this.name = "AuthError";
      this.statusCode = statusCode;
    }
  },
}));

import { POST } from "@/app/api/v1/transfers/route";
import { createTransfer, IdempotencyKeyConflictError } from "@/lib/transfers";
import { requireAuth, requireEmailVerified } from "@/lib/auth/middleware";

const mockCreate = vi.mocked(createTransfer);

function postWithHeaders(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/v1/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  recipientId: "rcp_clidnskd0000001abc12345",
  corridorId: "cor_clidnskd0000001abc12345",
  sendAmount: "10.00",
  exchangeRate: "1000",
};

const ALT_BODY = {
  recipientId: "rcp_clidnskd0000001abc12345",
  corridorId: "cor_clidnskd0000001abc12345",
  sendAmount: "20.00", // different
  exchangeRate: "1000",
};

const VALID_KEY = "7b51d5c4-2e34-4d61-9c4f-6c1d8e3aa101";

describe("POST /api/v1/transfers (Idempotency-Key)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireEmailVerified).mockResolvedValue({
      userId: "u1",
    } as never);
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1" } as never);
  });

  it("passes the idempotency key through to createTransfer", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      status: "CREATED",
      sendAmount: "10.00",
      recipientId: "rcp_clidnskd0000001abc12345",
      corridorId: "cor_clidnskd0000001abc12345",
      exchangeRate: "1000",
      fee: "0",
    } as never);

    const res = await POST(
      postWithHeaders(VALID_BODY, { "idempotency-key": VALID_KEY }),
    );

    expect(res.status).toBe(201);
    const call = mockCreate.mock.calls[0]?.[0] as { idempotencyKey?: string };
    expect(call?.idempotencyKey).toBe(VALID_KEY);
  });

  it("does not forward an idempotency key when the header is absent", async () => {
    mockCreate.mockResolvedValueOnce({ id: "t1" } as never);

    await POST(postWithHeaders(VALID_BODY));

    const call = mockCreate.mock.calls[0]?.[0] as { idempotencyKey?: string };
    expect(call?.idempotencyKey).toBeUndefined();
  });

  it("returns the existing transfer (201 + same id) when createTransfer returns the cached row", async () => {
    // Idempotent replay: createTransfer returns the original row.
    mockCreate.mockResolvedValueOnce({
      id: "t1",
      userId: "u1",
      status: "CREATED",
    } as never);

    const res = await POST(
      postWithHeaders(VALID_BODY, { "idempotency-key": VALID_KEY }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transfer.id).toBe("t1");
  });

  it("returns 409 idempotency_key_conflict on body mismatch with same key", async () => {
    mockCreate.mockRejectedValueOnce(
      new IdempotencyKeyConflictError(VALID_KEY),
    );

    const res = await POST(
      postWithHeaders(ALT_BODY, { "idempotency-key": VALID_KEY }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("idempotency_key_conflict");
  });

  it("returns 400 invalid_idempotency_key for a malformed header", async () => {
    const res = await POST(
      postWithHeaders(VALID_BODY, { "idempotency-key": "short" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("invalid_idempotency_key");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_idempotency_key for an oversized header", async () => {
    const res = await POST(
      postWithHeaders(VALID_BODY, { "idempotency-key": "a".repeat(200) }),
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
