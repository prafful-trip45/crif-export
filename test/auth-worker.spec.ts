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

  it('logs out with only the ACCESS token, even when the refresh token is stale', async () => {
    // The desktop rotates its refresh token on every /refresh, so the copy it holds can
    // lag the server's. Logout must still free the seat — otherwise the account stays
    // "in use" forever and the user is locked out of signing in cleanly elsewhere.
    const { env } = makeEnv();
    await createUser(env.DB, { username: 'carol', password: 'S3cretPass!', companyId: 'c1' });

    const login = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        username: 'carol',
        password: 'S3cretPass!',
      }),
      env,
    );
    const s = (await login.json()) as { token: string; refreshToken: string };

    // Rotate the refresh token server-side; `s.refreshToken` is now STALE.
    const refresh = await handleRefresh(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        refreshToken: s.refreshToken,
      }),
      env,
    );
    const r = (await refresh.json()) as { token: string; refreshToken: string };
    expect(r.refreshToken).not.toBe(s.refreshToken);

    // Log out presenting the access token + the STALE refresh token. The old handler
    // (refresh-hash only) would have no-op'd here and stranded the session in KV.
    const out = await handleLogout(
      req(
        'POST',
        { authorization: `Bearer ${r.token}`, 'content-type': 'application/json' },
        { refreshToken: s.refreshToken },
      ),
      env,
    );
    expect((await out.json()).status).toBe('revoked');

    // Seat is genuinely free: the session record is gone from KV…
    expect((env.SESSIONS as MiniKV).store.size).toBe(0);
    // …and the still-unexpired access token no longer works.
    const hb = await handleSession(
      req('GET', { authorization: `Bearer ${r.token}`, 'x-vidyasetu-ua': UA('devA') }),
      env,
    );
    expect(hb.status).toBe(401);
  });

  it('does not let an already-evicted device revoke the new session', async () => {
    // Device A is evicted by device B. If A then hits logout, it must NOT delete B's
    // session — otherwise a stale client could kick the legitimate user off.
    const { env } = makeEnv();
    await createUser(env.DB, { username: 'dave', password: 'S3cretPass!', companyId: 'c1' });
    const creds = { username: 'dave', password: 'S3cretPass!' };

    const loginA = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, creds),
      env,
    );
    const a = (await loginA.json()) as { token: string; refreshToken: string };

    const loginB = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devB'), 'content-type': 'application/json' }, creds),
      env,
    ); // evicts A
    const b = (await loginB.json()) as { token: string };

    const out = await handleLogout(
      req(
        'POST',
        { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
        { refreshToken: a.refreshToken },
      ),
      env,
    );
    expect((await out.json()).status).toBe('not-found'); // A's credentials are not current

    // B is untouched and still signed in.
    const hbB = await handleSession(
      req('GET', { authorization: `Bearer ${b.token}`, 'x-vidyasetu-ua': UA('devB') }),
      env,
    );
    expect((await hbB.json()).ok).toBe(true);
  });

  it('rotates the session in KV at most once a day, however often it is checked', async () => {
    // KV WRITES are the scarce resource (1,000/day, account-wide, on the free plan) — and
    // exhausting them once took the whole app down. The session check runs on every Generate
    // click, so it must be read-mostly: `lastSeen` is rewritten only after a full day.
    const { env } = makeEnv();
    const kv = env.SESSIONS as MiniKV;
    await createUser(env.DB, { username: 'erin', password: 'S3cretPass!', companyId: 'c1' });

    const login = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        username: 'erin',
        password: 'S3cretPass!',
      }),
      env,
    );
    const s = (await login.json()) as { token: string };

    let writes = 0;
    const realPut = kv.put.bind(kv);
    kv.put = async (k: string, v: string) => {
      writes++;
      return realPut(k, v);
    };

    const beat = () =>
      handleSession(req('GET', { authorization: `Bearer ${s.token}`, 'x-vidyasetu-ua': UA('devA') }), env);

    // A busy day of Generate clicks: lastSeen is fresh, so not one of them writes.
    for (let i = 0; i < 50; i++) expect((await (await beat()).json()).ok).toBe(true);
    expect(writes).toBe(0);

    // Even hours later, still no write — the rotation window is a full DAY.
    // (Erin is the only user, so hers is the only `sess:*` record in KV.)
    const [key, raw] = [...kv.store.entries()][0]!;
    const rec = JSON.parse(raw) as SessionRecord;
    const age = async (seconds: number) => {
      rec.lastSeen = Math.floor(Date.now() / 1000) - seconds;
      await realPut(key, JSON.stringify(rec));
      writes = 0;
    };

    await age(7_200); // 2h
    expect((await (await beat()).json()).ok).toBe(true);
    expect(writes).toBe(0);

    // Past a day → the next check rotates it exactly once.
    await age(86_401);
    expect((await (await beat()).json()).ok).toBe(true);
    expect(writes).toBe(1);
    expect((await (await beat()).json()).ok).toBe(true);
    expect(writes).toBe(1); // freshly touched → no further write
  });

  it('keeps the session valid when the KV touch fails (write quota exhausted)', async () => {
    // The lastSeen write is bookkeeping, not the verdict. When KV refused it (daily put
    // limit exceeded) the handler used to throw → 500 → the client read that as "offline"
    // and disabled Generate. A failed touch must never lock a paying user out.
    const { env } = makeEnv();
    const kv = env.SESSIONS as MiniKV;
    await createUser(env.DB, { username: 'frank', password: 'S3cretPass!', companyId: 'c1' });

    const login = await handleLogin(
      req('POST', { 'x-vidyasetu-ua': UA('devA'), 'content-type': 'application/json' }, {
        username: 'frank',
        password: 'S3cretPass!',
      }),
      env,
    );
    const s = (await login.json()) as { token: string };

    // Age the session so the next check TRIES to write, then make every write fail.
    const [key, raw] = [...kv.store.entries()][0]!;
    const rec = JSON.parse(raw) as SessionRecord;
    rec.lastSeen = Math.floor(Date.now() / 1000) - 86_401;
    await kv.put(key, JSON.stringify(rec));
    kv.put = async () => {
      throw new Error('KV PUT failed: 429 daily limit exceeded');
    };

    const res = await handleSession(
      req('GET', { authorization: `Bearer ${s.token}`, 'x-vidyasetu-ua': UA('devA') }),
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
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
