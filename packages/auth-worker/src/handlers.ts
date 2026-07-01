/**
 * Route handlers implementing the `/api/crif/*` contract the desktop client already
 * speaks (see packages/desktop/src/auth.ts). Every response is JSON with a `status`
 * field the client switches on.
 */
import type { Env } from './env.js';
import { signJwt, verifyJwt, verifyPassword, sha256Hex } from './crypto.js';
import { findUserByUsername, createUser } from './users.js';
import {
  checkSession,
  deleteSession,
  getSession,
  putSession,
  rotateRefreshToken,
  startSession,
  userIdFromRefreshToken,
} from './sessions.js';
import { parseUa, versionLt, type DeviceUa } from './ua.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const accessTtl = (env: Env): number => Number(env.ACCESS_TTL_SECONDS) || 900;
const refreshTtl = (env: Env): number => Number(env.REFRESH_TTL_SECONDS) || 2_592_000;

function versionInfo(env: Env): { latestVersion?: string; downloadUrl?: string } {
  const out: { latestVersion?: string; downloadUrl?: string } = {};
  if (env.LATEST_VERSION) out.latestVersion = env.LATEST_VERSION;
  if (env.DOWNLOAD_URL) out.downloadUrl = env.DOWNLOAD_URL;
  return out;
}

/** Reject clients below MIN_VERSION (the desktop maps this to its "upgrade" modal). */
function upgradeRequired(env: Env, device: DeviceUa): boolean {
  return !!env.MIN_VERSION && versionLt(device.version, env.MIN_VERSION);
}

/* ---------- POST /api/crif/auth/login ---------- */

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const device = parseUa(req.headers.get('x-vidyasetu-ua'));
  if (!device) return json({ status: 'invalid-credentials' }, 400);

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) return json({ status: 'invalid-credentials' }, 401);

  const user = await findUserByUsername(env.DB, username);
  // Verify against a real-looking hash even when the user is missing, to avoid a
  // username-enumeration timing side-channel.
  const DUMMY = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY);
  if (!user || !ok) return json({ status: 'invalid-credentials' }, 401);
  if (user.status !== 'active') return json({ status: 'company-suspended' }, 403);

  if (upgradeRequired(env, device)) {
    return json({ status: 'upgrade-required', minVersion: env.MIN_VERSION, ...versionInfo(env) }, 426);
  }

  // Create a fresh session, EVICTING any prior one (single device per user).
  const { session, refreshToken } = await startSession(env.SESSIONS, {
    userId: user.user_id,
    companyId: user.company_id,
    device,
    ttlSeconds: refreshTtl(env),
  });
  const token = await signJwt(
    { sub: user.user_id, sid: session.sid, cid: user.company_id, dev: device.deviceId },
    env.JWT_SECRET,
    accessTtl(env),
  );

  return json({
    status: 'ok',
    token,
    refreshToken,
    user: { user_id: user.user_id, username: user.username, company_id: user.company_id },
    ...versionInfo(env),
  });
}

/* ---------- GET /api/crif/session (heartbeat) ---------- */

export async function handleSession(req: Request, env: Env): Promise<Response> {
  const device = parseUa(req.headers.get('x-vidyasetu-ua'));
  if (!device) return json({ status: 'unauthenticated' }, 401);

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const payload = bearer ? await verifyJwt(bearer, env.JWT_SECRET) : null;
  if (!payload) return json({ status: 'unauthenticated' }, 401);

  if (upgradeRequired(env, device)) {
    return json({ status: 'upgrade-required', ...versionInfo(env) }, 426);
  }

  const session = await getSession(env.SESSIONS, payload.sub);
  const verdict = checkSession(session, payload.sid, device.deviceId);
  if (verdict !== 'ok') {
    // 'revoked' = logged in on another device; 'device-mismatch' = different device.
    return json({ status: 'session-revoked', reason: verdict }, 401);
  }

  // Touch lastSeen (best-effort; keeps the TTL rolling on the active device).
  session!.lastSeen = Math.floor(Date.now() / 1000);
  await putSession(env.SESSIONS, session!, refreshTtl(env));

  return json({ ok: true, status: 'ok', ...versionInfo(env) });
}

/* ---------- POST /api/crif/auth/refresh ---------- */

export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const device = parseUa(req.headers.get('x-vidyasetu-ua'));
  if (!device) return json({ status: 'unauthenticated' }, 401);

  const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
  const refreshToken = String(body.refreshToken ?? '');
  const userId = userIdFromRefreshToken(refreshToken);
  if (!userId) return json({ status: 'unauthenticated' }, 401);

  const session = await getSession(env.SESSIONS, userId);
  // Must match the user's CURRENT session's refresh hash (rotation invalidates old ones)…
  if (!session || session.refreshHash !== (await sha256Hex(refreshToken))) {
    return json({ status: 'session-revoked' }, 401);
  }
  // …and come from the SAME device the session is bound to.
  if (session.deviceId !== device.deviceId) {
    return json({ status: 'session-revoked', reason: 'device-mismatch' }, 401);
  }

  // Rotate the refresh token (single-use), keeping the same sid/device.
  const rotatedRefresh = await rotateRefreshToken(env.SESSIONS, session, device, refreshTtl(env));
  const token = await signJwt(
    { sub: session.userId, sid: session.sid, cid: session.companyId, dev: device.deviceId },
    env.JWT_SECRET,
    accessTtl(env),
  );
  return json({ status: 'ok', token, refreshToken: rotatedRefresh, ...versionInfo(env) });
}

/* ---------- POST /api/crif/auth/logout ---------- */

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
  const refreshToken = String(body.refreshToken ?? '');
  const userId = userIdFromRefreshToken(refreshToken);
  if (userId) {
    const session = await getSession(env.SESSIONS, userId);
    if (session && session.refreshHash === (await sha256Hex(refreshToken))) {
      await deleteSession(env.SESSIONS, userId);
    }
  }
  return json({ status: 'ok' });
}

/* ---------- POST /api/crif/admin/users (provisioning) ---------- */

export async function handleAdminCreateUser(req: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ status: 'disabled' }, 404);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token !== env.ADMIN_TOKEN) return json({ status: 'forbidden' }, 403);

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    companyId?: string;
    userId?: string;
  };
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const companyId = String(body.companyId ?? '').trim();
  if (!username || password.length < 8 || !companyId) {
    return json({ status: 'invalid', message: 'username, companyId and a password (>=8 chars) are required' }, 400);
  }
  if (await findUserByUsername(env.DB, username)) return json({ status: 'exists' }, 409);

  const created: { userId?: string } = {};
  if (body.userId) created.userId = body.userId;
  const userId = await createUser(env.DB, { username, password, companyId, ...created });
  return json({ status: 'ok', user: { user_id: userId, username, company_id: companyId } }, 201);
}
