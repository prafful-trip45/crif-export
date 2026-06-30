/**
 * Cut a desktop release: bump the version, commit the three manifests, and tag
 * `desktop-v<version>`. Pushing that tag triggers the cross-platform build CI
 * (.github/workflows/desktop-release.yml → macOS + Windows installers).
 *
 *   node scripts/release.mjs patch        # or minor | major | x.y.z
 *
 * Does NOT push — it prints the push command so you stay in control.
 */
import { execSync } from 'node:child_process';
import { readCurrentVersion, nextVersion, applyVersion } from './bump-version.mjs';

const arg = process.argv[2] || 'patch';
const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();

// Refuse to run on a dirty tree — the release commit must contain only the bump.
const dirty = git('status --porcelain');
if (dirty) {
  console.error('✗ Working tree is dirty. Commit or stash your changes first.');
  process.exit(1);
}

const current = readCurrentVersion();
const version = nextVersion(current, arg);
applyVersion(version);

const tag = `desktop-v${version}`;
git('add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
git(`commit -m "desktop: release v${version}"`);
git(`tag ${tag}`);

console.log(`✔ ${current} -> ${version}, committed and tagged ${tag}`);
console.log('\nNext:');
console.log(`  git push origin HEAD --follow-tags     # triggers the macOS + Windows build CI`);
console.log(`  # or build the current OS locally:  npm run tauri:build`);
