import { createRemoteJWKSet, jwtVerify } from 'jose'

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID
if (!APPLE_BUNDLE_ID) {
  throw new Error('APPLE_BUNDLE_ID environment variable is required')
}

const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys')
)

export interface AppleClaims {
  sub: string
  email?: string
}

export async function verifyAppleToken(token: string): Promise<AppleClaims> {
  const { payload } = await jwtVerify(token, APPLE_JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: APPLE_BUNDLE_ID,
  })

  if (typeof payload.sub !== 'string') {
    throw new Error('missing sub in Apple token')
  }

  return { sub: payload.sub, email: payload.email as string | undefined }
}
