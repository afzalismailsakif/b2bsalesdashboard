/* ==========================================================
   B2B Sales Dashboard
   Reads the published Google Sheet (CSV) and renders the page.
   Edit CONFIG to change the data source or the default targets.
   ========================================================== */
'use strict';

const CONFIG = {
  // Published-to-web CSV of the Google Sheet (File → Share → Publish to web → CSV)
  sheetUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR5_ZuCTFWUvfyCNla7wmkg9O0BcM6IOW702XkVpOSbD3dc_4I1Hp1-hSaCLiW9u62wcYDSs9UE2faM/pub?output=csv',
  // Web app URL of the targets Apps Script (see targets-api.gs). Targets saved there are shared by everyone.
  targetsApiUrl: 'https://script.google.com/macros/s/AKfycbwYYrGW7doSuy2Io_zwwHNsFGoKRGfuHKpe_-2lGKnPv3KKbT76FnTXNm9vmyMYLiGh_g/exec',
  // Fallback team target for each calendar month, January → December (£), used until the shared targets load
  defaultTargets: [35000, 35000, 35000, 20000, 20000, 20000, 20000, 20000, 35000, 35000, 35000, 35000],
  fyStartMonth: 2,          // Financial year starts in February
  autoRefreshMinutes: 5,    // Re-check the sheet this often while the tab is open
  pageSize: 25,             // Rows per page in "All deals"
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));

/* ---------- Formatting ---------- */
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-GB');
const money = v => gbp0.format(Math.round(v || 0));
const moneyExact = v => (Number.isInteger(v) ? gbp0.format(v) : gbp2.format(v));
const compact = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return '£' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (a >= 1e3) return '£' + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '£' + Math.round(v);
};
const pct = (v, d = 0) => (v == null || !isFinite(v) ? '–' : v.toFixed(d) + '%');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Periods ---------- */
// A period is a month encoded as year*12 + (month-1), so consecutive months are consecutive integers.
const key = (y, m) => y * 12 + (m - 1);
const fromKey = k => ({ y: Math.floor(k / 12), m: (k % 12) + 1 });
const shortLabel = k => { const { y, m } = fromKey(k); return `${MON[m - 1]} ’${String(y).slice(2)}`; };
const medLabel = k => { const { y, m } = fromKey(k); return `${MON[m - 1]} ${y}`; };
const longLabel = k => { const { y, m } = fromKey(k); return `${MONTHS[m - 1]} ${y}`; };
const daysIn = k => { const { y, m } = fromKey(k); return new Date(y, m, 0).getDate(); };

/* ---------- State ---------- */
let rows = [];
let lastSync = null;
let syncError = null;
let targets = loadTargets();
let targetsUpdatedAt = null;
const state = { mode: 'fy', year: 'all', month: 'all', people: new Set() };
const tx = { sort: 'period', dir: 'desc', page: 1, search: '' };
const charts = {};
let refreshTimer = null;

const $ = id => document.getElementById(id);

/* ---------- Storage (best effort) ---------- */
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
// Last shared targets seen by this browser, so the page draws with them before the API answers.
function loadTargets() {
  const raw = read('b2b-targets-shared');
  if (raw) {
    try {
      const t = JSON.parse(raw);
      if (Array.isArray(t) && t.length === 12 && t.every(n => typeof n === 'number' && n >= 0)) return t;
    } catch (e) { /* fall through */ }
  }
  return CONFIG.defaultTargets.slice();
}

/* ---------- Time helpers ---------- */
function now() { return new Date(); }
function todayKey() { const d = now(); return key(d.getFullYear(), d.getMonth() + 1); }
// Share of a month that has elapsed (1 for past months, 0 for future).
function elapsed(k) {
  const t = todayKey();
  if (k < t) return 1;
  if (k > t) return 0;
  const d = now();
  return Math.min(1, (d.getDate() - 1 + d.getHours() / 24) / daysIn(k));
}
const targetFor = k => targets[k % 12] || 0;

/* ---------- Year logic ---------- */
const fyOf = (y, m) => (m >= CONFIG.fyStartMonth ? y : y - 1);
const yearOfKey = k => { const { y, m } = fromKey(k); return state.mode === 'fy' ? fyOf(y, m) : y; };
function yearLabel(y, mode = state.mode) {
  if (mode === 'cal') return String(y);
  return CONFIG.fyStartMonth === 1 ? `FY ${y}` : `FY ${y}/${String(y + 1).slice(2)}`;
}
function periodsOfYear(y) {
  const start = state.mode === 'fy' ? key(y, CONFIG.fyStartMonth) : key(y, 1);
  return Array.from({ length: 12 }, (_, i) => start + i);
}
function monthOrder() {
  if (state.mode === 'cal') return MONTHS.map((_, i) => i + 1);
  return Array.from({ length: 12 }, (_, i) => ((CONFIG.fyStartMonth - 1 + i) % 12) + 1);
}
function availableYears() {
  return [...new Set(rows.map(r => yearOfKey(r.period)))].sort((a, b) => b - a);
}

/* ---------- Data loading ---------- */
function parseCSV(text) {
  const out = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); out.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out.filter(r => r.some(v => v.trim() !== ''));
}

function toRows(table) {
  if (!table.length) return [];
  const head = table[0].map(h => h.trim().toLowerCase());
  // Try each keyword in priority order so "Sales person name" is never mistaken for the amount.
  const find = (...words) => { for (const w of words) { const i = head.findIndex(h => h.includes(w)); if (i >= 0) return i; } return -1; };
  const iName = find('person', 'name', 'rep');
  const iAmt = find('amount', 'value', 'revenue');
  const iMonth = find('month');
  const iYear = find('year');
  if ([iName, iAmt, iMonth, iYear].some(i => i < 0)) throw new Error('The sheet needs columns for salesperson, amount, month and year.');
  const monthNum = v => {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 12) return n;
    const idx = MON.findIndex(m => v.trim().toLowerCase().startsWith(m.toLowerCase()));
    return idx >= 0 ? idx + 1 : NaN;
  };
  const list = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const name = (r[iName] || '').trim();
    const amount = parseFloat(String(r[iAmt] || '').replace(/[£$,\s]/g, ''));
    const m = monthNum(r[iMonth] || '');
    const y = parseInt(r[iYear], 10);
    if (!name || !isFinite(amount) || !m || !y) continue;
    list.push({ id: i, name, amount, month: m, year: y, period: key(y, m) });
  }
  return list;
}

const validTargets = t => Array.isArray(t) && t.length === 12 && t.every(n => typeof n === 'number' && isFinite(n) && n >= 0);

async function fetchTargets() {
  if (!CONFIG.targetsApiUrl) return;
  try {
    const sep = CONFIG.targetsApiUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${CONFIG.targetsApiUrl}${sep}t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok || !validTargets(data.targets)) throw new Error(data.error || 'Unexpected targets response');
    targets = data.targets;
    targetsUpdatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    store('b2b-targets-shared', JSON.stringify(targets));
  } catch (err) {
    console.warn('Could not load shared targets, using the last known ones.', err);
  }
}

async function loadData({ silent = false } = {}) {
  const btn = $('refreshBtn');
  btn.classList.add('spinning');
  setSync('loading');
  const before = rows.length;
  const targetsReady = fetchTargets();
  try {
    const sep = CONFIG.sheetUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${CONFIG.sheetUrl}${sep}t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Google Sheets returned ${res.status}`);
    const parsed = toRows(parseCSV(await res.text()));
    if (!parsed.length) throw new Error('The sheet has no rows that could be read.');
    await targetsReady;
    const first = !rows.length;
    rows = parsed;
    lastSync = new Date();
    syncError = null;
    $('notice').hidden = true;
    if (first) initFilters();
    else rebuildFilterOptions();
    render();
    if (!first && !silent && rows.length === before) toast('Up to date');
    if (!first && rows.length > before) toast(`${rows.length - before} new deal${rows.length - before === 1 ? '' : 's'} added`);
  } catch (err) {
    console.error(err);
    syncError = err;
    if (!rows.length) {
      const n = $('notice');
      n.hidden = false;
      n.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>Couldn’t load the sales sheet: ${esc(err.message)}. Check the sheet is still published to the web, then press refresh.</span>`;
      document.body.classList.remove('is-loading');
    }
  } finally {
    btn.classList.remove('spinning');
    setSync();
  }
}

function setSync(mode) {
  const el = $('syncStatus');
  el.className = 'sync';
  if (mode === 'loading' && !lastSync) { el.classList.add('is-loading'); el.innerHTML = '<span class="dot"></span>Loading from Google Sheets…'; return; }
  if (syncError) {
    el.classList.add('is-error');
    el.innerHTML = `<span class="dot"></span>${lastSync ? 'Sync failed, showing data from ' + lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not connected'}`;
    return;
  }
  if (!lastSync) return;
  const mins = Math.floor((Date.now() - lastSync) / 60000);
  const ago = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`;
  el.innerHTML = `<span class="dot"></span>Synced ${ago}, ${int.format(rows.length)} deals`;
  el.title = `Last synced ${lastSync.toLocaleString()}`;
}

/* ---------- Filters ---------- */
function initFilters() {
  // Default view: the year that contains today, if there is data for it.
  const years = availableYears();
  const tk = todayKey();
  const curYear = yearOfKey(tk);
  state.year = years.includes(curYear) ? curYear : (years[0] ?? 'all');
  readHash();
  rebuildFilterOptions();
}

function rebuildFilterOptions() {
  const years = availableYears();
  if (state.year !== 'all' && !years.includes(state.year)) state.year = years[0] ?? 'all';
  $('yearFilter').innerHTML = `<option value="all">All years</option>` +
    years.map(y => `<option value="${y}">${yearLabel(y)}</option>`).join('');
  $('yearFilter').value = String(state.year);

  $('monthFilter').innerHTML = `<option value="all">All months</option>` +
    monthOrder().map(m => `<option value="${m}">${MONTHS[m - 1]}</option>`).join('');
  $('monthFilter').value = String(state.month);

  const people = [...new Set(rows.map(r => r.name))].sort((a, b) => a.localeCompare(b));
  for (const p of [...state.people]) if (!people.includes(p)) state.people.delete(p);
  $('peopleOptions').innerHTML = people.map(p =>
    `<label><input type="checkbox" value="${esc(p)}" ${state.people.has(p) ? 'checked' : ''}> ${esc(p)}</label>`).join('');

  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
  updatePeopleSummary();
}

function updatePeopleSummary() {
  const n = state.people.size;
  $('peopleSummary').textContent = n === 0 ? 'Everyone' : n === 1 ? [...state.people][0] : `${n} people`;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('mode') === 'cal' || p.get('mode') === 'fy') state.mode = p.get('mode');
  if (p.has('year')) state.year = p.get('year') === 'all' ? 'all' : parseInt(p.get('year'), 10) || state.year;
  if (p.has('month')) { const m = parseInt(p.get('month'), 10); state.month = m >= 1 && m <= 12 ? m : 'all'; }
  if (p.get('people')) state.people = new Set(p.get('people').split('|').filter(Boolean));
}
function writeHash() {
  const p = new URLSearchParams();
  p.set('mode', state.mode);
  p.set('year', state.year);
  if (state.month !== 'all') p.set('month', state.month);
  if (state.people.size) p.set('people', [...state.people].join('|'));
  history.replaceState(null, '', '#' + p.toString());
}

function setFilter(patch) {
  Object.assign(state, patch);
  tx.page = 1;
  rebuildFilterOptions();
  render();
}

/* ---------- Selections ---------- */
const personOk = r => state.people.size === 0 || state.people.has(r.name);
// Rows for the selected year (ignores month) — used for charts that give the year as context.
function yearRows() { return rows.filter(r => personOk(r) && (state.year === 'all' || yearOfKey(r.period) === state.year)); }
// Rows for the full selection, including month.
function scopeRows() { return yearRows().filter(r => state.month === 'all' || r.month === state.month); }
// Months on the x-axis of the charts.
function chartPeriods() {
  if (state.year !== 'all') return periodsOfYear(state.year);
  if (!rows.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) { lo = Math.min(lo, r.period); hi = Math.max(hi, r.period); }
  hi = Math.max(hi, Math.min(todayKey(), hi + 1));
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
// Months covered by the full selection (only defined when a year is chosen).
function scopePeriods() {
  if (state.year === 'all') return null;
  return periodsOfYear(state.year).filter(k => state.month === 'all' || fromKey(k).m === state.month);
}
function sumBy(list, fn) { const m = new Map(); for (const r of list) { const k = fn(r); m.set(k, (m.get(k) || 0) + r.amount); } return m; }
function countBy(list, fn) { const m = new Map(); for (const r of list) { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); } return m; }
const total = list => list.reduce((s, r) => s + r.amount, 0);

// Same selection, one year earlier, cut to the same point in time (current month pro-rated).
function priorComparison() {
  const sp = scopePeriods();
  if (!sp) return null;
  const tk = todayKey();
  const live = sp.filter(k => k <= tk);
  if (!live.length) return null;
  let amount = 0, deals = 0;
  const byPerson = new Map();
  for (const k of live) {
    const f = elapsed(k);
    const list = rows.filter(r => r.period === k - 12 && personOk(r));
    if (!list.length) continue;
    amount += total(list) * f;
    deals += list.length * f;
    for (const r of list) byPerson.set(r.name, (byPerson.get(r.name) || 0) + r.amount * f);
  }
  const hasData = rows.some(r => live.includes(r.period + 12));
  if (!hasData) return null;
  return { amount, deals, byPerson };
}

/* ---------- Status ---------- */
function statusFor(ratio, inProgress) {
  if (ratio == null) return { cls: 'neutral', icon: 'fa-circle-minus', label: 'No target' };
  if (ratio >= 1) return { cls: 'good', icon: 'fa-circle-check', label: inProgress ? 'On track' : 'Target hit' };
  if (ratio >= 0.7) return { cls: 'warning', icon: 'fa-circle-half-stroke', label: inProgress ? 'Behind pace' : 'Missed target' };
  return { cls: 'critical', icon: 'fa-circle-exclamation', label: inProgress ? 'Well behind pace' : 'Missed target' };
}
const statusHTML = s => `<i class="fa-solid ${s.icon}"></i>${s.label}`;

/* ---------- Render ---------- */
function render() {
  if (!rows.length) return;
  document.body.classList.remove('is-loading');
  writeHash();
  renderScopeNote();
  renderPace();
  renderKPIs();
  renderTrend();
  renderLeaderboard();
  renderAttainment();
  renderCumulative();
  renderHeatmap();
  renderMonthTable();
  renderTransactions();
}

function renderScopeNote() {
  let when;
  if (state.year === 'all') when = state.month === 'all' ? 'all time' : `every ${MONTHS[state.month - 1]}`;
  else {
    const ps = periodsOfYear(state.year);
    when = state.month === 'all'
      ? `${yearLabel(state.year)} (${medLabel(ps[0])} to ${medLabel(ps[11])})`
      : longLabel(ps.find(k => fromKey(k).m === state.month));
  }
  const who = state.people.size ? [...state.people].join(', ') : 'the whole team';
  $('scopeNote').textContent = `Showing ${when} for ${who}.`;
}

function focusPeriod() {
  const tk = todayKey();
  if (state.year !== 'all') {
    const ps = periodsOfYear(state.year);
    if (state.month !== 'all') return ps.find(k => fromKey(k).m === state.month);
    if (ps.includes(tk)) return tk;
    return tk > ps[11] ? ps[11] : ps[0];
  }
  const maxK = Math.max(...rows.map(r => r.period));
  if (state.month !== 'all') {
    const ks = rows.filter(r => r.month === state.month).map(r => r.period);
    return ks.length ? Math.max(...ks) : key(fromKey(tk).y, state.month);
  }
  return tk <= maxK + 1 ? tk : maxK;
}

function setTrack(fillId, markerId, trackId, ratio, markerRatio, label) {
  const fill = $(fillId), marker = $(markerId);
  fill.style.width = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`;
  fill.classList.toggle('over', (ratio || 0) >= 1);
  if (markerRatio != null && markerRatio > 0 && markerRatio < 1) {
    marker.classList.add('show');
    marker.style.left = `calc(${markerRatio * 100}% - 1px)`;
  } else marker.classList.remove('show');
  $(trackId).setAttribute('aria-label', label);
}

function renderPace() {
  const k = focusPeriod();
  const list = rows.filter(r => r.period === k && personOk(r));
  const actual = total(list);
  const target = targetFor(k);
  const f = elapsed(k);
  const inProgress = f > 0 && f < 1;
  const partial = state.people.size > 0;

  $('paceTitle').textContent = longLabel(k) + (partial ? ' (selected people vs team target)' : '');
  $('paceActual').textContent = money(actual);
  $('paceTarget').textContent = money(target);
  $('pacePct').textContent = target ? pct(actual / target * 100) : '–';

  let status, facts = [];
  if (f === 0) {
    status = { cls: 'neutral', icon: 'fa-clock', label: 'Not started' };
    facts.push(`<li><i class="fa-solid fa-bullseye"></i>Target <strong>${money(target)}</strong></li>`);
  } else if (inProgress) {
    const projected = f > 0.02 ? actual / f : null;
    const expected = target * f;
    status = actual >= target ? statusFor(1, false) : statusFor(projected != null && target ? projected / target : (actual >= expected ? 1 : 0.5), true);
    const daysLeft = daysIn(k) - now().getDate() + 1;
    facts.push(`<li><i class="fa-solid fa-location-dot"></i>Expected by today <strong>${money(expected)}</strong></li>`);
    if (projected != null) facts.push(`<li><i class="fa-solid fa-chart-line"></i>Projected month end <strong>${money(projected)}</strong></li>`);
    if (actual < target) facts.push(`<li><i class="fa-solid fa-person-running"></i>Needs <strong>${money((target - actual) / daysLeft)}</strong> a day for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}</li>`);
  } else {
    status = statusFor(target ? actual / target : null, false);
    const prev = rows.filter(r => r.period === k - 12 && personOk(r));
    if (prev.length) {
      const d = actual - total(prev);
      facts.push(`<li><i class="fa-solid fa-calendar"></i>${d >= 0 ? 'Up' : 'Down'} <strong>${money(Math.abs(d))}</strong> on ${medLabel(k - 12)}</li>`);
    }
    if (actual < target) facts.push(`<li><i class="fa-solid fa-bullseye"></i>Short by <strong>${money(target - actual)}</strong></li>`);
    else facts.push(`<li><i class="fa-solid fa-bullseye"></i>Beat target by <strong>${money(actual - target)}</strong></li>`);
  }
  facts.push(`<li><i class="fa-solid fa-handshake"></i><strong>${list.length}</strong> deal${list.length === 1 ? '' : 's'}</li>`);
  const top = [...sumBy(list, r => r.name)].sort((a, b) => b[1] - a[1])[0];
  if (top && !(state.people.size === 1)) facts.push(`<li><i class="fa-solid fa-trophy"></i>Top seller <strong>${esc(top[0])}</strong> ${money(top[1])}</li>`);

  const ps = $('paceStatus');
  ps.className = `status ${status.cls}`;
  ps.innerHTML = statusHTML(status);
  $('paceFacts').innerHTML = facts.join('');
  setTrack('paceFill', 'paceMarker', 'paceTrack', target ? actual / target : 0, inProgress ? f : null,
    `${money(actual)} of ${money(target)} target`);

  // Year panel
  const y = state.year !== 'all' ? state.year : yearOfKey(k);
  const yps = periodsOfYear(y);
  const yList = rows.filter(r => yps.includes(r.period) && personOk(r));
  const yActual = total(yList);
  const yTarget = yps.reduce((s, p) => s + targetFor(p), 0);
  const yExpected = yps.reduce((s, p) => s + targetFor(p) * elapsed(p), 0);
  $('fyTitle').textContent = state.mode === 'fy' ? `Financial year ${yearLabel(y).replace('FY ', '')}` : `Calendar year ${y}`;
  $('fyActual').textContent = money(yActual);
  $('fyTarget').textContent = money(yTarget);
  const yearDone = yExpected >= yTarget - 0.5;
  const yFacts = [];
  yFacts.push(`<li><i class="fa-solid fa-percent"></i><strong>${yTarget ? pct(yActual / yTarget * 100) : '–'}</strong>&nbsp;of the year’s target</li>`);
  if (yExpected > 0 && !yearDone) {
    const gap = yActual - yExpected;
    yFacts.push(`<li><i class="fa-solid fa-location-dot"></i><strong>${money(Math.abs(gap))}</strong>&nbsp;${gap >= 0 ? 'ahead of' : 'behind'} pace</li>`);
    yFacts.push(`<li><i class="fa-solid fa-chart-line"></i>On course for <strong>${money(yActual * yTarget / yExpected)}</strong></li>`);
  }
  const done = yps.filter(p => elapsed(p) === 1);
  const byP = sumBy(yList, r => r.period);
  const hits = done.filter(p => (byP.get(p) || 0) >= targetFor(p)).length;
  if (done.length) yFacts.push(`<li><i class="fa-solid fa-circle-check"></i><strong>${hits} of ${done.length}</strong>&nbsp;finished months hit target</li>`);
  $('fyFacts').innerHTML = yFacts.join('');
  setTrack('fyFill', 'fyMarker', 'fyTrack', yTarget ? yActual / yTarget : 0, yearDone ? null : yExpected / yTarget,
    `${money(yActual)} of ${money(yTarget)} yearly target`);
}

function setDelta(id, cur, prev, fmt) {
  const el = $(id);
  el.className = 'kpi-delta';
  if (prev == null) { el.textContent = state.year === 'all' ? 'All years' : 'No earlier data'; el.classList.add('muted'); return; }
  if (prev === 0) { el.textContent = 'New vs last year'; return; }
  const d = (cur - prev) / prev * 100;
  el.classList.add(d >= 0 ? 'up' : 'down');
  el.innerHTML = `<i class="fa-solid fa-arrow-${d >= 0 ? 'up' : 'down'}"></i> ${Math.abs(d).toFixed(0)}% vs ${fmt}`;
  el.title = 'Compared with the same months last year, up to the same point in time';
}

function renderKPIs() {
  const list = scopeRows();
  const t = total(list);
  const prior = priorComparison();
  $('kpiTotal').textContent = money(t);
  $('kpiDeals').textContent = int.format(list.length);
  $('kpiAvg').textContent = money(list.length ? t / list.length : 0);
  const cmp = 'last year';
  setDelta('kpiTotalDelta', t, prior ? prior.amount : null, cmp);
  setDelta('kpiDealsDelta', list.length, prior ? prior.deals : null, cmp);
  setDelta('kpiAvgDelta', list.length ? t / list.length : 0, prior && prior.deals ? prior.amount / prior.deals : null, cmp);

  const max = list.reduce((b, r) => (!b || r.amount > b.amount ? r : b), null);
  $('kpiMax').textContent = max ? money(max.amount) : '–';
  $('kpiMaxWho').textContent = max ? `${max.name}, ${medLabel(max.period)}` : '';

  const people = [...sumBy(list, r => r.name)].sort((a, b) => b[1] - a[1]);
  $('kpiTop').textContent = people[0] ? people[0][0] : '–';
  $('kpiTopAmt').textContent = people[0] ? `${money(people[0][1])}, ${pct(people[0][1] / t * 100)} of sales` : '';

  const months = [...sumBy(list, r => r.period)].sort((a, b) => b[1] - a[1]);
  $('kpiBest').textContent = months[0] ? (state.year === 'all' ? medLabel(months[0][0]) : MONTHS[fromKey(months[0][0]).m - 1]) : '–';
  $('kpiBestAmt').textContent = months[0] ? `${money(months[0][1])}, ${targetFor(months[0][0]) ? pct(months[0][1] / targetFor(months[0][0]) * 100) + ' of target' : ''}` : '';
}

/* ---------- Charts ---------- */
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function baseOptions(extra = {}) {
  const ink2 = css('--ink-2'), line = css('--line');
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 6 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), borderColor: css('--line-strong'), borderWidth: 1,
        titleColor: css('--ink-3'), bodyColor: css('--ink'), padding: 10, cornerRadius: 8,
        titleFont: { weight: '500' }, bodyFont: { weight: '600' }, boxPadding: 4,
        usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: line }, ticks: { color: ink2, maxRotation: 0, autoSkipPadding: 8 } },
      y: { grid: { color: line }, border: { display: false }, ticks: { color: ink2, callback: v => compact(v), maxTicksLimit: 6 }, beginAtZero: true },
    },
    ...extra,
  };
}
function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  Chart.defaults.font.family = css('--font') || 'system-ui';
  Chart.defaults.font.size = 12;
  charts[id] = new Chart($(id), config);
}
function legendHTML(items) {
  return items.map(i => `<span><i class="${i.type}" style="${i.type === 'key-bar' ? 'background' : 'border-color'}:${i.color}"></i>${esc(i.label)}</span>`).join('');
}

function renderTrend() {
  const ps = chartPeriods();
  const yr = yearRows();
  const byP = sumBy(yr, r => r.period);
  const tk = todayKey();
  const accent = css('--accent'), s2 = css('--series-2'), tgt = css('--target');
  const focus = state.month !== 'all';
  const actual = ps.map(k => (k > tk && !byP.has(k) ? null : byP.get(k) || 0));
  const colors = ps.map(k => (!focus || fromKey(k).m === state.month ? accent : alpha(accent, 0.35)));
  const labels = ps.map(k => (state.year === 'all' ? shortLabel(k) : MON[fromKey(k).m - 1]));
  const datasets = [
    { type: 'bar', label: 'Sales', data: actual, backgroundColor: colors, hoverBackgroundColor: css('--accent-ink'),
      borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 38, categoryPercentage: 0.8, barPercentage: 0.9, order: 2, pointStyle: 'rect' },
    { type: 'line', label: 'Target', data: ps.map(targetFor), borderColor: tgt, borderDash: [5, 4], borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: tgt, stepped: 'middle', order: 1, pointStyle: 'line' },
  ];
  const legend = [{ type: 'key-bar', color: accent, label: 'Sales' }, { type: 'key-dash', color: tgt, label: 'Target' }];
  if (state.year !== 'all') {
    const prevAll = rows.filter(personOk);
    const prevBy = sumBy(prevAll, r => r.period);
    const prev = ps.map(k => (prevBy.has(k - 12) ? prevBy.get(k - 12) : null));
    if (prev.some(v => v != null)) {
      datasets.push({ type: 'line', label: `Previous year`, data: prev, borderColor: s2, backgroundColor: s2, borderWidth: 2,
        pointRadius: 3, pointHoverRadius: 5, pointBorderColor: css('--surface'), pointBorderWidth: 2, tension: 0.3, order: 0, spanGaps: false, pointStyle: 'line' });
      legend.push({ type: 'key-line', color: s2, label: 'Previous year' });
    }
  }
  $('trendLegend').innerHTML = legendHTML(legend);
  $('trendSub').textContent = state.people.size ? 'Sales by the selected people against the full team target.' : 'Bars are actual sales; the dashed line is the monthly target.';

  drawChart('trendChart', {
    data: { labels, datasets },
    options: baseOptions({
      onClick: (e, els, chart) => {
        const pts = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
        if (!pts.length) return;
        const k = ps[pts[0].index];
        const m = fromKey(k).m;
        // Defer so the chart finishes handling this click before it is redrawn.
        setTimeout(() => {
          if (state.month === m && state.year !== 'all') setFilter({ month: 'all' });
          else setFilter({ month: m, year: yearOfKey(k) });
        }, 0);
      },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: {
        ...baseOptions().plugins,
        tooltip: {
          ...baseOptions().plugins.tooltip,
          filter: i => i.raw != null,
          callbacks: {
            title: items => longLabel(ps[items[0].dataIndex]),
            label: c => `${c.dataset.label}: ${money(c.raw)}`,
            afterBody: items => {
              const k = ps[items[0].dataIndex];
              const a = byP.get(k) || 0, t = targetFor(k);
              return t && (k <= tk) ? [`${pct(a / t * 100)} of target${k === tk ? ' so far' : ''}`] : [];
            },
          },
        },
      },
    }),
  });
}

function renderAttainment() {
  const ps = chartPeriods();
  const byP = sumBy(yearRows(), r => r.period);
  const tk = todayKey();
  const vals = ps.map(k => (k > tk ? null : targetFor(k) ? (byP.get(k) || 0) / targetFor(k) * 100 : null));
  const colorFor = (v, k) => {
    if (v == null) return 'transparent';
    let ratio = v / 100;
    if (k === tk) { const f = elapsed(k); ratio = f > 0.02 ? ratio / f : 1; }
    const s = statusFor(ratio, k === tk).cls;
    const c = css(s === 'good' ? '--good' : s === 'warning' ? '--warning' : '--critical');
    return k === tk ? alpha(c, 0.55) : c;
  };
  const labels = ps.map(k => (state.year === 'all' ? shortLabel(k) : MON[fromKey(k).m - 1]));
  const maxV = Math.max(120, ...vals.filter(v => v != null).map(v => Math.ceil(v / 20) * 20 + 10));
  drawChart('attainChart', {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Achieved', data: vals, backgroundColor: ps.map((k, i) => colorFor(vals[i], k)),
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'start', maxBarThickness: 32, order: 2, pointStyle: 'rect' },
        { type: 'line', label: 'Target (100%)', data: ps.map(() => 100), borderColor: css('--target'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, order: 1, pointStyle: 'line' },
      ],
    },
    options: baseOptions({
      onClick: (e, els, chart) => {
        const pts = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
        if (!pts.length) return;
        const k = ps[pts[0].index];
        setTimeout(() => setFilter({ month: fromKey(k).m, year: yearOfKey(k) }), 0);
      },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      scales: {
        ...baseOptions().scales,
        y: { ...baseOptions().scales.y, max: maxV, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%', stepSize: 25 } },
      },
      plugins: {
        ...baseOptions().plugins,
        tooltip: {
          ...baseOptions().plugins.tooltip,
          filter: i => i.datasetIndex === 0 && i.raw != null,
          callbacks: {
            title: items => longLabel(ps[items[0].dataIndex]),
            label: c => {
              const k = ps[c.dataIndex];
              return `${pct(c.raw, 1)} of ${money(targetFor(k))}${k === tk ? ' so far' : ''}`;
            },
            afterLabel: c => {
              const k = ps[c.dataIndex];
              let ratio = c.raw / 100;
              if (k === tk) { const f = elapsed(k); ratio = f > 0.02 ? ratio / f : 1; }
              return statusFor(ratio, k === tk).label;
            },
          },
        },
      },
    }),
  });
}

function renderCumulative() {
  const empty = $('cumEmpty');
  if (state.year === 'all') {
    empty.hidden = false;
    $('cumLegend').innerHTML = '';
    $('cumSub').textContent = 'Cumulative sales through the year.';
    if (charts.cumChart) { charts.cumChart.destroy(); delete charts.cumChart; }
    return;
  }
  empty.hidden = true;
  const ps = periodsOfYear(state.year);
  const tk = todayKey();
  const byP = sumBy(rows.filter(personOk), r => r.period);
  let a = 0, t = 0, p = 0;
  const lastData = Math.max(...ps.filter(k => byP.has(k)), -Infinity);
  const actual = ps.map(k => { a += byP.get(k) || 0; return k <= Math.max(Math.min(tk, ps[11]), lastData) ? a : null; });
  const tgt = ps.map(k => (t += targetFor(k)));
  const hasPrev = ps.some(k => byP.has(k - 12));
  const prev = ps.map(k => (p += byP.get(k - 12) || 0));
  const accent = css('--accent'), s2 = css('--series-2'), tc = css('--target');
  const datasets = [
    { label: 'Actual', data: actual, borderColor: accent, backgroundColor: alpha(accent, 0.12), fill: 'origin', borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: accent, pointBorderColor: css('--surface'), pointBorderWidth: 2, tension: 0.25, pointStyle: 'line' },
    { label: 'Target', data: tgt, borderColor: tc, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, pointStyle: 'line' },
  ];
  const legend = [{ type: 'key-line', color: accent, label: 'Actual' }, { type: 'key-dash', color: tc, label: 'Target' }];
  if (hasPrev) {
    datasets.push({ label: 'Previous year', data: prev, borderColor: s2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, pointStyle: 'line' });
    legend.push({ type: 'key-line', color: s2, label: 'Previous year' });
  }
  $('cumLegend').innerHTML = legendHTML(legend);
  const lastIdx = actual.reduce((li, v, i) => (v != null ? i : li), -1);
  if (lastIdx >= 0) {
    const gap = actual[lastIdx] - tgt[lastIdx];
    $('cumSub').textContent = `${money(Math.abs(gap))} ${gap >= 0 ? 'ahead of' : 'behind'} the full-month targets to ${MON[fromKey(ps[lastIdx]).m - 1]}.`;
  }
  drawChart('cumChart', {
    type: 'line',
    data: { labels: ps.map(k => MON[fromKey(k).m - 1]), datasets },
    options: baseOptions({
      plugins: {
        ...baseOptions().plugins,
        tooltip: {
          ...baseOptions().plugins.tooltip,
          filter: i => i.raw != null,
          callbacks: {
            title: items => `To end of ${longLabel(ps[items[0].dataIndex])}`,
            label: c => `${c.dataset.label}: ${money(c.raw)}`,
          },
        },
      },
    }),
  });
}

/* ---------- Leaderboard ---------- */
function renderLeaderboard() {
  const list = scopeRows();
  const t = total(list);
  const sums = [...sumBy(list, r => r.name)].sort((a, b) => b[1] - a[1]);
  const counts = countBy(list, r => r.name);
  const prior = priorComparison();
  const max = sums[0] ? sums[0][1] : 1;
  if (!sums.length) { $('leaderboard').innerHTML = '<li class="panel-sub" style="padding:12px 8px">No sales in this view yet.</li>'; return; }
  $('leaderboard').innerHTML = sums.map(([name, amt], i) => {
    const n = counts.get(name);
    let delta = '';
    if (prior && prior.byPerson.has(name) && prior.byPerson.get(name) > 0) {
      const d = (amt - prior.byPerson.get(name)) / prior.byPerson.get(name) * 100;
      delta = `<span class="${d >= 0 ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${d >= 0 ? 'up' : 'down'}"></i> ${Math.abs(d).toFixed(0)}% vs last year</span>`;
    }
    const pressed = state.people.size === 1 && state.people.has(name);
    return `<li><button type="button" data-person="${esc(name)}" aria-pressed="${pressed}" title="${pressed ? 'Show everyone' : 'Show only ' + esc(name)}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${esc(name)}</span>
      <span class="lb-amt">${money(amt)}</span>
      <span class="lb-bar"><i style="width:${(amt / max * 100).toFixed(1)}%"></i></span>
      <span class="lb-meta"><span>${pct(amt / t * 100)} share</span><span>${n} deal${n === 1 ? '' : 's'}</span><span>avg ${money(amt / n)}</span>${delta}</span>
    </button></li>`;
  }).join('');
}

/* ---------- Heatmap ---------- */
function renderHeatmap() {
  const ps = chartPeriods();
  const yr = yearRows();
  const people = [...sumBy(yr, r => r.name)].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const cell = new Map(), cnt = new Map();
  for (const r of yr) {
    const k = r.name + '|' + r.period;
    cell.set(k, (cell.get(k) || 0) + r.amount);
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const max = Math.max(1, ...cell.values());
  const level = v => (v <= 0 ? 0 : Math.min(6, 1 + Math.floor(v / max * 5.999)));
  const colTotals = ps.map(k => total(yr.filter(r => r.period === k)));
  const focusM = state.month;
  const head = `<thead><tr><th></th>${ps.map(k => `<th class="${focusM !== 'all' && fromKey(k).m === focusM ? 'is-col-focus' : ''}">${state.year === 'all' ? shortLabel(k) : MON[fromKey(k).m - 1]}</th>`).join('')}<th class="total">Total</th></tr></thead>`;
  const body = people.map(p => {
    const tds = ps.map(k => {
      const v = cell.get(p + '|' + k) || 0;
      const lv = level(v);
      const f = focusM !== 'all' && fromKey(k).m === focusM ? ' col-focus' : '';
      return `<td class="cell lvl-${lv}${f}" data-tip="${esc(p)}|${k}|${v}|${cnt.get(p + '|' + k) || 0}">${v ? compact(v) : ''}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(p)}</th>${tds}<td class="total">${money(total(yr.filter(r => r.name === p)))}</td></tr>`;
  }).join('');
  const foot = `<tfoot><tr><th>Team</th>${colTotals.map(v => `<td>${v ? compact(v) : ''}</td>`).join('')}<td class="total">${money(total(yr))}</td></tr></tfoot>`;
  $('heatmap').innerHTML = people.length ? head + `<tbody>${body}</tbody>` + foot : '<tbody><tr class="empty-row"><td>No sales in this view yet.</td></tr></tbody>';
}

let tipEl;
function showTip(e) {
  const td = e.target.closest('td[data-tip]');
  if (!td) { hideTip(); return; }
  const [name, k, v, n] = td.dataset.tip.split('|');
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  tipEl.innerHTML = '';
  const s = document.createElement('strong'); s.textContent = moneyExact(Math.round(+v * 100) / 100);
  const a = document.createElement('div'); a.textContent = name;
  const b = document.createElement('span'); b.textContent = `${longLabel(+k)}, ${n} deal${n === '1' ? '' : 's'}`;
  tipEl.append(s, a, b);
  tipEl.hidden = false;
  const r = td.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  tipEl.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + 'px';
  tipEl.style.top = (r.top - tipEl.offsetHeight - 8 < 0 ? r.bottom + 8 : r.top - tipEl.offsetHeight - 8) + 'px';
}
function hideTip() { if (tipEl) tipEl.hidden = true; }

/* ---------- Month table ---------- */
function renderMonthTable() {
  const tk = todayKey();
  const yr = yearRows();
  const ps = chartPeriods().filter(k => k <= tk || yr.some(r => r.period === k));
  const byP = new Map();
  for (const r of yr) { if (!byP.has(r.period)) byP.set(r.period, []); byP.get(r.period).push(r); }
  let sT = 0, sG = 0, sD = 0;
  const html = ps.map(k => {
    const list = byP.get(k) || [];
    const a = total(list), t = targetFor(k);
    sT += a; sG += t; sD += list.length;
    const ratio = t ? a / t : null;
    const inProg = k === tk;
    const s = statusFor(inProg ? (elapsed(k) > 0.02 ? ratio / elapsed(k) : 1) : ratio, inProg);
    const col = css(s.cls === 'good' ? '--good' : s.cls === 'warning' ? '--warning' : s.cls === 'critical' ? '--critical' : '--ink-3');
    const top = [...sumBy(list, r => r.name)].sort((x, y) => y[1] - x[1])[0];
    const focus = state.month !== 'all' && fromKey(k).m === state.month;
    return `<tr class="${focus ? 'is-focus' : ''}">
      <td>${longLabel(k)}${inProg ? ' <span class="panel-sub">(so far)</span>' : ''}</td>
      <td class="num">${money(a)}</td>
      <td class="num">${money(t)}</td>
      <td><span class="mini-bar"><span class="bar"><i style="width:${Math.min(100, (ratio || 0) * 100)}%;background:${col}"></i></span><span class="pct" title="${s.label}"><i class="fa-solid ${s.icon}" style="color:${col}"></i>${pct(ratio * 100)}</span></span></td>
      <td class="num">${list.length}</td>
      <td>${top ? esc(top[0]) : '–'}</td>
      <td class="num">${top ? pct(top[1] / a * 100) : '–'}</td>
    </tr>`;
  }).join('');
  const tbody = $('monthTable').querySelector('tbody');
  tbody.innerHTML = html || '<tr class="empty-row"><td colspan="7">No months in this view.</td></tr>';
  let tfoot = $('monthTable').querySelector('tfoot');
  if (!tfoot) { tfoot = document.createElement('tfoot'); $('monthTable').appendChild(tfoot); }
  tfoot.innerHTML = ps.length ? `<tr><td>Total</td><td class="num">${money(sT)}</td><td class="num">${money(sG)}</td><td>${pct(sG ? sT / sG * 100 : null)}</td><td class="num">${sD}</td><td></td><td></td></tr>` : '';
}

/* ---------- Transactions ---------- */
function txRows() {
  const q = tx.search.trim().toLowerCase();
  let list = scopeRows();
  if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || String(r.amount).includes(q) || longLabel(r.period).toLowerCase().includes(q));
  const dir = tx.dir === 'asc' ? 1 : -1;
  const cmp = {
    period: (a, b) => a.period - b.period || a.id - b.id,
    name: (a, b) => a.name.localeCompare(b.name) || a.period - b.period,
    amount: (a, b) => a.amount - b.amount || a.id - b.id,
  }[tx.sort];
  return list.slice().sort((a, b) => cmp(a, b) * dir);
}
function renderTransactions() {
  const list = txRows();
  const pages = Math.max(1, Math.ceil(list.length / CONFIG.pageSize));
  tx.page = Math.min(tx.page, pages);
  const start = (tx.page - 1) * CONFIG.pageSize;
  const slice = list.slice(start, start + CONFIG.pageSize);
  $('txTable').querySelector('tbody').innerHTML = slice.length
    ? slice.map(r => `<tr><td>${longLabel(r.period)}</td><td>${esc(r.name)}</td><td class="num">${moneyExact(r.amount)}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="3">No deals match.</td></tr>';
  document.querySelectorAll('#txTable .sort').forEach(b => { if (b.dataset.sort === tx.sort) b.dataset.dir = tx.dir; else delete b.dataset.dir; });
  $('txSub').textContent = `${int.format(list.length)} deal${list.length === 1 ? '' : 's'} worth ${money(total(list))} in the current view.`;
  $('txPager').innerHTML = list.length > CONFIG.pageSize
    ? `<span>Showing ${start + 1}–${start + slice.length} of ${int.format(list.length)}</span>
       <span class="pages"><button type="button" data-page="prev" ${tx.page === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="fa-solid fa-chevron-left"></i></button>
       <button type="button" disabled>${tx.page} / ${pages}</button>
       <button type="button" data-page="next" ${tx.page === pages ? 'disabled' : ''} aria-label="Next page"><i class="fa-solid fa-chevron-right"></i></button></span>`
    : '';
}

/* ---------- Exports ---------- */
function fileStem() {
  const y = state.year === 'all' ? 'all-years' : yearLabel(state.year).replace(/[\s/]+/g, '-');
  const m = state.month === 'all' ? '' : '-' + MON[state.month - 1];
  return `b2b-sales-${y}${m}`.toLowerCase();
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCSV() {
  const list = txRows().sort((a, b) => a.period - b.period || a.id - b.id);
  const q = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = ['Sales person name,Sales amount,Month,Sales year,Month name', ...list.map(r => [q(r.name), r.amount, r.month, r.year, MONTHS[r.month - 1]].join(','))];
  download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), fileStem() + '.csv');
  toast(`Downloaded ${list.length} deals`);
}
async function capture() {
  if (!window.html2canvas) throw new Error('Export library still loading — try again in a moment.');
  document.body.classList.add('capturing');
  try {
    return await html2canvas($('dashboard'), { scale: 2, useCORS: true, backgroundColor: getComputedStyle(document.body).backgroundColor });
  } finally { document.body.classList.remove('capturing'); }
}
async function exportPNG() {
  toast('Preparing image…');
  const c = await capture();
  c.toBlob(b => download(b, fileStem() + '.png'));
}
async function exportPDF() {
  toast('Preparing PDF…');
  const c = await capture();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const margin = 8, w = pw - margin * 2;
  const pxPerMm = c.width / w;
  const sliceH = Math.floor((ph - margin * 2) * pxPerMm);
  for (let y = 0, page = 0; y < c.height; y += sliceH, page++) {
    const part = document.createElement('canvas');
    part.width = c.width; part.height = Math.min(sliceH, c.height - y);
    const ctx = part.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(c, 0, y, c.width, part.height, 0, 0, c.width, part.height);
    if (page) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, w, part.height / pxPerMm);
  }
  pdf.save(fileStem() + '.pdf');
}
async function runExport(kind) {
  closeMenus();
  try {
    if (kind === 'csv') exportCSV();
    else if (kind === 'png') await exportPNG();
    else if (kind === 'pdf') await exportPDF();
    else if (kind === 'print') window.print();
    else if (kind === 'link') { await navigator.clipboard.writeText(location.href); toast('Link to this view copied'); }
  } catch (e) { console.error(e); toast(e.message || 'Export failed'); }
}

/* ---------- Targets dialog ---------- */
function openTargets() {
  $('targetsGrid').innerHTML = monthOrder().map(m =>
    `<label>${MONTHS[m - 1]}<span class="money"><span>£</span><input type="number" min="0" step="500" inputmode="numeric" data-month="${m}" value="${targets[m - 1]}"></span></label>`).join('');
  const connected = !!CONFIG.targetsApiUrl;
  $('targetsSub').textContent = !connected
    ? 'Saving is not set up yet: add the targets web app URL to CONFIG.targetsApiUrl in script.js.'
    : targetsUpdatedAt
      ? `Changes apply for everyone. Last changed ${targetsUpdatedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`
      : 'Changes apply for everyone who opens the dashboard.';
  $('targetsPin').value = '';
  $('targetsPin').disabled = !connected;
  $('targetsSave').disabled = !connected;
  setTargetsError('');
  $('targetsDialog').showModal();
  $('targetsGrid').querySelector('input').focus();
}
function setTargetsError(msg) {
  const el = $('targetsError');
  el.textContent = msg;
  el.hidden = !msg;
}
async function saveTargets(e) {
  e.preventDefault();
  const pin = $('targetsPin').value.trim();
  if (!pin) { setTargetsError('Enter the PIN to save.'); $('targetsPin').focus(); return; }
  const next = targets.slice();
  $('targetsGrid').querySelectorAll('input').forEach(i => { const v = parseFloat(i.value); next[+i.dataset.month - 1] = isFinite(v) && v >= 0 ? v : 0; });
  const btn = $('targetsSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  setTargetsError('');
  try {
    // text/plain keeps this a "simple" request, which Apps Script web apps accept from other sites.
    const res = await fetch(CONFIG.targetsApiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pin, targets: next }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Could not save targets.');
    targets = validTargets(data.targets) ? data.targets : next;
    targetsUpdatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    store('b2b-targets-shared', JSON.stringify(targets));
    $('targetsDialog').close();
    render();
    toast('Targets saved for everyone');
  } catch (err) {
    console.error(err);
    setTargetsError(err instanceof TypeError ? 'Couldn’t reach the targets sheet. Check your connection and try again.' : err.message);
    if (/PIN/i.test(err.message)) { $('targetsPin').select(); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save targets';
  }
}

/* ---------- UI helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function closeMenus() {
  document.querySelectorAll('.menu-list').forEach(m => (m.hidden = true));
  document.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function toggleMenu(btn, menu) {
  const open = menu.hidden;
  closeMenus();
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function syncThemeIcon() { $('themeBtn').innerHTML = `<i class="fa-solid fa-${isDark() ? 'sun' : 'moon'}"></i>`; }

/* ---------- Wire up ---------- */
function bind() {
  $('year').textContent = new Date().getFullYear();
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    setFilter({ mode: b.dataset.mode });
  }));
  $('yearFilter').addEventListener('change', e => setFilter({ year: e.target.value === 'all' ? 'all' : +e.target.value }));
  $('monthFilter').addEventListener('change', e => setFilter({ month: e.target.value === 'all' ? 'all' : +e.target.value }));
  $('peopleBtn').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('peopleBtn'), $('peopleMenu')); });
  $('peopleMenu').addEventListener('click', e => e.stopPropagation());
  $('peopleOptions').addEventListener('change', e => {
    if (e.target.checked) state.people.add(e.target.value); else state.people.delete(e.target.value);
    setFilter({});
  });
  $('peopleMenu').querySelectorAll('[data-people]').forEach(b => b.addEventListener('click', () => {
    state.people = b.dataset.people === 'all' ? new Set(rows.map(r => r.name)) : new Set();
    if (state.people.size === new Set(rows.map(r => r.name)).size) state.people = new Set();
    setFilter({});
  }));
  $('resetBtn').addEventListener('click', () => {
    const years = availableYears();
    const cy = yearOfKey(todayKey());
    setFilter({ year: years.includes(cy) ? cy : years[0] ?? 'all', month: 'all', people: new Set() });
    tx.search = ''; $('txSearch').value = '';
    renderTransactions();
  });
  $('leaderboard').addEventListener('click', e => {
    const b = e.target.closest('[data-person]');
    if (!b) return;
    const name = b.dataset.person;
    setFilter({ people: state.people.size === 1 && state.people.has(name) ? new Set() : new Set([name]) });
  });

  $('refreshBtn').addEventListener('click', () => loadData());
  $('targetsBtn').addEventListener('click', openTargets);
  $('targetsForm').addEventListener('submit', saveTargets);
  $('targetsCancel').addEventListener('click', () => $('targetsDialog').close());
  $('targetsReset').addEventListener('click', () => {
    $('targetsGrid').querySelectorAll('input').forEach(i => (i.value = CONFIG.defaultTargets[+i.dataset.month - 1]));
  });
  $('themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store('b2b-theme', next);
    syncThemeIcon();
    render();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { syncThemeIcon(); render(); });

  $('exportBtn').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('exportBtn'), $('exportMenu')); });
  document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => runExport(b.dataset.export)));
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenus();
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (!typing && (e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) loadData();
  });

  let searchT;
  $('txSearch').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => { tx.search = e.target.value; tx.page = 1; renderTransactions(); }, 150); });
  document.querySelectorAll('#txTable .sort').forEach(b => b.addEventListener('click', () => {
    if (tx.sort === b.dataset.sort) tx.dir = tx.dir === 'asc' ? 'desc' : 'asc';
    else { tx.sort = b.dataset.sort; tx.dir = b.dataset.sort === 'name' ? 'asc' : 'desc'; }
    renderTransactions();
  }));
  $('txPager').addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    tx.page += b.dataset.page === 'next' ? 1 : -1;
    renderTransactions();
  });

  $('heatmap').addEventListener('pointerover', showTip);
  $('heatmap').addEventListener('pointerleave', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  window.addEventListener('hashchange', () => { if (!rows.length) return; readHash(); rebuildFilterOptions(); render(); });

  // Keep the "synced x min ago" label fresh, and re-check the sheet periodically.
  setInterval(setSync, 30000);
  refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') loadData({ silent: true }); }, CONFIG.autoRefreshMinutes * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lastSync && Date.now() - lastSync > CONFIG.autoRefreshMinutes * 60000) loadData({ silent: true });
  });
}

document.body.classList.add('is-loading');
bind();
syncThemeIcon();
loadData({ silent: true });
