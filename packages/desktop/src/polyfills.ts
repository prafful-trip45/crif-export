/**
 * Webview Node-compat globals.
 *
 * The shared `core` engine and ExcelJS expect Node's `Buffer` and `process`
 * globals (an .xlsx is a zip — ExcelJS leans on Buffer/stream/zlib). A webview
 * (WKWebView on macOS, WebView2 on Windows) provides none of these. We set them
 * up here from the real `buffer`/`process` packages, and this module is imported
 * FIRST in `main.ts` so the globals exist before any engine code evaluates.
 *
 * Node builtin *modules* that ExcelJS imports (stream/zlib/util/events) are
 * handled separately by vite-plugin-node-polyfills (see vite.config.ts).
 */
import { Buffer } from 'buffer';
import process from 'process';

const g = globalThis as unknown as {
  Buffer?: unknown;
  global?: unknown;
  process?: unknown;
};

if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) g.process = process;
