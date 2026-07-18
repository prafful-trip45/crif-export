#!/usr/bin/env bash
#
# crif-logs.sh — read the desktop app's licence-gate traffic from the Vidyasetu backend
# (EduBridge-TS `/api/crif/*`, Cloud Run service `edubridge-api`).
#
# This is the log you want whenever a customer says "it won't let me log in" / "it says my
# session expired" / "Generate is greyed out". Every desktop login, session check, refresh
# and logout lands here.
#
# HOW TO READ IT (the status code IS the diagnosis):
#   200  ok                   login/session accepted
#   401  invalid-credentials  wrong username/password — OR the app is pointed at a DIFFERENT
#                             backend than the one the user was provisioned on (see below)
#   401  session-revoked      signed in on another device (single-session), or logged out
#   403  company-suspended    the company licence is suspended
#   426  upgrade-required     app version is below the min-version floor
#   204  (OPTIONS)            CORS preflight — normal, ignore
#
# NOTE — the classic false alarm: a user on an OLD app build is still pointed at the RETIRED
# Cloudflare worker, so their login never reaches Vidyasetu at all. It fails there with
# "invalid username or password" while THIS log stays silent (or shows a clean 200 from
# someone else). If a user reports a login failure and you see NO 401 here, they are almost
# certainly on a stale build — have them install the current one.
#
# USAGE
#   ./scripts/crif-logs.sh                 # last 2h, all /api/crif traffic
#   ./scripts/crif-logs.sh 24h             # last 24h
#   ./scripts/crif-logs.sh 7d --logins     # logins only
#   ./scripts/crif-logs.sh 1h --errors     # failures only (4xx/5xx)
#   ./scripts/crif-logs.sh 6h --sessions   # who is signed in right now (queries Mongo)
#   ./scripts/crif-logs.sh 2h --raw        # full JSON entries (for anything unusual)
#
# Requires: gcloud (authenticated, project vidyasetu-4545).

set -euo pipefail

PROJECT="vidyasetu-4545"
SERVICE="edubridge-api"
REGION="asia-south1"

FRESHNESS="${1:-2h}"
[[ "$FRESHNESS" == --* ]] && FRESHNESS="2h"   # allow `crif-logs.sh --errors`
MODE="${2:-${1:-}}"
[[ "$MODE" != --* ]] && MODE=""

BASE="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""

case "$MODE" in
  --logins)   FILTER="$BASE AND httpRequest.requestUrl:\"/api/crif/auth/login\" AND httpRequest.requestMethod=\"POST\"" ;;
  --errors)   FILTER="$BASE AND httpRequest.requestUrl:\"/api/crif\" AND httpRequest.status>=400" ;;
  --raw)      FILTER="$BASE AND httpRequest.requestUrl:\"/api/crif\"" ;;
  --sessions) FILTER="" ;;
  *)          FILTER="$BASE AND httpRequest.requestUrl:\"/api/crif\" AND httpRequest.requestMethod!=\"OPTIONS\"" ;;
esac

# --- who is signed in right now (live Mongo, not logs) -----------------------
# crif_sessions holds at most ONE row per user (single-session). This answers "is the
# customer actually logged in, and on which machine?" — which the request log cannot.
if [[ "$MODE" == "--sessions" ]]; then
  EB="${EDUBRIDGE_DIR:-$HOME/Desktop/Work/EduBridge-TS}/backend"
  [[ -d "$EB" ]] || { echo "✗ EduBridge-TS backend not found at $EB (set EDUBRIDGE_DIR)" >&2; exit 1; }
  echo "› active desktop sessions (crif_sessions, edubridge_prod):"
  cat > "$EB/.tmp-crif-sessions.cjs" <<'JS'
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(process.env.MONGO_URL);
  await c.connect();
  const rows = await c.db(process.env.DB_NAME).collection('crif_sessions')
    .find({}, { projection: { _id: 0, user_id: 1, company_id: 1, desktop_id: 1, platform: 1, app_version: 1, last_seen_at: 1 } })
    .sort({ last_seen_at: -1 }).toArray();
  console.table(rows);
  console.log(rows.length ? '' : '(nobody is signed in)');
  await c.close();
})();
JS
  ( cd "$EB" && MONGO_URL="$(gcloud secrets versions access latest --secret=MONGO_URL --project "$PROJECT")" \
      DB_NAME=edubridge_prod node .tmp-crif-sessions.cjs )
  rm -f "$EB/.tmp-crif-sessions.cjs"
  exit 0
fi

# --- request log -------------------------------------------------------------
echo "› $SERVICE /api/crif — last $FRESHNESS ${MODE:+($MODE)}"
echo

if [[ "$MODE" == "--raw" ]]; then
  gcloud logging read "$FILTER" --project "$PROJECT" --freshness="$FRESHNESS" --limit=50 --format=json
  exit 0
fi

gcloud logging read "$FILTER" \
  --project "$PROJECT" \
  --freshness="$FRESHNESS" \
  --limit=100 \
  --format="value(timestamp, httpRequest.status, httpRequest.requestMethod, httpRequest.requestUrl, httpRequest.remoteIp)" \
  | awk -F'\t' '
      BEGIN { printf "%-22s %-5s %-6s %-28s %s\n", "TIME (UTC)", "CODE", "VERB", "PATH", "CLIENT IP" }
      {
        # strip the host so the path is readable
        path = $4; sub(/^https?:\/\/[^\/]+/, "", path)
        printf "%-22s %-5s %-6s %-28s %s\n", substr($1,1,19), $2, $3, path, $5
      }'

echo
echo "  200=ok  401=bad creds / revoked session  403=suspended  426=upgrade required"
echo "  No 401s but a user reports \"invalid username or password\"? They are on an OLD build"
echo "  still pointed at the retired Cloudflare worker — reinstall the current app."
