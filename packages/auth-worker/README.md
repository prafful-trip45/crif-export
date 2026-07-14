# CRIF Auth Worker (`crif-auth`) — ⚠️ RETIRED

> **Superseded (Jul 2026) by the Vidyasetu backend** (`EduBridge-TS`, `/api/crif/*` on
> Cloud Run, `https://api.vidyasetu.net`), which serves the identical contract backed by
> MongoDB. The desktop app points there now (`packages/desktop/.env`).
>
> **Why it was retired:** the session heartbeat rewrote a KV record on every beat, which
> blew Workers KV's free-tier ceiling of **1,000 writes/day**. Past the cap the write 429s,
> the Worker 500s, and the desktop reads that as "offline" — silently **disabling Generate**
> for the customer until the quota reset. Mongo has no such cap, and the Vidyasetu backend
> was always the intended home for this gate (see `docs/ARCHITECTURE_AND_BUSINESS.md`).
>
> Kept for reference only. **Do not redeploy** or point `VITE_LICENSE_SERVER_URL` at it.

Cloudflare Worker that provides **login + session validation** for the desktop app,
enforcing **one active session per user, bound to the device** (User-Agent). It
implements the exact `/api/crif/*` contract the desktop client already speaks
(`packages/desktop/src/auth.ts`), so pointing the desktop at it needs **no client code
change** — just set `VITE_LICENSE_SERVER_URL`.

## Why / what it enforces

- **No same user on two devices.** Sessions live in KV under one key per user
  (`sess:{userId}`). A login *overwrites* that key with a new `sid`, so a second login
  anywhere immediately invalidates the first device — its next 30s heartbeat returns
  `401 session-revoked` and the app drops back to the login screen ("newest device wins").
- **User-Agent binding.** The session records the device id from the
  `x-vidyasetu-ua: crif-{platform}/{os}/{deviceId}/{version}/1` header the client sends.
  Heartbeat / refresh reject any request whose device id differs from the bound one.
- **Tamper-proof identity.** Access tokens are HS256 JWTs signed with a server-only
  `JWT_SECRET`; refresh tokens are opaque and single-use (rotated on every refresh, only
  their hash is stored). Passwords are PBKDF2-SHA256.

## Endpoints

| Method & path | Body / headers | Success | Failure |
|---|---|---|---|
| `POST /api/crif/auth/login` | `{username,password}` + `x-vidyasetu-ua` | `{status:'ok', token, refreshToken, user, latestVersion?, downloadUrl?}` | `invalid-credentials` (401), `company-suspended` (403), `upgrade-required` (426) |
| `GET /api/crif/session` | `Authorization: Bearer <token>` + `x-vidyasetu-ua` | `{ok:true, status:'ok'}` | `unauthenticated`/`session-revoked` (401), `upgrade-required` (426) |
| `POST /api/crif/auth/refresh` | `{refreshToken}` + `x-vidyasetu-ua` | `{status:'ok', token, refreshToken}` | `session-revoked` (401) |
| `POST /api/crif/auth/logout` | `{refreshToken}` | `{status:'ok'}` | — |
| `POST /api/crif/admin/users` | `Authorization: Bearer <ADMIN_TOKEN>` + `{username,password,companyId}` | `201 {status:'ok', user}` | `forbidden` (403), `exists` (409), `disabled` (404 if `ADMIN_TOKEN` unset) |

## Storage

- **D1 `DB`** — provisioned `users` (see `schema.sql`). No self-signup.
- **KV `SESSIONS`** — the single active session per user (`sess:{userId}`), TTL = refresh lifetime.

## Setup

```bash
# 1. Create resources and paste the returned ids into wrangler.jsonc
npx wrangler d1 create crif-auth
npx wrangler kv namespace create SESSIONS

# 2. Schema
npx wrangler d1 execute crif-auth --local --file=packages/auth-worker/schema.sql   # local dev
npx wrangler d1 execute crif-auth          --file=packages/auth-worker/schema.sql   # remote

# 3. Secrets
npx wrangler secret put JWT_SECRET        # long random string
npx wrangler secret put ADMIN_TOKEN       # optional, enables the admin user endpoint

# 4. Seed a user (prints an INSERT + the wrangler command to apply it)
npx tsx packages/auth-worker/src/seed.ts alice 'S3cretPass!' company-001

# 5. Run / deploy (from packages/auth-worker)
npx wrangler dev
npx wrangler deploy
```

Point the desktop app at it: set `VITE_LICENSE_SERVER_URL` in `packages/desktop/.env`
to the worker origin (e.g. `http://127.0.0.1:8787` for `wrangler dev`, or the deployed
custom domain).

## Local end-to-end check

```bash
UA='crif-macos/na/inst-DEVICE-A/0.1.1/1'
BASE=http://127.0.0.1:8787
# login on device A
curl -s $BASE/api/crif/auth/login -H "x-vidyasetu-ua: $UA" \
  -H 'content-type: application/json' -d '{"username":"alice","password":"S3cretPass!"}'
# heartbeat with the returned token -> {"ok":true,...}
curl -s $BASE/api/crif/session -H "authorization: Bearer <TOKEN>" -H "x-vidyasetu-ua: $UA"
# login on device B (different deviceId) evicts A; A's heartbeat now -> 401 session-revoked
# heartbeat with B's token but a THIRD UA -> 401 (device mismatch)
```
