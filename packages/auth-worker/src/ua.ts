/**
 * The desktop client sends its device identity in a custom header:
 *   x-vidyasetu-ua: crif-{platform}/{os}/{deviceId}/{appVersion}/{schema}
 * e.g. "crif-macos/na/inst-a1b2c3d4e5f6g7h8/0.1.1/1"
 *
 * The stable, per-install `deviceId` is our device signal — we bind a session to it
 * and reject requests whose device differs (the "no same user on two devices" rule).
 */

export interface DeviceUa {
  raw: string;
  platform: string;
  os: string;
  deviceId: string;
  version: string;
}

export function parseUa(raw: string | null): DeviceUa | null {
  if (!raw) return null;
  const value = raw.trim();
  // crif-{platform}/{os}/{deviceId}/{version}/{schema}
  const m = /^crif-([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(value);
  if (!m) return null;
  const deviceId = m[3]!.trim();
  if (!deviceId) return null;
  return { raw: value, platform: m[1]!, os: m[2]!, deviceId, version: m[4]! };
}

/** The identity we bind a session to. Two requests are the "same device" iff equal. */
export function deviceKey(ua: DeviceUa): string {
  return ua.deviceId;
}

/** Semver-ish "a < b" for the version gate. Missing/garbage sorts as 0.0.0. */
export function versionLt(a: string, b: string): boolean {
  const parse = (v: string) => (v || '').split('.').map((n) => Number(n) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
