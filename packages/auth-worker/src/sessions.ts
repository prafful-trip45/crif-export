/**
 * Session store (KV) + the single-device / User-Agent enforcement rules.
 *
 * There is exactly ONE key per user — `sess:{userId}` — so a user can only ever have
 * ONE active session. Logging in again (anywhere) OVERWRITES that record with a new
 * `sid`, which instantly invalidates the previous device: its next heartbeat carries
 * the old `sid` and is rejected ("newest device wins"). The session is also bound to
 * the device (`x-vidyasetu-ua` deviceId), so a request from a different device is
 * rejected even if it somehow presents a valid-looking token.
 */
import type { KVNamespace } from './env.js';
import { randomToken, sha256Hex } from './crypto.js';
import type { DeviceUa } from './ua.js';

export interface SessionRecord {
  sid: string;
  userId: string;
  companyId: string;
  /** Bound device id (from x-vidyasetu-ua); the single-device signal. */
  deviceId: string;
  /** Full device UA string, kept for audit / display. */
  deviceUa: string;
  /** SHA-256 of the opaque refresh token (never store the token itself). */
  refreshHash: string;
  createdAt: number;
  lastSeen: number;
}

const sessionKey = (userId: string): string => `sess:${userId}`;

export async function getSession(kv: KVNamespace, userId: string): Promise<SessionRecord | null> {
  const raw = await kv.get(sessionKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function putSession(kv: KVNamespace, rec: SessionRecord, ttlSeconds: number): Promise<void> {
  await kv.put(sessionKey(rec.userId), JSON.stringify(rec), { expirationTtl: ttlSeconds });
}

export async function deleteSession(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(sessionKey(userId));
}

/**
 * The refresh token is `"{userId}.{secret}"` so the stateless `/refresh` and `/logout`
 * endpoints (which receive ONLY the token) can resolve the user without an extra header.
 * Only the token's SHA-256 hash is stored in the session; the secret is never persisted.
 */
async function mintRefreshToken(userId: string): Promise<{ token: string; hash: string }> {
  const token = `${userId}.${randomToken(32)}`;
  return { token, hash: await sha256Hex(token) };
}

/** Extract the userId a refresh token was minted for (or null if malformed). */
export function userIdFromRefreshToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  return token.slice(0, dot);
}

/**
 * Create (and persist) a fresh session for a user, EVICTING any previous one. Returns
 * the record plus the plaintext refresh token (shown to the client once, never stored).
 */
export async function startSession(
  kv: KVNamespace,
  args: { userId: string; companyId: string; device: DeviceUa; ttlSeconds: number; now?: number },
): Promise<{ session: SessionRecord; refreshToken: string }> {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const { token: refreshToken, hash } = await mintRefreshToken(args.userId);
  const session: SessionRecord = {
    sid: randomToken(16),
    userId: args.userId,
    companyId: args.companyId,
    deviceId: args.device.deviceId,
    deviceUa: args.device.raw,
    refreshHash: hash,
    createdAt: now,
    lastSeen: now,
  };
  await putSession(kv, session, args.ttlSeconds); // overwrites `sess:{userId}` → single session
  return { session, refreshToken };
}

/**
 * Rotate the refresh secret in place (SAME sid + device) and persist. Used by the
 * refresh flow so a stolen refresh token can only be used once.
 */
export async function rotateRefreshToken(
  kv: KVNamespace,
  session: SessionRecord,
  device: DeviceUa,
  ttlSeconds: number,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const { token, hash } = await mintRefreshToken(session.userId);
  session.refreshHash = hash;
  session.deviceUa = device.raw;
  session.lastSeen = now;
  await putSession(kv, session, ttlSeconds);
  return token;
}

export type SessionCheck = 'ok' | 'no-session' | 'revoked' | 'device-mismatch';

/**
 * Decide whether a request bearing (`sid`, `deviceId`) is the user's CURRENT session on
 * the SAME device. Pure — unit-tested directly.
 *   - no stored session                     -> 'no-session'   (401, session-revoked)
 *   - stored sid != token sid               -> 'revoked'      (logged in on another device)
 *   - stored device != request device       -> 'device-mismatch' (401, different device)
 */
export function checkSession(session: SessionRecord | null, sid: string, deviceId: string): SessionCheck {
  if (!session) return 'no-session';
  if (session.sid !== sid) return 'revoked';
  if (session.deviceId !== deviceId) return 'device-mismatch';
  return 'ok';
}
