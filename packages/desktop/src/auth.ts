/**
 * Desktop authentication against the Vidyasetu backend (`/api/crif/auth/*`).
 *
 * Users log in with a provisioned username + password; the backend returns
 * server-signed JWTs (access + refresh). We store them locally and send the
 * access token as `Authorization: Bearer` on the heartbeat. Because the tokens
 * are signed by a server-only secret, a tampered client cannot forge a valid
 * session — identity/subscription is tamper-proof. SINGLE-SESSION is enforced
 * server-side: logging in elsewhere revokes this session, which we discover on
 * the next heartbeat (→ forced back to the login screen).
 *
 * This module just reports status; the FAIL-CLOSED policy lives in main.ts
 * (evaluateGate). `heartbeat()` returns `'unreachable'` on any network error,
 * which the gate treats as a hard block — the app requires a live connection and
 * a foreground window to run.
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

export interface HeartbeatResult {
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

export async function heartbeat(version: string): Promise<HeartbeatResult> {
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

export async function logout(): Promise<void> {
  const rt = read(K_RT);
  try {
    if (rt && SERVER) {
      await fetch(urlOf('/api/crif/auth/logout'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
    }
  } catch {
    /* best effort */
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
