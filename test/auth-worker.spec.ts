import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  sha256Hex,
  randomToken,
} from '../packages/auth-worker/src/crypto.js';
import { parseUa, versionLt } from '../packages/auth-worker/src/ua.js';
import { checkSession, type SessionRecord } from '../packages/auth-worker/src/sessions.js';
import { createUser } from '../packages/auth-worker/src/users.js';
import {
  handleLogin,
  handleSession,
  handleRefresh,
  handleLogout,
} from '../packages/auth-worker/src/handlers.js';
import type { Env, D1Database, KVNamespace } from '../packages/auth-worker/src/env.js';

/* ---------- in-memory bindings ---------- */

class MiniKV implements KVNamespace {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

function miniD1(users: Record<string, unknown>[]): D1Database {
  return {
    prepare(q: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first<T>() {
          if (q.includes('WHERE username = ?')) return (users.find((u) => u.username === args[0]) ?? null) as T | null;
          if (q.includes('WHERE user_id = ?')) return (users.find((u) => u.user_id === args[0]) ?? null) as T | null;
          return null;
        },
        async run() {
          if (q.startsWith('INSERT INTO users')) {
            users.push({
              user_id: args[0],
              username: args[1],
              company_id: args[2],
              password_hash: args[3],
              status: args[4],
              created_at: args[5],
            });
          }
          return { success: true };
        },
        async all<T>() {
          return { results: users as T[], success: true };
        },
      };
      return stmt;
    },
  };
}

function makeEnv(): { env: Env; users: Record<string, unknown>[] } {
  const users: Record<string, unknown>[] = [];
  const env: Env = {
    DB: miniD1(users),
    SESSIONS: new MiniKV(),
    JWT_SECRET: 'test-secret-please-change',
    MIN_VERSION: '0.1.0',
    ACCESS_TTL_SECONDS: '900',
    REFRESH_TTL_SECONDS: '2592000',
  };
  return { env, users };
}

const UA = (device: string, version = '0.1.1') => `crif-macos/na/${device}/${version}/1`;
const req = (method: string, headers: Record<string, string>, body?: unknown) =>
  new Request('https://auth.test/', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/* ---------- crypto ---------- */

describe('crypto', () => {
  it('PBKDF2 password hash round-trips and rejects the wrong password', async () => {
    const hash = await hashPassword('S3cretPass!');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('S3cretPass!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('HS256 JWT verifies, and rejects tampering + expiry', async () => {
    const now = 1_000_000;
    const token = await signJwt({ sub: 'u1', sid: 's1' }, 'secret', 900, now);
    const ok = await verifyJwt(token, 'secret', now + 10);
    expect(ok?.sub).toBe('u1');
    expect(await verifyJwt(token, 'secret', now + 1000)).toBeNull(); // expired
    expect(await verifyJwt(token, 'other-secret', now + 10)).toBeNull(); // bad signature
    expect(await verifyJwt(token + 'x', 'secret', now + 10)).toBeNull(); // tampered
  });

  it('sha256Hex is stable and randomToken is unique', async () => {
    expect(await sha256Hex('abc')).toBe(await sha256Hex('abc'));
    expect(randomToken()).not.toBe(randomToken());
  });
});

/* ---------- ua ---------- */

describe('ua', () => {
  it('parses the device UA header', () => {
    const ua = parseUa('crif-macos/na/inst-abc123/0.1.1/1');
    expect(ua).toMatchObject({ platform: 'macos', deviceId: 'inst-abc123', version: '0.1.1' });
    expect(parseUa('garbage')).toBeNull();
    expect(parseUa(null)).toBeNull();
  });

  it('compares versions', () => {
    expect(versionLt('0.1.0', '0.1.1')).toBe(true);
    expect(versionLt('0.1.1', '0.1.1')).toBe(false);
    expect(versionLt('0.2.0', '0.1.9')).toBe(false);
  });
});

/* ---------- session decision (pure) ---------- */

describe('checkSession', () => {
  const base: SessionRecord = {
    sid: 'sid-1',
    userId: 'u1',
    companyId: 'c1',
    deviceId: 'devA',
    deviceUa: UA('devA'),
    refreshHash: 'h',
    createdAt: 0,
    lastSeen: 0,
  };
  it('accepts the current session on the same device', () => {
    expect(checkSession(base, 'sid-1', 'devA')).toBe('ok');
  });
  it('rejects a stale sid (logged in elsewhere) and a different device', () => {
    expect(checkSession(null, 'sid-1', 'devA')).toBe('no-session');
    expect(checkSession(base, 'sid-OLD', 'devA')).toBe('revoked');
    expect(checkSession(base, 'sid-1', 'devB')).toBe('device-mismatch');
  });
});

/* ---------- full flow: single device + User-Agent enforcement ---------- */

describe('auth flow — one active session per user, bound to the device', () => {
  it('login → heartbeat → second-device login evicts first → UA mismatch rejected → refresh → logout', async () => {
    const { env } = makeEnv();
    await createUser(env.DB, { username: 'alice', password: 'S3cretPass!', companyId: 'c1' });

    // Device A logs in.
    const loginA = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        username: 'alice',
        password: 'S3cretPass!',
      }),
      env,
    );
    expect(loginA.status).toBe(200);
    const a = (await loginA.json()) as { status: string; token: string; refreshToken: string };
    expect(a.status).toBe('ok');

    // Heartbeat on device A → ok.
    const hbA1 = await handleSession(
      req('GET', { authorization: `Bearer ${a.token}`, 'x-vidyasetu-ua': UA('devA') }),
      env,
    );
    expect(hbA1.status).toBe(200);
    expect((await hbA1.json()).ok).toBe(true);

    // Wrong password is rejected.
    const bad = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        username: 'alice',
        password: 'nope',
      }),
      env,
    );
    expect(bad.status).toBe(401);
    expect((await bad.json()).status).toBe('invalid-credentials');

    // Device B logs in as the same user → evicts A's session.
    const loginB = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devB'), 'content-type': 'application/json' }, {
        username: 'alice',
        password: 'S3cretPass!',
      }),
      env,
    );
    const b = (await loginB.json()) as { token: string; refreshToken: string };

    // A's old token now fails (session-revoked); B's token works.
    const hbA2 = await handleSession(
      req('GET', { authorization: `Bearer ${a.token}`, 'x-vidyasetu-ua': UA('devA') }),
      env,
    );
    expect(hbA2.status).toBe(401);
    expect((await hbA2.json()).status).toBe('session-revoked');

    const hbB1 = await handleSession(
      req('GET', { authorization: `Bearer ${b.token}`, 'x-vidyasetu-ua': UA('devB') }),
      env,
    );
    expect((await hbB1.json()).ok).toBe(true);

    // B's token presented from a DIFFERENT device (UA) → rejected (User-Agent binding).
    const hbWrongUa = await handleSession(
      req('GET', { authorization: `Bearer ${b.token}`, 'x-vidyasetu-ua': UA('devC') }),
      env,
    );
    expect(hbWrongUa.status).toBe(401);
    expect((await hbWrongUa.json()).reason).toBe('device-mismatch');

    // Refresh on device B rotates the refresh token (old one becomes invalid).
    const refresh = await handleRefresh(
      req('POST', { 'x-vidyasetu-ua': UA('devB'), 'content-type': 'application/json' }, {
        refreshToken: b.refreshToken,
      }),
      env,
    );
    const r = (await refresh.json()) as { status: string; token: string; refreshToken: string };
    expect(r.status).toBe('ok');
    expect(r.refreshToken).not.toBe(b.refreshToken);

    const reuseOld = await handleRefresh(
      req('POST', { 'x-vidyasetu-ua': UA('devB'), 'content-type': 'application/json' }, {
        refreshToken: b.refreshToken,
      }),
      env,
    );
    expect(reuseOld.status).toBe(401); // rotated → old refresh rejected

    // Logout removes the session; the new access token then fails.
    await handleLogout(
      req('POST', { 'content-type': 'application/json' }, { refreshToken: r.refreshToken }),
      env,
    );
    const hbAfterLogout = await handleSession(
      req('GET', { authorization: `Bearer ${r.token}`, 'x-vidyasetu-ua': UA('devB') }),
      env,
    );
    expect(hbAfterLogout.status).toBe(401);
  });

  it('blocks a client below MIN_VERSION with upgrade-required', async () => {
    const { env } = makeEnv();
    await createUser(env.DB, { username: 'bob', password: 'S3cretPass!', companyId: 'c1' });
    const res = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA', '0.0.9'), 'content-type': 'application/json' }, {
        username: 'bob',
        password: 'S3cretPass!',
      }),
      env,
    );
    expect(res.status).toBe(426);
    expect((await res.json()).status).toBe('upgrade-required');
  });
});
