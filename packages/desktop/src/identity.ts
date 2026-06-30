/**
 * Per-install device identity for the `x-vidyasetu-ua` header.
 *
 * `desktopId` is generated once and persisted (localStorage survives across
 * launches in the Tauri webview), mirroring the mobile app's stable device id
 * (`inst-…`, see backend middleware/deviceContext.ts). The user's company/user
 * identity is NOT kept here — it comes from the server-signed login token.
 */
const DESKTOP_ID_KEY = 'crif-desktop-id';

export interface Identity {
  desktopId: string;
  platform: string;
}

export function platformTag(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'desktop';
}

function getOrCreateDesktopId(): string {
  let id = '';
  try {
    id = localStorage.getItem(DESKTOP_ID_KEY) || '';
  } catch {
    /* storage unavailable */
  }
  if (!id) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    id = `inst-${rand}`;
    try {
      localStorage.setItem(DESKTOP_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export function getIdentity(): Identity {
  return { desktopId: getOrCreateDesktopId(), platform: platformTag() };
}
