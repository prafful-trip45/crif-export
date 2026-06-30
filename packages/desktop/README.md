# CRIF Export — Desktop app (macOS + Windows)

A native desktop GUI for `crif-export`, built with **Tauri v2**. It is a 4th
front-end over the shared [`core`](../core) engine — alongside the
[CLI](../cli), the [local web portal](../web), and the [Cloudflare worker](../worker).

## How it's wired (important)

The conversion runs **entirely in the webview** — there is no Rust/Node backend
doing the work. The frontend (Vite + TypeScript) bundles `core` directly and
calls the same `convert()` everything else uses. The Rust shell only provides:

- native **open / save dialogs** and **filesystem** access (`tauri-plugin-dialog`,
  `tauri-plugin-fs`), and
- the app window.

```
  src/main.ts ──imports──▶ core/convert()   (runs in WKWebView / WebView2)
       │                        ▲
       │ Tauri plugins          │  Buffer/zlib via vite-plugin-node-polyfills
       ▼                        │  (+ src/polyfills.ts sets the globals)
  native file dialogs ──────────┘
```

Because `core` uses Node's `Buffer` (and ExcelJS needs `zlib`/`stream`), the
webview gets those via `vite-plugin-node-polyfills` for the modules and
[`src/polyfills.ts`](src/polyfills.ts) for the `Buffer`/`process` globals. See
[`vite.config.ts`](vite.config.ts) for the `.js→.ts` resolver that lets Vite
consume the engine's ESM-style source imports.

**Privacy:** the workbook never leaves the machine. Files are read and written
only at paths the user explicitly picks. This is the product's differentiator
vs. hosted credit-bureau converters.

## Prerequisites

- **Node** 18+ and **npm**
- **Rust** (stable) — install via <https://rustup.rs>
- Platform toolchain:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** "Desktop development with C++" (MSVC) + the WebView2 runtime
    (preinstalled on Windows 10/11)

## Develop

```bash
cd packages/desktop
npm install
npm run tauri:dev      # launches the app window with hot-reload
```

`npm run dev` alone serves the UI in a normal browser (handy for quick UI work);
folder mode and native save are disabled there and fall back to an `<input>`
picker + object-URL download.

## Build installers

```bash
npm run tauri:build              # release build for the current OS
npm run tauri:build -- --debug   # faster, unoptimized build for testing
```

Output lands in `src-tauri/target/release/bundle/`:

| OS | Artifacts |
|----|-----------|
| macOS | `macos/CRIF Export.app`, `dmg/CRIF Export_<ver>_<arch>.dmg` |
| Windows | `nsis/CRIF Export_<ver>_x64-setup.exe`, `msi/CRIF Export_<ver>_x64_en-US.msi` |

> **You cannot cross-compile a Windows `.exe` from macOS** (and vice-versa).
> Build each OS on its own machine, or use CI (below).

## Cross-platform releases via CI

[`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml)
builds macOS (Apple Silicon + Intel) and Windows on their native runners.

- **Tag a release:** `git tag desktop-v0.1.0 && git push --tags` → installers are
  attached to a **draft GitHub Release**.
- **Manual run:** trigger `desktop-release` from the Actions tab → installers are
  uploaded as **workflow artifacts**.

## Code signing (later)

Unsigned builds run but show OS warnings. To ship cleanly:

- **macOS:** Apple Developer ID cert + notarization — set `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` in CI; Tauri notarizes during bundling.
- **Windows:** code-signing cert via `tauri.conf.json > bundle.windows.certificateThumbprint`
  (or Azure Trusted Signing).

These hook into the same workflow; left unset for now.

## Auth, versioning & licensing

Users sign in with a username + password provisioned per company at onboarding.
The **Vidyasetu backend** (EduBridge-TS) authenticates them and returns
**server-signed JWTs** (access + refresh). Because the signing secret never
leaves the server, a tampered client cannot forge a valid session — identity and
subscription are **tamper-proof**. Borrower data still never leaves the device.

**Policy — FAIL-CLOSED (mandatory internet).** The app refuses to run offline or
in the background. The Generate button is blocked and a modal is shown until a
live, authenticated, current session is confirmed **while the window is in the
foreground**. The client (`main.ts` `evaluateGate`) re-checks on a 30s timer, on
`online`/`offline` events, and on Page-Visibility/focus changes; any heartbeat
failure → "Internet connection required" modal until connectivity returns. (This
is a deliberate trade of the offline convenience for strict enforcement.)

### Endpoints (`/api/crif/*`, public — no Vidyasetu JWT)
| Endpoint | Purpose |
|---|---|
| `POST /auth/login` | `{username,password}` → `at` + `rt`; enforces version + single session |
| `POST /auth/refresh` | `{refreshToken}` → new `at`/`rt` if the session still lives |
| `POST /auth/logout` | revoke the session |
| `GET /session` | authenticated heartbeat — re-checks version + that this is the current session |

The app also sends `x-vidyasetu-ua` = `crif-<platform>/<os>/<desktopId>/<version>/<build>`
(mirrors the mobile app's `deviceContext`).

### The guarantees
- **Tamper-proof identity** — JWTs signed with `CRIF_JWT_SECRET` (server-only),
  `aud: crif-desktop`. A forged token fails verification (covered by tests).
- **No multiple sessions** — login calls `deleteAllForUser` then mints one
  session; the token's `sid` must still exist, so a login anywhere logs the user
  out everywhere else (caught on the next heartbeat → `401 session-revoked`).
- **5–10 users per company** — enforced at provisioning (`CRIF_MAX_USERS_HARD_CAP`,
  default 10; per-company `max_users` in `crif_company_licenses`).
- **Minimum version** — `426 upgrade-required` at login/heartbeat; floor lives in
  `crif_app_config` (→ `CRIF_MIN_DESKTOP_VERSION` env), changeable without a release.

Mongo collections (shared DB): `crif_users` (login accounts, bcrypt hashes),
`crif_sessions` (one active session per user), `crif_company_licenses`
(per-company seats + status), `crif_app_config` (min/latest version),
`crif_desktop_seats` (device audit).

### Onboarding a company (generate credentials)
From the backend (EduBridge-TS):
```bash
DB_NAME=edubridge_prod MONGO_URL=... \
  npm run crif:provision -- --company co_acme --name "Acme Finance" --count 5
```
Creates the licence + N user accounts with strong random passwords, prints them
and writes `crif-credentials-co_acme.csv` to hand to the customer. Passwords are
bcrypt-hashed in the DB and **cannot be recovered** afterwards. `--count` is
capped at `CRIF_MAX_USERS_HARD_CAP` (10).

### One-time backend setup (Vidyasetu env / Secret Manager)
```bash
CRIF_JWT_SECRET=<random 32+ char secret>     # falls back to JWT_SECRET if unset
CRIF_MIN_DESKTOP_VERSION=0.1.0
CRIF_LATEST_DESKTOP_VERSION=0.1.0
CRIF_DOWNLOAD_URL=https://…/download
CRIF_DEFAULT_MAX_USERS_PER_COMPANY=5
CRIF_MAX_USERS_HARD_CAP=10
```
App side — `packages/desktop/.env`:
```bash
VITE_LICENSE_SERVER_URL=https://api.vidyasetu.net   # the Vidyasetu API origin
```
Raise a company's seats live by upserting `crif_company_licenses`; raise the
version floor live by upserting `crif_app_config`; suspend a company by setting
its licence `status: suspended`; revoke a user by setting `crif_users.status:
suspended` (they're blocked at next login/refresh).

> Note: the desktop runs offline, so a determined attacker who patches the binary
> can still bypass client-side checks — inherent to any offline app. The
> server-signed tokens make the *legitimate* path unforgeable; the strongest
> additional lever (planned) is shipping CRIF spec/validation updates through the
> authenticated channel, so a cracked copy silently produces rejected files.

### Cutting a release
```bash
npm run release:patch     # or release:minor / release:major
git push origin HEAD --follow-tags   # tag desktop-v* → CI builds mac + windows
```
`release:*` bumps `package.json` + `tauri.conf.json` + `Cargo.toml` in lockstep,
commits, and tags `desktop-v<version>`. After shipping, bump
`CRIF_MIN_DESKTOP_VERSION` (or the `crif_app_config` doc) to force old clients to
update.

## Icons

App icons are generated from `icons/source.png`:

```bash
npm run icons     # tauri icon icons/source.png -> src-tauri/icons/*
```

`icons/source.png` is a generated placeholder
([`scripts/make-icon-source.mjs`](scripts/make-icon-source.mjs)). Drop in real
1024×1024 artwork and re-run.
