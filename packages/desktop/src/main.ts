/**
 * Desktop UI controller.
 *
 * One frame, two panes: the submission setup on the left, a persistent action rail
 * on the right. Running a conversion swaps the rail's Generate section for live
 * pipeline steps and then for the run result; a full-width report view holds the
 * detailed findings tables. The conversion itself runs in-process via `engine.ts`
 * — nothing leaves the machine.
 *
 * File selection + saving go through native OS dialogs (Tauri `dialog`/`fs`
 * plugins). Everything degrades gracefully when opened in a plain browser
 * (`vite dev` without the Tauri shell): the file picker falls back to an
 * <input type=file> and saving falls back to an object-URL download. Folder mode,
 * the traffic lights and "Reveal in folder" are Tauri-only.
 */
import './polyfills'; // MUST be first: sets up Buffer/process before the engine loads.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import {
  runConvert,
  runValidate,
  listFormats,
  getFormat,
  exportIssues,
  type FormatId,
  type ConvertResult,
  type CompareResult,
  type ConvertPhase,
} from './engine';
import type { ValidationIssue } from '../../core/src/core/result';
import { getAppVersion } from './app-version';
import {
  serverConfigured,
  isAuthenticated,
  checkSession,
  login as authLogin,
  logout as authLogout,
  currentUser,
} from './auth';
import { reportingCycleCode } from '../../core/src/formats/commercial-ucrf-flat.js';

const isTauri = '__TAURI_INTERNALS__' in window;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement).value;
const checked = (id: string) => ($(id) as HTMLInputElement).checked;

// ---- state -----------------------------------------------------------------
type Theme = 'dark' | 'light';
type AppMode = 'convert' | 'validate';
type Source = 'file' | 'folder';
type View = 'app' | 'report';
type RailTab = 'generate' | 'results';
type Status = 'idle' | 'running' | 'done';
type Outcome = 'errors' | 'bypassed' | 'success';
type Filter = 'all' | 'errors' | 'warnings';

/** A rule-level grouping of validation issues — the unit the operator acts on. */
interface Group {
  id: string;
  severity: 'error' | 'warning';
  title: string;
  where: string;
  fix: string;
  reference?: string;
  rows: Array<{ row: string; cell: string; value: string }>;
  count: number;
}

/** Everything a completed run produced, plus the inputs it ran with. */
interface Run {
  mode: AppMode;
  convert: ConvertResult;
  compare?: CompareResult;
  outcome: Outcome;
  groups: Group[];
  errorRows: number;
  warningRows: number;
  fileName: string;
  formatId: FormatId;
  formatLabel: string;
  memberId: string;
  memberName: string;
  reportingDate: string;
  cycle: string;
  creationDate: string;
  bypass: boolean;
  report: boolean;
  at: Date;
  durationMs: number;
}

let theme: Theme = 'dark';
let appMode: AppMode = 'convert';
let source: Source = 'file';
let view: View = 'app';
let railTab: RailTab = 'generate';
let status: Status = 'idle';
let step = 0; // 0..5 while running
let run: Run | null = null;
let filter: Filter = 'all';
let open: Record<string, boolean> = {};

// The selected workbook bytes + display name, regardless of how they were picked.
let pickedBytes: ArrayBuffer | null = null;
let pickedName: string | null = null;
let pickedSize = 0;
/** Native path when picked through the OS dialog — lets a re-run re-read from disk. */
let pickedPath: string | null = null;
let folderPath: string | null = null;
// The reference output file the user uploads in Validator mode.
let refBytes: ArrayBuffer | null = null;
let refName: string | null = null;
/** Where the submission file was last saved, for "Reveal in folder". */
let savedPath: string | null = null;

// Set true only when a full-screen gate (login / upgrade) is active.
let blocked = false;
// Connectivity is treated as a SOFT gate: instead of a modal, losing the
// connection just disables the Generate button. Defaults to true (assume online)
// so the app is usable immediately; the real connection is verified by the
// session check the CTAs run.
let online = true;

const STEPS: Array<{ phase: ConvertPhase; label: string }> = [
  { phase: 'reading', label: 'Reading workbook' },
  { phase: 'mapping', label: 'Mapping rows to segments' },
  { phase: 'validating', label: 'Validating against spec' },
  { phase: 'encoding', label: 'Encoding records' },
  { phase: 'writing', label: 'Writing output file' },
];
let stepDetails: string[] = [];

// ---- persistence -----------------------------------------------------------
const PERSIST = ['format', 'memberId', 'memberName', 'reportingDate', 'creationDate'];
const STORE = 'crif-export-desktop-form';
const THEME_STORE = 'crif-export-desktop-theme';
const RUNS_STORE = 'crif-export-desktop-runs';

function saveForm() {
  const data: Record<string, unknown> = {};
  PERSIST.forEach((id) => (data[id] = val(id)));
  data.report = checked('report');
  data.bypassErrors = checked('bypassErrors');
  data.source = source;
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
function loadForm(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

interface RecentRun {
  name: string;
  borrowers: number;
  warnings: number;
  clean: boolean;
  at: number;
}
function loadRecent(): RecentRun[] {
  try {
    const list = JSON.parse(localStorage.getItem(RUNS_STORE) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function pushRecent(entry: RecentRun) {
  try {
    localStorage.setItem(RUNS_STORE, JSON.stringify([entry, ...loadRecent()].slice(0, 10)));
  } catch {
    /* ignore */
  }
}

// ---- theme -----------------------------------------------------------------
function setTheme(t: Theme) {
  theme = t;
  $('root').setAttribute('data-theme', t);
  $('themeToggle').textContent = t === 'light' ? '☾' : '☀';
  try {
    localStorage.setItem(THEME_STORE, t);
  } catch {
    /* ignore */
  }
}

// ---- init ------------------------------------------------------------------
// The legacy V3.9 commercial profile (`commercial-ucrf-flat`) is still registered in
// the engine — it's the base the V3.10 profile is built from and several tests use it —
// but only the current V3.10 commercial option is offered in the UI.
const HIDDEN_FORMATS = new Set<FormatId>(['commercial-ucrf-flat', 'commercial-ucrf']);

function init() {
  setTheme((localStorage.getItem(THEME_STORE) as Theme) === 'light' ? 'light' : 'dark');

  const formats = listFormats().filter((f) => !HIDDEN_FORMATS.has(f.id));
  ($('format') as HTMLSelectElement).innerHTML = formats
    .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.label)}</option>`)
    .join('');

  const saved = loadForm();
  PERSIST.forEach((id) => {
    if (saved[id] != null && id !== 'format') ($(id) as HTMLInputElement).value = saved[id];
  });
  // Only restore a saved format if it's still an offered option (a previously-saved
  // hidden/removed format falls back to the first available one).
  if (saved.format && formats.some((f) => f.id === saved.format))
    ($('format') as HTMLSelectElement).value = saved.format;
  ($('report') as HTMLInputElement).checked = !!saved.report;
  ($('bypassErrors') as HTMLInputElement).checked = !!saved.bypassErrors;

  // Folder mode requires native fs — only offer it inside the desktop shell.
  if (!isTauri) {
    document.querySelector('#sourceTabs [data-mode="folder"]')?.classList.add('hidden');
  }
  setSource(saved.source === 'folder' && isTauri ? 'folder' : 'file');

  PERSIST.concat(['report', 'bypassErrors']).forEach((id) =>
    $(id).addEventListener('change', () => {
      saveForm();
      render();
    }),
  );
  ['memberId', 'memberName', 'format', 'creationDate'].forEach((id) =>
    $(id).addEventListener('input', render),
  );
  wireDatePickers();
  wireWindowControls();

  $('themeToggle').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  document.querySelectorAll<HTMLElement>('#sourceTabs .seg-opt').forEach((t) => {
    t.onclick = () => {
      setSource(t.dataset.mode as Source);
      saveForm();
      render();
    };
  });
  document.querySelectorAll<HTMLElement>('#appTabs .seg-opt').forEach((t) => {
    t.onclick = () => setAppMode(t.dataset.app as AppMode);
  });

  wireFileMode();
  wireFolderMode();
  wireReferenceMode();

  ($('loginSubmit') as HTMLButtonElement).onclick = () => void onLoginSubmit();
  $('loginPass').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void onLoginSubmit();
  });
  ($('connectionRetry') as HTMLButtonElement).onclick = () => void evaluateGate(true);
  ($('logoutBtn') as HTMLButtonElement).onclick = () => void onLogout();

  void getAppVersion().then((v) => ($('appVersion').textContent = `v${v}`));

  setAppMode('convert');
  startGateMonitor();
  void evaluateGate();
}

/** Traffic lights drive the real window (the shell is undecorated). */
function wireWindowControls() {
  const act = (fn: (w: any) => Promise<unknown>) => async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await fn(getCurrentWindow());
  };
  ($('winClose') as HTMLButtonElement).onclick = act((w) => w.close());
  ($('winMin') as HTMLButtonElement).onclick = act((w) => w.minimize());
  ($('winZoom') as HTMLButtonElement).onclick = act((w) => w.toggleMaximize());
}

// ---- mode / source ---------------------------------------------------------
const BLURB: Record<AppMode, string> = {
  convert:
    'Convert customer data in Excel into CRIF Highmark bureau submission files. Nothing leaves this machine.',
  validate:
    'Re-generates from your input workbook and compares it byte-for-byte against a filed submission or CRIF reference file.',
};

function setAppMode(m: AppMode) {
  appMode = m;
  document.querySelectorAll<HTMLElement>('#appTabs .seg-opt').forEach((x) => {
    const on = x.dataset.app === m;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', String(on));
  });
  $('modeBlurb').textContent = BLURB[m];
  document
    .querySelectorAll('.validate-only')
    .forEach((el) => el.classList.toggle('hidden', m !== 'validate'));
  // Switching modes resets the outcome; the form values stay put.
  resetRun();
}

function setSource(s: Source) {
  source = s;
  document
    .querySelectorAll<HTMLElement>('#sourceTabs .seg-opt')
    .forEach((x) => x.classList.toggle('active', x.dataset.mode === s));
  $('modeFile').classList.toggle('hidden', s !== 'file');
  $('modeFolder').classList.toggle('hidden', s !== 'folder');
}

/** Back to a clean slate: no outcome, rail on Generate, setup view. */
function resetRun() {
  run = null;
  status = 'idle';
  step = 0;
  stepDetails = [];
  railTab = 'generate';
  view = 'app';
  savedPath = null;
  open = {};
  filter = 'all';
  render();
}

// ---- auth + connectivity gate ---------------------------------------------
// Full-screen modals are reserved for LOGIN and UPGRADE only. Connectivity is a
// SOFT gate: when offline / the server is unreachable, we simply disable the
// Generate button (see `online` + the CTA) instead of flashing a modal on every
// focus change. The app does NOT block when backgrounded.
//
// The server is asked about the session ONLY on the CTAs — Generate, Validate, and the
// connection Retry button (`evaluateGate(true)`). There is no background heartbeat: an
// idle window cannot produce a file, so polling it bought nothing and cost a request per
// user per tick. Everything else re-evaluates the gate LOCALLY (token present? online?).
type GateReason = 'ok' | 'login' | 'connection' | 'upgrade';
let evaluating = false;

function applyGate(
  reason: GateReason,
  info?: { currentVersion?: string; latestVersion?: string; downloadUrl?: string },
) {
  blocked = reason !== 'ok';
  $('loginOverlay').classList.toggle('hidden', reason !== 'login');
  $('connectionOverlay').classList.toggle('hidden', reason !== 'connection');
  $('upgradeOverlay').classList.toggle('hidden', reason !== 'upgrade');
  if (reason === 'upgrade') {
    $('overlayIcon').textContent = '⤓';
    $('overlayTitle').textContent = 'Update required';
    $('upgradeMsg').textContent = `Your version (${info?.currentVersion ?? ''}) is no longer supported. Please update to ${info?.latestVersion || 'the latest version'} to continue.`;
    const link = $('upgradeLink') as HTMLAnchorElement;
    if (info?.downloadUrl) link.href = info.downloadUrl;
    else link.classList.add('hidden');
  }
  if (reason === 'login') ($('loginUser') as HTMLInputElement).focus();
  renderAccount(reason);
  render();
}

let toastTimer: number | undefined;

/**
 * Transient message pinned above the login overlay (which is why it lives outside it): the
 * one case that must never be silent is a session revoked out from under the user, where
 * the login screen alone looks like the app randomly logged them out.
 */
function showToast(message: string, ms = 6000) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
}

/**
 * The username + Sign out link live in the title bar / toolbar, and are only meaningful
 * while the user is actually signed in and using the app — so they show only when the gate
 * is open ('ok'). On an unconfigured/dev build (no licence server) there is no session to
 * sign out of, so they stay hidden.
 */
function renderAccount(reason: GateReason) {
  const signedIn = serverConfigured() && reason === 'ok' && isAuthenticated();
  ($('accountUser') as HTMLElement).hidden = !signedIn;
  ($('accountDivider') as HTMLElement).hidden = !signedIn;
  ($('logoutBtn') as HTMLElement).hidden = !signedIn;
  if (signedIn) $('accountUser').textContent = currentUser()?.username ?? '';
}

/**
 * Decide what the app may do right now.
 *
 * `verify: false` (the default) is a LOCAL evaluation — do we hold a token, are we online —
 * and touches no network. `verify: true` additionally asks the server whether this device
 * still owns the session and is on a supported version; only the CTAs do that, immediately
 * before the work they gate.
 */
async function evaluateGate(verify = false) {
  if (!serverConfigured()) {
    applyGate('ok'); // dev / unconfigured build: no gating
    return;
  }
  if (evaluating && !verify) return; // event callers coalesce; CTAs always run
  evaluating = true;
  try {
    if (!isAuthenticated()) {
      applyGate('login');
      return;
    }
    // Offline: soft-gate (disable Generate), no modal. Stay on the current view.
    if (!navigator.onLine) {
      online = false;
      applyGate('ok');
      return;
    }
    if (!verify) {
      applyGate('ok'); // signed in + online, as far as we can tell without asking the server
      return;
    }
    const version = await getAppVersion();
    const check = await checkSession(version);
    if (check.status === 'ok') {
      online = true;
      applyGate('ok');
    } else if (check.status === 'upgrade-required') {
      applyGate('upgrade', {
        currentVersion: version,
        latestVersion: check.latestVersion,
        downloadUrl: check.downloadUrl,
      });
    } else if (check.status === 'session-revoked' || check.status === 'unauthenticated') {
      // Signed in on another device (single session per user) — say so, don't just bounce
      // them to a login screen with no explanation.
      applyGate('login');
      showToast('Session ended — your account was signed in on another device. Please sign in again.');
    } else {
      // 'unreachable' — soft-gate (disable Generate), no modal; the next CTA retries.
      online = false;
      applyGate('ok');
    }
  } finally {
    evaluating = false;
  }
}

function startGateMonitor() {
  if (!serverConfigured()) return;
  // Connectivity only — these flip the soft gate locally and never call the server.
  window.addEventListener('online', () => {
    online = true;
    render();
  });
  window.addEventListener('offline', () => {
    online = false;
    render();
  });
}

async function onLoginSubmit() {
  const username = val('loginUser').trim();
  const password = val('loginPass');
  const err = $('loginError');
  err.textContent = '';
  if (!username || !password) {
    err.textContent = 'Enter your username and password.';
    return;
  }
  if (!navigator.onLine) {
    err.textContent = 'No internet connection. Connect and try again.';
    return;
  }
  const btn = $('loginSubmit') as HTMLButtonElement;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Signing in…';
  try {
    const version = await getAppVersion();
    const r = await authLogin(username, password, version);
    if (r.status === 'ok') {
      // Login already confirmed auth + version server-side, so dismiss the overlay
      // directly. (Don't await a second evaluateGate() — its round-trip can be slow
      // or coalesced behind the `evaluating` flag, leaving the button stuck on
      // "Signing in…" and the overlay up.)
      ($('loginPass') as HTMLInputElement).value = '';
      online = true;
      applyGate('ok');
    } else if (r.status === 'upgrade-required') {
      applyGate('upgrade', { currentVersion: version, latestVersion: r.latestVersion, downloadUrl: r.downloadUrl });
    } else if (r.status === 'company-suspended') {
      err.textContent = 'Your organisation’s licence is suspended. Please contact support.';
    } else if (r.status === 'unreachable') {
      err.textContent = 'Cannot reach the licence server. Check your connection and try again.';
    } else {
      err.textContent = 'Invalid username or password.';
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Sign in';
  }
}

/**
 * Sign out: tell the server to DELETE the session (so the seat is freed immediately and
 * the account is no longer counted as in use), clear the local tokens, and drop back to
 * the login overlay. `authLogout()` clears local state even if the network call fails, so
 * we always end up logged out on this device.
 */
async function onLogout() {
  const btn = $('logoutBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Signing out…';
  try {
    await authLogout();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign out';
    ($('loginUser') as HTMLInputElement).value = '';
    ($('loginPass') as HTMLInputElement).value = '';
    $('loginError').textContent = '';
    applyGate('login');
  }
}

// ---- file mode -------------------------------------------------------------
function wireFileMode() {
  const drop = $('drop');
  const input = $('file') as HTMLInputElement;

  drop.onclick = async () => {
    // Native picker in the desktop shell; <input> fallback in a browser.
    if (isTauri) {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (typeof picked === 'string') {
        const bytes = await readFile(picked);
        setPicked(toArrayBuffer(bytes), picked.split(/[\\/]/).pop() || picked, picked);
      }
    } else {
      input.click();
    }
  };

  input.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) setPicked(await f.arrayBuffer(), f.name, null);
  });

  ($('fileReplace') as HTMLButtonElement).onclick = () => {
    pickedBytes = null;
    pickedName = null;
    pickedPath = null;
    pickedSize = 0;
    input.value = '';
    resetRun();
  };

  // HTML5 drag-drop (Tauri's own file-drop is disabled in tauri.conf.json so
  // these events still deliver real File objects to the webview).
  ['dragover', 'drop'].forEach((e) => window.addEventListener(e, (ev) => ev.preventDefault()));
  wireDropTarget(drop, async (f) => setPicked(await f.arrayBuffer(), f.name, null));
}

/** Shared drag-over painting + drop handling for a dashed zone. */
function wireDropTarget(zone: HTMLElement, onFile: (f: File) => void | Promise<void>) {
  ['dragover', 'dragenter'].forEach((e) =>
    zone.addEventListener(e, (ev) => {
      ev.preventDefault();
      zone.classList.add('over');
    }),
  );
  ['dragleave', 'dragend'].forEach((e) => zone.addEventListener(e, () => zone.classList.remove('over')));
  zone.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    zone.classList.remove('over');
    const f = (ev as DragEvent).dataTransfer?.files?.[0];
    if (f) await onFile(f);
  });
}

function setPicked(bytes: ArrayBuffer, name: string, path: string | null) {
  pickedBytes = bytes;
  pickedName = name;
  pickedPath = path;
  pickedSize = bytes.byteLength;
  resetRun();
}

// ---- folder mode -----------------------------------------------------------
function wireFolderMode() {
  ($('chooseFolder') as HTMLButtonElement).onclick = async () => {
    if (!isTauri) return;
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== 'string') return;
    folderPath = dir;
    $('folderPath').textContent = dir;
    const entries = await readDir(dir);
    const xlsx = entries.filter((e) => e.isFile && /\.xlsx$/i.test(e.name));
    const select = $('folderFile') as HTMLSelectElement;
    if (!xlsx.length) {
      select.innerHTML = '<option value="">no .xlsx files in this folder</option>';
    } else {
      const opts = await Promise.all(
        xlsx.map(async (e) => `<option value="${escapeHtml(await join(dir, e.name))}">${escapeHtml(e.name)}</option>`),
      );
      select.innerHTML = opts.join('');
    }
    render();
  };
  $('folderFile').addEventListener('change', () => resetRun());
}

// ---- reference (output) file picker — Validator mode -----------------------
function wireReferenceMode() {
  const drop = $('refDrop');
  const input = $('refFile') as HTMLInputElement;

  drop.onclick = async () => {
    if (isTauri) {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const picked = await openDialog({ multiple: false });
      if (typeof picked === 'string') {
        const bytes = await readFile(picked);
        setRef(toArrayBuffer(bytes), picked.split(/[\\/]/).pop() || picked);
      }
    } else {
      input.click();
    }
  };

  input.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) setRef(await f.arrayBuffer(), f.name);
  });
  wireDropTarget(drop, async (f) => setRef(await f.arrayBuffer(), f.name));
}

function setRef(bytes: ArrayBuffer, name: string) {
  refBytes = bytes;
  refName = name;
  $('refDrop').textContent = `${name} — replace`;
  resetRun();
}

// ---- dates -----------------------------------------------------------------
function toDdmmyyyy(s: string): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim());
  if (!m) return undefined;
  return m[1]!.padStart(2, '0') + m[2]!.padStart(2, '0') + m[3];
}

/** "DD/MM/YYYY" -> "YYYY-MM-DD" (native date input value), or '' if unparseable. */
function toIsoDate(s: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim());
  if (!m) return '';
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

/** "YYYY-MM-DD" (native date input value) -> "DD/MM/YYYY". */
function fromIsoDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Wire a calendar button + native <input type="date"> to a DD/MM/YYYY text input.
 * The text field stays the source of truth (typing still works); the picker just
 * writes a formatted date back into it. `showPicker()` opens the OS calendar.
 */
function wireDatePicker(textId: string, btnId: string, nativeId: string): void {
  const text = $(textId) as HTMLInputElement;
  const btn = $(btnId) as HTMLButtonElement;
  const native = $(nativeId) as HTMLInputElement;
  if (!text || !btn || !native) return;

  const openPicker = () => {
    native.value = toIsoDate(text.value); // seed from whatever's typed
    // showPicker() is the modern API; fall back to focus+click for older shells.
    if (typeof native.showPicker === 'function') {
      try {
        native.showPicker();
        return;
      } catch {
        /* fall through to the click fallback below */
      }
    }
    native.focus();
    native.click();
  };

  btn.addEventListener('click', openPicker);
  native.addEventListener('change', () => {
    const formatted = fromIsoDate(native.value);
    if (!formatted) return;
    text.value = formatted;
    // Notify the rest of the app (persistence on 'change', rendering on 'input').
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function wireDatePickers(): void {
  wireReportingCyclePicker();
  wireDatePicker('creationDate', 'creationDatePick', 'creationDateNative');
}

/**
 * The reporting/cycle date is always one of four fixed points in a month:
 *   9th → W1 · 16th → W2 · 23rd → W3 · last day of the month → ME.
 * Instead of a free calendar we offer a month/year selector plus those four choices.
 * The hidden #reportingDate text input keeps the DD/MM/YYYY value the rest of the app
 * reads; #reportingCycleHint is the accent chip beside the label.
 */
function wireReportingCyclePicker(): void {
  const monthEl = $('reportingMonth') as HTMLInputElement;
  const seg = $('cycleSeg') as HTMLElement;
  const text = $('reportingDate') as HTMLInputElement;
  const hint = $('reportingCycleHint') as HTMLElement;
  if (!monthEl || !seg || !text) return;

  const opts = Array.from(seg.querySelectorAll<HTMLButtonElement>('.cycle-opt'));

  /** Day-of-month for a cycle within a given year/month (ME = last day). */
  const cycleDay = (year: number, month0: number, cycle: string): number => {
    if (cycle === 'W1') return 9;
    if (cycle === 'W2') return 16;
    if (cycle === 'W3') return 23;
    return new Date(year, month0 + 1, 0).getDate(); // ME = last day
  };

  /** Recompute #reportingDate from the current month + active cycle button. */
  const apply = (): void => {
    const active = opts.find((b) => b.classList.contains('active'));
    if (!monthEl.value || !active) {
      text.value = '';
      if (hint) hint.textContent = '';
    } else {
      const parts = monthEl.value.split('-'); // "YYYY-MM"
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const day = cycleDay(y, m - 1, active.dataset.cycle!);
      const dd = String(day).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      text.value = `${dd}/${mm}/${y}`;
      if (hint) hint.textContent = text.value;
    }
    // Notify the rest of the app (persistence on 'change', rendering on 'input').
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const selectCycle = (cycle: string): void => {
    opts.forEach((b) => b.classList.toggle('active', b.dataset.cycle === cycle));
    apply();
  };

  opts.forEach((b) => b.addEventListener('click', () => selectCycle(b.dataset.cycle!)));
  monthEl.addEventListener('change', apply);
  monthEl.addEventListener('input', apply);
  text.addEventListener('input', render);

  // Seed the controls from any restored #reportingDate (DD/MM/YYYY), else default to
  // the current month with the month-end (ME) cycle selected.
  const restored = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text.value || '').trim());
  if (restored) {
    const dd = restored[1]!;
    const mm = restored[2]!;
    const yyyy = restored[3]!;
    monthEl.value = `${yyyy}-${mm}`;
    const day = +dd;
    const lastDay = new Date(+yyyy, +mm, 0).getDate();
    const cycle =
      day === 9 ? 'W1' : day === 16 ? 'W2' : day === 23 ? 'W3' : day === lastDay ? 'ME' : day < 9 ? 'W1' : day <= 16 ? 'W2' : day <= 23 ? 'W3' : 'ME';
    selectCycle(cycle);
  } else {
    const now = new Date();
    monthEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    selectCycle('ME');
  }
}

/** The cycle code (W1/W2/W3/ME) currently selected in the segmented control. */
function activeCycle(): string {
  return (
    document.querySelector<HTMLElement>('#cycleSeg .cycle-opt.active')?.dataset.cycle ?? ''
  );
}

// ---- run -------------------------------------------------------------------
let runToken = 0;
class Cancelled extends Error {}

function hasInput(): boolean {
  return source === 'file' ? !!pickedBytes : !!val('folderFile');
}

async function onRun() {
  if (blocked || status === 'running' || !hasInput()) return;
  // THE enforcement point: confirm a live, current, on-version session with the server at
  // the moment of generation. No grace window, no cached verdict — a session revoked (or a
  // build de-supported) since the last click cannot produce a submission file.
  if (serverConfigured()) {
    await evaluateGate(true);
    if (blocked) return;
  }
  if (!online) return;

  const token = ++runToken;
  status = 'running';
  step = 0;
  stepDetails = [];
  railTab = 'generate';
  view = 'app';
  savedPath = null;
  render();

  const started = Date.now();
  const formatId = val('format') as FormatId;
  const format = getFormat(formatId);
  const memberId = val('memberId').trim();
  const memberName = val('memberName').trim();
  const reporting = toDdmmyyyy(val('reportingDate'));
  const creation = toDdmmyyyy(val('creationDate')) || reporting;
  const bypass = checked('bypassErrors');
  const wantReport = checked('report');

  // Each completed phase advances the rail, then yields so the webview repaints —
  // the pipeline is otherwise one synchronous burst.
  const onPhase = async (phase: ConvertPhase, detail?: string) => {
    if (token !== runToken) throw new Cancelled();
    const i = STEPS.findIndex((s) => s.phase === phase);
    if (i >= 0) {
      stepDetails[i] = detail ?? '';
      step = i + 1;
      render();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  };

  try {
    const bytes = await resolveBytes();
    let convert: ConvertResult;
    let compare: CompareResult | undefined;

    if (appMode === 'validate' && refBytes) {
      const r = await runValidate({
        formatId,
        bytes,
        referenceBytes: refBytes,
        memberId,
        memberName: memberName || undefined,
        reportingDate: reporting,
        creationDate: creation,
        ignoreLineEndings: checked('ignoreEol'),
        onPhase,
      });
      convert = r.convert;
      compare = r.compare;
    } else {
      convert = await runConvert({
        formatId,
        bytes,
        memberId,
        memberName: memberName || undefined,
        reportingDate: reporting,
        creationDate: creation,
        // Validator always wants bytes to compare, so warnings don't suppress the file.
        report: appMode === 'validate' ? false : wantReport,
        allowWarnings: appMode === 'validate' ? true : undefined,
        bypassErrors: appMode === 'validate' ? undefined : bypass,
      });
    }
    if (token !== runToken) return;

    const groups = buildGroups(convert.report.issues);
    const outcome: Outcome = convert.report.ok ? 'success' : convert.output ? 'bypassed' : 'errors';
    run = {
      mode: appMode,
      convert,
      compare,
      outcome,
      groups,
      errorRows: convert.report.errors.length,
      warningRows: convert.report.warnings.length,
      fileName: submissionFileName(format.outputExtension),
      formatId,
      formatLabel: format.label,
      memberId,
      memberName,
      reportingDate: val('reportingDate'),
      cycle: activeCycle(),
      creationDate: val('creationDate'),
      bypass,
      report: wantReport && !!convert.reportWorkbook,
      at: new Date(),
      durationMs: Date.now() - started,
    };
    // The report view opens the first group by default.
    open = groups.length ? { [groups[0]!.id]: true } : {};
    filter = 'all';
    status = 'done';
    railTab = 'results';

    if (convert.output) {
      pushRecent({
        name: run.fileName,
        borrowers: convert.counts?.borrowerCount ?? 0,
        warnings: run.warningRows,
        clean: outcome === 'success' && run.warningRows === 0,
        at: Date.now(),
      });
    }
    render();
  } catch (e) {
    if (e instanceof Cancelled || token !== runToken) return;
    status = 'idle';
    step = 0;
    render();
    showToast(`Conversion failed: ${(e as Error).message}`, 9000);
  }
}

function cancelRun() {
  runToken++;
  status = 'idle';
  step = 0;
  stepDetails = [];
  render();
}

/**
 * Read the input bytes at the moment of the run. When the workbook was picked
 * natively we re-read it from disk rather than reusing the bytes captured at pick
 * time — the operator has usually just fixed cells in Excel and expects the re-run
 * to see the saved file.
 */
async function resolveBytes(): Promise<ArrayBuffer> {
  if (source === 'file') {
    if (pickedPath && isTauri) {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = toArrayBuffer(await readFile(pickedPath));
      pickedBytes = bytes;
      pickedSize = bytes.byteLength;
      return bytes;
    }
    if (!pickedBytes) throw new Error('No file selected.');
    return pickedBytes;
  }
  const path = val('folderFile');
  if (!path) throw new Error('No file selected from the folder.');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return toArrayBuffer(await readFile(path));
}

// ---- findings grouping -----------------------------------------------------
/**
 * Collapse the flat issue list into one card per rule — `rule + fieldKey + segment
 * tag` — so the operator sees "7 rows fail this one rule" rather than 7 identical
 * lines. Errors first, then by descending affected-row count.
 */
function buildGroups(issues: ValidationIssue[]): Group[] {
  const byKey = new Map<string, ValidationIssue[]>();
  for (const i of issues) {
    const key = `${i.rule}|${i.fieldKey}|${i.sheet}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(i);
    else byKey.set(key, [i]);
  }

  const groups: Group[] = [];
  for (const [key, list] of byKey) {
    const first = list[0]!;
    const label = first.fieldLabel || first.fieldKey || first.sheet;
    const bypassable = list.some((i) => i.bypassable === false) ? false : true;
    // A message every row shares is a rule-level sentence — usable as a headline
    // when it is short, and worth repeating as guidance either way.
    const shared = list.every((i) => i.message === first.message) ? first.message : undefined;
    const where = [first.sheet, first.fieldKey, first.rule]
      .filter(Boolean)
      .concat(bypassable ? [] : ['not bypassable'])
      .join(' · ');

    groups.push({
      id: key.replace(/[^\w]+/g, '-'),
      severity: first.severity,
      title: groupTitle(shared, first.rule, label),
      where,
      fix: groupFix(shared, first.rule, label, bypassable),
      reference: first.reference,
      rows: list.map((i) => ({
        row: i.rowNumber ? String(i.rowNumber) : '—',
        cell: i.column && i.rowNumber ? `${i.column}${i.rowNumber}` : '—',
        value: displayValue(i.value),
      })),
      count: list.length,
    });
  }

  const rank = (g: Group) => (g.severity === 'error' ? 0 : 1);
  return groups.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

/**
 * A rule-level headline. A message every row in the group shares already reads as
 * the rule itself, so it becomes the title when it is short enough to sit on a rail
 * card; anything longer (the engine's messages often quote the offending value and
 * spell out the fix) gets a synthesised sentence instead, and the full text moves
 * into the fix guidance below.
 */
const TITLE_MAX = 80;

function groupTitle(shared: string | undefined, rule: string, label: string): string {
  if (shared && shared.length <= TITLE_MAX) return shared;
  switch (rule) {
    case 'enum':
      return `${label} holds a code that is not in the bureau catalogue`;
    case 'lookup':
      return `${label} could not be matched to a bureau code`;
    case 'format':
      return `${label} format looks wrong`;
    case 'date':
      return `${label} is not a valid date`;
    case 'length':
      return `${label} exceeds the length the bureau accepts`;
    case 'parse':
      return `${label} could not be parsed from the sheet`;
    case 'mandatory':
      return `${label} is required but blank`;
    case 'cardinality':
      return `${label} breaks the required record count`;
    case 'portal-mandatory':
      return `${label} breaks a rule the portal enforces on upload`;
    case 'empty-input':
      return 'No records were read from the input workbook';
    default:
      return shared ?? `${label} failed validation`;
  }
}

/**
 * What to actually do about it. The engine's own sentence leads when it did not fit
 * in the title, followed by the standing advice for that rule.
 */
function groupFix(shared: string | undefined, rule: string, label: string, bypassable: boolean): string {
  const base: Record<string, string> = {
    enum: `The cell holds a value that is not one of the codes the bureau publishes for ${label}. Replace it with the catalogue code named in the rule below.`,
    lookup: `The value could not be resolved to a bureau code. Use the exact spelling from the catalogue, or enter the code directly.`,
    format: `The value does not match the pattern the bureau expects for ${label}. Correct it, or clear the cell if the field is optional.`,
    date: `Dates must read DD/MM/YYYY in the sheet. Re-enter the value, or format the column as text so Excel stops reinterpreting it.`,
    length: `The value is longer than the field allows, so the bureau stores a truncated value. Shorten it in the sheet if the full text matters.`,
    parse: `The reader could not translate this cell safely, so emitting the file would silently drop the value. Correct the source cell.`,
    mandatory: `The bureau rejects the record when ${label} is blank. Fill the cell on every row listed.`,
    cardinality: `The number of records per borrower does not match what the format requires. Add the missing row, or remove the extra one.`,
    'portal-mandatory': `The portal enforces this on ingestion, so the file is refused at upload rather than at validation. Fix it in the sheet before re-running.`,
    'empty-input': `Check the file is the right one, the data sits on the expected sheet, and the column headers match the format.`,
  };
  const parts = [
    shared && shared.length > TITLE_MAX ? shared : null,
    base[rule] ?? `Correct the listed cells in the sheet, then re-run.`,
    bypassable ? null : 'Bypass cannot cover this one — no file is written until it is fixed.',
  ];
  return parts.filter(Boolean).join(' ');
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (v instanceof Date) return v.toLocaleDateString('en-GB');
  return String(v);
}

// ---- render ----------------------------------------------------------------
function render() {
  $('appView').classList.toggle('hidden', view !== 'app');
  $('reportView').classList.toggle('hidden', view !== 'report');
  renderInputCard();
  renderRail();
  if (view === 'report') renderReport();
  renderStatusLine();
}

function renderInputCard() {
  const has = !!pickedBytes;
  $('drop').classList.toggle('hidden', has);
  $('fileCard').classList.toggle('hidden', !has);
  if (!has) return;
  $('fileName').textContent = pickedName ?? '';
  const rows = run?.convert.counts?.borrowerCount;
  $('fileMeta').textContent = [rows ? `${fmt(rows)} borrowers` : null, humanSize(pickedSize)]
    .filter(Boolean)
    .join(' · ');
}

function renderStatusLine() {
  const user = currentUser()?.username;
  let text: string;
  if (status === 'running') {
    text = `● working — step ${Math.min(step + 1, STEPS.length)} of ${STEPS.length}`;
  } else if (status === 'done' && run) {
    text = run.convert.output
      ? `● file written · ${plural(run.warningRows, 'warning')}`
      : `● ${plural(run.errorRows, 'error')} · ${plural(run.warningRows, 'warning')} · no file written`;
  } else {
    text = `● idle · on-device${user ? ` · signed in as ${user}` : ''}`;
  }
  $('statusLine').textContent = text;
}

// --- rail -------------------------------------------------------------------
function renderRail() {
  const rail = $('rail');
  const parts: string[] = [];

  // The toggle appears only once a run has completed, and never while running.
  if (status === 'done' && run) {
    const errors = run.outcome === 'errors';
    const count = errors
      ? run.errorRows
      : run.outcome === 'bypassed'
        ? run.errorRows + run.warningRows
        : run.warningRows;
    const label = errors ? 'Findings' : 'Result';
    const tone = errors ? 'err' : 'warn';
    parts.push(`
      <div class="seg rail-toggle" role="group" aria-label="Rail view">
        <button type="button" class="seg-opt ${railTab === 'generate' ? 'active' : ''}" data-rail="generate">${appMode === 'validate' ? 'Validate' : 'Generate'}</button>
        <button type="button" class="seg-opt ${railTab === 'results' ? 'active' : ''}" data-rail="results">${label}${
          count ? `<span class="tabbadge ${tone}">${fmt(count)}</span>` : ''
        }</button>
      </div>`);
  }

  if (status === 'running') parts.push(railRunning());
  else if (status === 'done' && run && railTab === 'results') parts.push(railResult(run));
  else parts.push(railGenerate());

  rail.innerHTML = parts.join('');

  rail.querySelectorAll<HTMLElement>('[data-rail]').forEach((b) => {
    b.onclick = () => {
      railTab = b.dataset.rail as RailTab;
      render();
    };
  });
  const go = rail.querySelector<HTMLButtonElement>('#go');
  if (go) go.onclick = () => void onRun();
  const cancel = rail.querySelector<HTMLButtonElement>('#cancelRun');
  if (cancel) cancel.onclick = cancelRun;
  rail.querySelectorAll<HTMLElement>('[data-group]').forEach((c) => {
    c.onclick = () => openGroup(c.dataset.group!);
  });
  wireActions(rail);
}

function railGenerate(): string {
  const ready = hasInput();
  const rows = run?.convert.counts?.borrowerCount;
  const check: Array<{ label: string; ok: boolean; value: string }> = [
    { label: 'Bureau format', ok: true, value: shortFormat() },
    { label: 'Member ID', ok: !!val('memberId').trim(), value: val('memberId').trim() || 'from sheet' },
    {
      label: 'Cycle',
      ok: !!val('reportingDate'),
      value: val('reportingDate') ? `${val('reportingDate')} · ${activeCycle()}` : 'from sheet',
    },
    {
      label: 'Input workbook',
      ok: ready,
      value: ready ? (rows ? `${fmt(rows)} borrowers` : humanSize(pickedSize) || 'chosen') : 'not chosen',
    },
  ];
  if (appMode === 'validate')
    check.push({ label: 'Reference file', ok: !!refBytes, value: refName ? ellipsis(refName, 18) : 'optional' });

  const hint = !ready
    ? 'Choose an .xlsx input file to enable this.'
    : !online
      ? 'No internet connection — reconnect to generate.'
      : checked('bypassErrors')
        ? 'Bypass is on — errors will not stop the file being written.'
        : 'Runs on this machine. Findings appear before anything is written to disk.';

  const recent = loadRecent().slice(0, 2);

  return `
    <div class="rail-body">
      <h3>${appMode === 'validate' ? 'Validate' : 'Generate'}</h3>
      <div class="checklist">
        ${check
          .map(
            (c) => `
          <div class="checkrow-item">
            <div class="dot ${c.ok ? 'done' : ''}">${c.ok ? '✓' : '·'}</div>
            <div class="checkrow-label">${escapeHtml(c.label)}</div>
            <div class="checkrow-val ${c.ok ? '' : 'pending'}">${escapeHtml(c.value)}</div>
          </div>`,
          )
          .join('')}
      </div>
      <button type="button" class="cta" id="go" ${ready && online && !blocked ? '' : 'disabled'}>
        ${appMode === 'validate' ? 'Validate and compare' : 'Generate submission file'}
      </button>
      <p class="cta-hint">${escapeHtml(hint)}</p>
      <div class="spacer"></div>
      ${
        recent.length
          ? `<div class="recent">
               <h3>Recent runs</h3>
               ${recent
                 .map(
                   (r) => `
                 <div class="recent-item">
                   <span class="recent-dot ${r.clean ? '' : 'warn'}"></span>
                   <span class="recent-text">
                     <span class="recent-name">${escapeHtml(r.name)}</span>
                     <span class="recent-meta">${escapeHtml(
                       [
                         `${fmt(r.borrowers)} borrowers`,
                         r.clean ? 'clean' : plural(r.warnings, 'warning'),
                         relativeTime(r.at),
                       ].join(' · '),
                     )}</span>
                   </span>
                 </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }
    </div>`;
}

function railRunning(): string {
  return `
    <div class="rail-body">
      <div class="run-head">
        <span class="spinner"></span>
        <span class="run-title">${appMode === 'validate' ? 'Validating and comparing…' : 'Generating submission file…'}</span>
      </div>
      <div class="progress"><i style="width:${(step / STEPS.length) * 100}%"></i></div>
      <div class="checklist steps">
        ${STEPS.map((s, i) => {
          const done = i < step;
          const now = i === step;
          return `
          <div class="checkrow-item">
            <div class="dot ${done ? 'done' : now ? 'active' : ''}">${done ? '✓' : ''}</div>
            <div class="checkrow-label ${done || now ? '' : 'pending'}">${s.label}</div>
            <div class="step-detail">${escapeHtml(done ? (stepDetails[i] ?? '') : now ? 'working…' : '')}</div>
          </div>`;
        }).join('')}
      </div>
      <button type="button" class="cancel" id="cancelRun">Cancel</button>
      <div class="spacer"></div>
    </div>`;
}

function railResult(r: Run): string {
  const { tone, label, note } = outcomeCopy(r);
  const showFindings = r.groups.length > 0;

  return `
    <div class="rail-body results">
      <div class="outcome-pill ${tone}">${escapeHtml(label)}</div>
      <p class="outcome-note">${escapeHtml(note)}</p>
      ${
        showFindings
          ? `<div class="findlist">
               ${r.groups.map((g) => findCard(g)).join('')}
             </div>`
          : ''
      }
      ${r.convert.output ? outputBlock(r) : ''}
      <div class="actions">${actionsFor(r, 'rail')}</div>
      <div class="spacer"></div>
      <p class="railfoot">${
        showFindings
          ? 'Findings are keyed to the exact sheet cell. Export them and hand the file back to whoever owns the Master Sheet.'
          : 'The file is written only after validation passes, so what you save is what the portal will accept.'
      }</p>
    </div>`;
}

function findCard(g: Group): string {
  return `
    <button type="button" class="findcard" data-group="${g.id}">
      <span class="sevchip ${g.severity === 'error' ? 'err' : 'warn'}">${g.severity === 'error' ? 'ERROR' : 'WARN'}</span>
      <span class="find-text">
        <span class="find-title">${escapeHtml(g.title)}</span>
        <span class="find-where">${escapeHtml(g.where)}</span>
      </span>
      <span class="find-count">${plural(g.count, 'row')}</span>
    </button>`;
}

/** The output card + the 2×2 count grid shown in the rail on a written file. */
function outputBlock(r: Run): string {
  const counts = countCards(r);
  return `
    <div class="outcard">
      <div class="badge-sq ok mono">${escapeHtml(extLabel(r))}</div>
      <div class="outcard-text">
        <div class="outcard-name">${escapeHtml(r.fileName)}</div>
        <div class="outcard-meta">${escapeHtml(outMeta(r))}</div>
      </div>
    </div>
    <div class="countgrid">
      ${counts.map((c) => `<div class="countcard"><div class="n">${escapeHtml(c.n)}</div><div class="k">${escapeHtml(c.k)}</div></div>`).join('')}
    </div>`;
}

function countCards(r: Run): Array<{ n: string; k: string }> {
  const c = r.convert.counts;
  if (!c) return [];
  const accountLabel = r.formatId.startsWith('commercial') ? 'Credit facilities' : 'Accounts';
  return [
    { n: fmt(c.borrowerCount), k: 'Borrowers' },
    { n: fmt(c.accountCount), k: accountLabel },
    { n: fmt(c.addressCount), k: 'Addresses' },
    { n: fmt(c.segmentCount), k: 'Segments' },
  ];
}

/**
 * The headline verdict. In Validator mode a byte comparison, when one ran, takes
 * over the pill and the note — that is the answer the operator came for.
 */
function outcomeCopy(r: Run): { tone: 'ok' | 'warn' | 'err'; label: string; note: string } {
  if (r.mode === 'validate' && refBytes) {
    if (!r.compare) {
      return {
        tone: 'err',
        label: 'CANNOT COMPARE',
        note: `The input has ${plural(r.errorRows, 'blocking error')}, so no output could be generated to compare. Fix the cells below, then re-run.`,
      };
    }
    const bytes = `Generated ${fmt(r.compare.generatedLength)} bytes · reference ${fmt(r.compare.referenceLength)} bytes.`;
    return r.compare.match
      ? { tone: 'ok', label: 'MATCH ✓', note: `${r.compare.summary} ${bytes}` }
      : { tone: 'err', label: 'MISMATCH ✕', note: `${r.compare.summary} ${bytes}` };
  }

  if (r.outcome === 'errors') {
    const rules = r.groups.filter((g) => g.severity === 'error').length;
    const nonBypassable = r.groups.some((g) => g.where.includes('not bypassable'));
    const tail = r.bypass && nonBypassable
      ? ' Bypass cannot cover the parse errors, so nothing was written.'
      : ' Fix the cells, then re-run.';
    return {
      tone: 'err',
      label: `${fmt(r.errorRows)} BLOCKING ERROR${r.errorRows === 1 ? '' : 'S'}`,
      note: `No file written. ${plural(rules, 'rule')} failed across ${plural(r.errorRows, 'row')}, plus ${plural(r.warningRows, 'warning')}.${tail}`,
    };
  }
  if (r.outcome === 'bypassed') {
    return {
      tone: 'warn',
      label: 'GENERATED WITH BYPASS',
      note: `${plural(r.errorRows, 'error')} carried into the file — rejection risk on submission.`,
    };
  }
  return {
    tone: 'ok',
    label: 'GENERATED',
    note: r.warningRows
      ? `${plural(r.warningRows, 'warning')} reviewed · file written to disk.`
      : 'No errors, no warnings · file written to disk.',
  };
}

function outMeta(r: Run): string {
  if (!r.convert.output) return 'Fix the blocking findings, then re-run';
  const spec = getFormat(r.formatId);
  const eol = spec.lineEnding === '\r\n' ? 'CRLF' : spec.lineEnding === '\n' ? 'LF' : 'no line breaks';
  return [
    humanSize(r.convert.output.length),
    spec.fileEncoding.toUpperCase(),
    eol,
    r.report ? '+ workbook report' : 'no workbook report',
  ].join(' · ');
}

function extLabel(r: Run): string {
  return getFormat(r.formatId).outputExtension.replace('.', '').toUpperCase();
}

// --- report view ------------------------------------------------------------
function openGroup(id: string) {
  view = 'report';
  filter = 'all';
  open[id] = true;
  render();
}

function renderReport() {
  if (!run) return;
  const r = run;
  const { tone, label, note } = outcomeCopy(r);
  const visible = r.groups.filter((g) =>
    filter === 'all' ? true : filter === 'errors' ? g.severity === 'error' : g.severity === 'warning',
  );

  const chips = (
    [
      ['all', `All ${fmt(r.errorRows + r.warningRows)}`],
      ['errors', `Errors ${fmt(r.errorRows)}`],
      ['warnings', `Warnings ${fmt(r.warningRows)}`],
    ] as Array<[Filter, string]>
  )
    .map(
      ([k, text]) =>
        `<button type="button" class="seg-opt ${filter === k ? 'active' : ''}" data-filter="${k}">${escapeHtml(text)}</button>`,
    )
    .join('');

  const preview = (r.convert.outputText ?? '')
    .split(/\r?\n/)
    .filter((l) => l.length)
    .slice(0, 5)
    .map((l) => ellipsis(l, 160))
    .join('\n');

  const spec = getFormat(r.formatId);
  const eol = spec.lineEnding === '\r\n' ? 'CRLF' : spec.lineEnding === '\n' ? 'LF' : 'single line';

  $('reportView').innerHTML = `
    <div class="report-head">
      <button type="button" class="backbtn" id="backToSetup">← Back to setup</button>
      <div class="outcome-pill ${tone}">${escapeHtml(label)}</div>
      <p class="outcome-note">${escapeHtml(note)}</p>
      <div class="runstamp">${escapeHtml(stamp(r))}</div>
    </div>
    <div class="report-split">
      <div class="report-main">
        ${
          r.groups.length
            ? `<div class="section">
                 <div class="section-head">
                   <h2>Findings</h2>
                   <div class="rule"></div>
                   <div class="seg seg-sm">${chips}</div>
                 </div>
                 ${visible.map((g) => groupCard(g)).join('')}
               </div>`
            : ''
        }
        ${
          r.convert.output
            ? `<div class="section">
                 <div class="section-head"><h2>File contents</h2><div class="rule"></div></div>
                 <div class="bigcounts">
                   ${countCards(r)
                     .map((c) => `<div class="countcard"><div class="n">${escapeHtml(c.n)}</div><div class="k">${escapeHtml(c.k)}</div></div>`)
                     .join('')}
                 </div>
                 <div class="panel">
                   <div class="panel-head">First records<span class="note">${escapeHtml(`${spec.fileEncoding.toUpperCase()} · ${eol}`)}</span></div>
                   <pre class="panel-pre selectable">${escapeHtml(preview)}</pre>
                 </div>
               </div>`
            : ''
        }
      </div>
      <aside class="outrail">
        <h3>Output</h3>
        <div class="outcard">
          <div class="badge-sq ${r.convert.output ? 'ok' : 'err'} mono">${escapeHtml(extLabel(r))}</div>
          <div class="outcard-text">
            <div class="outcard-name">${escapeHtml(r.convert.output ? r.fileName : 'nothing written')}</div>
            <div class="outcard-meta">${escapeHtml(outMeta(r))}</div>
          </div>
        </div>
        <div class="actions">${actionsFor(r, 'report')}</div>
        <div class="hr"></div>
        <div class="facts">
          ${runFacts(r)
            .map((f) => `<div class="fact"><div class="k">${escapeHtml(f.k)}</div><div class="v">${escapeHtml(f.v)}</div></div>`)
            .join('')}
        </div>
        <div class="spacer"></div>
        <p class="railfoot">${
          r.groups.length
            ? 'Findings are keyed to the exact sheet cell. Export them and hand the file back to whoever owns the Master Sheet.'
            : 'The file is written only after validation passes, so what you save is what the portal will accept.'
        }</p>
      </aside>
    </div>`;

  const rv = $('reportView');
  (rv.querySelector('#backToSetup') as HTMLButtonElement).onclick = () => {
    view = 'app';
    render();
  };
  rv.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.filter as Filter;
      render();
    };
  });
  rv.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.toggle!;
      open[id] = !open[id];
      render();
    };
  });
  wireActions(rv);
}

/** Inline row tables cap at 3; the full set belongs in the .xlsx export. */
const INLINE_ROWS = 3;

function groupCard(g: Group): string {
  const isOpen = !!open[g.id];
  const shown = g.rows.slice(0, INLINE_ROWS);
  const more = g.rows.length - shown.length;
  return `
    <div class="group">
      <button type="button" class="group-head" data-toggle="${g.id}" aria-expanded="${isOpen}">
        <span class="sevchip ${g.severity === 'error' ? 'err' : 'warn'}">${g.severity === 'error' ? 'ERROR' : 'WARN'}</span>
        <span class="find-text">
          <span class="find-title">${escapeHtml(g.title)}</span>
          <span class="find-where">${escapeHtml(g.where)}</span>
        </span>
        <span class="group-right">
          <span class="find-count">${plural(g.count, 'row')}</span>
          <span class="chevron">${isOpen ? '▲' : '▼'}</span>
        </span>
      </button>
      ${
        isOpen
          ? `<div class="group-body">
               <p class="group-fix">${escapeHtml(g.fix)}</p>
               <div class="rowtable">
                 <div class="thead"><div>Row</div><div>Cell</div><div>Value read</div></div>
                 ${shown
                   .map(
                     (row) => `
                   <div class="trow">
                     <div class="r">${escapeHtml(row.row)}</div>
                     <div class="c">${escapeHtml(row.cell)}</div>
                     <div class="v selectable" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</div>
                   </div>`,
                   )
                   .join('')}
                 ${more > 0 ? `<div class="tmore">${plural(more, 'more row')}</div>` : ''}
               </div>
               ${g.reference ? `<div class="group-rule"><b>Rule</b>${escapeHtml(g.reference)}</div>` : ''}
             </div>`
          : ''
      }
    </div>`;
}

function runFacts(r: Run): Array<{ k: string; v: string }> {
  return [
    { k: 'Format', v: r.formatLabel },
    { k: 'Member', v: [r.memberId, r.memberName].filter(Boolean).join(' · ') || '—' },
    { k: 'Cycle', v: r.reportingDate ? `${r.reportingDate} (${r.cycle})` : '—' },
    { k: 'Created', v: r.creationDate || '—' },
    { k: 'Bypass', v: r.bypass ? 'ON' : 'off' },
  ];
}

function stamp(r: Run): string {
  const d = r.at;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())} · ${(r.durationMs / 1000).toFixed(1)}s`;
}

// --- actions ----------------------------------------------------------------
type ActionId = 'open-report' | 'export-issues' | 'rerun' | 'save' | 'save-report' | 'reveal';

function actionsFor(r: Run, where: 'rail' | 'report'): string {
  const defs: Array<[ActionId, string, boolean]> = [];
  if (!r.convert.output) {
    if (where === 'rail') defs.push(['open-report', 'Open full findings', true]);
    defs.push(['export-issues', 'Export findings (.xlsx)', where === 'report']);
    defs.push(['rerun', 'Mark cells fixed, re-run', false]);
  } else {
    defs.push(['save', 'Save submission file…', true]);
    if (where === 'rail') defs.push(['open-report', 'Open full report', false]);
    if (r.convert.reportWorkbook) defs.push(['save-report', 'Save workbook report (.xlsx)', false]);
    else defs.push(['reveal', 'Reveal in folder', false]);
    if (r.groups.length) defs.push(['export-issues', 'Export findings (.xlsx)', false]);
  }
  return defs
    .map(
      ([id, label, primary]) =>
        `<button type="button" class="action ${primary ? 'primary' : 'secondary'}" data-action="${id}">${escapeHtml(label)}</button>`,
    )
    .join('');
}

function wireActions(scope: HTMLElement) {
  scope.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.onclick = () => void onAction(btn.dataset.action as ActionId, btn);
  });
}

async function onAction(id: ActionId, btn: HTMLButtonElement) {
  const r = run;
  if (!r) return;
  switch (id) {
    case 'open-report':
      view = 'report';
      filter = 'all';
      render();
      return;
    case 'rerun':
      await onRun();
      return;
    case 'save':
      if (r.convert.output) await withBusy(btn, () => saveFile(r.fileName, r.convert.output!));
      return;
    case 'save-report':
      if (r.convert.reportWorkbook)
        await withBusy(btn, () => saveFile(reportFileName(), r.convert.reportWorkbook!, false));
      return;
    case 'export-issues':
      await withBusy(btn, async () => saveFile(issuesFileName(), await exportIssues(r.convert.report), false));
      return;
    case 'reveal':
      await revealSaved(r);
      return;
  }
}

async function withBusy(btn: HTMLButtonElement, work: () => Promise<unknown>) {
  btn.disabled = true;
  try {
    await work();
  } catch (e) {
    showToast(`Could not save: ${(e as Error).message}`, 8000);
  } finally {
    btn.disabled = false;
  }
}

/**
 * "Reveal in folder" only means something once the file exists on disk, so the
 * first click saves it and then opens the containing folder.
 */
async function revealSaved(r: Run) {
  if (!savedPath) {
    if (!r.convert.output) return;
    await saveFile(r.fileName, r.convert.output);
    if (!savedPath) return; // dialog cancelled
  }
  if (!isTauri) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(savedPath);
}

async function saveFile(defaultName: string, data: Uint8Array, isSubmission = true) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName });
    if (!path) return;
    await writeFile(path, data);
    if (isSubmission) savedPath = path;
  } else {
    const blob = new Blob([toArrayBuffer(data)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ---- names + formatting ----------------------------------------------------
/** `<member>_issues.xlsx` — a stable, obvious name for the findings export. */
function issuesFileName(): string {
  const base = (val('memberId') || 'submission').replace(/[^\w.-]+/g, '_');
  return `${base}_issues.xlsx`;
}

function reportFileName(): string {
  const base = (val('memberId') || 'submission').replace(/[^\w.-]+/g, '_');
  return `${base}_report.xlsx`;
}

/**
 * Build the CRIF submission file name the bureau expects:
 *   `{MemberCode}_Commercial_{ReportingDDMMYYYY}_{CreationDDMMYYYY}_{HHMMSS}_{Cycle}{ext}`
 * e.g. `NB51840001_Commercial_30062026_12072026_162820_ME.txt`. The HHMMSS is the
 * generation wall-clock time and the cycle (W1/W2/W3/ME) is derived from the
 * reporting date. The extension is the format's own output extension (`.txt`) — the
 * bureau portal rejects a `.Tap` upload. Falls back to a plain `submission{ext}`
 * when the format isn't a commercial one or the required fields (member code /
 * reporting date) are missing.
 */
function submissionFileName(ext: string): string {
  const formatId = val('format') as FormatId;
  const member = val('memberId').trim();
  const reporting = toDdmmyyyy(val('reportingDate')); // DDMMYYYY | undefined
  const isCommercial = formatId.startsWith('commercial');
  if (!isCommercial || !member || !reporting) return `submission${ext}`;

  const creation = toDdmmyyyy(val('creationDate')) || reporting;
  const rd = new Date(
    Date.UTC(+reporting.slice(4, 8), +reporting.slice(2, 4) - 1, +reporting.slice(0, 2)),
  );
  const cycle = reportingCycleCode(rd);

  const now = new Date();
  const hhmmss =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  return `${member}_Commercial_${reporting}_${creation}_${hhmmss}_${cycle}${ext}`;
}

/** Short format name for the readiness checklist, e.g. "UCRF V3.10". */
function shortFormat(): string {
  const label = getFormat(val('format') as FormatId).label;
  return label.replace(/^(Commercial|Consumer|MFI)\s+/, '');
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN');
}

function plural(n: number, word: string): string {
  return `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
}

function humanSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function ellipsis(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

init();
