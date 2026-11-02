/* Qanoot Jahangir — app logic. */
'use strict';
const APP_VERSION = '1.0.0';

/* =============================== storage, state & helpers =============================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('qj_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('qj_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('qj_' + k); } catch (e) {} }
};
const EMPTY = { rows: [], projects: [], people: [], categories: { Income: {}, Expense: {} }, user: '', currency: '',
  general: 'General / Overhead', statuses: ['In Progress', 'Completed', 'Sold'], personKinds: ['Employee', 'Vendor', 'Client'] };

let auth = LS.get('auth', null);          // {name, code, api}
let D = LS.get('data', EMPTY);            // last data from the server (works offline)
let V = D;                                // D + changes still waiting to sync
let queue = LS.get('queue', []);          // entry changes not yet on the server
let failed = LS.get('failed', []);        // changes the server rejected
const S = { type: 'Expense', kind: 'Collection', pkind: 'Employee', editId: null, open: {}, hopen: {},
  ovh: LS.get('ovh', false), syncing: false, again: false, offline: false, lastSync: LS.get('lastSync', null), tab: 'add' };

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => { n = Math.round((Number(n) || 0) * 100) / 100; return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label == null ? v : label)}</option>`;
const short = e => String(e || '').split('@')[0];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isLabor = c => /labou?r|salar|wage|staff/i.test(c || '');
const dressesOf = c => V.projects.filter(p => p.kind === 'Dress' && p.collection === c);
const collections = () => V.projects.filter(p => p.kind === 'Collection');
const standalone = () => { const cs = collections().map(c => c.name); return V.projects.filter(p => p.kind === 'Dress' && cs.indexOf(p.collection) < 0); };
const collectionOf = name => { const p = V.projects.find(x => x.name === name); if (!p) return name === V.general ? V.general : 'Other'; if (p.kind === 'Collection') return p.name; return collections().some(c => c.name === p.collection) ? p.collection : 'Standalone dresses'; };
function ensureOption(sel, v) { if (v && ![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', opt(v)); sel.value = v; }
function isTyping() { const a = document.activeElement; return a && /INPUT|SELECT|TEXTAREA/.test(a.tagName); }
function flash(el, text) { el.className = 'msg ok'; el.textContent = text; setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2500); }
function errMsg(el, text) { el.className = 'msg'; el.textContent = text; }
function showTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

/* =============================== server connection =============================== */
const apiUrl = () => (auth && auth.api) || window.QJ_API || '';
const isNetErr = e => e && (e.name === 'TypeError' || e.name === 'AbortError' || e.net);

async function api(action, extra, who) {
  const a = who || auth;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(a.api || apiUrl(), { method: 'POST', body: JSON.stringify(Object.assign({ action, user: a.name, code: a.code }, extra || {})), signal: ctrl.signal, redirect: 'follow' });
  } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { const err = new Error('The server sent an unexpected reply. Check the server address.'); err.net = !res.ok; throw err; }
  if (!j.ok) { const err = new Error(j.error || 'Something went wrong.'); err.auth = j.auth; throw err; }
  S.offline = false;
  return j;
}

function setData(d) {
  D = d || EMPTY;
  LS.set('data', D);
  S.lastSync = Date.now(); LS.set('lastSync', S.lastSync);
  renderAll();
}
function handleErr(e, el) {
  if (e && e.auth) { signOut(e.message, true); return; }
  if (isNetErr(e)) { S.offline = true; status(); if (el) errMsg(el, 'No internet connection. This change needs internet — try again when you\'re online.'); return; }
  if (el) errMsg(el, e.message); else status('⚠ ' + e.message);
}

/** Online-only changes (collections, dresses, people). */
async function call(action, args, o) {
  o = o || {};
  if (o.btn) o.btn.disabled = true;
  if (o.err) errMsg(o.err, '');
  try { const j = await api(action, { args }); setData(j.data); if (o.ok) o.ok(); }
  catch (e) { handleErr(e, o.err); }
  finally { if (o.btn) o.btn.disabled = false; }
}

/** Entry changes go through the queue: saved on the phone first, then sent. Works offline. */
function queueOp(op) {
  if (op.kind === 'update') {
    const a = queue.find(q => q.kind === 'add' && q.entry.id === op.entry.id);
    if (a) { a.entry = op.entry; return afterQueue(); }
    queue = queue.filter(q => !(q.kind === 'update' && q.entry.id === op.entry.id));
  }
  if (op.kind === 'delete') {
    const wasLocal = queue.some(q => q.kind === 'add' && q.entry.id === op.id);
    queue = queue.filter(q => !(q.entry && q.entry.id === op.id));
    if (wasLocal) return afterQueue();
  }
  op.qid = uid();
  queue.push(op);
  afterQueue();
}
function afterQueue() { LS.set('queue', queue); renderAll(); sync(); }

async function sync() {
  if (!auth) return;
  if (S.syncing) { S.again = true; return; }
  S.syncing = true; status();
  const ops = queue.slice();
  try {
    const j = ops.length ? await api('sync', { ops }) : await api('getData');
    if (ops.length) {
      const sent = new Set(ops.map(o => o.qid));
      queue = queue.filter(q => !sent.has(q.qid)); LS.set('queue', queue);
      (j.results || []).filter(r => !r.ok).forEach(r => failed.push({ error: r.error, op: r.op, at: Date.now() }));
      LS.set('failed', failed);
    }
    setData(ops.length ? j.data : j.data);
  } catch (e) { handleErr(e); }
  finally {
    S.syncing = false; status();
    if (S.again) { S.again = false; sync(); }
  }
}
const refresh = sync;

/** Data shown on screen = server data + this phone's unsynced changes. */
function view() {
  if (!queue.length) return D;
  const v = Object.assign({}, D, { rows: D.rows.slice() });
  queue.forEach(op => {
    if (op.kind === 'add') v.rows.push(Object.assign({}, op.entry, { pending: true, by: auth ? auth.name : '' }));
    else if (op.kind === 'update') { const i = v.rows.findIndex(r => r.id === op.entry.id); if (i >= 0) v.rows[i] = Object.assign({}, v.rows[i], op.entry, { pending: true }); }
    else if (op.kind === 'delete') v.rows = v.rows.filter(r => r.id !== op.id);
  });
  return v;
}

function status(override) {
  let t;
  if (override) t = override;
  else if (S.syncing) t = 'Syncing…';
  else if (S.offline) t = 'Offline';
  else t = S.lastSync ? 'Synced ' + hhmm(S.lastSync) : 'Not synced yet';
  if (queue.length) t += ' · ' + queue.length + ' waiting';
  $('sync').textContent = t;
  $('refresh').classList.toggle('spin', S.syncing);
  // banner
  let b = '';
  if (queue.length && S.offline) b = `<b>No internet.</b> ${queue.length} change${queue.length === 1 ? ' is' : 's are'} saved on this phone and will be sent automatically when you're back online.`;
  else if (queue.length && !S.syncing) b = `${queue.length} change${queue.length === 1 ? '' : 's'} waiting to sync.`;
  if (failed.length) b += (b ? '<br>' : '') + `<b>${failed.length} change${failed.length === 1 ? '' : 's'} couldn't be saved.</b> See Settings → Sync.`;
  $('banner').innerHTML = b; $('banner').hidden = !b;
  // settings
  $('setSync').textContent = $('sync').textContent.split(' · ')[0];
  $('setQueue').textContent = queue.length;
  $('setFailed').innerHTML = failed.length ? '<div class="sect">Couldn\'t be saved</div>' + failed.map((f, i) =>
    `<div class="kv"><span>${esc(f.op && f.op.entry ? (f.op.entry.category + ' · ' + fmt(f.op.entry.amount) + ' · ' + f.op.entry.date) : 'Change')}<small class="meta">${esc(f.error)}</small></span><button class="ib" data-dismiss="${i}" aria-label="Dismiss">✕</button></div>`).join('') : '';
}

/* =============================== login / logout =============================== */
function showLogin(msg) {
  $('app').hidden = true; $('login').hidden = false;
  $('lurlWrap').hidden = !!window.QJ_API;
  $('lurl').value = (auth && auth.api) || window.QJ_API || LS.get('lastApi', '');
  if (msg) errMsg($('lmsg'), msg);
}
function showApp() {
  $('login').hidden = true; $('app').hidden = false;
  renderAll();
}
$('lurlToggle').onclick = () => { $('lurlWrap').hidden = !$('lurlWrap').hidden; };
$('lcode').onkeydown = e => { if (e.key === 'Enter') $('lgo').click(); };
$('lgo').onclick = async () => {
  const who = { name: $('lname').value.trim(), code: $('lcode').value.trim(), api: $('lurl').value.trim() || window.QJ_API || '' };
  if (!who.name || !who.code) return errMsg($('lmsg'), 'Enter your name and access code.');
  if (!/^https?:\/\//.test(who.api)) { $('lurlWrap').hidden = false; return errMsg($('lmsg'), 'Enter the server address (your Apps Script Web app URL).'); }
  $('lgo').disabled = true; errMsg($('lmsg'), '');
  try {
    const j = await api('login', null, who);
    if (who.api === window.QJ_API) delete who.api;
    who.name = j.user;
    auth = who; LS.set('auth', auth); LS.set('lastApi', $('lurl').value.trim());
    $('lcode').value = '';
    setData(j.data);
    showApp();
  } catch (e) {
    errMsg($('lmsg'), isNetErr(e) ? 'Couldn\'t reach the server. Check your internet connection and the server address.' : e.message);
  } finally { $('lgo').disabled = false; }
};
function signOut(msg, forced) {
  if (!forced && queue.length && !confirm(queue.length + ' change(s) haven\'t synced yet and will be lost if you sign out. Sign out anyway?')) return;
  const name = auth && auth.name;
  auth = null; LS.del('auth');
  if (!forced) { queue = []; failed = []; LS.del('queue'); LS.del('failed'); LS.del('data'); D = EMPTY; }
  $('lname').value = name || '';
  showLogin(msg);
}
$('logout').onclick = () => signOut();

/* =============================== ADD / EDIT entry =============================== */
function fillProjects() {
  const cur = $('project').value;
  let h = opt(V.general);
  collections().forEach(c => {
    h += `<optgroup label="${esc(c.name)}">` + opt(c.name, c.name + ' — whole collection');
    dressesOf(c.name).forEach(d => h += opt(d.name, d.name + (d.status === 'Sold' ? ' (sold)' : '')));
    h += '</optgroup>';
  });
  const loose = standalone();
  if (loose.length) h += '<optgroup label="Standalone dresses">' + loose.map(d => opt(d.name)).join('') + '</optgroup>';
  $('project').innerHTML = h;
  if (cur) ensureOption($('project'), cur);
}
function fillCats(keepCat, keepSub) {
  const cats = V.categories[S.type] || {};
  const prev = keepCat !== undefined ? keepCat : $('category').value;
  $('category').innerHTML = Object.keys(cats).map(c => opt(c)).join('');
  if (prev && cats[prev]) $('category').value = prev; else if (keepCat) ensureOption($('category'), keepCat);
  fillSubs(keepSub);
}
function fillSubs(keep) {
  const prev = keep !== undefined ? keep : $('sub').value;
  const subs = (V.categories[S.type] || {})[$('category').value] || [];
  $('sub').innerHTML = subs.length ? subs.map(s => opt(s)).join('') : opt('', '—');
  if (prev) { if (subs.indexOf(prev) >= 0) $('sub').value = prev; else if (keep) ensureOption($('sub'), keep); }
}
function partyValue() { return $('party').value === '__other' ? $('partyOther').value.trim() : $('party').value; }
function setParty(v) {
  const known = v && V.people.some(p => p.name === v);
  $('party').value = !v ? '' : known ? v : '__other';
  $('partyOther').value = v && !known ? v : '';
  $('otherWrap').hidden = $('party').value !== '__other';
}
function fillParty(keep) {
  const cur = keep !== undefined ? keep : partyValue();
  const labor = isLabor($('category').value);
  const order = S.type === 'Income' ? ['Client', 'Vendor', 'Employee'] : labor ? ['Employee', 'Vendor', 'Client'] : ['Vendor', 'Employee', 'Client'];
  const names = { Employee: 'Employees', Vendor: 'Vendors / suppliers', Client: 'Clients' };
  let h = opt('', '— none —');
  order.forEach(k => {
    const ps = V.people.filter(p => p.kind === k && (p.active || p.name === cur)).sort((a, b) => a.name.localeCompare(b.name));
    if (ps.length) h += `<optgroup label="${names[k]}">` + ps.map(p => opt(p.name, p.name + (p.role ? ' · ' + p.role : ''))).join('') + '</optgroup>';
  });
  h += opt('__other', 'Other (type a name)…');
  $('party').innerHTML = h;
  setParty(cur);
  $('partyLabel').textContent = S.type === 'Income' ? 'Received from' : labor ? 'Employee / worker' : 'Paid to';
}
function setTypeButtons(t) { $('bExp').className = t === 'Expense' ? 'on e' : ''; $('bInc').className = t === 'Income' ? 'on i' : ''; }
function setType(t) { S.type = t; setTypeButtons(t); fillCats(); fillParty(); }
$('bExp').onclick = () => setType('Expense');
$('bInc').onclick = () => setType('Income');
$('category').onchange = () => { fillSubs(); fillParty(); };
$('party').onchange = () => { const o = $('party').value === '__other'; $('otherWrap').hidden = !o; if (o) $('partyOther').focus(); };
['qty', 'rate'].forEach(id => $(id).oninput = () => {
  const q = parseFloat($('qty').value), r = parseFloat($('rate').value);
  if (q > 0 && r > 0) $('amount').value = Math.round(q * r * 100) / 100;
});

function startEdit(id) {
  const r = V.rows.find(x => x.id === id);
  if (!r) return;
  S.editId = id; S.type = r.type; setTypeButtons(r.type);
  ensureOption($('project'), r.project);
  fillCats(r.category, r.sub);
  fillParty(r.party);
  $('date').value = r.date; $('amount').value = r.amount;
  $('qty').value = r.qty; $('rate').value = r.rate; $('desc').value = r.description;
  $('save').textContent = 'Update entry';
  $('editBar').hidden = false;
  $('msg').textContent = '';
  showTab('add'); window.scrollTo(0, 0);
}
function endEdit() {
  S.editId = null;
  ['amount', 'qty', 'rate', 'desc'].forEach(id => $(id).value = '');
  $('save').textContent = 'Add entry';
  $('editBar').hidden = true;
}
$('cancelEdit').onclick = () => { endEdit(); fillParty(''); };

$('save').onclick = () => {
  const amount = Math.round(parseFloat($('amount').value) * 100) / 100;
  if (!(amount > 0)) return errMsg($('msg'), 'Enter an amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test($('date').value)) return errMsg($('msg'), 'Choose a date.');
  const party = partyValue();
  const num = v => v === '' || isNaN(parseFloat(v)) ? '' : parseFloat(v);
  const entry = {
    id: S.editId || uid(), type: S.type, amount, date: $('date').value, project: $('project').value, category: $('category').value,
    sub: $('sub').value, party, qty: num($('qty').value), rate: num($('rate').value), description: $('desc').value.trim()
  };
  const newPerson = $('party').value === '__other' && party && $('savePerson').checked && !V.people.some(p => p.name.toLowerCase() === party.toLowerCase());
  const personKind = S.type === 'Income' ? 'Client' : isLabor(entry.category) ? 'Employee' : 'Vendor';
  const wasEdit = !!S.editId;
  if (wasEdit) { queueOp({ kind: 'update', entry }); endEdit(); }
  else { queueOp({ kind: 'add', entry }); ['amount', 'qty', 'rate', 'desc'].forEach(id => $(id).value = ''); }
  flash($('msg'), (wasEdit ? 'Updated' : 'Saved') + (S.offline ? ' on this phone — will sync when online ✓' : ' ✓'));
  if (newPerson) call('addPerson', { name: party, kind: personKind, role: personKind === 'Employee' ? entry.sub : '' }, { ok: () => setParty(party) });
};

/* entry rows (shared by Add, People & Reports) */
function entryRows(rows) {
  if (!rows.length) return '<tr><td class="empty">No entries</td></tr>';
  return rows.map(r => `<tr>
    <td>${esc(r.category)}${r.sub ? ' › ' + esc(r.sub) : ''}${r.pending ? ' <span class="pend">· not synced yet</span>' : ''}
      <small>${esc(r.project)}${r.party ? ' · ' + esc(r.party) : ''}</small>
      <small>${esc(r.date)}${r.qty !== '' && r.rate !== '' && r.qty != null && r.rate != null ? ' · ' + fmt(r.qty) + ' × ' + fmt(r.rate) : ''}${r.description ? ' · ' + esc(r.description) : ''} · ${esc(short(r.by))}</small></td>
    <td class="amt ${r.type === 'Income' ? 'inc' : 'exp'}">${r.type === 'Income' ? '+' : '−'}${fmt(r.amount)}</td>
    <td class="act"><button class="ib" data-edit="${esc(r.id)}" aria-label="Edit">✎</button><button class="ib" data-del="${esc(r.id)}" aria-label="Delete">✕</button></td></tr>`).join('');
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-edit],[data-del],[data-dismiss]'); if (!t) return;
  if (t.dataset.edit) startEdit(t.dataset.edit);
  if (t.dataset.del && confirm('Delete this entry?')) {
    if (S.editId === t.dataset.del) endEdit();
    queueOp({ kind: 'delete', id: t.dataset.del });
  }
  if (t.dataset.dismiss !== undefined) { failed.splice(Number(t.dataset.dismiss), 1); LS.set('failed', failed); status(); }
});

/* =============================== COLLECTIONS =============================== */
function costMap() {
  const m = {};
  V.rows.forEach(r => { const o = m[r.project] || (m[r.project] = { cost: 0, rec: 0 }); if (r.type === 'Expense') o.cost += r.amount; else o.rec += r.amount; });
  return m;
}
function overheadShare(m) {
  const total = (m[V.general] || { cost: 0 }).cost;
  const base = V.projects.reduce((s, p) => s + ((m[p.name] || {}).cost || 0), 0);
  return { total, fn: name => base ? total * ((m[name] || {}).cost || 0) / base : 0 };
}
function totals(p, m, share) {
  const own = m[p.name] || { cost: 0, rec: 0 };
  const t = { direct: own.cost, ovh: share(p.name), rec: own.rec, revenue: p.price > 0 ? p.price : own.rec, n: 0, ownRec: own.rec };
  if (p.kind === 'Collection') dressesOf(p.name).forEach(d => {
    const o = m[d.name] || { cost: 0, rec: 0 };
    t.direct += o.cost; t.ovh += share(d.name); t.rec += o.rec; t.revenue += d.price > 0 ? d.price : o.rec; t.n++;
  });
  t.cost = t.direct + (S.ovh ? t.ovh : 0);
  t.profit = t.revenue - t.cost;
  t.margin = t.revenue > 0 ? t.profit / t.revenue * 100 : null;
  t.due = p.kind === 'Dress' && p.price > 0 ? p.price - own.rec : null;
  return t;
}
function catBreak(rows) {
  const m = {};
  rows.forEach(r => { const c = m[r.category] || (m[r.category] = { t: 0, s: {} }); c.t += r.amount; const k = r.sub || '—'; c.s[k] = (c.s[k] || 0) + r.amount; });
  const keys = Object.keys(m).sort((a, b) => m[b].t - m[a].t);
  if (!keys.length) return '<div class="empty">Nothing yet</div>';
  return keys.map(c => `<div class="cat head"><span>${esc(c)}</span><span>${fmt(m[c].t)}</span></div>` +
    Object.keys(m[c].s).sort((a, b) => m[c].s[b] - m[c].s[a]).map(s => `<div class="cat sub"><span>${esc(s)}</span><span>${fmt(m[c].s[s])}</span></div>`).join('')).join('');
}
function groupList(rows, keyFn) {
  const m = {};
  rows.forEach(r => { const k = keyFn(r); if (k) m[k] = (m[k] || 0) + r.amount; });
  const keys = Object.keys(m).sort((a, b) => m[b] - m[a]);
  if (!keys.length) return '<div class="empty">Nothing yet</div>';
  return keys.map(k => `<div class="cat"><span>${esc(k)}</span><span>${fmt(m[k])}</span></div>`).join('');
}

function projCard(p, cls, m, sh) {
  const t = totals(p, m, sh.fn);
  const names = p.kind === 'Collection' ? [p.name].concat(dressesOf(p.name).map(d => d.name)) : [p.name];
  const exp = V.rows.filter(r => names.indexOf(r.project) >= 0 && r.type === 'Expense');
  const isD = p.kind === 'Dress';
  const badge = isD ? `<span class="badge${p.status === 'Sold' ? ' sold' : ''}">${esc(p.status)}</span>` : `<span class="badge">Collection · ${t.n} dress${t.n === 1 ? '' : 'es'}</span>`;
  const sub = [isD && p.client ? 'Client: ' + esc(p.client) : '', t.due !== null ? `Received ${fmt(t.ownRec)} · <b class="${t.due > 0 ? 'exp' : 'inc'}">${t.due > 0 ? 'Due ' + fmt(t.due) : 'Paid in full'}</b>` : ''].filter(Boolean).join(' · ');
  const collOpts = opt('', '— None (standalone) —') + collections().map(c => opt(c.name, c.name, c.name === p.collection)).join('');
  return `<div class="proj ${cls}${S.open[p.name] ? ' open' : ''}" data-name="${esc(p.name)}">
    <div class="ph">
      <div class="pt"><b>${esc(p.name)}</b>${badge}</div>
      ${sub ? `<div class="meta">${sub}</div>` : ''}
      <div class="nums">
        <span><span class="lbl">Cost${S.ovh ? ' + ovh' : ''}</span><b class="exp">${fmt(t.cost)}</b></span>
        <span><span class="lbl">Sale price</span><b>${t.revenue ? fmt(t.revenue) : '—'}</b></span>
        <span><span class="lbl">Profit${t.margin !== null ? ' · ' + Math.round(t.margin) + '%' : ''}</span><b class="${t.profit >= 0 ? 'inc' : 'exp'}">${t.revenue ? fmt(t.profit) : '—'}</b></span>
      </div>
    </div>
    <div class="pd">
      <label>Name</label><input data-f="name" value="${esc(p.name)}" maxlength="80">
      ${isD ? `<label>Collection</label><select data-f="coll">${collOpts}</select>
        <div class="row2"><div><label>Client</label><input data-f="client" value="${esc(p.client)}" maxlength="80"></div>
        <div><label>Status</label><select data-f="status">${V.statuses.map(s => opt(s, s, s === p.status)).join('')}</select></div></div>` : ''}
      <label>${isD ? 'Sale price' : 'Collection-level sale price (optional — dress prices are added automatically)'}</label>
      <input type="number" data-f="price" step="0.01" min="0" inputmode="decimal" value="${p.price || ''}">
      <div style="margin-top:10px">
        <div class="kv"><span>Direct cost</span><b>${fmt(t.direct)}</b></div>
        <div class="kv"><span>Overhead share (estimate)</span><span>${fmt(t.ovh)}</span></div>
        <div class="kv"><span>Cost incl. overhead</span><span>${fmt(t.direct + t.ovh)}</span></div>
        <div class="kv"><span>Payments received</span><span class="inc">${fmt(t.rec)}</span></div>
      </div>
      <div class="btns">
        <button class="btn sm" data-act="save">Save</button>
        <button class="btn sm ghost" data-act="entry">+ Add entry</button>
        <button class="btn sm danger" data-act="del">Delete</button>
      </div>
      <div class="msg" data-f="msg"></div>
      <div class="sect">Cost breakdown${p.kind === 'Collection' ? ' (incl. dresses)' : ''}</div>${catBreak(exp)}
      <div class="sect">Paid to people</div>${groupList(exp, r => r.party)}
    </div>
  </div>`;
}

function renderProjects() {
  const m = costMap(), sh = overheadShare(m), f = $('sfilter').value;
  const show = d => f === 'All' || d.status === f;
  let h = '';
  collections().forEach(c => {
    const ds = dressesOf(c.name).filter(show);
    if (f !== 'All' && !ds.length) return;
    h += projCard(c, 'coll', m, sh);
    ds.forEach(d => h += projCard(d, 'dress', m, sh));
  });
  standalone().filter(show).forEach(d => h += projCard(d, '', m, sh));
  if (!V.projects.length) h += '<div class="empty">Create your first collection above.</div>';
  const g = m[V.general] || { cost: 0, rec: 0 };
  h += `<div class="proj gen" data-name="${esc(V.general)}"><div class="ph"><div class="pt"><b>${esc(V.general)}</b><span class="badge">Not tied to a dress</span></div>
    <div class="nums"><span><span class="lbl">Cost</span><b class="exp">${fmt(g.cost)}</b></span><span><span class="lbl">Income</span><b class="inc">${fmt(g.rec)}</b></span>
    <span><button class="btn sm ghost" data-act="entry">+ Add entry</button></span></div></div></div>`;
  $('plist').innerHTML = h;
  $('ovh').checked = S.ovh;
  $('ovhNote').hidden = !S.ovh;
  $('ovhNote').textContent = `Overhead of ${fmt(sh.total)} ${V.currency} (all time) is spread across collections and dresses in proportion to their direct cost. Treat it as an estimate.`;
  const pc = $('pcoll').value;
  $('pcoll').innerHTML = opt('', '— None (standalone) —') + collections().map(c => opt(c.name)).join('');
  if (pc && collections().some(c => c.name === pc)) $('pcoll').value = pc;
}
$('sfilter').onchange = renderProjects;
$('ovh').onchange = () => { S.ovh = $('ovh').checked; LS.set('ovh', S.ovh); renderProjects(); };
$('plist').onclick = ev => {
  const card = ev.target.closest('.proj'); if (!card) return;
  const name = card.dataset.name, act = (ev.target.closest('[data-act]') || {}).dataset;
  const f = k => card.querySelector(`[data-f="${k}"]`);
  const a = act && act.act;
  if (a === 'entry') { endEdit(); ensureOption($('project'), name); showTab('add'); window.scrollTo(0, 0); return; }
  if (a === 'save') {
    const btn = ev.target.closest('button');
    call('updateProject', { name, newName: f('name').value, price: parseFloat(f('price').value) || 0,
      collection: f('coll') ? f('coll').value : '', client: f('client') ? f('client').value : '', status: f('status') ? f('status').value : '' },
      { btn, err: f('msg'), ok: () => { const nn = f('name').value.trim(); if (nn && nn !== name) { S.open[nn] = true; delete S.open[name]; } } });
    return;
  }
  if (a === 'del') { if (confirm('Delete "' + name + '"?')) call('deleteProject', name, { btn: ev.target.closest('button'), err: f('msg') }); return; }
  if (ev.target.closest('.ph') && card.querySelector('.pd')) { S.open[name] = !S.open[name]; card.classList.toggle('open', S.open[name]); }
};
document.querySelectorAll('#kindSeg button').forEach(b => b.onclick = () => {
  S.kind = b.dataset.k;
  document.querySelectorAll('#kindSeg button').forEach(x => x.classList.toggle('on', x === b));
  $('dressFields').hidden = S.kind !== 'Dress';
  $('pname').placeholder = S.kind === 'Dress' ? 'Ivory Gown #4' : 'Bridal 2027';
});
$('padd').onclick = () => call('addProject', {
  name: $('pname').value, kind: S.kind, collection: $('pcoll').value, client: $('pclient').value, price: parseFloat($('pprice').value) || 0
}, { btn: $('padd'), err: $('pmsg'), ok: () => { ['pname', 'pclient', 'pprice'].forEach(id => $(id).value = ''); flash($('pmsg'), 'Created ✓'); } });

/* =============================== PEOPLE =============================== */
function renderPeople() {
  const f = $('hfilter').value, inact = $('hinactive').checked, month = today().slice(0, 7);
  const list = V.people.filter(p => (f === 'All' || p.kind === f) && (inact || p.active)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { $('hlist').innerHTML = '<div class="empty">Add your first person above.</div>'; return; }
  $('hlist').innerHTML = list.map(p => {
    const rs = V.rows.filter(r => r.party === p.name);
    const sum = (arr, ty) => arr.filter(r => r.type === ty).reduce((s, r) => s + r.amount, 0);
    const ty = p.kind === 'Client' ? 'Income' : 'Expense';
    const mRows = rs.filter(r => r.date.startsWith(month));
    const recent = rs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    return `<div class="proj${p.active ? '' : ' inactive'}${S.hopen[p.name] ? ' open' : ''}" data-name="${esc(p.name)}">
      <div class="ph">
        <div class="pt"><b>${esc(p.name)}</b><span class="badge">${esc(p.role || p.kind)}${p.active ? '' : ' · inactive'}</span></div>
        ${p.phone ? `<div class="meta">${esc(p.phone)}</div>` : ''}
        <div class="nums">
          <span><span class="lbl">${ty === 'Income' ? 'Received' : 'Paid'} this month</span><b class="${ty === 'Income' ? 'inc' : 'exp'}">${fmt(sum(mRows, ty))}</b></span>
          <span><span class="lbl">All time</span><b>${fmt(sum(rs, ty))}</b></span>
          <span><span class="lbl">Entries</span><b>${rs.length}</b></span>
        </div>
      </div>
      <div class="pd">
        <div class="row2"><div><label>Name</label><input data-f="name" value="${esc(p.name)}" maxlength="80"></div>
          <div><label>Type</label><select data-f="kind">${V.personKinds.map(k => opt(k, k, k === p.kind)).join('')}</select></div></div>
        <div class="row2"><div><label>Role / trade</label><input data-f="role" value="${esc(p.role)}" maxlength="60"></div>
          <div><label>Phone</label><input data-f="phone" value="${esc(p.phone)}" maxlength="30" inputmode="tel"></div></div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" data-f="active"${p.active ? ' checked' : ''}> Active (shown in the entry form)</label>
        <div class="btns">
          <button class="btn sm" data-act="save">Save</button>
          <button class="btn sm ghost" data-act="pay">+ Add payment</button>
          <button class="btn sm danger" data-act="del">Delete</button>
        </div>
        <div class="msg" data-f="msg"></div>
        <div class="sect">By collection / dress</div>${groupList(rs.filter(r => r.type === ty), r => r.project)}
        <div class="sect">Recent entries</div><table>${entryRows(recent)}</table>
      </div>
    </div>`;
  }).join('');
}
$('hfilter').onchange = renderPeople;
$('hinactive').onchange = renderPeople;
$('hlist').onclick = ev => {
  const card = ev.target.closest('.proj'); if (!card) return;
  if (ev.target.closest('[data-edit],[data-del]')) return;
  const name = card.dataset.name, a = ((ev.target.closest('[data-act]') || {}).dataset || {}).act;
  const f = k => card.querySelector(`[data-f="${k}"]`);
  if (a === 'save') {
    call('updatePerson', { name, newName: f('name').value, kind: f('kind').value, role: f('role').value, phone: f('phone').value, active: f('active').checked },
      { btn: ev.target.closest('button'), err: f('msg'), ok: () => { const nn = f('name').value.trim(); if (nn && nn !== name) { S.hopen[nn] = true; delete S.hopen[name]; } } });
    return;
  }
  if (a === 'pay') {
    const p = V.people.find(x => x.name === name);
    endEdit();
    S.type = p && p.kind === 'Client' ? 'Income' : 'Expense'; setTypeButtons(S.type);
    const lc = p && p.kind === 'Employee' ? Object.keys(V.categories.Expense || {}).find(isLabor) : undefined;
    fillCats(lc); fillParty(name);
    showTab('add'); window.scrollTo(0, 0); return;
  }
  if (a === 'del') { if (confirm('Delete "' + name + '"?')) call('deletePerson', name, { btn: ev.target.closest('button'), err: f('msg') }); return; }
  if (ev.target.closest('.ph')) { S.hopen[name] = !S.hopen[name]; card.classList.toggle('open', S.hopen[name]); }
};
document.querySelectorAll('#pkSeg button').forEach(b => b.onclick = () => {
  S.pkind = b.dataset.k;
  document.querySelectorAll('#pkSeg button').forEach(x => x.classList.toggle('on', x === b));
  $('hrole').placeholder = { Employee: 'Embroidery karigar', Vendor: 'Fabric supplier', Client: 'Bride' }[S.pkind];
});
$('hadd').onclick = () => call('addPerson', { name: $('hname').value, kind: S.pkind, role: $('hrole').value, phone: $('hphone').value },
  { btn: $('hadd'), err: $('hmsg'), ok: () => { ['hname', 'hrole', 'hphone'].forEach(id => $(id).value = ''); flash($('hmsg'), 'Added ✓'); $('hfilter').value = S.pkind; renderPeople(); } });

/* =============================== REPORTS =============================== */
function fillReportFilters() {
  const rf = $('rfilter').value || '__all';
  let h = opt('__all', 'All collections and overhead') + opt('P:' + V.general, V.general);
  collections().forEach(c => { h += opt('C:' + c.name, c.name + ' (whole collection)'); dressesOf(c.name).forEach(d => h += opt('P:' + d.name, '   ↳ ' + d.name)); });
  standalone().forEach(d => h += opt('P:' + d.name, d.name + ' (standalone)'));
  $('rfilter').innerHTML = h;
  $('rfilter').value = [...$('rfilter').options].some(o => o.value === rf) ? rf : '__all';
  const yr = $('year').value || today().slice(0, 4);
  const years = [...new Set(V.rows.map(r => String(r.date).slice(0, 4)).concat([today().slice(0, 4)]))].sort().reverse();
  $('year').innerHTML = years.map(y => opt(y)).join('');
  $('year').value = yr;
}
function inPeriod(r) {
  const p = $('period').value;
  return p === 'all' || String(r.date).startsWith(p === 'year' ? $('year').value : $('month').value);
}
function inScope(r) {
  const v = $('rfilter').value;
  if (!v || v === '__all') return true;
  if (v.startsWith('C:')) { const c = v.slice(2); return r.project === c || dressesOf(c).some(d => d.name === r.project); }
  return r.project === v.slice(2);
}
function renderReports() {
  $('month').hidden = $('period').value !== 'month';
  $('year').hidden = $('period').value !== 'year';
  const rows = V.rows.filter(r => inPeriod(r) && inScope(r)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const exp = rows.filter(r => r.type === 'Expense'), inc = rows.filter(r => r.type === 'Income');
  const ti = inc.reduce((s, r) => s + r.amount, 0), te = exp.reduce((s, r) => s + r.amount, 0);
  $('tInc').textContent = fmt(ti); $('tExp').textContent = fmt(te);
  $('tPro').textContent = fmt(ti - te); $('tPro').className = ti - te >= 0 ? 'inc' : 'exp';
  const bc = {};
  rows.forEach(r => { const k = collectionOf(r.project); const o = bc[k] || (bc[k] = { c: 0, i: 0 }); if (r.type === 'Expense') o.c += r.amount; else o.i += r.amount; });
  const keys = Object.keys(bc).sort((a, b) => (bc[b].c + bc[b].i) - (bc[a].c + bc[a].i));
  $('bycoll').innerHTML = keys.length ? '<tr><td class="th">Collection</td><td class="num th">Spent</td><td class="num th">Received</td></tr>' +
    keys.map(k => `<tr><td>${esc(k)}</td><td class="num exp">${fmt(bc[k].c)}</td><td class="num inc">${fmt(bc[k].i)}</td></tr>`).join('') : '<tr><td class="empty">No data</td></tr>';
  $('cats').innerHTML = catBreak(exp);
  $('icats').innerHTML = catBreak(inc);
  $('byppl').innerHTML = groupList(exp, r => r.party);
  const q = $('q').value.trim().toLowerCase();
  const shown = q ? rows.filter(r => [r.description, r.party, r.category, r.sub, r.project, r.by].join(' ').toLowerCase().indexOf(q) >= 0) : rows;
  $('rcount').textContent = shown.length + ' entr' + (shown.length === 1 ? 'y' : 'ies');
  $('tbl').innerHTML = entryRows(shown.slice(0, 300));
}
['period', 'month', 'year', 'rfilter'].forEach(id => $(id).onchange = renderReports);
$('q').oninput = renderReports;

/* =============================== SETTINGS =============================== */
let lastTab = 'add';
$('gear').onclick = () => { if (S.tab !== 'set') lastTab = S.tab; renderSettings(); showTab('set'); window.scrollTo(0, 0); };
$('setBack').onclick = () => showTab(lastTab);
$('setSyncBtn').onclick = () => sync();
function renderSettings() {
  const mode = QJ_themePref('mode');
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  const sw = dark => Object.keys(QJ_THEMES).filter(k => QJ_THEMES[k].dark === dark).map(k => {
    const t = QJ_THEMES[k], on = QJ_themePref(dark ? 'dark' : 'light') === k;
    return `<button class="sw${on ? ' on' : ''}" data-theme="${k}" data-dark="${dark ? 1 : 0}" style="background:${t.bg};color:${t.tx}">
      <div class="dots"><i style="background:${t.btn}"></i><i style="background:${t.card}"></i><i style="background:${t.inc}"></i><i style="background:${t.exp}"></i></div>
      <span>${esc(t.n)}</span></button>`;
  }).join('');
  $('swLight').innerHTML = sw(false);
  $('swDark').innerHTML = sw(true);
  $('setUser').textContent = auth ? auth.name : '';
  $('ver').textContent = APP_VERSION;
  status();
}
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => { QJ_setTheme('mode', b.dataset.m); renderSettings(); });
['swLight', 'swDark'].forEach(id => $(id).onclick = ev => {
  const b = ev.target.closest('.sw'); if (!b) return;
  const dark = b.dataset.dark === '1';
  QJ_setTheme(dark ? 'dark' : 'light', b.dataset.theme);
  // picking a theme shows it right away: switch to that mode unless "Automatic" is already showing it
  const mode = QJ_themePref('mode');
  const sysDark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  if (!(mode === 'auto' && sysDark === dark)) QJ_setTheme('mode', dark ? 'dark' : 'light');
  renderSettings();
});

/* install prompt (Chrome / Android) */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installCard').hidden = false; });
$('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('installCard').hidden = true; };
window.addEventListener('appinstalled', () => { $('installCard').hidden = true; });

/* =============================== render & start =============================== */
function renderAll() {
  V = view();
  document.querySelectorAll('.cur').forEach(e => e.textContent = V.currency || '');
  $('user').textContent = auth ? auth.name : '';
  fillProjects();
  if (!S.editId) { fillCats(); fillParty(); }
  $('recent').innerHTML = entryRows(V.rows.slice(-15).reverse());
  renderProjects(); renderPeople(); fillReportFilters(); renderReports();
  if (S.tab === 'set') renderSettings();
  status();
}

$('refresh').onclick = () => sync();
// keep both users in step: sync every minute while open (never mid-typing or mid-edit), and when back online / reopened
setInterval(() => { if (auth && document.visibilityState === 'visible' && !S.editId && !isTyping()) sync(); }, 60000);
setInterval(() => { if (auth && queue.length && !S.syncing) sync(); }, 15000);
window.addEventListener('online', () => { S.offline = false; sync(); });
window.addEventListener('offline', () => { S.offline = true; status(); });
document.addEventListener('visibilitychange', () => { if (auth && document.visibilityState === 'visible' && !S.editId) sync(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

$('date').value = today();
$('month').value = today().slice(0, 7);
if (auth) { S.offline = navigator.onLine === false; showApp(); sync(); }
else showLogin();
