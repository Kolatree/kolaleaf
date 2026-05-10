import { NextResponse } from "next/server";
import { loginUser, EmailNotVerifiedError } from "@/lib/auth/login";
import {
  clearPendingTwoFactorCookie,
  clearSessionCookie,
  setPendingTwoFactorCookie,
  setSessionCookie,
} from "@/lib/auth/middleware";
import { issueVerificationCode } from "@/lib/auth/email-verification";
import { extractRequestContext } from "@/lib/security/request-context";
import { parseBody } from "@/lib/http/validate";
import { jsonError } from "@/lib/http/json-error";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordLoginFailure,
} from "@/lib/auth/login-rate-limit";
import { log } from "@/lib/obs/logger";
import { LoginBody } from "./_schemas";

export async function POST(request: Request) {
  const parsed = await parseBody(request, LoginBody);
  if (!parsed.ok) return parsed.response;
  const { identifier, password } = parsed.data;

  const securityContext = extractRequestContext(request);
  const { ip, userAgent } = securityContext;
  const identifierValue = identifier.value;

  const rateLimit = await checkLoginRateLimit(identifierValue, ip);
  if (!rateLimit.allowed) {
    log("warn", "auth.login.rate_limited", {
      identifier: identifierValue,
      ip,
      retryAfterMs: rateLimit.retryAfterMs,
    });
    // Phase 1 review fix: emit canonical ErrorEnvelope ({ error, reason }) and
    // carry retry-after via the Retry-After header (seconds) — same shape the
    // rest of /api/* uses, so iOS BackendError decode succeeds and reason-based
    // dispatch fires. The body field `retryAfter` was redundant once the header
    // is present.
    const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
    return jsonError(
      "rate_limited",
      "Too many sign-in attempts. Please try again shortly.",
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  try {
    // Email is already trimmed + lowercased by the Email primitive in
    // common.ts, so identifier.value arrives normalised.
    const { user, session, requires2FA, twoFactorMethod, challengeId } =
      await loginUser({
        identifier: identifierValue,
        password,
        ip,
        userAgent,
        securityContext,
      });
    await clearLoginRateLimit(identifierValue, ip);

    const response = NextResponse.json({
      user: { id: user.id, fullName: user.fullName },
      requires2FA,
      twoFactorMethod,
    });
    response.headers.append("Set-Cookie", clearSessionCookie());
    if (requires2FA && challengeId) {
      response.headers.append(
        "Set-Cookie",
        setPendingTwoFactorCookie(challengeId),
      );
    } else if (session) {
      response.headers.append("Set-Cookie", clearPendingTwoFactorCookie());
      response.headers.append("Set-Cookie", setSessionCookie(session.token));
    }
    return response;
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      await clearLoginRateLimit(identifierValue, ip);
      // Password was correct but the email is unverified. Issue a fresh code
      // (best-effort: rate limit may suppress) and tell the client to bounce
      // to /verify-email. We do NOT set a session cookie.
      try {
        await issueVerificationCode({
          userId: error.userId,
          email: error.email,
          recipientName: error.fullName,
        });
      } catch (issueErr) {
        log("error", "auth.login.verification-code-issue.failed", {
          error:
            issueErr instanceof Error ? issueErr.message : String(issueErr),
        });
        // Continue — surface the verification-required state to the client
        // anyway; the user can hit "resend" from the verify page.
      }
      return NextResponse.json(
        {
          requiresVerification: true,
          email: error.email,
          message: "Please verify your email to continue",
        },
        { status: 202 },
      );
    }

    const isInvalidCredentials =
      error instanceof Error && error.message === "Invalid credentials";

    if (isInvalidCredentials) {
      await recordLoginFailure(identifierValue, ip);
    }

    // Never leak the underlying error to the client — a DB error or internal
    // failure would otherwise surface in the HTTP body. Log the raw error so
    // operators can debug.
    log("error", "auth.login.failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Phase 1 review fix: differentiate invalid credentials (401) from internal
    // failure (500). The previous catch-all returned 401 'Login failed' for ANY
    // exception — DB outages, Prisma errors, etc. — so iOS surfaced "Email or
    // password incorrect" to users whose credentials were correct, generating
    // false support tickets. Both responses still hide the underlying message.
    if (isInvalidCredentials) {
      return jsonError("invalid_credentials", "Login failed", 401);
    }
    return jsonError(
      "internal_error",
      "Sign-in is temporarily unavailable. Please try again in a moment.",
      500,
    );
  }
}
