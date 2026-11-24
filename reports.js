/* Qanoot Jahangir — reports, charts, and PDF / image export.
 * Uses the app's data (V) and helpers from app.js. Export code (lib-html-to-image.js)
 * is only loaded the first time someone exports, so it never slows the app down. */
'use strict';
(function () {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtD = d => { if (!d) return ''; const a = String(d).split('-'); return (+a[2]) + ' ' + MON[+a[1] - 1] + ' ' + a[0]; };
  const nowLabel = () => { const d = new Date(); return fmtD(today()) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const sum = (rows, ty) => rows.reduce((s, r) => s + (!ty || r.type === ty ? r.amount : 0), 0);
  const pct = (n, t) => t ? Math.round(n / t * 100) + '%' : '—';
  const signed = n => { const r = Math.round(Number(n) || 0); return (r < 0 ? '−' : '') + fmt(Math.abs(r)); };
  const money = n => fmt(Math.round(Number(n) || 0));
  const sortDate = rows => rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const lc = s => String(s || '').trim().toLowerCase();

  /* ---------------- periods & scopes ---------------- */
  function period(p) {
    const mode = p.pmode || 'month';
    if (mode === 'month') { const m = p.month || today().slice(0, 7); return { from: m + '-01', to: m + '-31', label: MONTH[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4), multi: false }; }
    if (mode === 'year') { const y = p.year || today().slice(0, 4); return { from: y + '-01-01', to: y + '-12-31', label: 'Year ' + y, multi: true }; }
    if (mode === 'range') {
      const f = p.from || '', t = p.to || '';
      return { from: f, to: t, label: (f ? fmtD(f) : 'Start') + ' – ' + (t ? fmtD(t) : 'today'), multi: !f || !t || f.slice(0, 7) !== t.slice(0, 7) };
    }
    return { from: '', to: '', label: 'All time', multi: true };
  }
  const inP = (r, P) => (!P.from || r.date >= P.from) && (!P.to || r.date <= P.to);
  function inSc(r, v) {
    if (!v || v === '__all') return true;
    if (v.startsWith('C:')) { const c = v.slice(2); return r.project === c || dressesOf(c).some(d => d.name === r.project); }
    return r.project === v.slice(2);
  }
  const scLabel = v => !v || v === '__all' ? 'All collections' : v.startsWith('C:') ? v.slice(2) + ' (whole collection)' : v.slice(2);
  function scopeOpts(sel) {
    let h = opt('__all', 'All collections and overhead', sel === '__all') + opt('P:' + V.general, V.general, sel === 'P:' + V.general);
    collections().forEach(c => { h += opt('C:' + c.name, c.name + ' (whole collection)', sel === 'C:' + c.name); dressesOf(c.name).forEach(d => h += opt('P:' + d.name, '   ↳ ' + d.name, sel === 'P:' + d.name)); });
    standalone().forEach(d => h += opt('P:' + d.name, d.name + ' (standalone)', sel === 'P:' + d.name));
    return h;
  }
  /** Month buckets for a trend chart (most recent 24 months at most). */
  function monthly(rows, P) {
    const ms = rows.map(r => String(r.date).slice(0, 7)).filter(Boolean).sort();
    let start = P.from ? P.from.slice(0, 7) : ms[0], end = P.to ? P.to.slice(0, 7) : ms[ms.length - 1];
    const cur = today().slice(0, 7);
    if (!start || !end) return [];
    if (end > cur && (!ms.length || ms[ms.length - 1] <= cur)) end = cur;
    if (ms.length && ms[ms.length - 1] > end) end = ms[ms.length - 1];
    const out = [];
    let y = +start.slice(0, 4), m = +start.slice(5, 7);
    while (true) {
      const k = y + '-' + String(m).padStart(2, '0');
      if (k > end || out.length > 240) break;
      out.push({ k, inc: 0, exp: 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
    const idx = {}; out.forEach((o, i) => idx[o.k] = i);
    rows.forEach(r => { const i = idx[String(r.date).slice(0, 7)]; if (i !== undefined) r.type === 'Income' ? out[i].inc += r.amount : out[i].exp += r.amount; });
    return out.slice(-24);
  }
  const monLabel = k => MON[+k.slice(5, 7) - 1] + ' ’' + k.slice(2, 4);

  /* ---------------- blocks ---------------- */
  const tiles = items => ({ t: 'tiles', items });
  const H = text => ({ t: 'h', text });
  const note = text => ({ t: 'note', text });
  const empty = text => ({ t: 'empty', text });
  const kv = items => ({ t: 'kv', items: items.filter(x => x[1] !== '' && x[1] != null) });
  const chart = html => ({ t: 'chart', html });
  const table = (cols, rows, foot) => ({ t: 'table', cols, rows, foot });
  const col = (l, n) => ({ l, n: !!n });
  const row = (c, cls) => ({ c, cls: cls || '' });
  const pendingNote = rows => { const n = rows.filter(r => r.pending).length; return n ? note(n + ' entr' + (n === 1 ? 'y is' : 'ies are') + ' included that ' + (n === 1 ? 'hasn\'t' : 'haven\'t') + ' synced to the Sheet yet.') : null; };

  /* ---------------- charts (plain HTML, themed by CSS) ---------------- */
  function fold(items, max) {
    items = items.filter(i => i.v > 0).sort((a, b) => b.v - a.v);
    if (items.length <= max) return items;
    const rest = items.slice(max - 1);
    return items.slice(0, max - 1).concat([{ label: 'Other (' + rest.length + ')', v: rest.reduce((s, i) => s + i.v, 0) }]);
  }
  const legend = series => `<div class="lg">${series.map(s => `<span><i class="sw-${s.c}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  /** Horizontal bars. items: [{label, v, v2?, c?}]. series: [{name, c}] (c = ink | inc | exp). */
  function hbars(items, series) {
    if (!items.length) return '';
    const two = series.length > 1;
    const max = Math.max.apply(null, items.map(i => Math.max(Math.abs(i.v), two ? Math.abs(i.v2 || 0) : 0))) || 1;
    const line = (v, c) => `<div class="hb-line"><div class="hb-track"><div class="hb-fill sw-${c}" style="width:${Math.max(Math.abs(v) / max * 100, v ? 1 : 0).toFixed(1)}%"></div></div><div class="hb-val">${signed(v)}</div></div>`;
    return `<div class="hb">${two ? legend(series) : ''}${items.map(i => `<div class="hb-row" title="${esc(i.label)}"><div class="hb-lab">${esc(i.label)}</div><div>${line(i.v, i.c || series[0].c)}${two ? line(i.v2 || 0, series[1].c) : ''}</div></div>`).join('')}</div>`;
  }
  /** Monthly columns: income (solid) vs expenses (striped). */
  function columns(ms) {
    const max = Math.max.apply(null, ms.map(m => Math.max(m.inc, m.exp))) || 1;
    const every = ms.length > 12 ? 2 : 1;
    const h = v => (v / max * 100).toFixed(1) + '%';
    return `<div class="cc">${legend([{ name: 'Income', c: 'inc' }, { name: 'Expenses', c: 'exp' }])}
      <div class="cc-max">${fmt(max)}</div>
      <div class="cc-plot">${ms.map(m => `<div class="cc-col" title="${monLabel(m.k)}: income ${fmt(m.inc)}, expenses ${fmt(m.exp)}"><div class="cc-bar sw-inc" style="height:${h(m.inc)}"></div><div class="cc-bar sw-exp" style="height:${h(m.exp)}"></div></div>`).join('')}</div>
      <div class="cc-labs">${ms.map((m, i) => `<div>${i % every === 0 ? monLabel(m.k) : ''}</div>`).join('')}</div></div>`;
  }

  /* ---------------- shared tables ---------------- */
  function catTable(rows, label) {
    const total = sum(rows), m = {};
    rows.forEach(r => { const c = m[r.category || '—'] || (m[r.category || '—'] = { t: 0, s: {} }); c.t += r.amount; const k = r.sub || '—'; c.s[k] = (c.s[k] || 0) + r.amount; });
    const out = [];
    Object.keys(m).sort((a, b) => m[b].t - m[a].t).forEach(c => {
      out.push(row([esc(c), money(m[c].t), pct(m[c].t, total)], 'grp'));
      Object.keys(m[c].s).sort((a, b) => m[c].s[b] - m[c].s[a]).forEach(s => out.push(row(['<span class="ind">' + esc(s) + '</span>', money(m[c].s[s]), pct(m[c].s[s], total)], 'sub')));
    });
    return table([col(label || 'Category'), col('Amount', 1), col('Share', 1)], out, ['Total', money(total), '100%']);
  }
  function groupTable(rows, keyFn, label, valueLabel) {
    const m = {}, total = sum(rows);
    rows.forEach(r => { const k = keyFn(r) || '—'; m[k] = (m[k] || 0) + r.amount; });
    const keys = Object.keys(m).sort((a, b) => m[b] - m[a]);
    return table([col(label), col(valueLabel || 'Amount', 1), col('Share', 1)], keys.map(k => row([esc(k), money(m[k]), pct(m[k], total)])), ['Total', money(total), '100%']);
  }
  function groupItems(rows, keyFn) {
    const m = {}; rows.forEach(r => { const k = keyFn(r) || '—'; m[k] = (m[k] || 0) + r.amount; });
    return Object.keys(m).map(k => ({ label: k, v: m[k] }));
  }
  const catLine = r => esc(r.category) + (r.sub ? ' › ' + esc(r.sub) : '');
  const qr = r => r.qty !== '' && r.rate !== '' && r.qty != null && r.rate != null ? fmt(r.qty) + ' × ' + fmt(r.rate) : '';
  function entryTable(rows, opts) {
    opts = opts || {};
    const cols = [col('Date')];
    if (opts.type) cols.push(col('Type'));
    if (opts.project) cols.push(col('Collection / dress'));
    cols.push(col('Category'));
    if (opts.party !== false) cols.push(col(opts.partyLabel || 'Person'));
    cols.push(col('Details'), col('Amount', 1));
    const body = sortDate(rows).map(r => {
      const c = [fmtD(r.date)];
      if (opts.type) c.push(r.type);
      if (opts.project) c.push(esc(r.project));
      c.push(catLine(r));
      if (opts.party !== false) c.push(esc(r.party || ''));
      c.push([esc(r.description || ''), qr(r)].filter(Boolean).join(' · ') + (r.pending ? ' <span class="pend">not synced</span>' : ''));
      c.push(opts.type ? (r.type === 'Income' ? '+' : '−') + money(r.amount) : money(r.amount));
      return row(c);
    });
    const foot = new Array(cols.length).fill('');
    foot[0] = 'Total'; foot[cols.length - 1] = opts.type ? signed(sum(rows, 'Income') - sum(rows, 'Expense')) : money(sum(rows));
    return table(cols, body, foot);
  }

  /* ---------------- dress / collection maths ---------------- */
  function dressFigures(p, ovh) {
    const m = costMap(), sh = overheadShare(m);
    const t = totals(p, m, sh.fn);
    t.cost = t.direct + (ovh ? t.ovh : 0);
    t.profit = t.revenue - t.cost;
    t.margin = t.revenue > 0 ? t.profit / t.revenue * 100 : null;
    return t;
  }
  const marginTxt = t => t.margin === null ? '' : ' · ' + signed(Math.round(t.margin)) + '%';

  /* ================================================================ REPORTS */
  const DEFS = {
    pnl: {
      title: 'Profit and loss', desc: 'Income, expenses and profit for any period, with a month-by-month trend.',
      params: ['period', 'scope'], defaults: { pmode: 'month', scope: '__all' },
      build(p) {
        const P = period(p), rows = V.rows.filter(r => inP(r, P) && inSc(r, p.scope));
        const exp = rows.filter(r => r.type === 'Expense'), inc = rows.filter(r => r.type === 'Income');
        const ti = sum(inc), te = sum(exp), pr = ti - te;
        const B = [tiles([['Income', money(ti), 'inc'], ['Expenses', money(te), 'exp'], ['Profit' + (ti > 0 ? ' · ' + signed(Math.round(pr / ti * 100)) + '%' : ''), signed(pr), pr >= 0 ? 'inc' : 'exp']])];
        if (!rows.length) { B.push(empty('No entries in this period.')); return { subtitle: scLabel(p.scope) + ' · ' + P.label, blocks: B }; }
        if (P.multi) {
          const ms = monthly(rows, P);
          if (ms.length > 1) {
            B.push(H('Month by month'), chart(columns(ms)));
            B.push(table([col('Month'), col('Income', 1), col('Expenses', 1), col('Profit', 1)],
              ms.map(m => row([MONTH[+m.k.slice(5, 7) - 1] + ' ' + m.k.slice(0, 4), money(m.inc), money(m.exp), signed(m.inc - m.exp)])),
              ['Total', money(ti), money(te), signed(pr)]));
          }
        }
        if (exp.length) B.push(H('Expenses by category'), chart(hbars(fold(groupItems(exp, r => r.category), 8), [{ name: 'Expenses', c: 'ink' }])), catTable(exp));
        if (inc.length) B.push(H('Income by category'), catTable(inc));
        if (!p.scope || p.scope === '__all' || p.scope.startsWith('C:')) {
          const m = {};
          rows.forEach(r => { const k = p.scope && p.scope.startsWith('C:') ? r.project : collectionOf(r.project); const o = m[k] || (m[k] = { c: 0, i: 0 }); r.type === 'Expense' ? o.c += r.amount : o.i += r.amount; });
          const keys = Object.keys(m).sort((a, b) => (m[b].c + m[b].i) - (m[a].c + m[a].i));
          B.push(H(p.scope && p.scope.startsWith('C:') ? 'By dress' : 'By collection'),
            table([col(p.scope && p.scope.startsWith('C:') ? 'Dress' : 'Collection'), col('Spent', 1), col('Received', 1), col('Net', 1)],
              keys.map(k => row([esc(k), money(m[k].c), money(m[k].i), signed(m[k].i - m[k].c)])), ['Total', money(te), money(ti), signed(pr)]));
        }
        if (exp.some(r => r.party)) B.push(H('Paid to people'), groupTable(exp.filter(r => r.party), r => r.party, 'Person'));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        return { subtitle: scLabel(p.scope) + ' · ' + P.label, blocks: B };
      }
    },

    collection: {
      title: 'Collection summary', desc: 'Every dress in a collection: cost, sale price, profit and payments.',
      params: ['collection', 'ovh'], defaults: {},
      build(p) {
        const c = collections().find(x => x.name === p.collection);
        if (!c) return { subtitle: '', blocks: [empty(collections().length ? 'Choose a collection.' : 'Create a collection first.')] };
        const ds = dressesOf(c.name), names = [c.name].concat(ds.map(d => d.name));
        const ct = dressFigures(c, p.ovh);
        const rec = ds.reduce((s, d) => s + dressFigures(d, p.ovh).ownRec, 0) + ct.ownRec;
        const due = ds.reduce((s, d) => { const t = dressFigures(d, p.ovh); return s + (t.due > 0 ? t.due : 0); }, 0);
        const B = [tiles([[p.ovh ? 'Cost + overhead' : 'Total cost', money(ct.cost), 'exp'], ['Sale value', ct.revenue ? money(ct.revenue) : '—', ''],
          ['Profit' + marginTxt(ct), ct.revenue ? signed(ct.profit) : '—', !ct.revenue ? '' : ct.profit >= 0 ? 'inc' : 'exp'], ['Received', money(rec), 'inc'], ['Balance due', money(due), due > 0 ? 'exp' : '']])];
        const figs = ds.map(d => ({ d, t: dressFigures(d, p.ovh) }));
        if (figs.length) {
          if (figs.some(f => f.t.revenue > 0)) B.push(H('Cost and sale price by dress'), chart(hbars(figs.map(f => ({ label: f.d.name, v: f.t.cost, v2: f.t.revenue })), [{ name: 'Cost', c: 'exp' }, { name: 'Sale price', c: 'inc' }])));
          else B.push(H('Cost by dress'), chart(hbars(figs.map(f => ({ label: f.d.name, v: f.t.cost })), [{ name: 'Cost', c: 'ink' }])));
          const own = costMap()[c.name] || { cost: 0 };
          const body = figs.map(f => row([esc(f.d.name) + (f.d.client ? '<small>' + esc(f.d.client) + '</small>' : ''), esc(f.d.status), money(f.t.cost), f.t.revenue ? money(f.t.revenue) : '—', f.t.revenue ? signed(f.t.profit) : '—', f.t.margin === null ? '—' : Math.round(f.t.margin) + '%']));
          if (own.cost) body.push(row(['Collection-level costs<small>Photoshoots, shows and other shared costs</small>', '', money(own.cost + (p.ovh ? overheadShare(costMap()).fn(c.name) : 0)), '', signed(-(own.cost + (p.ovh ? overheadShare(costMap()).fn(c.name) : 0))), '']));
          B.push(H('Dresses'), table([col('Dress'), col('Status'), col('Cost', 1), col('Sale price', 1), col('Profit', 1), col('Margin', 1)], body,
            ['Total', '', money(ct.cost), ct.revenue ? money(ct.revenue) : '—', ct.revenue ? signed(ct.profit) : '—', ct.margin === null ? '—' : Math.round(ct.margin) + '%']));
          B.push(H('Payments from clients'), table([col('Dress'), col('Client'), col('Sale price', 1), col('Received', 1), col('Due', 1)],
            figs.map(f => row([esc(f.d.name), esc(f.d.client), f.d.price ? money(f.d.price) : '—', money(f.t.ownRec), f.t.due === null ? '—' : f.t.due > 0 ? money(f.t.due) : 'Paid'])),
            ['Total', '', ds.some(d => d.price > 0) ? money(ds.reduce((s, d) => s + d.price, 0)) : '—', money(figs.reduce((s, f) => s + f.t.ownRec, 0)), ds.some(d => d.price > 0) ? money(due) : '—']));
        } else B.push(empty('This collection has no dresses yet.'));
        const exp = V.rows.filter(r => names.indexOf(r.project) >= 0 && r.type === 'Expense');
        if (exp.length) B.push(H('Cost breakdown'), catTable(exp));
        if (exp.some(r => r.party)) B.push(H('Paid to people'), groupTable(exp.filter(r => r.party), r => r.party, 'Person'));
        if (p.ovh) B.push(note('Overhead (rent, salaries and other General / Overhead costs) is spread across all collections and dresses in proportion to their direct cost. It is an estimate.'));
        const pn = pendingNote(V.rows.filter(r => names.indexOf(r.project) >= 0)); if (pn) B.push(pn);
        return { subtitle: ds.length + ' dress' + (ds.length === 1 ? '' : 'es') + ' · all time' + (p.ovh ? ' · overhead included' : ''), subject: c.name, blocks: B };
      }
    },

    dress: {
      title: 'Dress cost sheet', desc: 'Full costing for one dress: materials, labour, people paid, profit and balance due.',
      params: ['dress', 'ovh'], defaults: {},
      build(p) {
        const d = V.projects.find(x => x.kind === 'Dress' && x.name === p.dress);
        if (!d) return { subtitle: '', blocks: [empty(V.projects.some(x => x.kind === 'Dress') ? 'Choose a dress.' : 'Create a dress first.')] };
        const t = dressFigures(d, p.ovh);
        const rows = V.rows.filter(r => r.project === d.name), exp = rows.filter(r => r.type === 'Expense'), inc = rows.filter(r => r.type === 'Income');
        const B = [kv([['Collection', d.collection || 'Standalone'], ['Client', d.client], ['Status', d.status]]),
          tiles([[p.ovh ? 'Cost + overhead' : 'Cost', money(t.cost), 'exp'], ['Sale price', t.revenue ? money(t.revenue) : '—', ''],
            ['Profit' + marginTxt(t), t.revenue ? signed(t.profit) : '—', !t.revenue ? '' : t.profit >= 0 ? 'inc' : 'exp'], ['Received', money(t.ownRec), 'inc'],
            ['Balance due', t.due === null ? '—' : t.due > 0 ? money(t.due) : 'Paid in full', t.due > 0 ? 'exp' : 'inc']])];
        if (p.ovh && t.ovh) B.push(kv([['Direct cost', money(t.direct)], ['Overhead share (estimate)', money(t.ovh)]]));
        if (exp.length) {
          B.push(H('Where the money went'), chart(hbars(fold(groupItems(exp, r => r.category), 8), [{ name: 'Cost', c: 'ink' }])), catTable(exp));
          if (exp.some(r => r.party)) B.push(H('Paid to people'), groupTable(exp.filter(r => r.party), r => r.party, 'Person'));
          B.push(H('Cost entries'), entryTable(exp));
        } else B.push(empty('No costs recorded for this dress yet.'));
        if (inc.length) B.push(H('Payments received'), entryTable(inc, { partyLabel: 'From' }));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        return { subtitle: (d.collection ? d.collection + ' · ' : '') + 'all time' + (p.ovh ? ' · overhead included' : ''), subject: d.name, blocks: B };
      }
    },

    person: {
      title: 'Payment statement', desc: 'Everything paid to one employee, karigar or vendor, by dress and by date.',
      params: ['person', 'period'], defaults: { pmode: 'all' },
      build(p) {
        const ps = V.people.find(x => x.name === p.person);
        if (!p.person) return { subtitle: '', blocks: [empty('Add people on the People tab first.')] };
        const P = period(p), all = V.rows.filter(r => r.party === p.person);
        const rows = all.filter(r => inP(r, P)), exp = rows.filter(r => r.type === 'Expense'), inc = rows.filter(r => r.type === 'Income');
        const B = [kv([['Type', ps ? ps.kind : ''], ['Role', ps ? ps.role : ''], ['Phone', ps ? ps.phone : '']]),
          tiles([['Paid', money(sum(exp)), 'exp'], ['Entries', String(exp.length), ''], ['Dresses worked on', String(new Set(exp.map(r => r.project).filter(x => x !== V.general)).size), '']])];
        if (inc.length) B[1].items.push(['Received from them', money(sum(inc)), 'inc']);
        if (!rows.length) { B.push(empty('No entries for ' + p.person + ' in this period.')); return { subtitle: P.label, subject: p.person, blocks: B }; }
        if (exp.length) {
          B.push(H('By collection and dress'), chart(hbars(fold(groupItems(exp, r => r.project), 10), [{ name: 'Paid', c: 'ink' }])), groupTable(exp, r => r.project, 'Collection / dress'));
          if (P.multi) { const ms = monthly(exp, P); if (ms.length > 1) B.push(H('By month'), table([col('Month'), col('Paid', 1)], ms.filter(m => m.exp).map(m => row([MONTH[+m.k.slice(5, 7) - 1] + ' ' + m.k.slice(0, 4), money(m.exp)])), ['Total', money(sum(exp))])); }
          B.push(H('All payments'), entryTable(exp, { project: true, party: false }));
        }
        if (inc.length) B.push(H('Money received from ' + p.person), entryTable(inc, { project: true, party: false }));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        return { subtitle: P.label, subject: p.person, blocks: B };
      }
    },

    client: {
      title: 'Client statement', desc: 'A client\'s dresses, what they have paid and what is still due.',
      params: ['client'], defaults: {},
      build(p) {
        if (!p.client) return { subtitle: '', blocks: [empty('Add a client on the People tab, or set a client on a dress.')] };
        const ds = V.projects.filter(x => x.kind === 'Dress' && lc(x.client) === lc(p.client));
        const names = ds.map(d => d.name);
        const pays = V.rows.filter(r => r.type === 'Income' && (lc(r.party) === lc(p.client) || (names.indexOf(r.project) >= 0 && !r.party)));
        const price = ds.reduce((s, d) => s + d.price, 0), paid = sum(pays);
        const ps = V.people.find(x => lc(x.name) === lc(p.client));
        const unpriced = ds.filter(d => !(d.price > 0));
        const bal = price - paid;
        const balTxt = !price ? '—' : bal > 0 ? money(bal) : bal < 0 ? 'Overpaid ' + money(-bal) : 'Paid in full';
        const B = [kv([['Phone', ps ? ps.phone : ''], ['Statement date', fmtD(today())]]),
          tiles([['Total price', price ? money(price) : 'Not set', ''], ['Paid', money(paid), 'inc'], ['Balance due', balTxt, !price ? '' : bal > 0 ? 'exp' : 'inc']])];
        if (unpriced.length) B.push(note(unpriced.length === ds.length ? 'None of these dresses has a sale price yet, so the balance can’t be worked out. Set the sale price on each dress card in Collections.' : unpriced.length + ' of these dresses ' + (unpriced.length === 1 ? 'has' : 'have') + ' no sale price yet, so ' + (unpriced.length === 1 ? 'it isn’t' : 'they aren’t') + ' included in the balance. Set the sale price on the dress card in Collections.'));
        if (ds.length) {
          B.push(H('Dresses'), table([col('Dress'), col('Collection'), col('Status'), col('Price', 1), col('Paid', 1), col('Due', 1)],
            ds.map(d => { const pd = sum(pays.filter(r => r.project === d.name)); return row([esc(d.name), esc(d.collection || 'Standalone'), esc(d.status), d.price ? money(d.price) : 'Not set', money(pd), d.price ? (d.price - pd > 0 ? money(d.price - pd) : 'Paid') : '—']); }),
            ['Total', '', '', price ? money(price) : '—', money(sum(pays.filter(r => names.indexOf(r.project) >= 0))), price ? money(Math.max(price - sum(pays.filter(r => names.indexOf(r.project) >= 0)), 0)) : '—']));
        } else B.push(note('No dresses list ' + p.client + ' as the client. To link a dress, set its Client field on the Collections tab.'));
        if (pays.length) B.push(H('Payments'), entryTable(pays, { project: true, party: false }));
        else B.push(empty('No payments recorded yet.'));
        const pn = pendingNote(pays); if (pn) B.push(pn);
        return { subtitle: 'As of ' + fmtD(today()), subject: p.client, blocks: B };
      }
    },

    category: {
      title: 'Spending by category', desc: 'One cost category (e.g. Materials or Labor): by subcategory, dress, person and month.',
      params: ['category', 'period', 'scope'], defaults: { pmode: 'year', scope: '__all' },
      build(p) {
        const P = period(p), rows = V.rows.filter(r => r.type === 'Expense' && r.category === p.category && inP(r, P) && inSc(r, p.scope));
        const total = sum(rows);
        const B = [tiles([['Spent', money(total), 'exp'], ['Entries', String(rows.length), ''], ['Share of all costs', pct(total, sum(V.rows.filter(r => r.type === 'Expense' && inP(r, P) && inSc(r, p.scope)))), '']])];
        if (!rows.length) { B.push(empty('No ' + p.category + ' costs in this period.')); return { subtitle: scLabel(p.scope) + ' · ' + P.label, subject: p.category, blocks: B }; }
        B.push(H('By subcategory'), chart(hbars(fold(groupItems(rows, r => r.sub), 10), [{ name: 'Spent', c: 'ink' }])), groupTable(rows, r => r.sub, 'Subcategory'));
        B.push(H('By collection and dress'), groupTable(rows, r => r.project, 'Collection / dress'));
        if (rows.some(r => r.party)) B.push(H('By person'), groupTable(rows.filter(r => r.party), r => r.party, 'Person'));
        if (P.multi) { const ms = monthly(rows, P); if (ms.length > 1) B.push(H('By month'), table([col('Month'), col('Spent', 1)], ms.map(m => row([MONTH[+m.k.slice(5, 7) - 1] + ' ' + m.k.slice(0, 4), money(m.exp)])), ['Total', money(total)])); }
        B.push(H('Entries'), entryTable(rows, { project: true }));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        return { subtitle: scLabel(p.scope) + ' · ' + P.label, subject: p.category, blocks: B };
      }
    },

    overhead: {
      title: 'Overhead report', desc: 'Rent, salaries and other costs not tied to a dress, and how they spread across collections.',
      params: ['period'], defaults: { pmode: 'year' },
      build(p) {
        const P = period(p), inPer = V.rows.filter(r => inP(r, P) && r.type === 'Expense');
        const rows = inPer.filter(r => r.project === V.general), oh = sum(rows), all = sum(inPer);
        const B = [tiles([['Overhead', money(oh), 'exp'], ['Direct dress costs', money(all - oh), ''], ['Overhead share of all costs', pct(oh, all), '']])];
        if (!rows.length) { B.push(empty('No overhead costs in this period.')); return { subtitle: P.label, blocks: B }; }
        B.push(H('By category'), chart(hbars(fold(groupItems(rows, r => r.category), 8), [{ name: 'Overhead', c: 'ink' }])), catTable(rows));
        if (P.multi) { const ms = monthly(rows, P); if (ms.length > 1) B.push(H('By month'), table([col('Month'), col('Overhead', 1)], ms.map(m => row([MONTH[+m.k.slice(5, 7) - 1] + ' ' + m.k.slice(0, 4), money(m.exp)])), ['Total', money(oh)])); }
        // spread of this period's overhead, in proportion to each collection's direct cost in the same period
        const dc = {}; inPer.filter(r => r.project !== V.general).forEach(r => { const k = collectionOf(r.project); dc[k] = (dc[k] || 0) + r.amount; });
        const base = all - oh, keys = Object.keys(dc).sort((a, b) => dc[b] - dc[a]);
        if (keys.length) B.push(H('Estimated share by collection'), table([col('Collection'), col('Direct cost', 1), col('Overhead share', 1), col('Total', 1)],
          keys.map(k => { const s = base ? oh * dc[k] / base : 0; return row([esc(k), money(dc[k]), money(s), money(dc[k] + s)]); }), ['Total', money(base), money(base ? oh : 0), money(base + (base ? oh : 0))]),
          note('Overhead is shared in proportion to each collection\'s direct cost in the same period. It is an estimate.'));
        B.push(H('Entries'), entryTable(rows));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        return { subtitle: P.label, blocks: B };
      }
    },

    dues: {
      title: 'Outstanding payments', desc: 'Every dress with money still owed by the client.',
      params: ['collection_any'], defaults: { collection_any: '__all' },
      build(p) {
        let ds = V.projects.filter(x => x.kind === 'Dress' && x.price > 0);
        if (p.collection_any && p.collection_any !== '__all') ds = ds.filter(d => d.collection === p.collection_any);
        const list = ds.map(d => ({ d, t: dressFigures(d, false) })).filter(x => x.t.due > 0).sort((a, b) => b.t.due - a.t.due);
        const due = list.reduce((s, x) => s + x.t.due, 0);
        const B = [tiles([['Total due', money(due), due > 0 ? 'exp' : 'inc'], ['Dresses with a balance', String(list.length), ''], ['Already received', money(list.reduce((s, x) => s + x.t.ownRec, 0)), 'inc']])];
        if (!list.length) { B.push(empty('Nothing outstanding — every priced dress is paid in full.')); }
        else {
          B.push(H('Largest balances'), chart(hbars(list.slice(0, 10).map(x => ({ label: x.d.name, v: x.t.due })), [{ name: 'Due', c: 'ink' }])));
          B.push(H('All balances'), table([col('Dress'), col('Client'), col('Status'), col('Price', 1), col('Received', 1), col('Due', 1)],
            list.map(x => row([esc(x.d.name) + (x.d.collection ? '<small>' + esc(x.d.collection) + '</small>' : ''), esc(x.d.client || '—'), esc(x.d.status), money(x.d.price), money(x.t.ownRec), money(x.t.due)])),
            ['Total', '', '', money(list.reduce((s, x) => s + x.d.price, 0)), money(list.reduce((s, x) => s + x.t.ownRec, 0)), money(due)]));
        }
        return { subtitle: (p.collection_any && p.collection_any !== '__all' ? p.collection_any + ' · ' : '') + 'as of ' + fmtD(today()), blocks: B };
      }
    },

    ledger: {
      title: 'Entries list', desc: 'A plain list of entries, filtered by period, collection, type or search.',
      params: ['period', 'scope', 'etype', 'q'], defaults: { pmode: 'month', scope: '__all', etype: 'all', q: '' },
      build(p) {
        const P = period(p), q = lc(p.q);
        const rows = V.rows.filter(r => inP(r, P) && inSc(r, p.scope) && (p.etype === 'all' || r.type === p.etype) &&
          (!q || lc([r.description, r.party, r.category, r.sub, r.project, r.by].join(' ')).indexOf(q) >= 0));
        const ti = sum(rows, 'Income'), te = sum(rows, 'Expense');
        const B = [tiles([['Income', money(ti), 'inc'], ['Expenses', money(te), 'exp'], ['Net', signed(ti - te), ti - te >= 0 ? 'inc' : 'exp'], ['Entries', String(rows.length), '']])];
        B.push(rows.length ? entryTable(rows, { type: true, project: true }) : empty('No entries match.'));
        const pn = pendingNote(rows); if (pn) B.push(pn);
        const bits = [scLabel(p.scope), P.label]; if (p.etype !== 'all') bits.push(p.etype + ' only'); if (p.q) bits.push('matching “' + p.q + '”');
        return { subtitle: bits.join(' · '), blocks: B };
      }
    }
  };
  const ORDER = ['pnl', 'collection', 'dress', 'person', 'client', 'category', 'overhead', 'dues', 'ledger'];

  /* ================================================================ rendering */
  function blockHtml(b, print) {
    switch (b.t) {
      case 'tiles': return `<div class="blk blk-tiles"><div class="rtiles">${b.items.map(i => `<div class="rtile"><small>${esc(i[0])}</small><b class="${i[2] || ''}">${esc(i[1])}</b></div>`).join('')}</div></div>`;
      case 'h': return `<div class="blk blk-h"><h3>${esc(b.text)}</h3></div>`;
      case 'note': return `<div class="blk blk-note"><div class="rnote">${esc(b.text)}</div></div>`;
      case 'empty': return `<div class="blk blk-empty"><div class="rempty">${esc(b.text)}</div></div>`;
      case 'kv': return b.items.length ? `<div class="blk blk-kv"><div class="rkv">${b.items.map(i => `<span><small>${esc(i[0])}</small>${esc(i[1])}</span>`).join('')}</div></div>` : '';
      case 'chart': return b.html ? `<div class="blk blk-chart">${b.html}</div>` : '';
      case 'table': {
        const t = `<table class="rt">${thead(b)}<tbody>${b.rows.map(r => trHtml(b, r)).join('')}</tbody>${tfoot(b)}</table>`;
        return `<div class="blk blk-table">${print ? t : '<div class="tscroll">' + t + '</div>'}</div>`;
      }
    }
    return '';
  }
  const thead = b => `<thead><tr>${b.cols.map(c => `<th class="${c.n ? 'n' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead>`;
  const trHtml = (b, r) => `<tr class="${r.cls}">${r.c.map((x, i) => `<td class="${b.cols[i] && b.cols[i].n ? 'n' : ''}">${x}</td>`).join('')}</tr>`;
  const tfoot = b => b.foot ? `<tfoot><tr>${b.foot.map((x, i) => `<td class="${b.cols[i] && b.cols[i].n ? 'n' : ''}">${x}</td>`).join('')}</tr></tfoot>` : '';
  function headerHtml(def, out) {
    return `<div class="blk blk-head"><div class="rhead"><img src="icons/icon-192.png" class="rlogo" alt="" width="48" height="48">
      <div class="rhead-t"><div class="rbrand">Qanoot Jahangir</div><div class="rtitle">${esc(def.title)}${out.subject ? ' — ' + esc(out.subject) : ''}</div>
      <div class="rsub">${esc(out.subtitle || '')}</div></div></div>
      <div class="rmeta">Generated ${esc(nowLabel())}${auth ? ' by ' + esc(auth.name) : ''} · Amounts in ${esc(V.currency || '')}</div></div>`;
  }

  /* ================================================================ viewer */
  const RS = { key: null, p: {}, out: null, back: 'rep' };
  const thisMonth = () => today().slice(0, 7), thisYear = () => today().slice(0, 4);
  function defaultsFor(key) {
    const d = Object.assign({ pmode: 'month', month: thisMonth(), year: thisYear(), from: '', to: '', ovh: !!S.ovh }, DEFS[key].defaults);
    const firstDress = V.projects.find(x => x.kind === 'Dress');
    if (DEFS[key].params.indexOf('collection') >= 0) d.collection = (collections()[0] || {}).name || '';
    if (DEFS[key].params.indexOf('dress') >= 0) d.dress = firstDress ? firstDress.name : '';
    if (DEFS[key].params.indexOf('person') >= 0) { const ps = personList(); d.person = ps.length ? ps[0].name : ''; }
    if (DEFS[key].params.indexOf('client') >= 0) d.client = clientList()[0] || '';
    if (DEFS[key].params.indexOf('category') >= 0) { const cs = categoryList(); d.category = cs.indexOf('Materials') >= 0 ? 'Materials' : cs[0] || ''; }
    return d;
  }
  const personList = () => V.people.filter(x => x.kind !== 'Client').sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  function clientList() {
    const m = {};
    V.people.filter(x => x.kind === 'Client').forEach(x => m[lc(x.name)] = x.name);
    V.projects.forEach(x => { if (x.client && !m[lc(x.client)]) m[lc(x.client)] = x.client.trim(); });
    return Object.keys(m).map(k => m[k]).sort((a, b) => a.localeCompare(b));
  }
  function categoryList() {
    const s = Object.keys((V.categories || {}).Expense || {});
    V.rows.forEach(r => { if (r.type === 'Expense' && r.category && s.indexOf(r.category) < 0) s.push(r.category); });
    return s;
  }

  const PF = {
    period: p => {
      const years = [...new Set(V.rows.map(r => String(r.date).slice(0, 4)).concat([thisYear()]))].filter(Boolean).sort().reverse();
      return `<label>Period</label><div class="row2"><select data-k="pmode">${[['month', 'Month'], ['year', 'Year'], ['all', 'All time'], ['range', 'Date range']].map(x => opt(x[0], x[1], p.pmode === x[0])).join('')}</select>
        ${p.pmode === 'month' ? `<input type="month" data-k="month" value="${esc(p.month)}">` : p.pmode === 'year' ? `<select data-k="year">${years.map(y => opt(y, y, y === p.year)).join('')}</select>` : '<span></span>'}</div>
        ${p.pmode === 'range' ? `<div class="row2"><div><label>From</label><input type="date" data-k="from" value="${esc(p.from)}"></div><div><label>To</label><input type="date" data-k="to" value="${esc(p.to)}"></div></div>` : ''}`;
    },
    scope: p => `<label>Collection / dress</label><select data-k="scope">${scopeOpts(p.scope)}</select>`,
    collection: p => `<label>Collection</label><select data-k="collection">${collections().map(c => opt(c.name, c.name, c.name === p.collection)).join('') || opt('', 'No collections yet')}</select>`,
    collection_any: p => `<label>Collection</label><select data-k="collection_any">${opt('__all', 'All collections', p.collection_any === '__all')}${collections().map(c => opt(c.name, c.name, c.name === p.collection_any)).join('')}</select>`,
    dress: p => {
      let h = '';
      collections().forEach(c => { const ds = dressesOf(c.name); if (ds.length) h += `<optgroup label="${esc(c.name)}">${ds.map(d => opt(d.name, d.name, d.name === p.dress)).join('')}</optgroup>`; });
      const loose = standalone(); if (loose.length) h += `<optgroup label="Standalone dresses">${loose.map(d => opt(d.name, d.name, d.name === p.dress)).join('')}</optgroup>`;
      return `<label>Dress</label><select data-k="dress">${h || opt('', 'No dresses yet')}</select>`;
    },
    person: p => {
      const groups = { Employee: 'Employees', Vendor: 'Vendors / suppliers' };
      const h = Object.keys(groups).map(k => { const ps = personList().filter(x => x.kind === k); return ps.length ? `<optgroup label="${groups[k]}">${ps.map(x => opt(x.name, x.name + (x.role ? ' · ' + x.role : '') + (x.active ? '' : ' (inactive)'), x.name === p.person)).join('')}</optgroup>` : ''; }).join('');
      return `<label>Person</label><select data-k="person">${h || opt('', 'No people yet')}</select>`;
    },
    client: p => `<label>Client</label><select data-k="client">${clientList().map(c => opt(c, c, c === p.client)).join('') || opt('', 'No clients yet')}</select>`,
    category: p => `<label>Category</label><select data-k="category">${categoryList().map(c => opt(c, c, c === p.category)).join('')}</select>`,
    etype: p => `<label>Type</label><select data-k="etype">${[['all', 'Income and expenses'], ['Expense', 'Expenses only'], ['Income', 'Income only']].map(x => opt(x[0], x[1], p.etype === x[0])).join('')}</select>`,
    q: p => `<label>Search</label><input data-k="q" value="${esc(p.q)}" placeholder="Description, person, category…">`,
    ovh: p => `<label class="chk" style="margin-top:12px"><input type="checkbox" data-k="ovh"${p.ovh ? ' checked' : ''}> Include overhead share</label>`
  };
  function renderParams() {
    const def = DEFS[RS.key];
    $('rparams').innerHTML = def.params.map(k => `<div class="pf">${PF[k](RS.p)}</div>`).join('');
  }
  function renderBody() {
    const def = DEFS[RS.key];
    let out;
    try { out = def.build(RS.p); } catch (e) { out = { subtitle: '', blocks: [empty('This report could not be built: ' + e.message)] }; }
    RS.out = out;
    $('viewTitle').textContent = def.title;
    $('rbody').innerHTML = headerHtml(def, out) + out.blocks.filter(Boolean).map(b => blockHtml(b, false)).join('');
  }
  function open(key, params, back) {
    if (!DEFS[key]) return;
    RS.key = key;
    RS.p = Object.assign(defaultsFor(key), params || {});
    RS.back = back || (S.tab !== 'view' ? S.tab : RS.back);
    hidePanel();
    renderParams(); renderBody();
    showTab('view'); window.scrollTo(0, 0);
  }
  let qTimer;
  $('rparams').addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k || k === 'q') return;
    RS.p[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'pmode') renderParams();
    hidePanel(); renderBody();
  });
  $('rparams').addEventListener('input', e => {
    if (e.target.dataset.k !== 'q') return;
    RS.p.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { hidePanel(); renderBody(); }, 250);
  });
  $('viewBack').onclick = () => showTab(RS.back || 'rep');

  // report library on the Reports tab
  function renderLibrary() {
    $('rlib').innerHTML = ORDER.map(k => `<button class="rlib-item" data-report="${k}"><span><b>${esc(DEFS[k].title)}</b><small>${esc(DEFS[k].desc)}</small></span><span class="chev" aria-hidden="true">›</span></button>`).join('');
  }
  $('rlib').addEventListener('click', e => { const b = e.target.closest('[data-report]'); if (b) open(b.dataset.report, {}, 'rep'); });
  $('dashToReport').onclick = () => {
    const pm = $('period').value;
    open('pnl', { pmode: pm, month: $('month').value || thisMonth(), year: $('year').value || thisYear(), scope: $('rfilter').value || '__all' }, 'rep');
  };
  renderLibrary();

  /* ================================================================ export */
  const A4W = 794, A4H = 1123;   // A4 at 96 dpi
  let htiP = null;
  function loadLib() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    return htiP || (htiP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'lib-html-to-image.js';
      s.onload = () => res(window.htmlToImage);
      s.onerror = () => { htiP = null; s.remove(); rej(new Error('The export tool couldn\'t load. Connect to the internet once, then try again.')); };
      document.head.appendChild(s);
    }));
  }
  function makeHost() {
    const host = document.createElement('div');
    host.className = 'rpt print rhost';
    document.body.appendChild(host);
    return host;
  }
  async function imagesReady(el) {
    await Promise.all([...el.querySelectorAll('img')].map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; })));
  }

  /** Lays the report out on A4 pages, splitting long tables (with their headers repeated). */
  function paginate(host, def, out) {
    const pages = [];
    let body;
    const newPage = () => {
      const pg = document.createElement('div');
      pg.className = 'rpage';
      pg.innerHTML = '<div class="rpage-body"></div><div class="rpage-foot"></div>';
      host.appendChild(pg); pages.push(pg); body = pg.firstChild;
    };
    const over = () => body.scrollHeight > body.clientHeight + 1;
    const toEl = html => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };
    const breakPage = () => {
      const last = body.lastElementChild;
      const keep = last && last.classList.contains('blk-h') && body.children.length > 1;
      if (keep) last.remove();
      newPage();
      if (keep) body.appendChild(last);
    };
    const place = el => { body.appendChild(el); if (over() && body.children.length > 1) { el.remove(); breakPage(); body.appendChild(el); } };
    newPage();
    place(toEl(headerHtml(def, out)));
    out.blocks.filter(Boolean).forEach(b => {
      if (b.t !== 'table') { const html = blockHtml(b, true); if (html) place(toEl(html)); return; }
      const mk = () => toEl(`<div class="blk blk-table"><table class="rt">${thead(b)}<tbody></tbody></table></div>`);
      let w = mk(); place(w);
      let tb = w.querySelector('tbody');
      b.rows.forEach(r => {
        const tr = toEl('<table><tbody>' + trHtml(b, r) + '</tbody></table>').querySelector('tr');
        tb.appendChild(tr);
        if (!over()) return;
        tr.remove();
        if (!tb.children.length) { w.remove(); breakPage(); body.appendChild(w); }
        else { breakPage(); w = mk(); body.appendChild(w); tb = w.querySelector('tbody'); }
        tb.appendChild(tr);
      });
      if (b.foot) {
        const tf = toEl('<table>' + tfoot(b) + '</table>').querySelector('tfoot');
        w.querySelector('table').appendChild(tf);
        if (over() && tb.children.length) {
          tf.remove(); const tr = tb.lastElementChild; tr.remove();
          if (!tb.children.length) w.remove();
          breakPage(); w = mk(); body.appendChild(w); tb = w.querySelector('tbody'); tb.appendChild(tr); w.querySelector('table').appendChild(tf);
        }
      }
    });
    const n = pages.length;
    pages.forEach((pg, i) => { pg.lastChild.innerHTML = `<span>Qanoot Jahangir · ${esc(def.title)}${out.subject ? ' — ' + esc(out.subject) : ''}</span><span>Page ${i + 1} of ${n}</span>`; });
    return pages;
  }

  const blobOf = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Couldn\'t create the image.')), type, q));
  const render = (lib, el, ratio) => lib.toCanvas(el, { pixelRatio: ratio || 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: false });

  /** Minimal PDF writer: one full-page JPEG per A4 page. */
  async function makePdf(jpegs, title) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const W = 595.28, Hh = 841.89, n = jpegs.length, total = 4 + n * 3;   // objects 0 … 3+3n
    const obj = (num, f) => { offs[num] = len; push(num + ' 0 obj\n'); f(); push('\nendobj\n'); };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + binary marker
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Count ' + n + ' /Kids [' + jpegs.map((_, i) => (4 + i * 3) + ' 0 R').join(' ') + '] >>'));
    const safe = String(title).replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1');
    obj(3, () => push('<< /Title (' + safe + ') /Producer (Qanoot Jahangir) >>'));
    jpegs.forEach((j, i) => {
      const pg = 4 + i * 3, ct = pg + 1, im = pg + 2;
      obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${Hh}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
      const cs = `q ${W} 0 0 ${Hh} 0 0 cm /Im0 Do Q`;
      obj(ct, () => { push(`<< /Length ${cs.length} >>\nstream\n`); push(cs); push('\nendstream'); });
      obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); push(j.bytes); push('\nendstream'); });
    });
    const xref = len;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  function fileBase() {
    const def = DEFS[RS.key], out = RS.out || {};
    return ('QJ ' + def.title + (out.subject ? ' - ' + out.subject : '') + ' - ' + today()).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim();
  }

  async function exportPdf() {
    const lib = await loadLib(), def = DEFS[RS.key];
    renderBody();
    const host = makeHost();
    try {
      const pages = paginate(host, def, RS.out);
      await imagesReady(host);
      const jpegs = [];
      for (let i = 0; i < pages.length; i++) {
        setPanel(`<div class="meta">Preparing PDF… page ${i + 1} of ${pages.length}</div>`);
        const c = await render(lib, pages[i], 2);
        const b = await blobOf(c, 'image/jpeg', 0.88);
        jpegs.push({ w: c.width, h: c.height, bytes: new Uint8Array(await b.arrayBuffer()) });
      }
      const blob = await makePdf(jpegs, 'Qanoot Jahangir - ' + def.title + (RS.out.subject ? ' - ' + RS.out.subject : ''));
      return [new File([blob], fileBase() + '.pdf', { type: 'application/pdf' })];
    } finally { host.remove(); }
  }

  async function exportImage() {
    const lib = await loadLib(), def = DEFS[RS.key];
    renderBody();
    const host = makeHost();
    try {
      const el = document.createElement('div');
      el.className = 'rimg';
      el.innerHTML = headerHtml(def, RS.out) + RS.out.blocks.filter(Boolean).map(b => blockHtml(b, true)).join('') +
        `<div class="rimg-foot">Qanoot Jahangir · ${esc(def.title)}</div>`;
      host.appendChild(el);
      await imagesReady(host);
      if (el.offsetHeight <= 7000) {
        setPanel('<div class="meta">Preparing image…</div>');
        const c = await render(lib, el, 2);
        return [new File([await blobOf(c, 'image/png')], fileBase() + '.png', { type: 'image/png' })];
      }
      // very long report: one image per page
      el.remove();
      const pages = paginate(host, def, RS.out);
      await imagesReady(host);
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        setPanel(`<div class="meta">Preparing images… ${i + 1} of ${pages.length}</div>`);
        const c = await render(lib, pages[i], 2);
        files.push(new File([await blobOf(c, 'image/png')], fileBase() + ' - page ' + (i + 1) + '.png', { type: 'image/png' }));
      }
      return files;
    } finally { host.remove(); }
  }

  /* ---------------- export panel: share or save ---------------- */
  function setPanel(html) { $('expPanel').innerHTML = html; $('expPanel').hidden = false; }
  function hidePanel() { $('expPanel').hidden = true; $('expPanel').innerHTML = ''; }
  const sizeTxt = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  let ready = null;
  async function runExport(kind) {
    const btns = [$('expPdf'), $('expImg')];
    btns.forEach(b => b.disabled = true);
    setPanel(`<div class="meta">Preparing ${kind === 'pdf' ? 'PDF' : 'image'}…</div>`);
    try {
      const files = await (kind === 'pdf' ? exportPdf() : exportImage());
      ready = files;
      const canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
      const size = files.reduce((s, f) => s + f.size, 0);
      setPanel(`<div class="h"><b>${kind === 'pdf' ? 'PDF' : files.length > 1 ? files.length + ' images' : 'Image'} ready</b><span class="meta">${sizeTxt(size)}</span></div>
        <div class="meta">${esc(files.length > 1 ? 'This report is long, so it has been split into one image per page.' : files[0].name)}</div>
        <div class="btns">${canShare ? '<button class="btn sm" id="expShare">Share…</button>' : ''}<button class="btn sm ${canShare ? 'ghost' : ''}" id="expSave">Save to phone</button><button class="btn sm ghost" id="expClose">Close</button></div>
        <div class="msg" id="expMsg"></div>`);
    } catch (e) {
      setPanel(`<div class="msg">${esc(e.message || String(e))}</div><div class="btns"><button class="btn sm ghost" id="expClose">Close</button></div>`);
    } finally { btns.forEach(b => b.disabled = false); }
  }
  function saveFiles(files) {
    files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    }, i * 400));
  }
  $('expPanel').addEventListener('click', async e => {
    const id = e.target.id;
    if (id === 'expClose') { hidePanel(); ready = null; }
    if (id === 'expSave' && ready) { saveFiles(ready); $('expMsg').className = 'msg ok'; $('expMsg').textContent = 'Saved to your Downloads.'; }
    if (id === 'expShare' && ready) {
      try { await navigator.share({ files: ready, title: ready[0].name }); }
      catch (err) { if (err && err.name !== 'AbortError') { $('expMsg').className = 'msg'; $('expMsg').textContent = 'Sharing didn\'t work on this phone — use Save to phone instead.'; } }
    }
  });
  $('expPdf').onclick = () => runExport('pdf');
  $('expImg').onclick = () => runExport('img');

  /* ---------------- public ---------------- */
  window.QJR = {
    open,
    refresh() { renderLibrary(); if (S.tab === 'view' && RS.key && !isTyping()) { const k = RS.key; RS.p = Object.assign(defaultsFor(k), RS.p); renderParams(); renderBody(); } },
    defs: DEFS, _makePdf: makePdf, _state: RS
  };
})();
