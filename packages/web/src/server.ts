/**
 * Local web portal for crif-export.
 *
 * A tiny zero-dependency Node HTTP server wrapping the same `core` engine the CLI
 * uses. It supports BOTH input modes the user requested:
 *   1. Local folder path — the browser sends a server-side filesystem path; the
 *      server reads the .xlsx from disk (only a local server can do this).
 *   2. Drag-drop / file picker — the browser uploads the .xlsx bytes directly.
 *
 * Run with: npm run web  (defaults to http://localhost:4317)
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { convert } from '../../core/src/core/pipeline.js';
import type { FileMeta, FormatId } from '../../core/src/core/types.js';
import { getFormat, listFormats } from '../../core/src/formats/index.js';
import { PAGE_HTML } from './page.js';

const PORT = Number(process.env.PORT ?? 4317);

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      return send(res, 200, 'text/html', PAGE_HTML);
    }
    if (req.method === 'GET' && req.url === '/api/formats') {
      return json(res, 200, { formats: listFormats() });
    }
    if (req.method === 'POST' && req.url === '/api/resolve-folder') {
      const body = await readBody(req);
      const { folder } = JSON.parse(body);
      return json(res, 200, { files: listXlsx(folder) });
    }
    if (req.method === 'POST' && req.url === '/api/convert') {
      return await handleConvert(req, res);
    }
    return send(res, 404, 'text/plain', 'Not found');
  } catch (err) {
    return json(res, 500, { error: (err as Error).message });
  }
});

async function handleConvert(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const body = await readBody(req);
  const payload = JSON.parse(body) as {
    formatId: FormatId;
    memberId: string;
    memberName?: string;
    password?: string;
    reportingDate?: string; // DDMMYYYY
    creationDate?: string;
    allowWarnings?: boolean;
    // exactly one of these:
    filePath?: string; // server-side path (folder mode)
    fileBase64?: string; // uploaded bytes (drag-drop mode)
  };

  const format = getFormat(payload.formatId);
  const buf = payload.fileBase64
    ? Buffer.from(payload.fileBase64, 'base64')
    : readFileSync(payload.filePath!);

  const meta: FileMeta = {
    memberId: payload.memberId,
    memberName: payload.memberName,
    password: payload.password,
    reportingDate: parseDate(payload.reportingDate),
    creationDate: parseDate(payload.creationDate),
  };

  const result = await convert(buf, format, meta, { allowWarnings: payload.allowWarnings });
  return json(res, 200, {
    ok: result.report.ok,
    counts: result.counts,
    issues: result.report.issues,
    extension: format.outputExtension,
    // base64 so the browser can offer a download
    outputBase64: result.output ? result.output.toString('base64') : null,
  });
}

function listXlsx(folder: string): string[] {
  const st = statSync(folder); // throws if missing → 500 with message
  if (!st.isDirectory()) return [folder];
  return readdirSync(folder)
    .filter((f) => extname(f).toLowerCase() === '.xlsx')
    .map((f) => join(folder, f));
}

function parseDate(s?: string): Date {
  if (!s) return new Date();
  return new Date(Date.UTC(+s.slice(4, 8), +s.slice(2, 4) - 1, +s.slice(0, 2)));
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: import('node:http').ServerResponse, code: number, type: string, body: string) {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}
function json(res: import('node:http').ServerResponse, code: number, obj: unknown) {
  send(res, code, 'application/json', JSON.stringify(obj));
}

server.listen(PORT, () => {
  console.log(`crif-export portal → http://localhost:${PORT}`);
});
