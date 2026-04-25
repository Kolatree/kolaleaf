import { verifyHmac, verifyStaticSecret } from '../../crypto/verify-hmac'

// Flutterwave's `verif-hash` header is a static secret (not HMAC). Match
// the shape used in handleFlutterwaveWebhook: constant-time string compare.
export function verifyFlutterwaveSignature(
  signature: string,
  webhookSecret: string,
): boolean {
  return verifyStaticSecret(signature, webhookSecret)
}

// BudPay signs the raw HTTP body with HMAC-SHA512 using the merchant
// secret key. Payload shape: the exact raw bytes the provider sent --
// do NOT JSON.stringify(JSON.parse(body)) here, whitespace/key-order
// differences break verification.
export function verifyBudPaySignature(
  rawBody: string,
  signature: string,
  secretKey: string,
): boolean {
  return verifyHmac('sha512', rawBody, signature, secretKey)
}
