/* Qanoot Jahangir — colour themes. Loaded first so the right colours show instantly (no flash). */
(function () {
  var T = {
    // ---- light
    ivory:     { n: 'Atelier ivory',         dark: false, bg: '#f7f4ef', card: '#ffffff', ink: '#2b2622', tx: '#221e1a', mut: '#7a7168', soft: '#efe9e1', bd: '#e6e1d9', inc: '#1f7a4d', exp: '#b3392b', btn: '#2b2622', btx: '#ffffff', ti: '#2b2622' },
    blush:     { n: 'Blush and burgundy',    dark: false, bg: '#fbf4f3', card: '#ffffff', ink: '#7b2d3f', tx: '#2a1d20', mut: '#8a6f74', soft: '#f4e2e2', bd: '#eedada', inc: '#2e7d5b', exp: '#b0413e', btn: '#7b2d3f', btx: '#ffffff', ti: '#7b2d3f' },
    emerald:   { n: 'Emerald and champagne', dark: false, bg: '#f4f6f2', card: '#ffffff', ink: '#1f4d3f', tx: '#1b2420', mut: '#6b7a72', soft: '#e6ece5', bd: '#dfe6de', inc: '#1f7a4d', exp: '#b3392b', btn: '#1f4d3f', btx: '#f6efe0', ti: '#a8874d' },
    pearl:     { n: 'Midnight and pearl',    dark: false, bg: '#f5f6f8', card: '#ffffff', ink: '#1d2a44', tx: '#1a1f2b', mut: '#6a7385', soft: '#e7eaf0', bd: '#e1e5ec', inc: '#23784f', exp: '#b23a3a', btn: '#1d2a44', btx: '#ffffff', ti: '#1d2a44' },
    sand:      { n: 'Sand and terracotta',   dark: false, bg: '#f8f3ec', card: '#fffdf9', ink: '#a4532f', tx: '#2a211b', mut: '#86766a', soft: '#f1e6d8', bd: '#eadfd1', inc: '#2f7a50', exp: '#b13a2c', btn: '#a4532f', btx: '#ffffff', ti: '#a4532f' },
    // ---- dark
    noir:      { n: 'Noir and gold',         dark: true,  bg: '#141214', card: '#1f1c1f', ink: '#c9a45c', tx: '#f3ece0', mut: '#9c9286', soft: '#2c282c', bd: '#353035', inc: '#7cc79a', exp: '#e8877a', btn: '#c9a45c', btx: '#141214', ti: '#c9a45c' },
    bordeaux:  { n: 'Bordeaux night',        dark: true,  bg: '#1a1114', card: '#24181c', ink: '#e0a3b2', tx: '#f5e9ec', mut: '#a88f96', soft: '#33232a', bd: '#3b2a30', inc: '#80c9a0', exp: '#f08c86', btn: '#e0a3b2', btx: '#1a1114', ti: '#e0a3b2' },
    forest:    { n: 'Forest velvet',         dark: true,  bg: '#0f1714', card: '#17211d', ink: '#c8a96a', tx: '#ecf0ea', mut: '#8f9c95', soft: '#22302a', bd: '#2a3832', inc: '#86cfa2', exp: '#ec8a7d', btn: '#c8a96a', btx: '#0f1714', ti: '#c8a96a' },
    sapphire:  { n: 'Sapphire night',        dark: true,  bg: '#0e1420', card: '#161e2d', ink: '#9db8ea', tx: '#e8edf6', mut: '#8a95aa', soft: '#212b3d', bd: '#283347', inc: '#7fcaa0', exp: '#ee8a85', btn: '#9db8ea', btx: '#0e1420', ti: '#c9d6ee' },
    charcoal:  { n: 'Charcoal and pearl',    dark: true,  bg: '#161618', card: '#202023', ink: '#e6e1d8', tx: '#efece6', mut: '#9a978f', soft: '#2c2c30', bd: '#333337', inc: '#83c99f', exp: '#ea8a7e', btn: '#e6e1d8', btx: '#161618', ti: '#e6e1d8' }
  };
  var DEFAULTS = { mode: 'auto', light: 'ivory', dark: 'noir' };

  function pref(k) {
    try { var v = localStorage.getItem('qj_theme_' + k); return v ? JSON.parse(v) : DEFAULTS[k]; } catch (e) { return DEFAULTS[k]; }
  }
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function apply() {
    var mode = pref('mode');
    var dark = mode === 'dark' || (mode === 'auto' && mq && mq.matches);
    var id = dark ? pref('dark') : pref('light');
    var t = T[id] || T[dark ? DEFAULTS.dark : DEFAULTS.light];
    var s = document.documentElement.style;
    ['bg', 'card', 'ink', 'tx', 'mut', 'soft', 'bd', 'inc', 'exp', 'btn', 'btx', 'ti'].forEach(function (k) { s.setProperty('--' + k, t[k]); });
    s.colorScheme = t.dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-dark', t.dark ? '1' : '0');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t.bg);
  }

  window.QJ_THEMES = T;
  window.QJ_themePref = pref;
  window.QJ_setTheme = function (k, v) { try { localStorage.setItem('qj_theme_' + k, JSON.stringify(v)); } catch (e) {} apply(); };
  window.QJ_applyTheme = apply;
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  apply();
})();
