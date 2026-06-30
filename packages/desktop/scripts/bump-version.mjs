/**
 * Bump the desktop app version in lockstep across all three manifests that must
 * agree (Tauri reads the version from tauri.conf.json; the runtime reads it via
 * getVersion(); Cargo needs its own copy):
 *
 *   - package.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml   ([package] version)
 *
 * Usage:
 *   node scripts/bump-version.mjs patch        # 0.1.0 -> 0.1.1
 *   node scripts/bump-version.mjs minor        # 0.1.0 -> 0.2.0
 *   node scripts/bump-version.mjs major        # 0.1.0 -> 1.0.0
 *   node scripts/bump-version.mjs 1.4.2         # set explicitly
 *
 * Importable: release.mjs reuses readCurrentVersion/nextVersion/applyVersion.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const FILES = {
  pkg: join(root, 'package.json'),
  tauriConf: join(root, 'src-tauri', 'tauri.conf.json'),
  cargo: join(root, 'src-tauri', 'Cargo.toml'),
};

export function readCurrentVersion() {
  return JSON.parse(readFileSync(FILES.pkg, 'utf8')).version;
}

export function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+([-+].*)?$/.test(bump)) return bump; // explicit version
  const [maj, min, pat] = current.split(/[-+]/)[0].split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump "${bump}" — use major | minor | patch | x.y.z`);
}

export function applyVersion(version) {
  // package.json
  const pkg = JSON.parse(readFileSync(FILES.pkg, 'utf8'));
  pkg.version = version;
  writeFileSync(FILES.pkg, JSON.stringify(pkg, null, 2) + '\n');

  // tauri.conf.json
  const conf = JSON.parse(readFileSync(FILES.tauriConf, 'utf8'));
  conf.version = version;
  writeFileSync(FILES.tauriConf, JSON.stringify(conf, null, 2) + '\n');

  // Cargo.toml — replace ONLY the [package] version (not rust-version, not deps).
  const cargo = readFileSync(FILES.cargo, 'utf8');
  const replaced = cargo.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
    `$1${version}$2`,
  );
  if (replaced === cargo) throw new Error('Could not find [package] version in Cargo.toml');
  writeFileSync(FILES.cargo, replaced);

  return version;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: bump-version.mjs <major|minor|patch|x.y.z>');
    process.exit(1);
  }
  const current = readCurrentVersion();
  const version = nextVersion(current, arg);
  applyVersion(version);
  console.log(`bumped ${current} -> ${version}`);
  console.log('updated: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml');
}
