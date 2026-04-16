import crypto, { timingSafeEqual } from 'crypto'

// Flutterwave's `verif-hash` header is a static secret (not HMAC). Match
// the shape used in handleFlutterwaveWebhook: constant-time string compare.
export function verifyFlutterwaveSignature(
  signature: string,
  webhookSecret: string,
): boolean {
  if (!signature || !webhookSecret) return false
  const expected = Buffer.from(webhookSecret, 'utf-8')
  const received = Buffer.from(signature, 'utf-8')
  if (expected.length !== received.length) return false
  try {
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

// Paystack signs the raw HTTP body with HMAC-SHA512 using the secret key.
export function verifyPaystackSignature(
  rawBody: string,
  signature: string,
  secretKey: string,
): boolean {
  if (!signature || !secretKey) return false
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const receivedBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== receivedBuf.length) return false
  try {
    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}
