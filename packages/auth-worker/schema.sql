-- CRIF Auth Worker — D1 schema.
-- Apply locally:   npx wrangler d1 execute crif-auth --local --file=packages/auth-worker/schema.sql
-- Apply remote:    npx wrangler d1 execute crif-auth        --file=packages/auth-worker/schema.sql

CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  company_id    TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2$<iters>$<saltB64url>$<hashB64url>
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended'
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

-- Optional: append-only login audit (device history). Not required by the auth flow.
CREATE TABLE IF NOT EXISTS login_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  device_ua  TEXT NOT NULL,
  at         INTEGER NOT NULL
);
