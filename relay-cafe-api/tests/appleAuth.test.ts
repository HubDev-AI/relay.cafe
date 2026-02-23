import { describe, it, expect, mock } from 'bun:test'

// We test the verification logic with a mocked JWKS fetch.
// verifyAppleToken should:
//   - Throw if token is malformed
//   - Return { sub } on valid token (mocked)

describe('verifyAppleToken', () => {
  it('throws on malformed token', async () => {
    const { verifyAppleToken } = await import('../src/lib/appleAuth')
    await expect(verifyAppleToken('not.a.jwt')).rejects.toThrow()
  })
})
