import { describe, it, expect, vi, beforeEach } from "vitest";

// /api/v1/account/me — GET (response-only) and PATCH (Phase 3 / U29+U30
// PostKYC partial-update). GET tests confirm the OpenAPI 200 contract;
// PATCH tests cover auth, schema, partial-update semantics, the
// blank-string→NULL contract, the GET/PATCH round-trip via a stateful
// in-memory user, AUSTRAC AuthEvent emission, the bidi/zero-width
// sanitization helper, country pinning, and the per-user rate limit.
vi.mock("@/lib/db/client", () => {
  // ADV-1: PATCH wraps the User update + AuthEvent emission in
  // `prisma.$transaction(async (tx) => …)`. The mock supplies a `tx`
  // handle that is the same prisma object, so any mock for
  // `prisma.user.update` / `prisma.authEvent.create` is hit whether
  // the route uses `prisma.user.update(…)` directly or `tx.user.update(…)`
  // inside the transaction callback. Tests can also reject the
  // `$transaction` call directly to simulate a rollback.
  const prismaMock: {
    user: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    userIdentifier: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    authEvent: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    user: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    userIdentifier: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    authEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // Default: $transaction immediately invokes the callback with the
  // prisma mock as `tx`. Tests that need rollback semantics override
  // this with mockRejectedValueOnce / mockImplementationOnce.
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => {
      return await fn(prismaMock);
    },
  );
  return { prisma: prismaMock };
});

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

vi.mock("@/lib/auth/audit", () => ({
  logAuthEvent: vi.fn(),
}));

vi.mock("@/lib/auth/account-write-rate-limit", () => ({
  checkAccountWriteRateLimit: vi.fn(),
  __resetAccountWriteRateLimitForTests: vi.fn(),
  __setRedisClientForTests: vi.fn(),
  __markRedisFailedForTests: vi.fn(),
  __probeRedisHealth: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/v1/account/me/route";
import { prisma } from "@/lib/db/client";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import { logAuthEvent } from "@/lib/auth/audit";
import { checkAccountWriteRateLimit } from "@/lib/auth/account-write-rate-limit";
import { AccountMeResponse } from "@/app/api/v1/account/me/_schemas";

const mockRequireAuth = vi.mocked(requireAuth);
const mockUserFind = vi.mocked(prisma.user.findUniqueOrThrow);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockIdentFirst = vi.mocked(prisma.userIdentifier.findFirst);
const mockIdentMany = vi.mocked(prisma.userIdentifier.findMany);
const mockLogAuthEvent = vi.mocked(logAuthEvent);
const mockRateLimit = vi.mocked(checkAccountWriteRateLimit);
// `prisma.$transaction` is mocked at the factory level; this typed
// handle lets individual tests override it (rollback, partial failure).
const mockPrismaTransaction = (
  prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
).$transaction;

// ADV-1: `vi.clearAllMocks()` clears the default $transaction
// implementation set in the factory. Re-install the
// "invoke-callback-with-prisma-as-tx" default before each test so the
// route's `prisma.$transaction(async (tx) => ...)` actually runs.
function defaultPrismaTransaction(): void {
  mockPrismaTransaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => {
      return await fn(prisma);
    },
  );
}

const USER_ID = "u1";

function getRequest(): Request {
  return new Request("http://localhost/api/v1/account/me", { method: "GET" });
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/account/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequestRaw(body: string): Request {
  return new Request("http://localhost/api/v1/account/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function mockSession() {
  mockRequireAuth.mockResolvedValue({ userId: USER_ID } as never);
}

function mockRateLimitOk() {
  mockRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
}

// Stateful in-memory User row. PATCH tests mutate this and then GET
// reads it back so we can assert round-trip behavior without a real DB.
type UserRow = {
  id: string;
  fullName: string | null;
  displayName: string | null;
  twoFactorMethod: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorBackupCodes: string[];
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  kycStatus: "PENDING" | "IN_REVIEW" | "VERIFIED" | "REJECTED";
};

function freshUser(): UserRow {
  return {
    id: USER_ID,
    fullName: "Ada Lovelace",
    displayName: null,
    twoFactorMethod: null,
    twoFactorEnabledAt: null,
    twoFactorBackupCodes: [],
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postcode: null,
    country: null,
    kycStatus: "VERIFIED",
  };
}

function wireUserMocks(row: UserRow) {
  // Cast via `unknown` because Prisma's fluent return type
  // (DynamicModelExtensionFluentApi) doesn't match a plain async fn.
  // The runtime-mocked helpers only need to satisfy the awaited-shape.
  (mockUserFind as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => ({ ...row }),
  );
  (mockUserUpdate as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async ({ data }: { data: Partial<UserRow> }) => {
      Object.assign(row, data);
      return { ...row };
    },
  );
  mockIdentFirst.mockResolvedValue(null);
  mockIdentMany.mockResolvedValue([
    { id: "e1", identifier: "a@b.com", verified: true },
  ] as never);
}

describe("GET /api/v1/account/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitOk();
    defaultPrismaTransaction();
  });

  it("returns 401 on AuthError", async () => {
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, "unauthorised"));
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    // ADV / API-001: 401 must use the project-wide envelope shape.
    expect(json).toMatchObject({
      error: expect.any(String),
      reason: expect.any(String),
    });
  });

  it("returns a payload that matches AccountMeResponse", async () => {
    mockSession();
    wireUserMocks(freshUser());

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    // The shape is the OpenAPI response contract; parsing succeeds
    // only if every required key is present.
    expect(() => AccountMeResponse.parse(json)).not.toThrow();
  });

  it("uses an explicit Prisma select (no SELECT *)", async () => {
    // ADV-4: A migration-ordering deploy that lands new code before the
    // displayName migration must not 500 with "column not found". The
    // route enforces this by passing `select` to findUniqueOrThrow.
    mockSession();
    wireUserMocks(freshUser());

    await GET(getRequest());

    expect(mockUserFind).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.any(Object) }),
    );
  });

  it("returns 500 with the project-wide envelope on unexpected errors", async () => {
    mockSession();
    mockUserFind.mockRejectedValueOnce(new Error("db blew up"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    // API-001: error envelope must include `reason` so iOS BackendError
    // decodes correctly.
    expect(json).toMatchObject({
      error: expect.any(String),
      reason: expect.any(String),
    });
  });
});

describe("PATCH /api/v1/account/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitOk();
    defaultPrismaTransaction();
  });

  // ─── Auth-before-parse (ADV-9) ────────────────────────────────────

  it("returns 401 when unauthenticated and does NOT leak schema fields", async () => {
    // Body would otherwise 422 — proves the auth gate runs before the
    // schema and never reveals which field set is accepted to anonymous
    // callers.
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, "unauthorised"));
    const res = await PATCH(patchRequest({ state: "XYZ" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.fields).toBeUndefined();
  });

  // ─── Schema validation (existing + new) ───────────────────────────

  it("returns 422 when state is not a valid AuState", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ state: "XYZ" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.state).toBeInstanceOf(Array);
  });

  it("returns 422 when postcode is not 4 digits", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ postcode: "abc1" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.postcode).toBeInstanceOf(Array);
  });

  it("returns 422 when displayName is empty", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ displayName: "" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.displayName).toBeInstanceOf(Array);
  });

  // ─── ADV-2: country pinned to AU ──────────────────────────────────

  it("rejects non-AU country (ADV-2: AU-only Wave 1)", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ country: "RU" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.country).toBeInstanceOf(Array);
  });

  // ─── ADV-3 / ADV-6: bidi-control / zero-width / NFKC ──────────────

  it("rejects displayName containing only RTL Override (ADV-3)", async () => {
    mockSession();
    wireUserMocks(freshUser());
    // U+202E is the RTL Override. After strip + trim the value is
    // empty — must be rejected.
    const res = await PATCH(patchRequest({ displayName: "‮" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.displayName).toBeInstanceOf(Array);
  });

  it("strips RTL Override from displayName when other letters remain", async () => {
    mockSession();
    const row = freshUser();
    wireUserMocks(row);
    // "‮Admin" → after strip + trim → "Admin"
    const res = await PATCH(patchRequest({ displayName: "‮Admin" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: "Admin" } }),
    );
  });

  it("rejects zero-width-only displayName (renders blank)", async () => {
    mockSession();
    wireUserMocks(freshUser());
    // U+200B repeated. Passes a naive min(1) but renders as empty.
    const res = await PATCH(patchRequest({ displayName: "​​​" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.displayName).toBeInstanceOf(Array);
  });

  it("NFKC-normalises fullwidth letters (e.g. Ｐａｔ → Pat)", async () => {
    mockSession();
    const row = freshUser();
    wireUserMocks(row);
    const res = await PATCH(patchRequest({ displayName: "Ｐａｔ" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: "Pat" } }),
    );
  });

  it("rejects displayName with no letter (digits only)", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ displayName: "12345" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.fields?.displayName).toBeInstanceOf(Array);
  });

  it("ALLOWS addressLine1 starting with digits (e.g. '12 Pitt St')", async () => {
    mockSession();
    const row = freshUser();
    wireUserMocks(row);
    const res = await PATCH(patchRequest({ addressLine1: "12 Pitt Street" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { addressLine1: "12 Pitt Street" } }),
    );
  });

  it("strips RTL Override from addressLine1 too", async () => {
    mockSession();
    const row = freshUser();
    wireUserMocks(row);
    const res = await PATCH(patchRequest({ addressLine1: "‮12 Pitt St" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { addressLine1: "12 Pitt St" } }),
    );
  });

  // ─── ADV-10: malformed body shapes ────────────────────────────────

  it("returns 400 on null body", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequestRaw("null"));
    expect(res.status).toBe(422);
    // Note: `null` is valid JSON, so parseBody routes it to the
    // schema; the schema rejects it because it is not an object → 422.
  });

  it("returns 422 on top-level JSON array", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequestRaw("[]"));
    expect(res.status).toBe(422);
  });

  it("returns 400 on Content-Length: 0 (empty body)", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequestRaw(""));
    // parseBody catches the JSON parse error and emits malformed_json/400.
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed JSON", async () => {
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequestRaw("not-json"));
    expect(res.status).toBe(400);
  });

  // ─── Happy-path + partial-update (existing behavior preserved) ────

  it("happy: full update returns 200 with new values; GET reflects them", async () => {
    mockSession();
    const row = freshUser();
    wireUserMocks(row);

    const res = await PATCH(
      patchRequest({
        displayName: "Pet",
        addressLine1: "1 Smith St",
        city: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "AU",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.displayName).toBe("Pet");
    expect(json.addressLine1).toBe("1 Smith St");
    expect(json.city).toBe("Sydney");
    expect(json.state).toBe("NSW");
    expect(json.postcode).toBe("2000");
    expect(json.country).toBe("AU");

    // Subsequent GET round-trips the same values from the persisted row.
    const get = await GET(getRequest());
    const getJson = await get.json();
    expect(getJson.displayName).toBe("Pet");
    expect(getJson.city).toBe("Sydney");
  });

  it("partial update writes only supplied fields; others untouched", async () => {
    mockSession();
    const row = freshUser();
    row.addressLine1 = "Original Line 1";
    row.city = "Melbourne";
    wireUserMocks(row);

    const res = await PATCH(patchRequest({ displayName: "X" }));
    expect(res.status).toBe(200);

    // Prisma was called with ONLY the displayName key (and explicit
    // select for ADV-4 / ADV-7).
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { displayName: "X" },
      select: expect.any(Object),
    });
    const json = await res.json();
    expect(json.displayName).toBe("X");
    expect(json.addressLine1).toBe("Original Line 1");
    expect(json.city).toBe("Melbourne");
  });

  it("blank-string normalises to NULL on the column (addressLine2)", async () => {
    mockSession();
    const row = freshUser();
    row.addressLine2 = "Apt 5";
    wireUserMocks(row);

    const res = await PATCH(patchRequest({ addressLine2: "" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { addressLine2: null },
      select: expect.any(Object),
    });
    const json = await res.json();
    expect(json.addressLine2).toBeNull();
  });

  it("case-insensitive AU state: lower-case input is upper-cased before persistence", async () => {
    mockSession();
    wireUserMocks(freshUser());

    const res = await PATCH(patchRequest({ state: "nsw" }));
    expect(res.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { state: "NSW" },
      select: expect.any(Object),
    });
  });

  // ─── ADV-1: AuthEvent emission for AUSTRAC retention ──────────────

  it("emits an ACCOUNT_PROFILE_UPDATED AuthEvent on successful PATCH", async () => {
    mockSession();
    const row = freshUser();
    row.displayName = "Ada";
    wireUserMocks(row);

    await PATCH(patchRequest({ displayName: "Pet", city: "Sydney" }));

    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        event: "ACCOUNT_PROFILE_UPDATED",
        metadata: expect.objectContaining({
          fields: expect.arrayContaining(["displayName", "city"]),
          changes: expect.objectContaining({
            displayName: { before: "Ada", after: "Pet" },
            city: { before: null, after: "Sydney" },
          }),
        }),
      }),
      // ADV-1: second arg is the tx client passed by the route so the
      // AuthEvent insert is part of the same Postgres transaction as
      // the User update. The mock factory's $transaction default
      // invokes the callback with the prisma mock as `tx`.
      expect.anything(),
    );
  });

  // ─── ADV-5: rate limit ────────────────────────────────────────────

  it("returns 429 when the per-user rate limit is exceeded", async () => {
    mockSession();
    wireUserMocks(freshUser());
    mockRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterMs: 60_000,
    });

    const res = await PATCH(patchRequest({ displayName: "Pet" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    // Update must NOT happen when rate-limited.
    expect(mockUserUpdate).not.toHaveBeenCalled();
    // AuthEvent must NOT fire either — a denied write has no audit
    // signal beyond the rate-limit decision itself.
    expect(mockLogAuthEvent).not.toHaveBeenCalled();
  });

  // ─── ADV-1: atomic User update + AuthEvent (rollback) ─────────────

  it("rolls back the User update when AuthEvent insert fails (ADV-1)", async () => {
    // Simulates a transient AuthEvent insert failure (e.g. statement
    // timeout) AFTER tx.user.update succeeded. The route MUST surface
    // a 500 AND the User row MUST NOT be mutated — without
    // $transaction, a User update without an audit row violates
    // AUSTRAC's 7-year retention requirement for KYC-bound records.
    mockSession();
    const row = freshUser();
    row.displayName = "Original";
    wireUserMocks(row);

    // Override the default $transaction to simulate Postgres rollback:
    // run the callback (so user.update mutates the in-memory row),
    // then have the AuthEvent step throw, then REVERT the row to its
    // pre-tx snapshot (this is what `BEGIN ... ROLLBACK` does on a
    // real DB — Prisma re-throws, the calling code sees an error, and
    // committed state is unchanged).
    mockLogAuthEvent.mockRejectedValueOnce(
      new Error("authEvent insert timeout"),
    );
    mockPrismaTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => unknown) => {
        const snapshot: UserRow = { ...row };
        try {
          return await fn(prisma);
        } catch (err) {
          // Rollback: restore the pre-tx snapshot so the assertion
          // below can verify the User row was not mutated.
          Object.assign(row, snapshot);
          throw err;
        }
      },
    );

    const res = await PATCH(patchRequest({ displayName: "Pet" }));

    // (a) Surface as 500 with the project envelope.
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({
      error: expect.any(String),
      reason: expect.any(String),
    });

    // (b) Subsequent GET must return the ORIGINAL displayName — proves
    // the User mutation rolled back along with the failed AuthEvent.
    const get = await GET(getRequest());
    const getJson = await get.json();
    expect(getJson.displayName).toBe("Original");
  });

  // ─── ADV2-3: rate-limit consumes a token only on a valid body ────
  //
  // Without this ordering, 20 schema-rejected requests would exhaust
  // the legitimate user's daily quota — a stolen-session attacker
  // could lock out the real user with one second of garbage payloads.

  it("does NOT consume the rate-limit token on a 422 (ADV2-3)", async () => {
    mockSession();
    wireUserMocks(freshUser());

    // 20 invalid requests (any 422 path will do).
    for (let i = 0; i < 20; i += 1) {
      const res = await PATCH(patchRequest({ state: "XYZ" }));
      expect(res.status).toBe(422);
    }
    // Rate-limiter must NEVER have been called for a 422 — the limit
    // gate is now AFTER schema validation.
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("does consume the rate-limit token on a 200 (ADV2-3)", async () => {
    mockSession();
    wireUserMocks(freshUser());

    const res = await PATCH(patchRequest({ displayName: "Pet" }));
    expect(res.status).toBe(200);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it("does NOT consume the rate-limit token on a 401 (ADV2-3)", async () => {
    // Auth gate fires before everything else, so a stolen-cookie
    // attacker that no longer holds a valid session can't even
    // probe the rate-limit surface.
    mockRequireAuth.mockRejectedValueOnce(new AuthError(401, "unauthorised"));
    const res = await PATCH(patchRequest({ displayName: "Pet" }));
    expect(res.status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("after 20 invalid bodies, a 21st VALID body still succeeds (ADV2-3)", async () => {
    // Demonstrates the user-facing benefit: a noisy frontend that
    // submits 20 bad bodies in a row does not exhaust the user's
    // daily real-write budget.
    mockSession();
    wireUserMocks(freshUser());

    for (let i = 0; i < 20; i += 1) {
      const r = await PATCH(patchRequest({ state: "XYZ" }));
      expect(r.status).toBe(422);
    }
    // First call to the (mocked) rate limit returns allowed.
    const final = await PATCH(patchRequest({ displayName: "Pet" }));
    expect(final.status).toBe(200);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  // ─── ADV2-1: strict schema rejects unknown keys ───────────────────

  it("returns 422 on unknown body keys (ADV2-1: .strict() guard)", async () => {
    // A future maintainer adding a non-column virtual field would crash
    // Prisma at runtime; .strict() turns that into a compile-time-ish
    // 422. Also defends against a forged body that smuggles e.g.
    // `admin: true` or `kycStatus: 'VERIFIED'` past the iterate-keys
    // logic in the route.
    mockSession();
    wireUserMocks(freshUser());
    const res = await PATCH(patchRequest({ displayName: "Pet", admin: true }));
    expect(res.status).toBe(422);
    const json = await res.json();
    // Zod 4's `unrecognized_keys` issue lands at form-level (path is
    // `[]`), so `flattenError` puts the message on the top-level
    // `error` summary — not `fields[key]`. Asserting on `error`
    // catches both Zod 3 and Zod 4 shapes without coupling the test
    // to the internals of `jsonZodError`.
    expect(json.reason).toBe("validation_failed");
    expect(json.error).toMatch(/admin/i);
    // User update must NOT have happened — the 422 is pre-write.
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockLogAuthEvent).not.toHaveBeenCalled();
  });
});
