import { verifyHmac } from '../../crypto/verify-hmac'

export function verifySumsubSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  return verifyHmac('sha256', payload, signature, secret)
}
