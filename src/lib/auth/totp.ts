import crypto from 'crypto'
import { generateSecret, verifySync, generateURI } from 'otplib'

const ISSUER = 'Kolaleaf'

export function generateTotpSecret(userEmail: string): { secret: string; uri: string } {
  const secret = generateSecret()
  const uri = generateURI({ issuer: ISSUER, label: userEmail, secret })
  return { secret, uri }
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const result = verifySync({ token, secret })
  return result.valid
}

export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []
  while (codes.length < count) {
    const code = crypto.randomBytes(6).toString('hex').slice(0, 8).toLowerCase()
    if (!codes.includes(code)) {
      codes.push(code)
    }
  }
  return codes
}
