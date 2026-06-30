#!/usr/bin/env bash
#
# build-installers.sh — produce the macOS .dmg and (on Windows) the .exe/.msi
# installers for "CIC - Text and TUDF converter", and optionally reinstall the
# freshly built .app into /Applications on macOS.
#
# WHY a wrapper instead of plain `tauri build`:
#   * Tauri's `bundle_dmg.sh` fails if a previous run left a temp read-write DMG
#     mounted (Error: "Resource busy" / "failed to run bundle_dmg.sh"). This
#     script detaches any stale CIC images and clears temp rw.*.dmg files first.
#   * It prints exactly where each artifact landed.
#
# CROSS-PLATFORM NOTE (read this):
#   Tauri Windows installers (NSIS .exe / WiX .msi) are produced by the Windows
#   toolchain and are NOT reliably cross-compilable from macOS/Linux. Run this
#   script ON WINDOWS (Git Bash / WSL with the MSVC toolchain) to get the
#   Windows installers, and ON macOS to get the .dmg. The recommended way to get
#   both from one place is the GitHub Actions matrix (see the heredoc this script
#   can emit with `--print-ci`).
#
# USAGE:
#   ./scripts/build-installers.sh            # build native installer(s) for THIS OS
#   ./scripts/build-installers.sh --reinstall  # macOS: also copy the .app to /Applications
#   ./scripts/build-installers.sh --print-ci   # print a ready-to-use GitHub Actions workflow
#
set -euo pipefail

# --- locate the desktop package (this script lives in packages/desktop/scripts) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DESKTOP_DIR"

APP_NAME="CIC - Text and TUDF converter"
BUNDLE_DIR="src-tauri/target/release/bundle"
OS="$(uname -s)"

REINSTALL=0
PRINT_CI=0
for arg in "$@"; do
  case "$arg" in
    --reinstall) REINSTALL=1 ;;
    --print-ci)  PRINT_CI=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# --print-ci: emit a GitHub Actions workflow that builds BOTH installers and
# exit. This is the only reliable way to get mac + windows artifacts together.
# ---------------------------------------------------------------------------
if [[ "$PRINT_CI" == 1 ]]; then
  cat <<'YAML'
# .github/workflows/build-installers.yml
name: Build installers
on: { workflow_dispatch: {}, push: { tags: ['v*'] } }
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest    # produces the .dmg (universal/aarch64)
          - os: windows-latest  # produces the NSIS .exe and WiX .msi
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install dependencies
        run: npm ci
      - name: Build the Tauri app + installers
        working-directory: packages/desktop
        run: npm run tauri:build
      - uses: actions/upload-artifact@v4
        with:
          name: installers-${{ matrix.os }}
          path: |
            packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg
            packages/desktop/src-tauri/target/release/bundle/nsis/*.exe
            packages/desktop/src-tauri/target/release/bundle/msi/*.msi
YAML
  exit 0
fi

# ---------------------------------------------------------------------------
# macOS: clear any stale mounted CIC DMG so bundle_dmg.sh can run cleanly.
# ---------------------------------------------------------------------------
clean_stale_dmg() {
  [[ "$OS" == "Darwin" ]] || return 0
  echo "› clearing any stale mounted DMGs…"
  # NOTE: this runs under `set -euo pipefail`, so each pipeline below ends in
  # `|| true` — `grep`/`awk` returning non-zero (no match) is normal here and
  # must not abort the build.
  # Detach every attached image whose path mentions the app name.
  local devs
  devs="$(hdiutil info 2>/dev/null | awk '
    /\/dev\/disk/ {dev=$1}
    /image-path/ && (/CIC/ || /Text and TUDF/) {print dev}
  ' | sort -u || true)"
  if [[ -n "$devs" ]]; then
    while read -r dev; do
      [[ -n "$dev" ]] && { echo "  detaching $dev"; hdiutil detach "$dev" -force >/dev/null 2>&1 || true; }
    done <<<"$devs"
  fi
  # Detach by mounted volume name too.
  local vols
  vols="$(ls /Volumes 2>/dev/null | grep -iE 'CIC|Text and TUDF' || true)"
  if [[ -n "$vols" ]]; then
    while read -r vol; do
      [[ -n "$vol" ]] && hdiutil detach "/Volumes/$vol" -force >/dev/null 2>&1 || true
    done <<<"$vols"
  fi
  # Delete leftover temp rw images.
  find "$BUNDLE_DIR/macos" -maxdepth 1 -name 'rw.*.dmg' -delete 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Build.
# ---------------------------------------------------------------------------
build_macos() {
  clean_stale_dmg
  echo "› building macOS .dmg (+ .app)…"
  # `--bundles app,dmg` is explicit so we don't trip on unrelated targets.
  npm run tauri:build -- --bundles app,dmg
}

build_windows() {
  echo "› building Windows installers (.exe NSIS + .msi WiX)…"
  npm run tauri:build -- --bundles nsis,msi
}

case "$OS" in
  Darwin) build_macos ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) build_windows ;;
  Linux)
    echo "✗ Linux host: cannot build the macOS .dmg or Windows installers here." >&2
    echo "  Run on macOS for the .dmg, on Windows for the .exe/.msi, or use --print-ci." >&2
    exit 1 ;;
  *) echo "✗ unsupported OS: $OS" >&2; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Report artifacts.
# ---------------------------------------------------------------------------
echo
echo "› artifacts:"
found=0
for sub in dmg nsis msi macos; do
  d="$BUNDLE_DIR/$sub"
  [[ -d "$d" ]] || continue
  while IFS= read -r f; do
    [[ -e "$f" ]] || continue
    printf '   %s  (%s)\n' "$f" "$(du -h "$f" 2>/dev/null | cut -f1)"
    found=1
  done < <(find "$d" -maxdepth 1 -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.msi' \) 2>/dev/null)
done
[[ "$found" == 1 ]] || echo "   (no installer artifacts found — check the build output above)"

# ---------------------------------------------------------------------------
# macOS reinstall: copy the freshly built .app into /Applications.
# ---------------------------------------------------------------------------
if [[ "$REINSTALL" == 1 && "$OS" == "Darwin" ]]; then
  APP="$BUNDLE_DIR/macos/$APP_NAME.app"
  if [[ -d "$APP" ]]; then
    echo
    echo "› reinstalling to /Applications…"
    rm -rf "/Applications/$APP_NAME.app"
    cp -R "$APP" "/Applications/"
    echo "   installed: /Applications/$APP_NAME.app"
  else
    echo "✗ --reinstall: built .app not found at $APP" >&2
  fi
fi

echo
echo "✓ done."
