/**
 * scripts/export-openapi-snapshot.ts
 *
 * Generates the OpenAPI 3.1 document from the central registry and writes
 * it to the iOS test bundle as a deterministic JSON snapshot.
 *
 * Used by `OpenAPIContractTests` in `ios/KolaleafTests/Networking/` to
 * detect drift between the backend Zod schemas and the iOS Codable DTOs:
 * if a non-optional field is added server-side and iOS doesn't model it,
 * the test bundle decode against the example payload fails at CI time
 * instead of in production.
 *
 * Run with:
 *   npm run openapi:snapshot
 *
 * The output is deterministic — keys are sorted recursively before write
 * so re-running on an unchanged registry produces identical bytes.
 *
 * Wave 1 · U84 (OpenAPI contract test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Side-effect imports register every route with the central registry.
// Mirror of `src/app/api/v1/openapi/route.ts` — keep these lists in sync.

// auth
import "@/app/api/v1/auth/send-code/_schemas";
import "@/app/api/v1/auth/complete-registration/_schemas";
import "@/app/api/v1/auth/login/_schemas";
import "@/app/api/v1/auth/logout/_schemas";
import "@/app/api/v1/auth/verify-code/_schemas";
import "@/app/api/v1/auth/verify-email/_schemas";
import "@/app/api/v1/auth/verify-2fa/_schemas";
import "@/app/api/v1/auth/device-attestation/_schemas";
import "@/app/api/v1/auth/request-password-reset/_schemas";
import "@/app/api/v1/auth/reset-password/_schemas";
import "@/app/api/v1/auth/resend-verification/_schemas";

// analytics
import "@/app/api/v1/analytics/events/_schemas";

// account
import "@/app/api/v1/account/me/_schemas";
import "@/app/api/v1/account/change-email/_schemas";
import "@/app/api/v1/account/change-password/_schemas";
import "@/app/api/v1/account/email/[id]/_schemas";
import "@/app/api/v1/account/phone/add/_schemas";
import "@/app/api/v1/account/phone/remove/_schemas";
import "@/app/api/v1/account/phone/verify/_schemas";
import "@/app/api/v1/account/2fa/setup/_schemas";
import "@/app/api/v1/account/2fa/enable/_schemas";
import "@/app/api/v1/account/2fa/disable/_schemas";
import "@/app/api/v1/account/2fa/regenerate-backup-codes/_schemas";

// admin
import "@/app/api/v1/admin/rates/_schemas";
import "@/app/api/v1/admin/compliance/_schemas";
import "@/app/api/v1/admin/float/_schemas";
import "@/app/api/v1/admin/stats/_schemas";
import "@/app/api/v1/admin/referrals/[id]/pay/_schemas";
import "@/app/api/v1/admin/transfers/_schemas";
import "@/app/api/v1/admin/transfers/[id]/_schemas";
import "@/app/api/v1/admin/transfers/[id]/refund/_schemas";
import "@/app/api/v1/admin/transfers/[id]/retry/_schemas";
import "@/app/api/v1/admin/failed-emails/_schemas";
import "@/app/api/v1/admin/failed-emails/[id]/resolve/_schemas";
import "@/app/api/v1/admin/compliance/[id]/mark-reported/_schemas";

// transfers / recipients / rates / banks / kyc
import "@/app/api/v1/transfers/_schemas";
import "@/app/api/v1/transfers/[id]/_schemas";
import "@/app/api/v1/transfers/[id]/cancel/_schemas";
import "@/app/api/v1/transfers/[id]/issue-payid/_schemas";
import "@/app/api/v1/recipients/_schemas";
import "@/app/api/v1/recipients/[id]/_schemas";
import "@/app/api/v1/recipients/resolve/_schemas";
import "@/app/api/v1/rates/[corridorId]/_schemas";
import "@/app/api/v1/rates/public/_schemas";
import "@/app/api/v1/banks/_schemas";
import "@/app/api/v1/kyc/initiate/_schemas";
import "@/app/api/v1/kyc/access-token/_schemas";
import "@/app/api/v1/kyc/status/_schemas";
import "@/app/api/v1/kyc/retry/_schemas";

import { generateOpenApiDocument } from "@/lib/openapi/registry";

/**
 * Recursive deterministic JSON stringifier. Sorts object keys at every
 * level so byte-identical output is produced for an unchanged registry.
 * Arrays preserve their order — OpenAPI considers `required` /
 * `oneOf` / `tags` order significant in some tools, so we don't reorder.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) + "\n";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

function main(): void {
  const doc = generateOpenApiDocument();
  const json = stableStringify(doc);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const outPath = path.join(
    repoRoot,
    "ios",
    "KolaleafTests",
    "Networking",
    "openapi-snapshot.json",
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json, "utf8");

  const sizeKb = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${sizeKb} KiB)`);
}

main();
