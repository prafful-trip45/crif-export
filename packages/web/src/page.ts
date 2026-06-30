/** Single-page UI for the local portal (inline HTML/CSS/JS, no build step). */
export const PAGE_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CRIF Export — Bureau Submission Generator</title>
<style>
  :root { --bg:#0f1419; --card:#1a212b; --line:#2b3543; --ink:#e6edf3; --muted:#9aa7b4; --accent:#4f8cff; --ok:#2ea043; --err:#f85149; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:880px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:18px; }
  label { display:block; font-weight:600; margin:14px 0 6px; }
  .hint { color:var(--muted); font-weight:400; font-size:12px; }
  select, input[type=text], input[type=password] { width:100%; padding:9px 11px; background:#0d1117; border:1px solid var(--line); border-radius:8px; color:var(--ink); }
  .row { display:flex; gap:14px; } .row > div { flex:1; }
  .tabs { display:flex; gap:8px; margin:6px 0 12px; }
  .tab { padding:8px 14px; border:1px solid var(--line); border-radius:8px; cursor:pointer; background:#0d1117; color:var(--muted); }
  .tab.active { border-color:var(--accent); color:var(--ink); }
  .drop { border:2px dashed var(--line); border-radius:10px; padding:30px; text-align:center; color:var(--muted); cursor:pointer; transition:border-color .12s,color .12s,background .12s; }
  .drop.over { border-color:var(--accent); color:var(--ink); }
  .drop.has-file { border-style:solid; border-color:var(--ok); color:var(--ink); background:rgba(46,160,67,.08); }
  .drop .fn { font-weight:700; color:var(--ink); word-break:break-all; }
  .drop .swap { color:var(--accent); font-size:12px; }
  button.go { margin-top:18px; width:100%; padding:12px; font-weight:700; font-size:15px; background:var(--accent); color:#fff; border:0; border-radius:9px; cursor:pointer; }
  button.go:disabled { opacity:.5; cursor:not-allowed; }
  .hidden { display:none; }
  .result { margin-top:16px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700; }
  .pill.ok { background:rgba(46,160,67,.15); color:var(--ok); }
  .pill.err { background:rgba(248,81,73,.15); color:var(--err); }
  table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12.5px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.sev-error { color:var(--err); } td.sev-warning { color:var(--warn); }
  a.dl { display:inline-block; margin-top:12px; padding:10px 16px; background:var(--ok); color:#fff; border-radius:8px; text-decoration:none; font-weight:700; }
  code { background:#0d1117; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>CRIF Export</h1>
  <p class="sub">Convert customer data in Excel → CRIF Highmark bureau submission files.</p>

  <div class="card">
    <label>Bureau format / portal <span class="hint">(which submission you are filing)</span></label>
    <select id="format"></select>

    <div class="row">
      <div>
        <label>Member / MFI / NBF ID</label>
        <input type="text" id="memberId" placeholder="e.g. NBF1111111" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/>
      </div>
      <div>
        <label>Reporting / cycle date <span class="hint">DD/MM/YYYY</span></label>
        <input type="text" id="reportingDate" placeholder="30/04/2024" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/>
      </div>
      <div>
        <label>Creation date <span class="hint">DD/MM/YYYY</span></label>
        <input type="text" id="creationDate" placeholder="30/04/2024" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/>
      </div>
    </div>
    <div class="row">
      <div id="memberNameWrap">
        <label>Member name <span class="hint">(MFI)</span></label>
        <input type="text" id="memberName" placeholder="ABC Microfinance" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/>
      </div>
    </div>
    <label class="hint" style="font-weight:400;margin-top:14px;">
      <input type="checkbox" id="report" style="width:auto;vertical-align:middle;"/>
      Also generate the multi-sheet workbook report (.xlsx — one sheet per segment + sorting)
    </label>
    <p class="hint">For flat-sheet formats you may leave Member ID &amp; dates blank if filled in the sheet's header cells — the sheet overrides these.</p>
  </div>

  <div class="card">
    <label>Input source</label>
    <div class="tabs">
      <div class="tab active" data-mode="folder">Local folder path</div>
      <div class="tab" data-mode="drop">Drag &amp; drop file</div>
    </div>

    <div id="modeFolder">
      <label>Folder containing the Excel file(s) <span class="hint">absolute path on this machine</span></label>
      <input type="text" id="folder" placeholder="/Users/me/Desktop/submissions" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"/>
      <label>File <span class="hint">(picked from the folder)</span></label>
      <select id="folderFile"><option value="">— type a folder path above —</option></select>
    </div>

    <div id="modeDrop" class="hidden">
      <div class="drop" id="drop">Drop a <code>.xlsx</code> here, or click to choose</div>
      <input type="file" id="file" accept=".xlsx" class="hidden"/>
      <div id="fileName" class="hint"></div>
    </div>
  </div>

  <button class="go" id="go" disabled>Generate submission file</button>
  <div class="result" id="result"></div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let mode = 'folder';
let uploadB64 = null, uploadName = null;

// Persist the user's choices across reloads (selected format, typed fields, mode).
const PERSIST = ['format','memberId','memberName','reportingDate','creationDate'];
const STORE = 'crif-export-form';
function saveForm() {
  const data = {}; PERSIST.forEach(id => { data[id] = $(id).value; });
  data.report = $('report').checked; data.mode = mode;
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch(e){}
}
function loadForm() {
  let data; try { data = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch(e){ data = {}; }
  PERSIST.forEach(id => { if (data[id] != null && id !== 'format') $(id).value = data[id]; });
  return data;
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.mode === m));
  $('modeFolder').classList.toggle('hidden', mode!=='folder');
  $('modeDrop').classList.toggle('hidden', mode!=='drop');
}

// Parse a fetch Response as JSON, but surface a readable error when the server
// returns HTML/text (5xx, error page) instead of "Unexpected token '<'".
async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) {
    const snippet = text.replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim().slice(0,160);
    throw new Error('Server returned a non-JSON response (HTTP '+res.status+'). '+(snippet||'The request may have failed or timed out.'));
  }
}

async function init() {
  const { formats } = await safeJson(await fetch('/api/formats'));
  $('format').innerHTML = formats.map(f => '<option value="'+f.id+'">'+f.label+'</option>').join('');
  const saved = loadForm();
  if (saved.format && formats.some(f => f.id === saved.format)) $('format').value = saved.format;
  if (saved.report) $('report').checked = true;
  setMode(saved.mode === 'drop' ? 'drop' : 'folder');
  PERSIST.concat(['report']).forEach(id => $(id).addEventListener('change', saveForm));
  refreshGo();
}
init();

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  setMode(t.dataset.mode);
  saveForm();
  refreshGo();
});

$('folder').addEventListener('change', async () => {
  const folder = $('folder').value.trim(); if (!folder) return;
  try {
    const r = await safeJson(await fetch('/api/resolve-folder',{method:'POST',body:JSON.stringify({folder})}));
    if (r.error) { $('folderFile').innerHTML = '<option value="">'+r.error+'</option>'; return; }
    $('folderFile').innerHTML = r.files.length
      ? r.files.map(f => '<option value="'+f+'">'+f.split('/').pop()+'</option>').join('')
      : '<option value="">no .xlsx files found</option>';
  } catch(e){ $('folderFile').innerHTML = '<option value="">'+e.message+'</option>'; }
  refreshGo();
});
$('folderFile').addEventListener('change', refreshGo);

const drop = $('drop');
drop.onclick = () => $('file').click();
// Prevent the browser from navigating to a file dropped anywhere on the window.
['dragover','drop'].forEach(e => window.addEventListener(e, ev => ev.preventDefault()));
['dragover','dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave','dragend'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', ev => { ev.preventDefault(); drop.classList.remove('over'); handleFile(ev.dataTransfer.files[0]); });
$('file').addEventListener('change', ev => handleFile(ev.target.files[0]));

function handleFile(f) {
  if (!f) return;
  uploadName = f.name;
  // Reflect the selection in the drop zone itself (not just the line below it).
  drop.classList.add('has-file');
  drop.innerHTML = '<div class="fn">✓ ' + f.name + '</div><div class="swap">click to choose a different file</div>';
  $('fileName').textContent = '';
  const reader = new FileReader();
  reader.onload = () => { uploadB64 = reader.result.split(',')[1]; refreshGo(); };
  reader.readAsDataURL(f);
}

function refreshGo() {
  const hasInput = mode==='folder' ? !!$('folderFile').value : !!uploadB64;
  $('go').disabled = !($('memberId').value.trim() && hasInput);
}
['memberId','format'].forEach(id => $(id).addEventListener('input', refreshGo));

$('go').onclick = async () => {
  $('go').disabled = true; $('result').innerHTML = 'Converting…';
  const payload = {
    formatId: $('format').value,
    memberId: $('memberId').value.trim(),
    memberName: $('memberName').value.trim() || undefined,
    reportingDate: toDdmmyyyy($('reportingDate').value),
    creationDate: toDdmmyyyy($('creationDate').value) || toDdmmyyyy($('reportingDate').value),
    report: $('report').checked,
  };
  if (mode==='folder') payload.filePath = $('folderFile').value;
  else { payload.fileBase64 = uploadB64; }

  try {
    const r = await safeJson(await fetch('/api/convert',{method:'POST',body:JSON.stringify(payload)}));
    render(r);
  } catch(e){ $('result').innerHTML = '<span class="pill err">ERROR</span> '+e.message; }
  refreshGo();
};

function toDdmmyyyy(s){ const m=/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec((s||'').trim()); if(!m) return undefined; return m[1].padStart(2,'0')+m[2].padStart(2,'0')+m[3]; }

function render(r){
  if (r.error){ $('result').innerHTML = '<span class="pill err">ERROR</span> '+r.error; return; }
  let html = r.ok ? '<span class="pill ok">VALID</span>' : '<span class="pill err">'+r.issues.filter(i=>i.severity==='error').length+' ERRORS — file not generated</span>';
  if (r.counts) html += ' &nbsp; '+r.counts.borrowerCount+' borrowers · '+r.counts.accountCount+' accounts';
  if (r.issues.length){
    html += '<table><tr><th>Severity</th><th>Sheet</th><th>Row</th><th>Field</th><th>Message</th></tr>';
    html += r.issues.map(i => '<tr><td class="sev-'+i.severity+'">'+i.severity+'</td><td>'+i.sheet+'</td><td>'+i.rowNumber+'</td><td>'+i.fieldKey+'</td><td>'+i.message+'</td></tr>').join('');
    html += '</table>';
  }
  if (r.outputBase64){
    const href = 'data:application/octet-stream;base64,'+r.outputBase64;
    html += '<br><a class="dl" download="submission'+r.extension+'" href="'+href+'">Download submission'+r.extension+'</a>';
  }
  if (r.reportBase64){
    const href = 'data:application/octet-stream;base64,'+r.reportBase64;
    html += ' <a class="dl" download="report.xlsx" href="'+href+'">Download workbook report (.xlsx)</a>';
  }
  $('result').innerHTML = html;
}
</script>
</body>
</html>`;
