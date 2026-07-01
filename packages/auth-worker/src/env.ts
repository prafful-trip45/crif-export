/**
 * Minimal Cloudflare binding types + the Worker `Env`.
 *
 * We declare just the slice of the KV / D1 APIs this Worker uses so the package
 * type-checks under the repo's shared tsconfig WITHOUT pulling in
 * `@cloudflare/workers-types` (which isn't a repo dependency).
 */

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface D1Result<T> {
  results: T[];
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  /** D1 database holding provisioned user accounts. */
  DB: D1Database;
  /** KV namespace holding the ONE active session per user. */
  SESSIONS: KVNamespace;
  /** HMAC secret for signing/verifying access JWTs (set via `wrangler secret put`). */
  JWT_SECRET: string;

  /** Version gate + config (from wrangler `vars`). */
  MIN_VERSION?: string;
  LATEST_VERSION?: string;
  DOWNLOAD_URL?: string;
  ACCESS_TTL_SECONDS?: string;
  REFRESH_TTL_SECONDS?: string;

  /**
   * Shared secret required to call the admin user-provisioning endpoint
   * (`POST /api/crif/admin/users`). Set via `wrangler secret put ADMIN_TOKEN`.
   * If unset, the admin endpoint is disabled.
   */
  ADMIN_TOKEN?: string;
}
