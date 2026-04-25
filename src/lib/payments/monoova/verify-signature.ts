import { verifyHmac } from '../../crypto/verify-hmac'

export function verifyMonoovaSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  return verifyHmac('sha256', payload, signature, secret)
}
