/**
 * Desktop authentication against the Vidyasetu backend (`/api/crif/auth/*`).
 *
 * Users log in with a provisioned username + password; the backend returns
 * server-signed JWTs (access + refresh). We store them locally and send the
 * access token as `Authorization: Bearer` on the session check. Because the tokens
 * are signed by a server-only secret, a tampered client cannot forge a valid
 * session — identity/subscription is tamper-proof. SINGLE-SESSION is enforced
 * server-side: logging in elsewhere revokes this session, which we discover on
 * the next check (→ toast + forced back to the login screen).
 *
 * `checkSession()` runs on the CTAs that matter (Generate / Validate / Retry), NOT on a
 * timer. A background poll bought nothing — an idle window can't leak data — while costing
 * a request per user per tick. Verifying at the moment of use is both cheaper and STRICTER:
 * a revoked or downlevel client is stopped before it can produce a submission file.
 *
 * This module just reports status; the FAIL-CLOSED policy lives in main.ts
 * (evaluateGate). `checkSession()` returns `'unreachable'` on any network error,
 * which the gate treats as a hard block — the app requires a live connection to generate.
 */
import { getIdentity } from './identity';

const SERVER = import.meta.env.VITE_LICENSE_SERVER_URL;
const K_AT = 'crif-at';
const K_RT = 'crif-rt';
const K_USER = 'crif-user';

export interface LoginResult {
  status: 'ok' | 'invalid-credentials' | 'company-suspended' | 'upgrade-required' | 'unreachable';
  user?: { user_id: string; username: string; company_id: string };
  minVersion?: string;
  latestVersion?: string;
  downloadUrl?: string;
}

export interface SessionCheckResult {
  status: 'ok' | 'upgrade-required' | 'session-revoked' | 'unauthenticated' | 'unreachable';
  latestVersion?: string;
  downloadUrl?: string;
}

export function serverConfigured(): boolean {
  return !!SERVER;
}
export function isAuthenticated(): boolean {
  return !!read(K_AT);
}
export function currentUser(): LoginResult['user'] | null {
  try {
    return JSON.parse(read(K_USER) || 'null');
  } catch {
    return null;
  }
}

export async function login(username: string, password: string, version: string): Promise<LoginResult> {
  if (!SERVER) return { status: 'unreachable' };
  try {
    const res = await fetch(urlOf('/api/crif/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vidyasetu-ua': ua(version) },
      body: JSON.stringify({ username, password }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok && body.status === 'ok' && body.token) {
      save(body.token, body.refreshToken, body.user);
      return { status: 'ok', user: body.user };
    }
    if (body.status === 'upgrade-required') {
      return { status: 'upgrade-required', minVersion: body.minVersion, latestVersion: body.latestVersion, downloadUrl: body.downloadUrl };
    }
    if (body.status === 'company-suspended') return { status: 'company-suspended' };
    return { status: 'invalid-credentials' };
  } catch {
    return { status: 'unreachable' };
  }
}

/**
 * Ask the server whether THIS device still holds the user's session (and is on a supported
 * version). Called from the CTAs — never on a timer. On a 401 we try a single token refresh
 * before concluding the session is gone, so an expired access token doesn't read as a revoke.
 */
export async function checkSession(version: string): Promise<SessionCheckResult> {
  if (!SERVER) return { status: 'ok' };
  const at = read(K_AT);
  if (!at) return { status: 'unauthenticated' };
  try {
    let res = await fetch(urlOf('/api/crif/session'), {
      headers: { authorization: `Bearer ${at}`, 'x-vidyasetu-ua': ua(version) },
    });
    if (res.status === 401) {
      // Access token expired/invalid — try a refresh once.
      const refreshed = await tryRefresh(version);
      if (!refreshed) {
        clear();
        return { status: 'session-revoked' };
      }
      res = await fetch(urlOf('/api/crif/session'), {
        headers: { authorization: `Bearer ${read(K_AT)}`, 'x-vidyasetu-ua': ua(version) },
      });
    }
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 426) {
      return { status: 'upgrade-required', latestVersion: body.latestVersion, downloadUrl: body.downloadUrl };
    }
    if (res.ok && body.ok) return { status: 'ok' };
    if (res.status === 401) {
      clear();
      return { status: 'session-revoked' };
    }
    return { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' }; // offline → fail open
  }
}

/**
 * Sign out. Asks the server to delete the session — which frees the user's single seat, so
 * the account immediately stops counting as in use and they can sign in on any device.
 * We send BOTH credentials: the access token (always current) and the refresh token (which
 * rotates, so our copy may be stale). The server revokes if either one matches.
 *
 * Local tokens are cleared regardless of the outcome — a device that can't reach the server
 * must still be able to sign itself out. In that case the server-side session lingers until
 * its TTL, but the next successful login evicts it anyway (single-session).
 */
export async function logout(): Promise<void> {
  const at = read(K_AT);
  const rt = read(K_RT);
  try {
    if (SERVER && (at || rt)) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (at) headers.authorization = `Bearer ${at}`;
      await fetch(urlOf('/api/crif/auth/logout'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken: rt ?? '' }),
      });
    }
  } catch {
    /* best effort — we still clear locally below */
  }
  clear();
}

async function tryRefresh(version: string): Promise<boolean> {
  const rt = read(K_RT);
  if (!rt) return false;
  try {
    const res = await fetch(urlOf('/api/crif/auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vidyasetu-ua': ua(version) },
      body: JSON.stringify({ refreshToken: rt }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok && body.status === 'ok' && body.token) {
      save(body.token, body.refreshToken, currentUser());
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---- storage + helpers -----------------------------------------------------
function ua(version: string): string {
  const id = getIdentity();
  // EduBridge shape: Platform/OSVersion/DeviceId/AppVersion/AppBuild
  return `crif-${id.platform}/na/${id.desktopId}/${version}/1`;
}
function urlOf(path: string): string {
  return new URL(path, SERVER).toString();
}
function save(token: string, refreshToken: string, user: unknown) {
  try {
    localStorage.setItem(K_AT, token);
    localStorage.setItem(K_RT, refreshToken);
    if (user) localStorage.setItem(K_USER, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}
function clear() {
  try {
    [K_AT, K_RT, K_USER].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
