/**
 * DEPRECATED — superseded by `auth.ts` (server-signed JWT login).
 *
 * The earlier encrypted `X-App-Attestation` header relied on an AES key embedded
 * in the app, which is extractable and therefore forgeable. Identity is now
 * carried by server-signed access/refresh tokens (the signing secret never
 * leaves the backend), which is tamper-proof. Kept as an empty module so any
 * stale import doesn't break the build.
 */
export {};
