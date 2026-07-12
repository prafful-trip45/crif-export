/**
 * Desktop UI controller.
 *
 * Mirrors the local web portal's flow, but file selection + saving go through
 * native OS dialogs (Tauri `dialog`/`fs` plugins) instead of a browser path box
 * and a `data:` download. The conversion itself runs in-process via `engine.ts`.
 *
 * Everything degrades gracefully when opened in a plain browser (`vite dev`
 * without the Tauri shell): the file picker falls back to an <input type=file>
 * and saving falls back to an object-URL download. Folder mode is Tauri-only.
 */
import './polyfills'; // MUST be first: sets up Buffer/process before the engine loads.
import {
  runConvert,
  runValidate,
  listFormats,
  getFormat,
  type FormatId,
  type ConvertResult,
  type CompareResult,
} from './engine';
import { getAppVersion } from './app-version';
import { serverConfigured, isAuthenticated, heartbeat, login as authLogin } from './auth';
import { reportingCycleCode } from '../../core/src/formats/commercial-ucrf-flat.js';

const isTauri = '__TAURI_INTERNALS__' in window;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement).value;

type Mode = 'file' | 'folder';
let mode: Mode = 'file';

// 'convert' = generate a bureau file; 'validate' = generate + auto-compare to a
// supplied output/reference file (the Validator feature).
type AppMode = 'convert' | 'validate';
let appMode: AppMode = 'convert';

// The selected workbook bytes + display name, regardless of how they were picked.
let pickedBytes: ArrayBuffer | null = null;
let pickedName: string | null = null;
let folderPath: string | null = null;
// The reference output file the user uploads in Validator mode.
let refBytes: ArrayBuffer | null = null;
let refName: string | null = null;
// Set true only when a full-screen gate (login / upgrade) is active.
let blocked = false;
// Connectivity is treated as a SOFT gate: instead of a modal, losing the
// connection just disables the Generate button. Defaults to true (assume online)
// so the app is usable immediately; the real connection is verified by the
// heartbeat when the window gains focus.
let online = true;

// ---- form persistence ------------------------------------------------------
const PERSIST = ['format', 'memberId', 'memberName', 'reportingDate', 'creationDate'];
const STORE = 'crif-export-desktop-form';

function saveForm() {
  const data: Record<string, unknown> = {};
  PERSIST.forEach((id) => (data[id] = val(id)));
  data.report = ($('report') as HTMLInputElement).checked;
  data.mode = mode;
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

// ---- app mode (Convert / Validator) ----------------------------------------
function setAppMode(m: AppMode) {
  appMode = m;
  document.querySelectorAll('#appTabs .tab').forEach((x) =>
    x.classList.toggle('active', (x as HTMLElement).dataset.app === m),
  );
  // Reference card + intro line are visible only in Validator mode.
  document
    .querySelectorAll('.validate-only')
    .forEach((el) => el.classList.toggle('hidden', m !== 'validate'));
  ($('go') as HTMLButtonElement).textContent =
    m === 'validate' ? 'Validate against output file' : 'Generate submission file';
  // The workbook-report checkbox is irrelevant when validating.
  $('result').innerHTML = '';
  refreshGo();
}

// ---- mode tabs -------------------------------------------------------------
function setMode(m: Mode) {
  mode = m;
  document.querySelectorAll('.tab').forEach((x) =>
    x.classList.toggle('active', (x as HTMLElement).dataset.mode === m),
  );
  $('modeFile').classList.toggle('hidden', m !== 'file');
  $('modeFolder').classList.toggle('hidden', m !== 'folder');
}

// ---- init ------------------------------------------------------------------
function init() {
  const formats = listFormats();
  ($('format') as HTMLSelectElement).innerHTML = formats
    .map((f) => `<option value="${f.id}">${f.label}</option>`)
    .join('');

  const saved = loadForm();
  PERSIST.forEach((id) => {
    if (saved[id] != null && id !== 'format') (($(id) as HTMLInputElement).value = saved[id]);
  });
  if (saved.format && formats.some((f) => f.id === saved.format))
    ($('format') as HTMLSelectElement).value = saved.format;
  if (saved.report) ($('report') as HTMLInputElement).checked = true;

  // Folder mode requires native fs — only offer it inside the desktop shell.
  if (!isTauri) {
    const folderTab = document.querySelector('.tab[data-mode="folder"]') as HTMLElement | null;
    folderTab?.classList.add('hidden');
  }
  setMode(saved.mode === 'folder' && isTauri ? 'folder' : 'file');

  PERSIST.concat(['report']).forEach((id) => $(id).addEventListener('change', saveForm));
  ['memberId', 'format'].forEach((id) => $(id).addEventListener('input', refreshGo));
  wireDatePickers();

  document.querySelectorAll('.tab').forEach(
    (t) =>
      ((t as HTMLElement).onclick = () => {
        setMode((t as HTMLElement).dataset.mode as Mode);
        saveForm();
        refreshGo();
      }),
  );

  // App-mode (Convert / Validator) tabs.
  document.querySelectorAll('#appTabs .tab').forEach(
    (t) =>
      ((t as HTMLElement).onclick = () => setAppMode((t as HTMLElement).dataset.app as AppMode)),
  );

  wireFileMode();
  wireFolderMode();
  wireReferenceMode();
  ($('go') as HTMLButtonElement).onclick = () => void (appMode === 'validate' ? onValidate() : onGenerate());
  ($('loginSubmit') as HTMLButtonElement).onclick = () => void onLoginSubmit();
  $('loginPass').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void onLoginSubmit();
  });
  ($('connectionRetry') as HTMLButtonElement).onclick = () => void evaluateGate();
  refreshGo();
  startGateMonitor();
  void evaluateGate();
}

// ---- auth + connectivity gate --------------------------------------------
// Full-screen modals are reserved for LOGIN and UPGRADE only. Connectivity is a
// SOFT gate: when offline / the server is unreachable, we simply disable the
// Generate button (see `online` + refreshGo) instead of flashing a modal on every
// focus change. The app does NOT block when backgrounded.
type GateReason = 'ok' | 'login' | 'connection' | 'upgrade';
let gateTimer: number | undefined;
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
  refreshGo();
}

async function evaluateGate(force = false) {
  if (!serverConfigured()) {
    applyGate('ok'); // dev / unconfigured build: no gating
    return;
  }
  if (evaluating && !force) return; // periodic/event callers coalesce; clicks force
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
    const version = await getAppVersion();
    const hb = await heartbeat(version);
    if (hb.status === 'ok') {
      online = true;
      applyGate('ok');
    } else if (hb.status === 'upgrade-required') {
      applyGate('upgrade', { currentVersion: version, latestVersion: hb.latestVersion, downloadUrl: hb.downloadUrl });
    } else if (hb.status === 'session-revoked' || hb.status === 'unauthenticated') {
      applyGate('login');
    } else {
      // 'unreachable' — soft-gate (disable Generate), no modal; retry on next focus/tick.
      online = false;
      applyGate('ok');
    }
  } finally {
    evaluating = false;
  }
}

function startGateMonitor() {
  if (!serverConfigured()) return;
  window.addEventListener('online', () => void evaluateGate());
  // Offline: just disable the button (soft gate), no modal.
  window.addEventListener('offline', () => {
    online = false;
    refreshGo();
  });
  // Re-verify the connection only when the window REGAINS focus (not on blur),
  // so backgrounding the app never flashes a popup.
  window.addEventListener('focus', () => void evaluateGate());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void evaluateGate();
  });
  if (gateTimer === undefined) gateTimer = window.setInterval(() => void evaluateGate(), 30000);
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
      // directly. (Don't await a second evaluateGate() — its heartbeat round-trip
      // can be slow or coalesced behind the `evaluating` flag, leaving the button
      // stuck on "Signing in…" and the overlay up.)
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

// ---- file mode -------------------------------------------------------------
function wireFileMode() {
  const drop = $('drop');
  const input = $('file') as HTMLInputElement;

  drop.onclick = async () => {
    // Native picker in the desktop shell; <input> fallback in a browser.
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (typeof picked === 'string') {
        const bytes = await readFile(picked);
        setPicked(toArrayBuffer(bytes), picked.split(/[\\/]/).pop() || picked);
      }
    } else {
      input.click();
    }
  };

  input.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) setPicked(await f.arrayBuffer(), f.name);
  });

  // HTML5 drag-drop (Tauri's own file-drop is disabled in tauri.conf.json so
  // these events still deliver real File objects to the webview).
  ['dragover', 'drop'].forEach((e) =>
    window.addEventListener(e, (ev) => ev.preventDefault()),
  );
  ['dragover', 'dragenter'].forEach((e) =>
    drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'dragend'].forEach((e) =>
    drop.addEventListener(e, () => drop.classList.remove('over')),
  );
  drop.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    drop.classList.remove('over');
    const f = (ev as DragEvent).dataTransfer?.files?.[0];
    if (f) setPicked(await f.arrayBuffer(), f.name);
  });
}

function setPicked(bytes: ArrayBuffer, name: string) {
  pickedBytes = bytes;
  pickedName = name;
  const drop = $('drop');
  drop.classList.add('has-file');
  drop.innerHTML = `<div class="fn">✓ ${escapeHtml(name)}</div><div class="swap">click to choose a different file</div>`;
  refreshGo();
}

// ---- folder mode -----------------------------------------------------------
function wireFolderMode() {
  ($('chooseFolder') as HTMLButtonElement).onclick = async () => {
    if (!isTauri) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const dir = await open({ directory: true, multiple: false });
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
    refreshGo();
  };
  $('folderFile').addEventListener('change', refreshGo);
}

// ---- reference (output) file picker — Validator mode -----------------------
function wireReferenceMode() {
  const drop = $('refDrop');
  const input = $('refFile') as HTMLInputElement;

  drop.onclick = async () => {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const picked = await open({ multiple: false });
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

  ['dragover', 'dragenter'].forEach((e) =>
    drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'dragend'].forEach((e) =>
    drop.addEventListener(e, () => drop.classList.remove('over')),
  );
  drop.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    drop.classList.remove('over');
    const f = (ev as DragEvent).dataTransfer?.files?.[0];
    if (f) setRef(await f.arrayBuffer(), f.name);
  });
}

function setRef(bytes: ArrayBuffer, name: string) {
  refBytes = bytes;
  refName = name;
  const drop = $('refDrop');
  drop.classList.add('has-file');
  drop.innerHTML = `<div class="fn">✓ ${escapeHtml(name)}</div><div class="swap">click to choose a different file</div>`;
  refreshGo();
}

// ---- generate --------------------------------------------------------------
function refreshGo() {
  const hasInput = mode === 'file' ? !!pickedBytes : !!val('folderFile');
  const ready = val('memberId').trim() && hasInput && (appMode !== 'validate' || !!refBytes);
  const go = $('go') as HTMLButtonElement;
  go.disabled = blocked || !online || !ready;
  // Soft connection gate: explain why the button is disabled (no modal).
  go.title = !online ? 'No internet connection — reconnect to generate.' : '';
}

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
    // Notify the rest of the app (persistence on 'change', gating on 'input').
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function wireDatePickers(): void {
  wireDatePicker('reportingDate', 'reportingDatePick', 'reportingDateNative');
  wireDatePicker('creationDate', 'creationDatePick', 'creationDateNative');
}

async function onGenerate() {
  if (blocked) return;
  // Fully strict: re-confirm a live, current, online session at the moment of
  // generation (closes the gap between periodic heartbeats). No grace window.
  if (serverConfigured()) {
    await evaluateGate(true);
    if (blocked) return;
  }
  const go = $('go') as HTMLButtonElement;
  go.disabled = true;
  $('result').innerHTML = 'Converting…';
  try {
    const bytes = await resolveBytes();
    const reporting = toDdmmyyyy(val('reportingDate'));
    const result = await runConvert({
      formatId: val('format') as FormatId,
      bytes,
      memberId: val('memberId').trim(),
      memberName: val('memberName').trim() || undefined,
      reportingDate: reporting,
      creationDate: toDdmmyyyy(val('creationDate')) || reporting,
      report: ($('report') as HTMLInputElement).checked,
    });
    render(result);
  } catch (e) {
    $('result').innerHTML = `<span class="pill err">ERROR</span> ${escapeHtml((e as Error).message)}`;
  }
  refreshGo();
}

async function onValidate() {
  if (blocked) return;
  if (serverConfigured()) {
    await evaluateGate(true);
    if (blocked) return;
  }
  if (!refBytes) {
    $('result').innerHTML = '<span class="pill err">ERROR</span> Choose the output file to validate against.';
    return;
  }
  const go = $('go') as HTMLButtonElement;
  go.disabled = true;
  $('result').innerHTML = 'Comparing…';
  try {
    const bytes = await resolveBytes();
    const reporting = toDdmmyyyy(val('reportingDate'));
    const result = await runValidate({
      formatId: val('format') as FormatId,
      bytes,
      referenceBytes: refBytes,
      memberId: val('memberId').trim(),
      memberName: val('memberName').trim() || undefined,
      reportingDate: reporting,
      creationDate: toDdmmyyyy(val('creationDate')) || reporting,
      ignoreLineEndings: ($('ignoreEol') as HTMLInputElement).checked,
    });
    renderValidate(result.convert, result.compare);
  } catch (e) {
    $('result').innerHTML = `<span class="pill err">ERROR</span> ${escapeHtml((e as Error).message)}`;
  }
  refreshGo();
}

async function resolveBytes(): Promise<ArrayBuffer> {
  if (mode === 'file') {
    if (!pickedBytes) throw new Error('No file selected.');
    return pickedBytes;
  }
  const path = val('folderFile');
  if (!path) throw new Error('No file selected from the folder.');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return toArrayBuffer(await readFile(path));
}

// ---- render + save ---------------------------------------------------------
function render(r: ConvertResult) {
  const errCount = r.report.issues.filter((i) => i.severity === 'error').length;
  let html = r.report.ok
    ? '<span class="pill ok">VALID</span>'
    : `<span class="pill err">${errCount} ERROR${errCount === 1 ? '' : 'S'} — file not generated</span>`;
  if (r.counts)
    html += ` &nbsp; ${r.counts.borrowerCount} borrowers · ${r.counts.accountCount} accounts`;

  if (r.report.issues.length) {
    html += '<table><tr><th>Severity</th><th>Sheet</th><th>Row</th><th>Field</th><th>Message</th></tr>';
    html += r.report.issues
      .map(
        (i) =>
          `<tr><td class="sev-${i.severity}">${i.severity}</td><td>${escapeHtml(i.sheet)}</td><td>${i.rowNumber}</td><td>${escapeHtml(i.fieldKey)}</td><td>${escapeHtml(i.message)}</td></tr>`,
      )
      .join('');
    html += '</table>';
  }

  html += '<div class="actions" id="saveActions"></div>';
  html += '<div class="note">Files are written only where you choose to save them — nothing is uploaded.</div>';
  $('result').innerHTML = html;

  const actions = $('saveActions');
  const ext = getFormatExtension(val('format') as FormatId);
  if (r.output) {
    addSaveButton(actions, 'Save submission file', submissionFileName(ext), r.output, false);
  }
  if (r.reportWorkbook) {
    addSaveButton(actions, 'Save workbook report (.xlsx)', 'report.xlsx', r.reportWorkbook, true);
  }
}

// ---- render the Validator result -------------------------------------------
function renderValidate(c: ConvertResult, cmp?: CompareResult) {
  let html = '';

  // 1) The headline verdict.
  if (!cmp) {
    // Input couldn't be converted (blocking errors) → nothing to compare.
    const errCount = c.report.errors.length;
    html +=
      `<span class="pill err">CANNOT COMPARE</span> ` +
      `The input has ${errCount} blocking error${errCount === 1 ? '' : 's'}, so no output could be generated to compare. Fix the input below, then re-run.`;
  } else if (cmp.match) {
    html += `<span class="pill ok">MATCH ✓</span> ${escapeHtml(cmp.summary)}`;
  } else {
    html += `<span class="pill err">MISMATCH ✕</span> ${escapeHtml(cmp.summary)}`;
  }

  // 2) Size line (when we have a comparison).
  if (cmp) {
    html +=
      `<div class="note">Generated output: <strong>${cmp.generatedLength.toLocaleString()}</strong> bytes` +
      ` &nbsp;·&nbsp; Your reference file: <strong>${cmp.referenceLength.toLocaleString()}</strong> bytes</div>`;
  }

  // 3) Byte-level differences.
  if (cmp && !cmp.match && cmp.diffs.length) {
    html += '<table><tr><th>Offset</th><th>Line:Col</th><th>Generated</th><th>Your file</th><th>Context (generated → yours)</th></tr>';
    html += cmp.diffs
      .map((d) => {
        const e = d.expected === undefined ? '∅ (end)' : `0x${d.expected.toString(16).padStart(2, '0')}`;
        const a = d.actual === undefined ? '∅ (end)' : `0x${d.actual.toString(16).padStart(2, '0')}`;
        return (
          `<tr><td>${d.offset}</td><td>${d.line}:${d.column}</td>` +
          `<td class="sev-error">${e}</td><td class="sev-error">${a}</td>` +
          `<td><code class="selectable">${escapeHtml(d.expectedContext)}</code><br><code class="selectable">${escapeHtml(d.actualContext)}</code></td></tr>`
        );
      })
      .join('');
    html += '</table>';
    if (cmp.truncated)
      html += '<div class="note">Showing the first differences only — more exist further in the file.</div>';
  }

  // 4) Input-validation warnings/errors, so the user sees data issues too.
  if (c.report.issues.length) {
    html += `<label style="margin-top:16px;">Input validation report <span class="hint">(${c.report.errors.length} error(s), ${c.report.warnings.length} warning(s))</span></label>`;
    html += '<table><tr><th>Severity</th><th>Sheet</th><th>Row</th><th>Field</th><th>Message</th></tr>';
    html += c.report.issues
      .map(
        (i) =>
          `<tr><td class="sev-${i.severity}">${i.severity}</td><td>${escapeHtml(i.sheet)}</td><td>${i.rowNumber}</td><td>${escapeHtml(i.fieldKey)}</td><td>${escapeHtml(i.message)}</td></tr>`,
      )
      .join('');
    html += '</table>';
  }

  // 5) Optionally let the user save the freshly-generated output for inspection.
  html += '<div class="actions" id="saveActions"></div>';
  html += '<div class="note">Both files are read on this machine only — nothing is uploaded.</div>';
  $('result').innerHTML = html;

  if (c.output) {
    const ext = getFormatExtension(val('format') as FormatId);
    addSaveButton($('saveActions'), 'Save the generated output', submissionFileName(ext), c.output, true);
  }
}

function addSaveButton(
  parent: HTMLElement,
  label: string,
  defaultName: string,
  data: Uint8Array,
  alt: boolean,
) {
  const btn = document.createElement('button');
  btn.className = 'dl' + (alt ? ' alt' : '');
  btn.textContent = label;
  btn.onclick = () => saveFile(defaultName, data);
  parent.appendChild(btn);
}

async function saveFile(defaultName: string, data: Uint8Array) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName });
    if (path) await writeFile(path, data);
  } else {
    const blob = new Blob([toArrayBuffer(data)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// ---- helpers ---------------------------------------------------------------
function getFormatExtension(id: FormatId): string {
  return getFormat(id).outputExtension;
}

/**
 * Build the CRIF submission file name the bureau expects:
 *   `{MemberCode}_Commercial_{ReportingDDMMYYYY}_{CreationDDMMYYYY}_{HHMMSS}_{Cycle}.Tap`
 * e.g. `NB51840001_Commercial_30062026_12072026_162820_ME.Tap`. The HHMMSS is the
 * generation wall-clock time and the cycle (W1/W2/W3/ME) is derived from the
 * reporting date. Falls back to a plain `submission{ext}` when the format isn't a
 * commercial one or the required fields (member code / reporting date) are missing.
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

  // CRIF names the delimited commercial file with a `.Tap` extension regardless of
  // the internal text extension used elsewhere in the tool.
  return `${member}_Commercial_${reporting}_${creation}_${hhmmss}_${cycle}.Tap`;
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
