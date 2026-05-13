# Investigation: `/api/v1/kyc/initiate` returns 500 in production

**Date:** 2026-05-13
**Status:** Outstanding — needs Railway log access to confirm
**Trigger:** iPhone screenshot showed `Something went wrong on our side (500).` on the KYC intro screen after tapping "Start verification"

## What we know

- Route: `src/app/api/v1/kyc/initiate/route.ts:18-62`
- All non-AuthError / non-RateLimit / non-409 errors fall through to `return jsonError("kyc_initiate_failed", message, 500)` (line 60)
- The `message` carried in the error body is `error.message` from whatever throws inside `initiateKyc(userId, client)` (`src/lib/kyc/sumsub/kyc-service.ts`)
- Without server logs, we can't see which specific line throws

## Most likely root causes (ordered by likelihood)

### 1. Sumsub credentials missing or wrong in production env

Highest probability. `createSumsubClient()` in `src/lib/kyc/sumsub/client.ts:71-78` requires:

- `SUMSUB_API_URL`
- `SUMSUB_APP_TOKEN`
- `SUMSUB_SECRET_KEY`
- `SUMSUB_LEVEL_NAME`

If any are missing in production, `validateSumsubConfig()` throws at line 78 with `"Sumsub config missing in production: …"`. That message would surface in the iOS error.

**Verify:**

```
railway variables --service <api-service> | grep -i sumsub
```

Or in Railway dashboard → Service → Variables.

### 2. Sumsub API rejecting the request

Common Sumsub-side rejections:

- Invalid `levelName` — backend ships a level the Sumsub account doesn't have
- App-token / secret-key mismatch (e.g. dev keys in prod env)
- Applicant already exists in a state Sumsub doesn't allow re-creation for (race against the 409 handling on line 54-58 if the message format changed Sumsub-side)

**Verify:** check Sumsub dashboard → Applicants → search by `userId` to see if a half-created applicant is wedged.

### 3. Code error inside `initiateKyc`

Lower probability since Vitest tests cover happy path. Check:

- `src/lib/kyc/sumsub/kyc-service.ts` — any new field reference that production DB doesn't have a column for
- `prisma.user.findUniqueOrThrow` calls — would throw if user row missing (race after a logout?)

## Diagnostic procedure (when Railway access is restored)

```
# 1. Verify auth + project link
railway whoami
railway list
cd ~/Documents/projects/Kolaleaf && railway link --project <kolaleaf-project-id>

# 2. Tail the API service logs while reproducing the bug on iPhone
railway logs --service kolaleaf-web --tail | grep -E "kyc.initiate|Sumsub|kyc.failed"

# 3. Look for the actual throw site in the stack trace
# Likely patterns:
#   "Sumsub config missing"
#   "applicant_already_exists"
#   "INVALID_LEVEL"
#   prisma errors
```

## Workaround for the user RIGHT NOW

The "Maybe later" Skip button shipped in commit `e8a52bb` lets the user reach MainTab without completing KYC. The /kyc/initiate 500 is a real backend bug but is not blocking app exploration. Backend transfer-time KYC enforcement (separate concern) gates actual money movement until verification completes.

## Fix paths (once root cause confirmed)

| If root cause is           | Fix                                                                          |
| -------------------------- | ---------------------------------------------------------------------------- |
| Missing env vars           | Add to Railway, redeploy, no code change                                     |
| Sumsub credential mismatch | Rotate Sumsub keys, update Railway env, redeploy                             |
| Stale applicant state      | One-off cleanup query in Sumsub dashboard + add idempotency to `initiateKyc` |
| Code regression            | Hotfix commit + deploy                                                       |

## Owner

Backend developer with Sumsub dashboard access + Railway production env permissions. Not implementable purely from the iOS side.
