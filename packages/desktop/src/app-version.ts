/**
 * The app's own version. In the Tauri shell this is the single source of truth
 * from tauri.conf.json (kept in lockstep by scripts/bump-version.mjs); in a plain
 * browser (`vite dev`) it falls back to VITE_APP_VERSION, which vite.config.ts
 * injects from package.json.
 */
export async function getAppVersion(): Promise<string> {
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      /* fall through to the build-time constant */
    }
  }
  return import.meta.env.VITE_APP_VERSION || '0.0.0';
}
