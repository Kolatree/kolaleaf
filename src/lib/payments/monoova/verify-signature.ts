import crypto from 'crypto'

export function verifyMonoovaSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    )
  } catch {
    return false
  }
}
