import crypto from 'crypto'

// Shared HMAC verification for webhook signature checks.
//
// All providers sign the raw HTTP body with an HMAC keyed on a shared secret.
// This helper centralises the constant-time comparison so each provider
// module only needs to specify its algorithm and encoding.
export function verifyHmac(
  algorithm: 'sha256' | 'sha512',
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false

  const expected = crypto
    .createHmac(algorithm, secret)
    .update(payload)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const receivedBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== receivedBuf.length) return false

  try {
    return crypto.timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}

// Constant-time comparison for providers that use a static secret
// (e.g. Flutterwave's `verif-hash` header is the webhook secret itself,
// not an HMAC digest).
export function verifyStaticSecret(
  received: string,
  expected: string,
): boolean {
  if (!received || !expected) return false

  const expectedBuf = Buffer.from(expected, 'utf-8')
  const receivedBuf = Buffer.from(received, 'utf-8')
  if (expectedBuf.length !== receivedBuf.length) return false

  try {
    return crypto.timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}
