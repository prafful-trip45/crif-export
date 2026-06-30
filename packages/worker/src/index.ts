/**
 * Public Cloudflare Worker portal for crif-export.
 *
 * Wraps the same `core` engine the CLI and local portal use, exposed over a Worker
 * `fetch` handler. Differences from the local Node portal:
 *   - drag-drop / upload ONLY (no server-side folder-path reading — unsafe in public),
 *   - HTTP Basic Auth gate (BASIC_AUTH secret, "user:password"),
 *   - runs on the Workers runtime (nodejs_compat supplies Buffer/zlib for ExcelJS).
 */
import { Buffer } from 'node:buffer';
import { convert } from '../../core/src/core/pipeline.js';
import type { FileMeta, FormatId } from '../../core/src/core/types.js';
import { getFormat, listFormats } from '../../core/src/formats/index.js';
import { PAGE_HTML } from './page.js';

interface Env {
  /** "user:password" — required; the site refuses to serve if unset. */
  BASIC_AUTH?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = requireAuth(req, env);
    if (auth) return auth;

    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/formats') {
      return json({ formats: listFormats() });
    }
    if (req.method === 'POST' && url.pathname === '/api/convert') {
      return handleConvert(req);
    }
    return new Response('Not found', { status: 404 });
  },
};

/** Gate every request behind HTTP Basic Auth. */
function requireAuth(req: Request, env: Env): Response | null {
  const expected = env.BASIC_AUTH;
  if (!expected) {
    return new Response('Server not configured (BASIC_AUTH missing).', { status: 503 });
  }
  const header = req.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    if (timingSafeEqual(decoded, expected)) return null;
  }
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="CRIF Export", charset="UTF-8"' },
  });
}

/** Constant-time string compare to avoid leaking the credential via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleConvert(req: Request): Promise<Response> {
  let payload: {
    formatId: FormatId;
    memberId: string;
    memberName?: string;
    password?: string;
    reportingDate?: string; // DDMMYYYY
    creationDate?: string;
    allowWarnings?: boolean;
    report?: boolean;
    fileBase64?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let format;
  try {
    format = getFormat(payload.formatId);
  } catch {
    return json({ error: `Unknown format "${payload.formatId}"` }, 400);
  }

  if (!payload.fileBase64) return json({ error: 'No file uploaded' }, 400);
  const bytes = Buffer.from(payload.fileBase64, 'base64');
  // Hand the engine an ArrayBuffer (ExcelJS.load accepts it).
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const meta: FileMeta = {
    memberId: payload.memberId,
    memberName: payload.memberName,
    password: payload.password,
    reportingDate: parseDate(payload.reportingDate),
    creationDate: parseDate(payload.creationDate),
  };

  try {
    // The multi-sheet .xlsx report uses ExcelJS's workbook WRITER, which hangs on
    // the Workers runtime (the runtime then kills the request → 1101). The reader
    // works, so conversion + the .txt download are fine — only the report is
    // unavailable on the hosted portal. Never invoke it here; the local Node portal
    // and the CLI still produce it.
    const result = await convert(ab, format, meta, {
      allowWarnings: payload.allowWarnings,
      report: false,
    });
    return json({
      ok: result.report.ok,
      counts: result.counts,
      issues: result.report.issues,
      extension: format.outputExtension,
      outputBase64: result.output ? result.output.toString('base64') : null,
      reportBase64: null,
      reportUnavailable: payload.report === true,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
}

function parseDate(s?: string): Date {
  if (!s || !/^\d{8}$/.test(s)) return new Date();
  return new Date(Date.UTC(+s.slice(4, 8), +s.slice(2, 4) - 1, +s.slice(0, 2)));
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
