# Licence gate — operations runbook

Everything you need when a customer says *"it won't let me in"*, when you onboard a new
company, or when you ship a release: reading the logs, provisioning users, freeing a stuck
seat, and raising the version floor.

---

## The one-minute mental model

The desktop app is **offline for conversion** — borrower data never leaves the machine. The
only thing that goes online is the **licence gate**: who you are, whether your company's
licence is active, and whether your app version is still supported.

That gate is served by the **Vidyasetu backend** — the `/api/crif/*` routes in the
**EduBridge-TS** repo, running on **Cloud Run** (`edubridge-api`, project `vidyasetu-4545`,
region `asia-south1`) against **MongoDB** (`edubridge_prod`). Public URL:
**`https://api.vidyasetu.net`**.

Two rules drive almost every support question:

- **Single session per user.** A login anywhere deletes the previous session. The evicted
  machine finds out on its next Generate click: it shows a *"session ended — signed in on
  another device"* toast and drops to the login screen.
- **The session is only checked on the CTAs** (Generate / Validate / Retry), never on a
  timer. An idle window can sit signed-in-looking for a while; it cannot produce a file.

> **The Cloudflare `crif-auth` worker is RETIRED.** It is still deployed and still answers,
> which is exactly what makes it dangerous — see [Failure modes](#failure-modes). Never point
> an app at it again.

**Where things live**

| Thing | Where |
|---|---|
| Gate routes | `EduBridge-TS/backend/src/routes/crif.ts` |
| Users | Mongo `crif_users` (username, bcrypt hash, company, status) |
| Sessions | Mongo `crif_sessions` — **at most one row per user** |
| Company licence | Mongo `crif_company_licenses` (`status: active \| suspended`) |
| Version floor | Mongo `crif_app_config`, `_id: 'desktop'` |
| App points here | `packages/desktop/.env` → `VITE_LICENSE_SERVER_URL` (gitignored!) |
| CI points here | GitHub secret `VITE_LICENSE_SERVER_URL` |

---

## Reading the logs

Use [`scripts/crif-logs.sh`](../scripts/crif-logs.sh). It needs `gcloud`, authenticated on
project `vidyasetu-4545`.

```bash
./scripts/crif-logs.sh                 # last 2h of /api/crif traffic
./scripts/crif-logs.sh 24h             # any window: 30m, 12h, 7d
./scripts/crif-logs.sh 12h --logins    # logins only
./scripts/crif-logs.sh 12h --errors    # failures only (4xx / 5xx)
./scripts/crif-logs.sh --sessions      # who is signed in RIGHT NOW, on which machine
./scripts/crif-logs.sh 2h --raw        # full JSON entries
```

**The status code is the diagnosis:**

| Code | Meaning | What to do |
|---|---|---|
| `200` | Accepted | Nothing — it worked |
| `401 invalid-credentials` | Wrong username/password | Re-issue credentials, or suspect a stale build (below) |
| `401 session-revoked` | Signed in on another device, or logged out | Expected under single-session. Have them sign in again |
| `403 company-suspended` | Company licence suspended | Reactivate the `crif_company_licenses` row |
| `426 upgrade-required` | App below the min-version floor | They must install the current build |
| `204` on `OPTIONS` | CORS preflight | Normal. Ignore |

`--sessions` reads Mongo rather than the request log, because the log **cannot** tell you who
is currently signed in. It prints `user_id`, `company_id`, `desktop_id`, platform, app version
and `last_seen_at`.

Raw one-liner, if you'd rather not use the script:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="edubridge-api" AND httpRequest.requestUrl:"/api/crif"' \
  --project vidyasetu-4545 --freshness=12h --limit=50 \
  --format="value(timestamp,httpRequest.status,httpRequest.requestMethod,httpRequest.requestUrl)"
```

---

## Failure modes

### "Invalid username or password" — but the logs show no 401

**This is the most likely support ticket, and the credentials are fine.** The user is on an
**old app build** still pointed at the retired Cloudflare worker. Their login never reaches
Vidyasetu, so this log stays silent while the worker rejects them — the new usernames simply
don't exist in its database.

*Diagnosis:* a user reports a login failure **and** `./scripts/crif-logs.sh 24h --errors`
shows no matching 401. *Fix:* have them install the current build.

Confirm it directly — this returns `401 invalid-credentials` from the **worker** while the
same credentials return `200` from Vidyasetu:

```bash
curl -s -X POST https://crif-auth.praffulla-tripathi.workers.dev/api/crif/auth/login \
  -H 'content-type: application/json' -H 'x-vidyasetu-ua: crif-windows/na/probe/0.2.2/1' \
  -d '{"username":"finguru-01","password":"<their password>"}'
```

### "Cannot reach the licence server"

The request is being blocked before it lands, or the app has no backend baked in.

- **CORS.** The backend allowlists only `tauri://localhost`, `http(s)://tauri.localhost` and
  `http://localhost:1420` (`EduBridge-TS/backend/src/config.ts`). The packaged app is fine.
  **Testing the renderer in a browser on any other port produces this exact error** — run the
  dev server on **port 1420**.
- **No gate baked in.** If `VITE_LICENSE_SERVER_URL` was empty at build time the app runs
  with *no login at all* rather than erroring. Check a build with:
  `grep -r api.vidyasetu.net packages/desktop/dist`

### Generate is greyed out / the app says it's offline

The session check failed and the app soft-gated. Check `--errors`. Historically this was
caused by the backend 500-ing under Cloudflare KV's write quota — that whole class of failure
is gone with the move to Mongo.

### A user is locked out of their own seat

Someone else (or a test login) took the single session. Sign in again on the right machine —
that evicts the other. To free a seat by hand, delete the row (see below).

---

## Provisioning a new company

Run from `EduBridge-TS/backend`. This writes **straight to production Mongo**.

```bash
cd ~/Desktop/Work/EduBridge-TS/backend
TS_NODE_TRANSPILE_ONLY=1 \
  MONGO_URL="$(gcloud secrets versions access latest --secret=MONGO_URL --project vidyasetu-4545)" \
  DB_NAME=edubridge_prod \
  yarn crif:provision --company co_acme --name "Acme Finance" --count 5 --prefix acme
```

- Usernames come out as `{prefix}-01 … -0N`; passwords are strong random, **printed once**
  and written to a gitignored `crif-credentials-<company>.csv`. They are bcrypt-hashed in the
  DB and **cannot be recovered** — capture them at creation.
- Re-running is idempotent (existing usernames are skipped), capped at 10 users.
- `TS_NODE_TRANSPILE_ONLY=1` is required: an unrelated workspace type (`@vidyasetu/aapi-models`)
  is stale and fails the typecheck.

**Current tenant:** Finguru = company `co_finguru`, users `finguru-01 … finguru-05`.

> ⚠️ **Never test more than one account at a time.** Logging in as a user evicts whoever
> holds that seat — including the live customer. Verifying all five credentials once kicked
> the customer out mid-session.

---

## Direct Mongo operations

There is **no admin HTTP endpoint** for these — suspension and seat-freeing are direct DB
writes. Pattern (run from `EduBridge-TS/backend` so `mongodb` resolves):

```bash
cd ~/Desktop/Work/EduBridge-TS/backend
cat > .tmp-op.cjs <<'EOF'
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(process.env.MONGO_URL);
  await c.connect();
  const db = c.db(process.env.DB_NAME);

  // --- pick one ---

  // Who is signed in?
  console.table(await db.collection('crif_sessions').find({}).toArray());

  // Free a stuck seat (forces re-login; does NOT delete the user)
  // await db.collection('crif_sessions').deleteMany({ user_id: 'cu_…' });

  // Suspend / reactivate a company (login then returns 403 company-suspended)
  // await db.collection('crif_company_licenses').updateOne({ company_id: 'co_acme' }, { $set: { status: 'suspended' } });

  // Disable one user
  // await db.collection('crif_users').updateOne({ username: 'acme-03' }, { $set: { status: 'suspended' } });

  await c.close();
})();
EOF
MONGO_URL="$(gcloud secrets versions access latest --secret=MONGO_URL --project vidyasetu-4545)" \
  DB_NAME=edubridge_prod node .tmp-op.cjs
rm -f .tmp-op.cjs
```

---

## The version gate (forcing an upgrade)

Lives in Mongo `crif_app_config` `{_id: 'desktop'}` and **overrides env**, so the floor can be
raised **with no redeploy**:

| Field | Effect |
|---|---|
| `minVersion` | Below this → `426 upgrade-required`, app is hard-blocked behind the "Update required" modal |
| `latestVersion` | Shown in that modal |
| `downloadUrl` | Where the modal sends them (`https://cic.vidyasetu.net/download`) |

**Order matters.** Publish the installer at `downloadUrl` *first*, then raise `minVersion` —
otherwise you hard-block users behind a dead link. Bump `latestVersion` on release; raise
`minVersion` only when you need to force everyone off an old build.

---

## Releasing a build

```bash
cd packages/desktop
node scripts/bump-version.mjs 0.2.3      # keeps package.json + tauri.conf.json + Cargo.toml in lockstep
npm run installers                       # macOS → .dmg  (Windows box → .exe + .msi)
```

The script writes `.env` (defaulting to `https://api.vidyasetu.net`), installs deps, and —
crucially — **aborts if the login gate isn't in the built bundle**. Without that check a
clone with no `.env` silently ships an app with **no login at all**, and the build still
reports success.

**A Mac cannot build the Windows `.exe`** — the NSIS/WiX bundlers are Windows-native and
Tauri doesn't support cross-compiling them. Use CI:

```bash
gh workflow run desktop-release.yml --ref <branch>
gh run download <run-id> --dir dist-installers/<version>   # .exe + .msi + both .dmg
```

CI bakes the backend URL from the GitHub secret **`VITE_LICENSE_SERVER_URL`** — *not* from your
local `.env`. If you ever move backends again, **update that secret**, or CI will keep shipping
apps pointed at the old one. (The workflow fails the build if the URL is missing entirely, but
it cannot tell a *wrong* URL from a right one.)

---

## Known gaps

- **No device binding on the session check.** `crifAuth.ts` verifies the session still exists
  but not that the caller is the machine it was issued to, so a copied access token works from
  another machine until the next login. A fix is written but **uncommitted and undeployed** —
  it needs a Cloud Run deploy of `edubridge-api`, which also serves the mobile app.
- **Seat/device caps are not enforced.** `crifSeatService` is built but wired to no route, so
  `max_users` / `max_desktops` do nothing at runtime. Single-session is the real limit.
- **No admin API.** Suspension and seat management are direct Mongo writes (above).
