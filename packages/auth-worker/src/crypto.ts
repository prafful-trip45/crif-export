/**
 * Auth primitives on WebCrypto (SubtleCrypto) — no Node crypto, no dependencies,
 * runs unchanged on the Cloudflare Workers runtime.
 *
 *  - Passwords: PBKDF2-SHA256, stored as `pbkdf2$<iterations>$<saltB64url>$<hashB64url>`.
 *  - Access token: compact HS256 JWT (header.payload.signature), `exp` enforced.
 *  - Refresh token: opaque random string; only its SHA-256 hash is stored server-side.
 */

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_BYTES = 32;
const enc = new TextEncoder();

/* ---------- base64url ---------- */

export function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function bytesFromB64url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '='; // pad to a multiple of 4
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlFromString = (s: string): string => b64urlFromBytes(enc.encode(s));
const stringFromB64url = (s: string): string => new TextDecoder().decode(bytesFromB64url(s));

/** Constant-time compare of two equal-length byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/* ---------- random tokens ---------- */

/** URL-safe random token (default 32 bytes ≈ 43 chars). Use for refresh tokens & sids. */
export function randomToken(bytes = 32): string {
  return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ---------- passwords (PBKDF2) ---------- */

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlFromBytes(salt)}$${b64urlFromBytes(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = bytesFromB64url(parts[2]!);
  const expected = bytesFromB64url(parts[3]!);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqualBytes(actual, expected);
}

/** SHA-256 hex digest — used to store only a HASH of the opaque refresh token. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- JWT (HS256) ---------- */

export interface JwtPayload {
  sub: string; // user_id
  sid: string; // session id
  cid?: string; // company_id
  dev?: string; // bound device (x-vidyasetu-ua)
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64urlFromString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64urlFromString(JSON.stringify(body));
  const data = `${head}.${claims}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

/** Verify signature + expiry. Returns the payload, or null if invalid/expired. */
export async function verifyJwt(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, claims, sig] = parts as [string, string, string];
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    bytesFromB64url(sig) as BufferSource,
    enc.encode(`${head}.${claims}`),
  );
  if (!ok) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(stringFromB64url(claims));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  return payload;
}
