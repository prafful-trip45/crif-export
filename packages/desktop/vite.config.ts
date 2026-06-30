import { defineConfig, type Plugin } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { readFileSync } from 'node:fs';

// Browser-dev fallback for the app version (the Tauri shell uses getVersion()).
// Kept in lockstep with tauri.conf.json/Cargo.toml by scripts/bump-version.mjs.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * The shared `core` engine is authored in ESM-TypeScript style: its relative
 * imports carry a `.js` extension (e.g. `import { x } from './engine.js'`) even
 * though the files on disk are `.ts`. `tsc` (bundler resolution) and `tsx` map
 * `.js -> .ts` transparently; Vite/esbuild does NOT. This tiny resolver does the
 * same `.js -> .ts` rewrite, but ONLY for relative source imports — never for
 * bare/`node_modules` specifiers (so ExcelJS's own internal `.js` files are left
 * alone).
 */
function jsToTsResolve(): Plugin {
  return {
    name: 'crif-js-to-ts-resolve',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      if (importer.includes('node_modules')) return null;
      const resolved = await this.resolve(source.slice(0, -3) + '.ts', importer, { skipSelf: true });
      return resolved ?? null;
    },
  };
}

/**
 * Strip the `crossorigin` attribute Vite adds to the bundled <script>/<link>
 * tags. In the packaged Tauri app, assets are served over the custom `tauri://`
 * protocol, and a `crossorigin`-flagged request fails the WebView's CORS check —
 * so the CSS and the entry module silently fail to load (the app renders as
 * unstyled raw HTML and no JS runs). Harmless in the browser/dev server. See the
 * Tauri + Vite asset-loading gotcha.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'crif-strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin\b(?:=(?:"[^"]*"|'[^']*'))?/g, '');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    jsToTsResolve(),
    stripCrossorigin(),
    // ExcelJS needs Node builtin MODULES (stream/zlib/util/events — xlsx is a
    // zip). Polyfill those. We deliberately DISABLE the per-file GLOBAL
    // injection (Buffer/process/global): the engine source lives outside this
    // package's node_modules, so an injected `import '.../shims/buffer'` can't
    // resolve from there. Instead `src/polyfills.ts` sets those globals from the
    // real `buffer`/`process` packages before any engine code runs.
    nodePolyfills({
      globals: { Buffer: false, global: false, process: false },
      protocolImports: true,
    }),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkgVersion),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
