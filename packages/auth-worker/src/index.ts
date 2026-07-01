/**
 * CRIF Auth Worker — login + single-device session validation for the desktop app.
 *
 * Implements the `/api/crif/*` contract the desktop client already speaks
 * (packages/desktop/src/auth.ts). Enforces ONE active session per user, bound to the
 * device's `x-vidyasetu-ua` identity: a second login anywhere evicts the first, and a
 * request from a different device is rejected. See README.md and the crif-auth plan.
 */
import type { Env } from './env.js';
import {
  handleAdminCreateUser,
  handleLogin,
  handleLogout,
  handleRefresh,
  handleSession,
} from './handlers.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-vidyasetu-ua',
  'access-control-max-age': '86400',
};

const withCors = (res: Response): Response => {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
};

type Route = { method: string; path: string; handler: (req: Request, env: Env) => Promise<Response> };
const ROUTES: Route[] = [
  { method: 'POST', path: '/api/crif/auth/login', handler: handleLogin },
  { method: 'GET', path: '/api/crif/session', handler: handleSession },
  { method: 'POST', path: '/api/crif/auth/refresh', handler: handleRefresh },
  { method: 'POST', path: '/api/crif/auth/logout', handler: handleLogout },
  { method: 'POST', path: '/api/crif/admin/users', handler: handleAdminCreateUser },
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return withCors(new Response(JSON.stringify({ ok: true, service: 'crif-auth' }), {
        headers: { 'content-type': 'application/json' },
      }));
    }

    if (!env.JWT_SECRET) {
      return withCors(
        new Response(JSON.stringify({ status: 'unreachable', message: 'server not configured (JWT_SECRET missing)' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    const route = ROUTES.find((r) => r.path === url.pathname);
    if (!route) return withCors(new Response(JSON.stringify({ status: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
    if (route.method !== req.method) {
      return withCors(new Response(JSON.stringify({ status: 'method-not-allowed' }), { status: 405, headers: { 'content-type': 'application/json' } }));
    }

    try {
      return withCors(await route.handler(req, env));
    } catch (err) {
      return withCors(
        new Response(JSON.stringify({ status: 'error', message: String((err as Error)?.message ?? err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
  },
};
