/**
 * DEPRECATED — superseded by `auth.ts` (authenticated heartbeat).
 *
 * The version gate is now part of the authenticated session: login and the
 * `/api/crif/session` heartbeat both enforce the minimum version, keyed off the
 * server-signed token rather than an encrypted header. Kept as an empty module so
 * any stale import doesn't break the build.
 */
export {};
