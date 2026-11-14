(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Basics
   * ------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const app = $('#app');
  const overlay = $('#overlay');
  const toastEl = $('#toast');
  const native = window.Native || null;

  const PROVIDERS = {
    syosetu: { label: '成为小说家吧', short: 'SYOSETU' },
    kakuyomu: { label: 'KAKUYOMU', short: 'KAKUYOMU' },
    hameln: { label: 'Hameln', short: 'HAMELN' },
    pixiv: { label: 'Pixiv', short: 'PIXIV' },
    novelup: { label: 'Novelup', short: 'NOVELUP' },
    alphapolis: { label: 'Alphapolis', short: 'ALPHAPOLIS' },
    local: { label: '本地导入', short: 'LOCAL' }
  };
  const PROVIDER_ORDER = ['syosetu', 'kakuyomu', 'novelup', 'hameln', 'pixiv', 'alphapolis'];

  const TAG_GROUPS = [
    { title: '题材 / 设定', tags: [
      { tag: '異世界転生', label: '异世界转生' }, { tag: '異世界', label: '异世界' },
      { tag: 'ファンタジー', label: '奇幻' }, { tag: '転生', label: '转生' },
      { tag: '魔法', label: '魔法' }, { tag: '冒険', label: '冒险' },
      { tag: 'チート', label: '龙傲天' }, { tag: '学園', label: '校园' },
      { tag: '日常', label: '日常' }, { tag: '恋愛', label: '恋爱' },
      { tag: 'ラブコメ', label: '恋爱喜剧' }, { tag: '青春', label: '青春' }
    ]},
    { title: '人物 / 关系', tags: [
      { tag: '男主人公', label: '男主视角' }, { tag: '女主人公', label: '女主视角' },
      { tag: 'ハーレム', label: '后宫' }, { tag: '百合', label: '百合' },
      { tag: '溺愛', label: '溺爱' }, { tag: 'ざまぁ', label: '爽文 / 复仇' },
      { tag: 'TS', label: 'TS' }
    ]},
    { title: '氛围 / 注意', tags: [
      { tag: '残酷描写', label: '残酷描写' }, { tag: 'R15', label: 'R15' }
    ]}
  ];
  const COMMON_TAGS = TAG_GROUPS[0].tags.slice(0, 10).concat(TAG_GROUPS[1].tags.slice(0, 4));
  const ALL_TAGS = TAG_GROUPS.reduce((a, g) => a.concat(g.tags), []);
  function tagLabel(tag) {
    const t = ALL_TAGS.find(x => x.tag === tag);
    return t ? t.label : tag;
  }

  const EMPTY_BOOK = { titleZh: '', titleJp: '轻小说', type: '', attentions: [], keywords: [], total: 0, downloadable: 0 };
  const DEFAULT_SETTINGS = {
    theme: 'auto',
    wifiOnly: true,
    reader: { mode: 'zh', engine: 'auto', fontSize: 18, lineHeight: 1.8, theme: 'paper', serif: false, animation: 'slide', brightness: -1, keepAwake: true }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function loadSettings() {
    const raw = loadJSON('nr.settings', {}) || {};
    return {
      theme: raw.theme || DEFAULT_SETTINGS.theme,
      wifiOnly: raw.wifiOnly !== false,
      autoSubscribe: raw.autoSubscribe !== false,
      autoCheckShelf: raw.autoCheckShelf !== false,
      autoDownloadNew: !!raw.autoDownloadNew,
      simpleMode: !!raw.simpleMode,
      reader: Object.assign({}, DEFAULT_SETTINGS.reader, raw.reader || {})
    };
  }
  function saveSettings() { saveJSON('nr.settings', settings); }

  let settings = loadSettings();
  let shelf = loadJSON('nr.shelf', []) || [];
  let categories = loadJSON('nr.categories', []) || [];
  let progress = loadJSON('nr.progress', {}) || {};
  let recent = loadJSON('nr.recent', []) || [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function relTime(sec) {
    if (!sec) return '';
    const ms = Number(sec) * 1000;
    const d = new Date(ms);
    const diff = Date.now() - ms;
    if (diff < 0) return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 86400 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function hashStr(s) {
    let h = 0;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function initialOf(title) {
    const t = String(title || '?').trim().replace(/^[「『【\s]+/, '');
    if (!t) return 'N';
    if (/^[A-Za-z0-9]/.test(t)) {
      const parts = t.split(/\s+/);
      return (parts[0].slice(0, 1) + (parts[1] ? parts[1].slice(0, 1) : '')).toUpperCase();
    }
    return Array.from(t)[0] || 'N';
  }
  const PALETTES = [
    ['#173f2c', '#2d8a5e'], ['#203a4a', '#3d7f93'], ['#3b2a1e', '#a46d3d'],
    ['#2d2140', '#745a9c'], ['#3b1f26', '#9b4d5c'], ['#1f3a36', '#4d8f86'],
    ['#33301b', '#8e8540'], ['#2a2a33', '#666a86']
  ];
  function coverHtml(title, opts) {
    opts = opts || {};
    const p = PALETTES[hashStr(title) % PALETTES.length];
    return '<div class="cover ' + (opts.lg ? 'lg' : '') + '" style="--ca:' + p[0] + ';--cb:' + p[1] + '">'
      + '<span class="cat">' + esc(opts.cat || 'NOVEL') + '</span>'
      + '<span class="initial">' + esc(initialOf(title)) + '</span></div>';
  }

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    home: '<path d="M3 10.6 12 3l9 7.6"/><path d="M5 9.8V21h14V9.8"/><path d="M9.5 21v-6h5v6"/>',
    shelf: '<path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.4L5 21V4.5A1.5 1.5 0 0 1 6.5 3Z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    dlcircle: '<circle cx="12" cy="12" r="9"/><path d="M12 7v7"/><path d="m8.5 11 3.5 3.5 3.5-3.5"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.2" fill="var(--surface)"/><circle cx="15" cy="17" r="2.2" fill="var(--surface)"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.4L5 21V4.5A1.5 1.5 0 0 1 6.5 3Z"/>',
    bookmarkFill: '<path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.4L5 21V4.5A1.5 1.5 0 0 1 6.5 3Z" fill="currentColor"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    check: '<path d="m5 12 5 5L20 6"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    wifi: '<path d="M3 9a15 15 0 0 1 18 0"/><path d="M6.5 12.5a10 10 0 0 1 11 0"/><path d="M10 16a5 5 0 0 1 4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.1M3.5 12h.1M3.5 18h.1"/>',
    type: '<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    heart: '<path d="M20.8 8.6a5.1 5.1 0 0 0-8.8-2.9 5.1 5.1 0 0 0-8.8 2.9c0 5.4 8.8 10.4 8.8 10.4s8.8-5 8.8-10.4Z"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9Z"/>',
    alert: '<path d="M12 4 2.8 20h18.4Z"/><path d="M12 9v5M12 17v.1"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="M14 6l3 3"/>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9Z" fill="currentColor" stroke="none"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v18H6.5A2.5 2.5 0 0 0 4 23V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v18h4.5A2.5 2.5 0 0 1 20 23V5.5Z"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    forum: '<path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1.2-4.2A8 8 0 1 1 21 12Z"/><path d="M8 11h8M8 14h5"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ------------------------------------------------------------------ *
   *  Native bridge
   * ------------------------------------------------------------------ */
  class ApiError extends Error {
    constructor(status, message) { super(message || '请求失败'); this.status = status; }
  }
  const pendingCalls = new Map();
  let callSeq = 0;

  function invoke(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      if (!native || typeof native[method] !== 'function') {
        reject(new ApiError(0, '请在 Novelia 阅读 App 内使用'));
        return;
      }
      const id = 'c' + (++callSeq);
      const timer = setTimeout(() => {
        pendingCalls.delete(id);
        reject(new ApiError(0, '请求超时，请检查网络或代理'));
      }, 46000);
      pendingCalls.set(id, { resolve, reject, timer });
      try {
        native[method].apply(native, [id].concat(args));
      } catch (e) {
        clearTimeout(timer);
        pendingCalls.delete(id);
        reject(new ApiError(0, e.message || '调用失败'));
      }
    });
  }

  function invokeLong(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      if (!native || typeof native[method] !== 'function') {
        reject(new ApiError(0, '请在 Novelia 阅读 App 内使用'));
        return;
      }
      const id = 'l' + (++callSeq);
      const timer = setTimeout(() => {
        pendingCalls.delete(id);
        reject(new ApiError(0, '操作超时'));
      }, 300000);
      pendingCalls.set(id, { resolve, reject, timer });
      try {
        native[method].apply(native, [id].concat(args));
      } catch (e) {
        clearTimeout(timer);
        pendingCalls.delete(id);
        reject(new ApiError(0, e.message || '调用失败'));
      }
    });
  }

  window.NativeBridge = {
    resolve(id, status, body) {
      const p = pendingCalls.get(id);
      if (!p) return;
      pendingCalls.delete(id);
      clearTimeout(p.timer);
      if (status === 200) p.resolve(body || '');
      else p.reject(new ApiError(status, cleanError(body)));
    }
  };

  function cleanError(body) {
    let s = String(body == null ? '' : body).trim();
    if (!s) return '请求失败';
    try {
      const j = JSON.parse(s);
      s = j.message || j.error || s;
    } catch (e) {}
    s = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  }

  async function api(path) {
    return invoke('api', path);
  }
  async function apiJson(path) {
    const text = await api(path);
    try { return JSON.parse(text); }
    catch (e) { throw new ApiError(0, '返回数据格式异常'); }
  }
  async function forumApi(path) {
    const text = await invoke('forum', path);
    try { return JSON.parse(text); }
    catch (e) { throw new ApiError(0, '评论数据格式异常'); }
  }
  function sync(fn, fallback) {
    try { const v = fn(); return v == null || v === '' ? fallback : v; }
    catch (e) { return fallback; }
  }
  function nativeKey(provider, novel) {
    if (native && typeof native.key === 'function') {
      const k = sync(() => native.key(provider, novel), '');
      if (k) return k;
    }
    return (provider + '__' + novel).replace(/[^A-Za-z0-9._-]/g, '_');
  }
  function encodePath(s) { return encodeURIComponent(String(s == null ? '' : s)); }

  /* ------------------------------------------------------------------ *
   *  App state + routing
   * ------------------------------------------------------------------ */
  const state = {
    route: { name: 'home', seg: [], query: new URLSearchParams() },
    home: { provider: 'syosetu', items: [], page: 0, pageCount: 1, loading: false, error: '', done: false, started: false },
    wenku: { items: [], page: 0, pageCount: 1, level: 0, query: '', loading: false, error: '', started: false },
    wenkuBook: null, wenkuBookId: '', wenkuLoading: false, wenkuError: '',
    search: { q: '', provider: 'all', tags: [], sort: 0, type: 0, translate: 0, items: [], page: 0, pageCount: 1, loading: false, error: '', done: false, ran: false },
    webUrl: '',
    auth: { loggedIn: false, user: '', canR18: false, ageDays: 0 },
    r18: !!loadJSON('nr.r18', false),
    pendingR18: false,
    loggingIn: false,
    book: null,
    bookRef: null,
    bookLoading: false,
    bookError: '',
    tocLimit: 120,
    tocQuery: '',
    downloads: [],
    commentPreview: { key: '', total: 0, items: [], loading: false, error: '', loaded: false },
    comments: { key: '', items: [], page: 0, total: 0, loading: false, error: '', done: false },
    commentRoot: 0,
    commentReplyName: '',
    privacy: { hasPin: false, hideRecents: true },
    locked: false,
    hiddenAt: 0,
    storage: { bytes: 0, free: 0 },
    proxy: { mode: 'none', host: '', port: '' },
    relay: 'auto',
    proxyTesting: false,
    proxyResult: null,
    dlChoice: 0,
    dlChoiceSet: false,
    usage: { count: null, loading: false, error: '' },
    online: { count: null, loading: false, error: '' },
    appUpdate: { checking: false },
    pendingUpdate: null,
    shelfFilter: { q: '', status: 'all', cat: 'all', tag: 'all', sort: 'recent' },
    shelfManage: false,
    shelfSelected: new Set(),
    dlManage: false,
    dlSelected: new Set(),
    subChecking: false,
    statsYear: new Date().getFullYear(),
    sheet: null,
    confirmEl: null,
    booted: false
  };
  let dlTimer = null;
  let searchSeq = 0;
  let homeSeq = 0;

  function parseRoute() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    const qIndex = raw.indexOf('?');
    const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
    const seg = pathPart.split('/').filter(Boolean);
    return { name: seg[0] || 'home', seg: seg, query: new URLSearchParams(queryPart) };
  }
  function navigate(hash) {
    if (location.hash === hash) { onRoute(); return; }
    location.hash = hash;
  }

  function onRoute() {
    stopDownloadPoll();
    const r = parseRoute();
    const changed = r.name !== state.route.name || r.seg.join('/') !== state.route.seg.join('/');
    state.route = r;
    if (changed) closeSheet();
    window.scrollTo(0, 0);
    if (r.name === 'home') {
      if (!state.home.started && !state.home.items.length) {
        try {
          const ck = 'nr.home.' + (state.r18 ? 2 : 1) + '.' + state.home.provider;
          const c = loadJSON(ck, null);
          if (c && Array.isArray(c.items) && c.items.length) {
            state.home.items = c.items;
            state.home.pageCount = c.pageCount || 1;
            state.home.started = true;
          }
        } catch (e) {}
      }
      if (!state.home.started) loadHome(0);
    } else if (r.name === 'search') {
      initSearch(r);
    } else if (r.name === 'book') {
      loadBook(r.seg[1], r.seg[2]);
    } else if (r.name === 'downloads') {
      refreshDownloads();
      startDownloadPoll();
    } else if (r.name === 'settings') {
      loadAuth();
      loadPrivacy();
      loadProxy();
      refreshStorage();
    } else if (r.name === 'wenku') {
      if (r.seg[1]) loadWenkuBook(r.seg[1]);
      else if (!state.wenku.started) loadWenku(0);
    }
    render();
    if (!state.booted) {
      state.booted = true;
      setTimeout(() => {
        const b = $('#boot');
        if (b) { b.classList.add('out'); setTimeout(() => b.remove(), 420); }
      }, 260);
    }
  }

  function render() {
    applyTheme();
    if (state.locked) {
      app.innerHTML = lockView();
      return;
    }
    const r = state.route;
    let view;
    if (r.name === 'home') view = homeView();
    else if (r.name === 'search') view = searchView();
    else if (r.name === 'book') view = bookView();
    else if (r.name === 'shelf') view = shelfView();
    else if (r.name === 'downloads') view = downloadsView();
    else if (r.name === 'settings') view = settingsView();
    else if (r.name === 'stats') view = statsView();
    else if (r.name === 'wenku') view = r.seg[1] ? wenkuBookView() : wenkuView();
    else view = homeView();
    const renderKey = r.name + '|' + JSON.stringify(r.seg || []);
    if (state.lastRenderKey !== renderKey) {
      state.lastRenderKey = renderKey;
      app.classList.remove('route-anim');
      void app.offsetWidth;
      app.classList.add('route-anim');
      clearTimeout(state.routeAnimTimer);
      state.routeAnimTimer = setTimeout(() => app.classList.remove('route-anim'), 520);
      try { window.scrollTo(0, 0); } catch (e) {}
    }
    app.innerHTML = view.html;
    if (view.tab) app.insertAdjacentHTML('beforeend', tabbar(view.tab));
    else app.insertAdjacentHTML('beforeend', '');
  }

  function applyTheme() {
    const dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.classList.toggle('simple-mode', !!settings.simpleMode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f1511' : '#f5f7f4');
    if (native && typeof native.setDark === 'function') {
      try { native.setDark(dark); } catch (e) {}
    }
  }

  function lockView() {
    return '<div class="lock-screen"><div class="lock-logo">N</div>'
      + '<h1>已锁定</h1><p>输入隐私 PIN 解锁</p>'
      + '<div class="lock-box"><input id="lock-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="4-8 位数字">'
      + '<button data-action="unlock-pin">解锁</button></div>'
      + '<div class="lock-error" id="lock-error"></div>'
      + '<div class="lock-note">忘记 PIN 只能清除应用数据后重新设置</div></div>';
  }
  function loadPrivacy() {
    if (native && typeof native.privacyInfo === 'function') {
      const raw = sync(() => native.privacyInfo(), '{}');
      try { state.privacy = JSON.parse(raw || '{}'); } catch (e) {}
    }
    if (!state.privacy || typeof state.privacy !== 'object') state.privacy = { hasPin: false, hideRecents: true };
    return state.privacy;
  }
  function showPrivacySheet() {
    loadPrivacy();
    const p = state.privacy;
    const recents = '<div class="setting-row" style="padding:12px 0 6px;border:0"><div class="st"><b>隐藏最近任务预览</b><span>同时禁止系统截图，避免锁屏前内容出现在多任务里</span></div><button class="switch ' + (p.hideRecents !== false ? 'on' : '') + '" data-action="privacy-recents"></button></div>';
    if (p.hasPin) {
      showSheet('<h2>隐私锁</h2><p class="sheet-sub">已开启。应用冷启动会要求输入 PIN。</p>' + recents
        + '<div class="field" style="margin-top:8px"><label>输入当前 PIN 以关闭</label><input id="privacy-old" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>'
        + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
        + '<button class="btn btn-danger" data-action="privacy-disable">关闭隐私锁</button></div>');
      return;
    }
    showSheet('<h2>设置隐私锁</h2><p class="sheet-sub">设置 4-8 位数字 PIN。应用冷启动时需要输入；忘记只能清除应用数据。</p>'
      + '<div class="field"><label>新 PIN</label><input id="privacy-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>'
      + '<div class="field" style="margin-top:8px"><label>再输一次</label><input id="privacy-confirm" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>'
      + recents
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
      + '<button class="btn btn-primary" data-action="privacy-enable">开启隐私锁</button></div>');
  }
  function lockNow() {
    loadPrivacy();
    if (!state.privacy.hasPin) return;
    state.locked = true;
    render();
  }

  function topbar(opts) {
    opts = opts || {};
    const back = opts.back ? '<button class="icon-btn back-btn" data-action="back" aria-label="返回">' + icon('back') + '</button>' : '';
    const logo = opts.logo ? '<div class="logo">N</div>' : '';
    const title = opts.title ? '<div class="page-title">' + esc(opts.title) + (opts.sub ? '<small>' + esc(opts.sub) + '</small>' : '') + '</div>' : '';
    const brand = opts.brand ? '<div class="brand"><b>Novelia</b><span>轻小说机翻阅读器</span></div>' : '';
    const brandHit = (logo || brand) ? '<a class="brand-home" href="home.html" aria-label="首页">' + logo + brand + '</a>' : '';
    return '<header class="topbar' + (opts.plain ? ' plain' : '') + '">' + back + brandHit + title
      + '<div class="top-actions">' + (opts.actions || '') + '</div></header>';
  }
  function tabbar(active) {
    const running = state.downloads.some(d => d.status === 'downloading');
    const items = [
      ['home', '首页', 'home'],
      ['wenku', '文库', 'book'],
      ['shelf', '书架', 'shelf'],
      ['downloads', '下载', 'dlcircle'],
      ['settings', '我的', 'settings']
    ];
    return '<nav class="tabbar"><div class="tabbar-inner">' + items.map(it => {
      const badge = it[0] === 'downloads' && running ? '<span class="badge"></span>' : '';
      const href = it[0] === 'home' ? 'home.html' : ('#/' + it[0]);
      return '<a class="tab ' + (active === it[0] ? 'active' : '') + '" href="' + href + '">'
        + icon(it[2]) + '<span>' + it[1] + '</span>' + badge + '</a>';
    }).join('') + '</div></nav>';
  }
  function shell(content, tab) {
    return '<div class="page' + (tab ? '' : ' no-nav') + '">' + content + '</div>';
  }

  /* ------------------------------------------------------------------ *
   *  Home
   * ------------------------------------------------------------------ */
  function pageNavHtml(kind, page, pageCount) {
    if (!pageCount || pageCount <= 1) return '';
    return '<div class="page-nav">'
      + '<button data-action="' + kind + '-page" data-page="' + (page - 1) + '" ' + (page <= 0 ? 'disabled' : '') + '>上一页</button>'
      + '<span>第 ' + (page + 1) + ' / ' + pageCount + ' 页</span>'
      + '<button data-action="' + kind + '-page" data-page="' + (page + 1) + '" ' + (page >= pageCount - 1 ? 'disabled' : '') + '>下一页</button>'
      + '<input id="' + kind + '-page-input" inputmode="numeric" placeholder="页码">'
      + '<button data-action="' + kind + '-go">跳转</button></div>';
  }
  function homeView() {
    const h = state.home;
    const cont = latestProgress();
    let listHtml = '';
    if (!h.started || (h.loading && h.items.length === 0)) {
      listHtml = skeletonRows(5) + '<div class="load-more"><button class="btn btn-sm btn-ghost" data-action="retry-home">重新加载</button></div>';
    } else if (h.error && h.items.length === 0) {
      listHtml = errorCard(h.error, 'retry-home');
    } else if (h.items.length === 0) {
      listHtml = emptyState('book', '这里还没有内容', '换一个书源，或稍后再试。', '刷新', 'retry-home');
    } else {
      listHtml = '<div class="book-list">' + h.items.map(bookRow).join('') + '</div>';
      if (h.loading) listHtml += '<div class="load-more"><span class="btn btn-sm btn-ghost"><span class="spin"></span> 加载中</span></div>';
      else listHtml += pageNavHtml('home', h.page, h.pageCount);
    }

    const hero = '<section class="hero"><div class="kicker">AUTONOVEL READER</div>'
      + '<h1>把机翻轻小说<br>装进口袋里。</h1>'
      + '<p>发现、阅读、整本缓存。支持中文 / 日文 / 双语对照与离线书架。</p>'
      + '<div class="hero-actions"><button class="btn btn-light" data-action="scroll-home">开始探索</button>'
      + '<button class="btn btn-ghost-light" data-action="go" data-href="#/shelf">我的书架</button></div>'
      + '<div class="stat-row"><div class="stat"><b>6</b><span>网络书源</span></div>'
      + '<div class="stat"><b>∞</b><span>离线缓存</span></div><div class="stat"><b>3</b><span>阅读模式</span></div></div></section>';

    const searchPill = '<button class="search-pill" data-action="go-search">' + icon('search')
      + '<span>搜索作品、作者或关键词</span><span class="hint">搜索</span></button>';

    const forumEntry = '<button class="forum-entry" data-action="open-forum">'
      + '<div class="fe-icon">' + icon('forum') + '</div>'
      + '<div class="fe-copy"><b>小说讨论区</b><span>登录官方论坛，发主题、回复和讨论</span></div>'
      + '<div class="fe-arrow">' + icon('right') + '</div></button>';

    const contHtml = cont ? '<a class="card" style="display:flex;align-items:center;gap:12px;margin-top:12px" href="javascript:void(0)" data-action="continue-reading">'
      + '<div class="si" style="width:38px;height:38px;border-radius:12px;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center;flex:none">' + icon('play') + '</div>'
      + '<div style="flex:1;min-width:0"><div style="font-size:9.5px;letter-spacing:1.2px;color:var(--faint)">继续阅读</div>'
      + '<div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(cont.novelTitle || '上次阅读') + '</div>'
      + '<div style="font-size:10px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(cont.title || '') + '</div></div>'
      + '<div style="color:var(--faint)">' + icon('right') + '</div></a>' : '';

    const chips = '<div class="chips">' + PROVIDER_ORDER.map(p =>
      '<button class="chip ' + (h.provider === p ? 'active' : '') + '" data-action="provider" data-provider="' + p + '">' + PROVIDERS[p].label + '</button>'
    ).join('') + r18Chip() + '</div>';

    const content = topbar({
      logo: true, brand: true,
      actions: '<button class="icon-btn" data-action="open-forum" aria-label="论坛">' + icon('forum') + '</button>'
        + '<button class="icon-btn" data-action="refresh-home" aria-label="刷新">' + icon('refresh') + '</button>'
        + '<button class="icon-btn" data-action="go-search" aria-label="搜索">' + icon('search') + '</button>'
    }) + hero + searchPill + forumEntry + contHtml
      + '<div class="section-head"><h2>最近更新 <span class="sub">' + PROVIDERS[h.provider].label + (state.r18 ? ' · R18' : '') + '</span></h2>'
      + '<button class="link" data-action="refresh-home">换一批 ' + icon('refresh') + '</button></div>'
      + chips + '<div id="home-list">' + listHtml + '</div>';

    return { html: shell(content, 'home'), tab: 'home' };
  }

  async function loadHome(page) {
    const h = state.home;
    const target = typeof page === 'number' ? Math.max(0, page) : 0;
    const seq = ++homeSeq;
    h.page = target;
    h.loadingAt = Date.now();
    if (target !== 0 || !h.items.length) h.items = [];
    h.loading = true;
    h.started = true;
    h.error = '';
    if (state.route.name === 'home') render();
    try {
      const base = 'novel?page=' + target + '&pageSize=15&level=' + (state.r18 ? 2 : 1)
        + '&provider=' + encodePath(h.provider) + '&query=&sort=0&type=0&translate=0';
      const req = apiJson(base);
      const data = await Promise.race([
        req,
        new Promise((_, reject) => setTimeout(() => reject(new Error('首页加载超时，请点“重新加载”')), 20000))
      ]);
      if (seq !== homeSeq) return;
      h.items = Array.isArray(data.items) ? data.items : [];
      h.pageCount = Math.max(1, Number(data.pageNumber) || 1);
      h.page = target;
      h.error = '';
      if (target === 0) {
        try { saveJSON('nr.home.' + (state.r18 ? 2 : 1) + '.' + h.provider, { items: h.items, pageCount: h.pageCount, at: Date.now() }); } catch (e) {}
      }
    } catch (e) {
      if (seq !== homeSeq) return;
      h.error = e.message || '加载失败';
    } finally {
      if (seq === homeSeq) h.loading = false;
      if (state.route.name === 'home') render();
    }
  }

  function bookRow(item) {
    const p = item.providerId || '';
    const n = item.novelId || '';
    const title = item.titleZh || item.titleJp || '';
    const hasZh = !!(item.titleZh && item.titleJp);
    const tags = [];
    if (item.type) tags.push('<span class="tag">' + esc(item.type) + '</span>');
    (item.attentions || []).slice(0, 2).forEach(a => tags.push('<span class="tag red">' + esc(a) + '</span>'));
    if (item.sakura > 0) tags.push('<span class="tag green">Sakura ' + fmtNum(item.sakura) + '</span>');
    else if (item.gpt > 0) tags.push('<span class="tag green">GPT ' + fmtNum(item.gpt) + '</span>');
    return '<a class="book-row" href="#/book/' + encodePath(p) + '/' + encodePath(n) + '">'
      + coverHtml(title, { cat: (PROVIDERS[p] || {}).short || p })
      + '<div class="book-main"><h3>' + esc(title) + '</h3>'
      + (hasZh ? '<p class="jp">' + esc(item.titleJp) + '</p>' : '')
      + '<div class="book-meta">' + tags.join('')
      + '<span class="dim">' + fmtNum(item.total) + ' 章</span>'
      + (item.updateAt ? '<span class="dim">· ' + relTime(item.updateAt) + '</span>' : '')
      + '</div></div><div class="book-right">' + icon('right') + '</div></a>';
  }
  function skeletonRows(n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += '<div class="sk-row"><div class="skeleton"></div><div class="sk-lines"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>';
    }
    return s;
  }
  function errorCard(msg, action) {
    return '<div class="error-card"><b>加载失败</b><p>' + esc(msg) + '</p>'
      + '<button class="btn btn-sm btn-danger" data-action="' + action + '">重试</button></div>';
  }
  function emptyState(iconName, title, desc, btn, action) {
    return '<div class="empty"><div class="e-icon">' + icon(iconName) + '</div><h3>' + esc(title) + '</h3><p>' + esc(desc) + '</p>'
      + (btn ? '<button class="btn btn-primary" data-action="' + action + '">' + esc(btn) + '</button>' : '') + '</div>';
  }
  function latestProgress() {
    let best = null;
    Object.keys(progress).forEach(k => {
      const v = progress[k];
      if (!v || !v.chapterId) return;
      if (!best || (v.updatedAt || 0) > (best.updatedAt || 0)) best = Object.assign({ key: k }, v);
    });
    return best;
  }

  /* ------------------------------------------------------------------ *
   *  Wenku (published volumes)
   * ------------------------------------------------------------------ */
  const WENKU_LEVELS = [[0, '全部'], [1, '轻小说'], [2, '轻文学'], [3, '文学'], [4, '非小说'], [5, 'R18 男性向'], [6, 'R18 女性向']];
  function cleanVolumeTitle(id) {
    return String(id || '').replace(/\.epub$/i, '').replace(/\s*\([^)]*文庫\)\s*$/i, '').trim();
  }
  function wenkuCoverHtml(item) {
    const tag = '<span>' + esc((item.titleZh || item.title || '?').slice(0, 1)) + '</span>';
    return '<div class="wenku-cover-wrap"><img class="wenku-cover" src="' + esc(item.cover || '') + '" loading="lazy" alt="" onerror="this.remove()">'
      + '<div class="wenku-cover-fallback">' + tag + '</div></div>';
  }
  async function loadWenku(page) {
    const w = state.wenku;
    if (w.loading) return;
    w.page = typeof page === 'number' ? Math.max(0, page) : 0;
    w.items = [];
    w.loading = true;
    w.started = true;
    w.error = '';
    if (state.route.name === 'wenku' && !state.route.seg[1]) render();
    try {
      const data = await apiJson('wenku?page=' + w.page + '&pageSize=20&level=' + (w.level || 0) + '&query=' + encodePath(w.query || ''));
      w.items = Array.isArray(data.items) ? data.items : [];
      w.pageCount = Math.max(1, Number(data.pageNumber) || 1);
      w.page = page;
      w.error = '';
    } catch (e) {
      w.error = e.message || '文库加载失败';
    }
    w.loading = false;
    if (state.route.name === 'wenku' && !state.route.seg[1]) render();
  }
  function wenkuCard(item) {
    return '<a class="wenku-card" href="#/wenku/' + encodePath(item.id) + '">' + wenkuCoverHtml(item)
      + '<div class="wc-body"><h3>' + esc(item.titleZh || item.title || '') + '</h3><p>' + esc(item.title || '') + '</p></div></a>';
  }
  function wenkuView() {
    const w = state.wenku;
    if (!w.started) setTimeout(() => loadWenku(0), 0);
    const levels = '<div class="chips">' + WENKU_LEVELS.map(x =>
      '<button class="chip ' + (w.level === x[0] ? 'active' : '') + '" data-action="wenku-level" data-level="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    let body = '';
    if (w.loading && w.items.length === 0) body = skeletonRows(4);
    else if (w.error && w.items.length === 0) body = errorCard(w.error, 'retry-wenku');
    else if (!w.items.length) body = emptyState('book', '没有找到文库书籍', '换个关键词或分级试试。', '刷新', 'retry-wenku');
    else body = '<div class="wenku-grid">' + w.items.map(wenkuCard).join('') + '</div>' + pageNavHtml('wenku', w.page, w.pageCount);
    const content = topbar({ logo: true, brand: true, actions: '<a class="icon-btn" href="home.html" aria-label="首页">' + icon('home') + '</a><button class="icon-btn" data-action="go-search">' + icon('search') + '</button>' })
      + '<div class="section-head"><h2>文库 <span class="sub">' + (w.query ? '搜索结果' : '出版轻小说') + '</span></h2>'
      + '<button class="link" data-action="retry-wenku">' + icon('refresh') + ' 刷新</button></div>'
      + '<div class="search-box" style="margin:0 0 4px">' + icon('search')
      + '<input id="wenku-search" placeholder="文库书名 / 作者" value="' + esc(w.query || '') + '">'
      + '<button class="go" data-action="wenku-search">搜索</button></div>'
      + levels + body;
    return { html: shell(content, 'wenku'), tab: 'wenku' };
  }
  async function loadWenkuBook(id) {
    if (!id) { navigate('#/wenku'); return; }
    if (state.wenkuBook && state.wenkuBookId === id) {
      if (state.route.name === 'wenku') render();
      return;
    }
    state.wenkuBook = null;
    state.wenkuBookId = id;
    state.wenkuLoading = true;
    state.wenkuError = '';
    render();
    try {
      const data = await apiJson('wenku/' + encodePath(id));
      if (state.wenkuBookId !== id) return;
      state.wenkuBook = data;
      state.wenkuLoading = false;
      if (state.route.name === 'wenku') render();
    } catch (e) {
      if (state.wenkuBookId !== id) return;
      state.wenkuLoading = false;
      state.wenkuError = e.message || '文库详情加载失败';
      if (state.route.name === 'wenku') render();
    }
  }
  function wenkuBookView() {
    const back = topbar({ back: true, title: '文库详情', sub: '出版轻小说', actions: '' });
    if (state.wenkuLoading) return { html: shell(back + skeletonRows(5), null), tab: null };
    if (state.wenkuError || !state.wenkuBook) return { html: shell(back + errorCard(state.wenkuError || '文库书籍不存在', 'retry-wenku-book'), null), tab: null };
    const b = state.wenkuBook;
    const cover = b.cover ? '<div class="wc-cover"><img class="wenku-cover" src="' + esc(b.cover) + '" alt="" onerror="this.remove()"></div>' : '<div class="wc-cover">' + wenkuCoverHtml(b) + '</div>';
    const title = b.titleZh || b.title || '';
    const badges = [];
    if (b.level) badges.push('<span class="tag green">' + esc(b.level) + '</span>');
    (b.keywords || []).slice(0, 6).forEach(k => badges.push('<button class="tag" data-action="tag-jump" data-tag="' + esc(k) + '">' + esc(k) + '</button>'));
    const hero = '<section class="wenku-hero">' + cover + '<div class="wc-main"><h1>' + esc(title) + '</h1>'
      + (b.title && b.titleZh ? '<div class="wc-sub">' + esc(b.title) + '</div>' : '')
      + '<div class="wc-sub">' + esc((b.authors || []).join(' / ')) + (b.artists && b.artists.length ? ' · 插画 ' + esc(b.artists.join(' / ')) : '') + '</div>'
      + '<div class="badges">' + badges.join('') + '</div></div></section>';
    const intro = '<div class="card"><div class="card-title"><b>简介</b><span>' + esc(b.publisher || '') + '</span></div>'
      + '<div class="intro" style="-webkit-line-clamp:8">' + esc(b.introduction || '暂无简介') + '</div></div>';
    const volumes = Array.isArray(b.volumeJp) ? b.volumeJp : [];
    let volHtml = '';
    if (!volumes.length) {
      volHtml = '<div class="comment-empty">这本书还没有可读的分卷。</div>';
    } else {
      volHtml = volumes.map((v, i) => {
        const vid = v.volumeId || '';
        const total = Number(v.total) || 0;
        const sakura = Number(v.sakura) || 0;
        const gpt = Number(v.gpt) || 0;
        const youdao = Number(v.youdao) || 0;
        const tr = sakura > 0 ? 'sakura' : (gpt > 0 ? 'gpt' : (youdao > 0 ? 'youdao' : 'sakura'));
        const countText = total + ' 章' + (sakura ? ' · Sakura ' + sakura : (gpt ? ' · GPT ' + gpt : (youdao ? ' · 有道 ' + youdao : '')));
        return '<div class="volume-row"><span class="vi">' + (i + 1) + '</span><div class="vt"><b>' + esc(cleanVolumeTitle(vid)) + '</b><span>' + countText + '</span></div>'
          + '<button class="vbtn" data-action="wenku-read" data-id="' + esc(state.wenkuBookId) + '" data-vid="' + esc(vid) + '" data-translator="' + tr + '" data-title="' + esc(cleanVolumeTitle(vid)) + '" ' + (total ? '' : 'disabled') + '>'
          + (total ? '阅读' : '暂无') + '</button></div>';
      }).join('');
    }
    const volCard = '<div class="card"><div class="card-title"><b>分卷</b><span>' + volumes.length + ' 卷 · EPUB 离线解析</span></div>' + volHtml + '</div>';
    const web = '<button class="btn btn-ghost btn-block" data-action="wenku-web" data-id="' + esc(state.wenkuBookId) + '" style="margin-bottom:10px">在网页版查看</button>';
    return { html: shell(back + '<div class="fade-in">' + hero + intro + volCard + web + '</div>', null), tab: null };
  }
  async function readWenkuVolume(id, vid, translator, title) {
    if (!id || !vid) return;
    showSheet('<h2>准备文库</h2><p class="sheet-sub">正在下载 EPUB 并解析章节，首次会慢一点。</p><div class="comment-loading"><span class="spin"></span> 下载与解析中…</div>');
    try {
      const raw = await invoke('wenkuPrepare', id, vid, translator || 'sakura');
      let meta = {};
      try { meta = JSON.parse(raw); } catch (e) {}
      const key = meta._key || '';
      if (!key) throw new Error('没有生成缓存');
      closeSheet();
      openReader('wenku', id, '0', 0, title || meta.titleZh || '', key);
    } catch (e) {
      closeSheet();
      toast('文库准备失败：' + (e.message || '未知错误'));
    }
  }

  /* ------------------------------------------------------------------ *
   *  Search
   * ------------------------------------------------------------------ */
  function initSearch(route) {
    const q = route.query.get('q') || '';
    const p = route.query.get('p') || 'all';
    const tags = (route.query.get('t') || '').split(',').filter(Boolean);
    const sort = parseInt(route.query.get('s') || '0', 10) || 0;
    const type = parseInt(route.query.get('ty') || '0', 10) || 0;
    const translate = parseInt(route.query.get('tr') || '0', 10) || 0;
    const pg = parseInt(route.query.get('pg') || '0', 10) || 0;
    const changed = q !== state.search.q || p !== state.search.provider || tags.join(',') !== state.search.tags.join(',')
      || sort !== state.search.sort || type !== state.search.type || translate !== state.search.translate || pg !== state.search.page;
    if (changed) {
      state.search.q = q;
      state.search.provider = p;
      state.search.tags = tags;
      state.search.sort = sort;
      state.search.type = type;
      state.search.translate = translate;
      state.search.page = pg;
      state.search.pageCount = 1;
      state.search.ran = false;
      state.search.items = [];
      state.search.page = 0;
      state.search.done = false;
      state.search.error = '';
    }
    if ((q || tags.length) && !state.search.ran) {
      runSearch(true, state.search.page || 0);
    }
  }
  function tagPill(t, selected) {
    return '<button class="tag-pill' + (selected ? ' active' : '') + '" data-action="toggle-tag" data-tag="' + esc(t.tag) + '">'
      + esc(t.label) + '</button>';
  }
  function syncSearchUrl() {
    const s = state.search;
    const params = new URLSearchParams();
    if (s.q) params.set('q', s.q);
    params.set('p', s.provider || 'all');
    params.set('s', String(s.sort || 0));
    params.set('ty', String(s.type || 0));
    params.set('tr', String(s.translate || 0));
    if (s.page > 0) params.set('pg', String(s.page));
    if (s.tags.length) params.set('t', s.tags.join(','));
    try { history.replaceState(null, '', '#/search?' + params.toString()); } catch (e) {}
  }
  function tagSection() {
    const s = state.search;
    const selected = s.tags || [];
    const common = COMMON_TAGS.map(t => tagPill(t, selected.indexOf(t.tag) >= 0)).join('');
    const extras = selected.filter(t => !COMMON_TAGS.some(x => x.tag === t))
      .map(t => tagPill({ tag: t, label: tagLabel(t) }, true)).join('');
    return '<div class="tag-search"><div class="tag-search-head"><b>按标签找书</b>'
      + '<button class="link" data-action="open-tag-sheet">全部标签 ' + icon('right') + '</button></div>'
      + '<div class="tag-cloud">' + common + extras + '</div>'
      + (selected.length ? '<div class="tag-selected"><span>已选：' + selected.map(t => esc(tagLabel(t))).join(' + ') + '</span>'
        + '<button data-action="clear-tags">清除</button></div>' : '')
      + '</div>';
  }
  function searchView() {
    const s = state.search;
    const chips = ['all'].concat(PROVIDER_ORDER).map(p =>
      '<button class="chip ' + (s.provider === p ? 'active' : '') + '" data-action="search-provider" data-provider="' + p + '">'
      + (p === 'all' ? '全部书源' : PROVIDERS[p].label) + '</button>'
    ).join('') + r18Chip();
    const sortLabels = ['更新', '点击', '相关'];
    const sortChips = '<div class="chips sort-chips"><span class="filter-label">排序</span>'
      + sortLabels.map((label, i) => '<button class="chip ' + (s.sort === i ? 'active' : '') + '" data-action="search-sort" data-sort="' + i + '">' + label + '</button>').join('')
      + '</div>';
    const filterChips = '<div class="search-filter-box">'
      + '<div class="chips sort-chips"><span class="filter-label">类型</span>'
      + [['全部', 0], ['连载中', 1], ['已完结', 2], ['短篇', 3]].map(x => '<button class="chip ' + (s.type === x[1] ? 'active' : '') + '" data-action="search-type" data-value="' + x[1] + '">' + x[0] + '</button>').join('')
      + '</div>'
      + '<div class="chips sort-chips"><span class="filter-label">译本</span>'
      + [['全部', 0], ['GPT', 1], ['Sakura', 2]].map(x => '<button class="chip ' + (s.translate === x[1] ? 'active' : '') + '" data-action="search-translate" data-value="' + x[1] + '">' + x[0] + '</button>').join('')
      + '</div></div>';
    const title = s.q || (s.tags.length ? s.tags.map(tagLabel).join(' + ') : '');
    let body = '';
    if (!s.q && !s.tags.length) {
      body = '<div class="card" style="margin-top:8px"><div class="card-title"><b>最近搜索</b><span>' + recent.length + ' 条</span></div>'
        + (recent.length ? '<div class="recent">' + recent.map(q => '<button class="chip" data-action="recent-search" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>'
          : '<p style="font-size:11.5px;color:var(--faint);margin:8px 0 0">还没有搜索记录。试试「恋爱」「异世界」，或直接点上面的标签。</p>')
        + '</div>' + emptyState('search', '找一本想读的书', '支持书名、作者、关键词；标签可多选组合。', '', '');
    } else if (s.loading && s.items.length === 0) {
      body = '<div class="search-meta"><span>正在搜索「' + esc(title) + '」…</span></div>' + skeletonRows(5);
    } else if (s.error && s.items.length === 0) {
      body = errorCard(s.error, 'retry-search');
    } else if (!s.loading && s.items.length === 0) {
      body = emptyState('search', '没有找到结果', '换个关键词或标签，或切换单个书源试试。', '', '');
    } else {
      body = '<div class="search-meta"><span>「' + esc(title) + '」 · ' + s.items.length + ' 个结果</span><span>' + (s.provider === 'all' ? '全部书源' : PROVIDERS[s.provider].label) + '</span></div>'
        + '<div class="book-list">' + s.items.map(bookRow).join('') + '</div>';
      if (s.loading) body += '<div class="load-more"><span class="btn btn-sm btn-ghost"><span class="spin"></span> 加载中</span></div>';
      else body += pageNavHtml('search', s.page, s.pageCount);
    }
    const content = topbar({
      back: true, title: '搜索', sub: '书名 / 作者 / 标签',
      actions: ''
    }) + '<div class="search-head"><div class="search-box">' + icon('search')
      + '<input id="search-input" type="search" placeholder="书名 / 作者 / 关键词" value="' + esc(s.q) + '" autocomplete="off">'
      + '<button class="go" data-action="submit-search">搜索</button></div></div>'
      + '<div class="chips">' + chips + '</div>' + sortChips + filterChips + tagSection() + body;
    return { html: shell(content, 'home'), tab: 'home' };
  }
  function openTagSheet() {
    const s = state.search;
    const groups = TAG_GROUPS.map(g =>
      '<div class="tag-group"><h3>' + esc(g.title) + '</h3><div class="tag-cloud">'
      + g.tags.map(t => tagPill(t, s.tags.indexOf(t.tag) >= 0)).join('') + '</div></div>'
    ).join('');
    showSheet('<h2>全部标签</h2><p class="sheet-sub">点标签筛选，可多选；多个标签为同时满足。再点一次取消。</p>'
      + groups
      + '<div class="notice">' + icon('info') + '<span>R18 内容需要原站账号权限，请在网页版登录后查看；进入前会要求确认已满 18 岁。</span></div>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="open-web-gate">网页版</button>'
      + '<button class="btn btn-primary" data-action="close-sheet">完成</button></div>');
  }
  function toggleTag(tag, close) {
    const s = state.search;
    if (!tag) return;
    const i = s.tags.indexOf(tag);
    if (i >= 0) s.tags.splice(i, 1); else s.tags.push(tag);
    s.items = []; s.page = 0; s.done = false; s.ran = false; s.error = '';
    const active = s.tags.indexOf(tag) >= 0;
    const pills = document.querySelectorAll('[data-action="toggle-tag"]');
    for (let k = 0; k < pills.length; k++) {
      if (pills[k].getAttribute('data-tag') === tag) pills[k].classList.toggle('active', active);
    }
    syncSearchUrl();
    if (close) closeSheet();
    if (s.q || s.tags.length) runSearch(true); else render();
  }
  async function runSearch(reset, page) {
    const s = state.search;
    const q = String(s.q || '').trim();
    const effective = [q].concat(s.tags.map(t => t + '$')).filter(Boolean).join(' ').trim();
    if (!effective) return;
    const target = typeof page === 'number' ? Math.max(0, page) : (reset ? 0 : s.page + 1);
    if (reset) {
      s.items = []; s.page = 0; s.pageCount = 1; s.done = false; s.error = '';
    }
    s.page = target;
    syncSearchUrl();
    const seq = ++searchSeq;
    s.loading = true;
    s.ran = true;
    if (q) addRecent(q);
    if (state.route.name === 'search') render();
    const list = s.provider === 'all' ? PROVIDER_ORDER : [s.provider];
    const path = p => 'novel?page=' + target + '&pageSize=15&level=' + (state.r18 ? 2 : 1) + '&provider=' + encodePath(p)
      + '&query=' + encodePath(effective) + '&sort=' + (s.sort || 0)
      + '&type=' + (s.type || 0) + '&translate=' + (s.translate || 0);
    const settled = await Promise.allSettled(list.map(p => apiJson(path(p))));
    if (seq !== searchSeq) return;
    let ok = 0, items = [], pageCount = 1;
    settled.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        ok++;
        const arr = Array.isArray(r.value.items) ? r.value.items : [];
        items = items.concat(arr);
        pageCount = Math.max(pageCount, Number(r.value.pageNumber) || 1);
      }
    });
    if (ok === 0) {
      s.error = settled[0] && settled[0].reason ? settled[0].reason.message : '搜索失败';
    } else {
      const seen = new Set();
      items = items.filter(it => {
        const k = (it.providerId || '') + '/' + (it.novelId || '');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      items.sort((a, b) => (b.updateAt || 0) - (a.updateAt || 0));
      s.items = items;
      s.page = target;
      s.pageCount = pageCount;
      s.done = target >= pageCount - 1;
      s.error = '';
    }
    s.loading = false;
    if (state.route.name === 'search') render();
  }
  function addRecent(q) {
    q = String(q || '').trim();
    if (!q) return;
    recent = [q].concat(recent.filter(x => x !== q)).slice(0, 10);
    saveJSON('nr.recent', recent);
  }

  /* ------------------------------------------------------------------ *
   *  Novel comments (forum external API; read is public, posting is on web)
   * ------------------------------------------------------------------ */
  function commentKey(provider, novel) { return 'web-' + provider + '-' + novel; }
  function commentPath(key, page, size) {
    return 'external/comment/novel/' + encodePath(key) + '?page=' + page + '&page_size=' + size;
  }
  function commentTime(s) {
    const t = Date.parse(String(s || ''));
    if (!isFinite(t)) return '';
    return relTime(Math.floor(t / 1000));
  }
  function commentBody(s) {
    return esc(String(s == null ? '' : s)).replace(/\n/g, '<br>');
  }
  function visibleComments(arr) {
    return (arr || []).filter(c => c && !c.authorBlocked && (c.status == null || c.status === 0));
  }
  function commentHtml(c, compact) {
    const name = c.authorUsername || '匿名';
    const replies = c.replies && Array.isArray(c.replies.items) ? visibleComments(c.replies.items) : [];
    const replyCount = Number(c.replyCount || (c.replies && c.replies.total) || 0);
    let replyHtml = '';
    if (replies.length) {
      replyHtml = '<div class="comment-replies">' + replies.slice(0, compact ? 1 : 3).map(r =>
        '<div class="reply-line"><b>' + esc(r.authorUsername || '') + '</b> ' + commentBody(r.content) + '</div>'
      ).join('') + (replyCount > (compact ? 1 : 3) ? '<div class="reply-more">还有 ' + (replyCount - (compact ? 1 : 3)) + ' 条回复</div>' : '') + '</div>';
    } else if (replyCount > 0) {
      replyHtml = '<div class="comment-replies"><div class="reply-more">' + replyCount + ' 条回复</div></div>';
    }
    return '<div class="comment-item' + (compact ? ' compact' : '') + '">'
      + '<div class="avatar">' + esc(String(name).slice(0, 2).toUpperCase()) + '</div>'
      + '<div class="comment-main"><div class="comment-head"><b>' + esc(name) + '</b><span>' + esc(commentTime(c.createdAt)) + '</span></div>'
      + '<div class="comment-content">' + commentBody(c.content) + '</div>' + replyHtml
      + (!compact ? '<div class="comment-actions"><button data-action="comment-reply" data-id="' + c.id + '" data-user="' + esc(name) + '">回复</button></div>' : '')
      + '</div></div>';
  }
  function commentPreviewHtml() {
    const b = state.book;
    if (!b) return '';
    const key = commentKey(b._provider, b._novel);
    const p = state.commentPreview;
    if (p.key !== key) return '<div class="comment-loading"><span class="spin"></span> 正在加载讨论…</div>';
    if (p.loading) return '<div class="comment-loading"><span class="spin"></span> 正在加载讨论…</div>';
    if (p.error) return '<div class="comment-error">' + esc(p.error) + '<button data-action="retry-comment-preview">重试</button></div>';
    if (!p.items.length) return '<div class="comment-empty">还没有人讨论，去网页版说两句。</div>';
    return p.items.map(c => commentHtml(c, true)).join('');
  }
  async function loadCommentPreview(force) {
    const b = state.book;
    if (!b) return;
    const key = commentKey(b._provider, b._novel);
    if (!force && state.commentPreview.key === key && state.commentPreview.loaded) return;
    state.commentPreview = { key: key, total: 0, items: [], loading: true, error: '', loaded: false };
    updateCommentPreviewDom();
    try {
      const data = await forumApi(commentPath(key, 1, 4));
      if (state.book !== b) return;
      const items = visibleComments(data.items);
      state.commentPreview = { key: key, total: Number(data.total) || 0, items: items, loading: false, error: '', loaded: true };
    } catch (e) {
      if (state.book !== b) return;
      state.commentPreview = { key: key, total: 0, items: [], loading: false, error: e.message || '讨论加载失败', loaded: false };
    }
    updateCommentPreviewDom();
  }
  function updateCommentPreviewDom() {
    const b = state.book;
    if (!b || state.route.name !== 'book') return;
    const key = commentKey(b._provider, b._novel);
    const preview = $('#comment-preview');
    if (preview && state.commentPreview.key === key) preview.innerHTML = commentPreviewHtml();
    const count = $('#comment-count');
    if (count && state.commentPreview.key === key) {
      count.textContent = state.commentPreview.total ? fmtNum(state.commentPreview.total) + ' 条' : (state.commentPreview.loading ? '加载中' : '0 条');
    }
    const more = $('#comment-more');
    if (more) more.textContent = state.commentPreview.total ? ('查看全部 ' + fmtNum(state.commentPreview.total) + ' 条讨论') : '查看全部讨论';
  }
  function commentComposerHtml() {
    loadAuth();
    if (!state.auth.loggedIn) {
      return '<div class="comment-login-hint">登录原站账号后可直接发评论<button data-action="open-login">登录</button></div>';
    }
    const reply = state.commentRoot > 0;
    return '<div class="comment-compose"><textarea id="comment-input" rows="2" maxlength="4000" placeholder="'
      + (reply ? '回复 ' + esc(state.commentReplyName || '') + '…' : '说点什么…') + '"></textarea>'
      + '<div class="compose-row"><span class="compose-hint" id="compose-hint">'
      + (reply ? '回复 ' + esc(state.commentReplyName || '') + ' <button data-action="cancel-reply">取消</button>' : '评论会提交到原站论坛')
      + '</span><button class="compose-send" id="comment-send" data-action="send-comment">发送</button></div></div>';
  }
  function updateComposer() {
    const wrap = $('#comment-compose-wrap');
    if (!wrap) return;
    wrap.innerHTML = commentComposerHtml();
  }
  function commentSheetHtml() {
    return '<h2>讨论</h2><p class="sheet-sub"><span id="comment-total">' + (state.comments.total ? fmtNum(state.comments.total) + ' 条' : '') + '</span> · 评论来自原站论坛</p>'
      + '<div id="comment-compose-wrap">' + commentComposerHtml() + '</div>'
      + '<div id="comment-list"></div><div id="comment-footer"></div>';
  }
  async function loadComments(reset, page) {
    const b = state.book;
    if (!b) return;
    const key = commentKey(b._provider, b._novel);
    if (state.comments.key !== key && !reset) return;
    if (state.comments.loading) return;
    if (reset) {
      state.comments.key = key;
      state.comments.items = [];
      state.comments.page = 0;
      state.comments.pages = 1;
      state.comments.total = 0;
      state.comments.error = '';
    }
    const target = Math.max(1, parseInt(page || state.comments.page || 1, 10) || 1);
    state.comments.loading = true;
    state.comments.error = '';
    renderCommentsSheet();
    try {
      const size = 20;
      const data = await forumApi(commentPath(key, target, size));
      const items = visibleComments(data.items);
      const total = Number(data.total) || items.length;
      const pages = Math.max(1, Math.ceil(total / size));
      const safePage = Math.min(target, pages);
      state.comments.items = items;
      state.comments.page = safePage;
      state.comments.pages = pages;
      state.comments.total = total;
      state.comments.error = '';
      if (safePage !== target) {
        state.comments.loading = false;
        loadComments(false, safePage);
        return;
      }
    } catch (e) {
      state.comments.error = e.message || '讨论加载失败';
      state.comments.items = [];
    }
    state.comments.loading = false;
    renderCommentsSheet();
  }
  function commentPagerHtml(c) {
    const pages = Math.max(1, Number(c.pages) || 1);
    const page = Math.min(pages, Math.max(1, Number(c.page) || 1));
    if (pages <= 1) return '';
    return '<div class="comment-pager">'
      + '<button class="btn btn-sm btn-ghost" data-action="comment-prev"' + (page <= 1 || c.loading ? ' disabled' : '') + '>上一页</button>'
      + '<span>第 ' + page + ' / ' + pages + ' 页</span>'
      + '<button class="btn btn-sm btn-ghost" data-action="comment-next"' + (page >= pages || c.loading ? ' disabled' : '') + '>下一页</button>'
      + '</div>'
      + '<div class="comment-jump">'
      + '<input id="comment-page-input" type="number" inputmode="numeric" min="1" max="' + pages + '" value="' + page + '" aria-label="评论页码">'
      + '<button class="btn btn-sm btn-ghost" data-action="comment-go"' + (c.loading ? ' disabled' : '') + '>跳转</button>'
      + '</div>';
  }
  function renderCommentsSheet() {
    const list = $('#comment-list');
    if (!list) return;
    const c = state.comments;
    if (c.loading && c.items.length === 0) {
      list.innerHTML = '<div class="comment-loading"><span class="spin"></span> 正在加载讨论…</div>';
    } else if (c.error && c.items.length === 0) {
      list.innerHTML = '<div class="comment-error">' + esc(c.error) + '<button data-action="retry-comment-list">重试</button></div>';
    } else if (c.items.length === 0) {
      list.innerHTML = '<div class="comment-empty">还没有人讨论，去网页版说两句。</div>';
    } else {
      list.innerHTML = c.items.map(x => commentHtml(x, false)).join('');
    }
    const totalEl = $('#comment-total');
    if (totalEl) totalEl.textContent = c.total ? fmtNum(c.total) + ' 条' : '';
    const footer = $('#comment-footer');
    if (footer) {
      const b = state.book;
      const url = b ? ('https://books.fishhawk.top/novel/' + encodePath(b._provider) + '/' + encodePath(b._novel)) : 'https://books.fishhawk.top/';
      footer.innerHTML = (c.error && c.items.length ? '<div class="comment-error">' + esc(c.error) + '<button data-action="retry-comment-list">重试</button></div>' : '')
        + commentPagerHtml(c)
        + (c.loading ? '<div class="comment-loading" style="padding:8px"><span class="spin"></span> 加载中…</div>' : '')
        + '<button class="btn btn-ghost btn-block" data-action="comment-web" data-url="' + esc(url) + '">在网页版查看 / 管理评论</button>'
        + '<div class="note" style="text-align:center">评论提交到原站论坛；发布权限和频率由原站账号决定。</div>';
    }
  }

  function openComments() {
    const b = state.book;
    if (!b) return;
    const key = commentKey(b._provider, b._novel);
    state.comments = { key: key, items: [], page: 0, total: state.commentPreview.key === key ? state.commentPreview.total : 0, loading: false, error: '', done: false };
    state.commentRoot = 0;
    state.commentReplyName = '';
    showSheet(commentSheetHtml());
    loadComments(true);
  }

  /* ------------------------------------------------------------------ *
   *  Book detail
   * ------------------------------------------------------------------ */
  async function loadBook(provider, novelId) {
    if (!provider || !novelId) { navigate('#/home'); return; }
    const key = nativeKey(provider, novelId);
    if (state.book && state.bookRef && state.bookRef.key === key) {
      if (state.route.name === 'book') { render(); loadCommentPreview(); }
      return;
    }
    state.book = null;
    state.bookRef = { provider: provider, novelId: novelId, key: key };
    state.bookLoading = true;
    state.bookError = '';
    state.tocLimit = 120;
    state.tocQuery = '';
    state.dlChoiceSet = false;
    state.dlChoice = 0;
    render();
    try {
      const data = await apiJson('novel/' + encodePath(provider) + '/' + encodePath(novelId));
      data._provider = provider;
      data._novel = novelId;
      data._key = key;
      if (state.bookRef && state.bookRef.key === key) {
        state.book = data;
        state.bookLoading = false;
        try { sessionStorage.setItem('novel:' + key, JSON.stringify(data)); } catch (e) {}
        if (state.route.name === 'book') { render(); loadCommentPreview(); }
      }
    } catch (e) {
      if (state.bookRef && state.bookRef.key === key) {
        state.bookLoading = false;
        state.bookError = e.message || '加载失败';
        if (state.route.name === 'book') render();
      }
    }
  }
  function bookView() {
    const ref = state.bookRef;
    if (!ref) return { html: shell('<div class="empty">正在返回…</div>', null), tab: null };
    const backBtn = topbar({
      back: true, title: '作品详情', sub: PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider,
      actions: '<button class="icon-btn" data-action="share-book" aria-label="分享">' + icon('share') + '</button>'
    });
    if (state.bookLoading) {
      return { html: shell(backBtn + '<div style="display:flex;gap:16px;padding:18px 2px"><div class="skeleton" style="width:108px;height:150px;border-radius:15px;flex:none"></div><div class="sk-lines" style="padding-top:18px"><div class="skeleton" style="height:18px;width:85%"></div><div class="skeleton" style="height:11px;width:55%"></div><div class="skeleton" style="height:11px;width:70%"></div></div></div>' + skeletonRows(4), null), tab: null };
    }
    if (state.bookError || !state.book) {
      return { html: shell(backBtn + errorCard(state.bookError || '作品不存在', 'retry-book'), null), tab: null };
    }
    const b = state.book;
    const key = b._key || ref.key;
    const toc = Array.isArray(b.toc) ? b.toc : [];
    const downloadable = toc.filter(x => x && x.chapterId).length;
    const prog = progress[key];
    let readIndex = -1;
    if (prog) readIndex = toc.findIndex(x => x && x.chapterId === prog.chapterId);
    if (readIndex < 0) readIndex = toc.findIndex(x => x && x.chapterId);
    const readLabel = prog ? '继续阅读' : '开始阅读';
    const inShelf = shelf.some(x => x.key === key);
    const dl = state.downloads.find(x => x.key === key);
    const dlDone = !!(dl && dl.status === 'done');
    const dlLabel = dlDone ? '已下载' : (dl ? '下载中' : '下载');
    const tags = [];
    (b.attentions || []).forEach(a => tags.push('<button class="tag red" data-action="tag-jump" data-tag="' + esc(a) + '">' + esc(a) + '</button>'));
    (b.keywords || []).slice(0, 6).forEach(k => tags.push('<button class="tag" data-action="tag-jump" data-tag="' + esc(k) + '">' + esc(k) + '</button>'));
    tags.push('<span class="tag green">' + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + '</span>');
    const author = (b.authors || []).map(a => a && a.name).filter(Boolean).join(' / ') || '佚名';
    const coverTitle = b.titleZh || b.titleJp || '?';
    const hero = '<section class="book-hero">' + coverHtml(coverTitle, { lg: true, cat: (PROVIDERS[ref.provider] || {}).short || ref.provider })
      + '<div class="bh-main"><h1>' + esc(coverTitle) + '</h1>'
      + (b.titleJp && b.titleZh ? '<p class="jp-title">' + esc(b.titleJp) + '</p>' : '')
      + '<div class="author">' + icon('edit') + '<span>' + esc(author) + '</span></div>'
      + '<div class="badges">' + tags.join('') + '</div></div></section>';
    const stats = '<div class="stats-grid">'
      + '<div><b>' + fmtNum(toc.length) + '</b><span>章节</span></div>'
      + '<div><b>' + fmtNum(b.totalCharacters) + '</b><span>字数</span></div>'
      + '<div><b>' + fmtNum(b.points) + '</b><span>热度</span></div>'
      + '<div><b>' + fmtNum(Math.max(b.sakura || 0, b.gpt || 0, b.youdao || 0)) + '</b><span>已译</span></div></div>';
    const actions = '<div class="action-row">'
      + '<button class="btn btn-primary" data-action="read" data-index="' + readIndex + '">' + icon('play') + readLabel + '</button>'
      + '<button class="btn btn-ghost" data-action="' + (dlDone ? 'read-dl' : 'download-sheet') + '" data-key="' + esc(key) + '">' + icon(dlDone ? 'play' : 'download') + dlLabel + '</button>'
      + '<button class="btn btn-ghost icon-only" data-action="toggle-shelf" aria-label="收藏">' + icon(inShelf ? 'bookmarkFill' : 'bookmark') + '</button>'
      + '</div>';
    const intro = b.introductionZh || b.introductionJp || '暂无简介。';
    const introCard = '<div class="card"><div class="card-title"><b>简介</b><span>' + esc(b.type || '') + '</span></div>'
      + '<div class="intro" id="intro-text">' + esc(intro) + '</div>'
      + '<button class="intro-toggle" data-action="intro-toggle">展开全部</button></div>';
    const commentCard = '<div class="card" id="comment-card"><div class="card-title"><b>讨论</b><span id="comment-count">'
      + (state.commentPreview.key === key && state.commentPreview.total ? fmtNum(state.commentPreview.total) + ' 条' : '')
      + '</span></div><div id="comment-preview">' + commentPreviewHtml() + '</div>'
      + '<button class="btn btn-ghost btn-block" id="comment-more" data-action="open-comments" style="margin-top:10px">'
      + (state.commentPreview.key === key && state.commentPreview.total ? '查看全部 ' + fmtNum(state.commentPreview.total) + ' 条讨论' : '查看全部讨论')
      + '</button></div>';
    const tocHtml = '<div class="card"><div class="card-title"><b>目录</b><span>' + downloadable + ' / ' + toc.length + ' 章可读</span></div>'
      + '<div class="toc-tools"><input id="toc-search" placeholder="在目录中查找…" value="' + esc(state.tocQuery) + '"></div>'
      + '<div class="toc-list" id="toc-list">' + tocListHtml() + '</div></div>';
    return { html: shell(backBtn + '<div class="fade-in">' + hero + stats + actions + introCard + commentCard + tocHtml + '</div>', null), tab: null };
  }
  function filteredToc() {
    const b = state.book;
    if (!b || !Array.isArray(b.toc)) return [];
    const q = state.tocQuery.trim().toLowerCase();
    const out = [];
    b.toc.forEach((item, i) => {
      if (!item) return;
      if (q) {
        const hay = ((item.titleZh || '') + ' ' + (item.titleJp || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      out.push({ item: item, index: i });
    });
    return out;
  }
  function tocListHtml() {
    const b = state.book;
    if (!b) return '';
    const all = filteredToc();
    if (!all.length) return '<div style="text-align:center;color:var(--faint);font-size:11.5px;padding:18px">没有匹配的章节</div>';
    const shown = all.slice(0, state.tocLimit);
    const prog = progress[b._key];
    let html = shown.map(x => {
      const item = x.item;
      const enabled = !!item.chapterId;
      const current = prog && prog.chapterId === item.chapterId;
      return '<button class="toc-item' + (enabled ? '' : ' disabled') + (current ? ' current' : '') + '" data-action="chapter" data-index="' + x.index + '">'
        + '<span class="idx">' + (x.index + 1) + '</span>'
        + '<span class="tt">' + esc(item.titleZh || item.titleJp || ('第 ' + (x.index + 1) + ' 章'))
        + (item.titleZh && item.titleJp ? '<small>' + esc(item.titleJp) + '</small>' : '') + '</span>'
        + '<span class="dot' + (enabled ? ' on' : '') + '"></span></button>';
    }).join('');
    if (all.length > shown.length) {
      html += '<button class="toc-more" data-action="toc-more">显示更多（' + (all.length - shown.length) + '）</button>';
    }
    return html;
  }
  function downloadSheet() {
    const b = state.book;
    if (!b) return;
    const key = b._key;
    const dl = state.downloads.find(x => x.key === key);
    const downloadable = (b.toc || []).filter(x => x && x.chapterId).length;
    const opts = [
      { limit: 50, title: '前 50 章', desc: '先下载一卷左右，适合试读' },
      { limit: 200, title: '前 200 章', desc: '缓存一大段，占用更少空间' },
      { limit: 0, title: '全部 ' + downloadable + ' 章', desc: '整本离线，章节多时耗时较久' }
    ];
    if (!state.dlChoiceSet) {
      state.dlChoice = dl && dl.limit ? dl.limit : 0;
      state.dlChoiceSet = true;
    }
    const current = state.dlChoice;
    const optHtml = opts.map(o => '<button class="opt ' + (current === o.limit ? 'active' : '') + '" data-action="dl-choice" data-limit="' + o.limit + '">'
      + '<span class="radio"></span><span><b>' + o.title + '</b><span>' + o.desc + '</span></span></button>').join('');
    const status = dl ? '<div class="notice">' + icon('download') + '<span>已有下载任务：' + esc(dl.titleZh || dl.titleJp || '') + ' · ' + (dl.done || 0) + ' / ' + (dl.target || dl.downloadable || downloadable) + ' 章。继续下载会自动补齐缺失章节。</span></div>' : '';
    const rangeStart = dl && dl.rangeStart > 1 ? dl.rangeStart : '';
    const rangeEnd = dl && dl.rangeEnd > 0 && dl.rangeEnd < downloadable ? dl.rangeEnd : '';
    const rangeHtml = '<div class="field-row" style="margin-top:10px"><div class="field"><label>自定义起始章（可选）</label><input id="dl-start" inputmode="numeric" placeholder="第几章" value="' + esc(rangeStart) + '"></div>'
      + '<div class="field"><label>结束章（可选）</label><input id="dl-end" inputmode="numeric" placeholder="留空到末章" value="' + esc(rangeEnd) + '"></div></div>'
      + '<div class="note">填写自定义范围会忽略上面的前 50/200/全部；留空则按上面选择。</div>';
    const wifiHtml = '<label class="check-row" style="margin-top:10px"><input type="checkbox" id="wifi-only" ' + (settings.wifiOnly !== false ? 'checked' : '') + '><span>仅 Wi-Fi 下载，避免用移动数据</span></label>';
    showSheet('<h2>下载到本地</h2><p class="sheet-sub">只下载站点已有译文的章节。下载在后台进行，可在「下载」页查看进度。</p>'
      + '<div class="opt-list">' + optHtml + '</div>' + rangeHtml + wifiHtml + status
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
      + '<button class="btn btn-primary" data-action="download-start">' + icon('download') + '开始下载</button></div>');
  }
  function openReader(provider, novelId, chapterId, index, title, key) {
    key = key || nativeKey(provider, novelId);
    if (state.book && state.book._key === key) {
      try { sessionStorage.setItem('novel:' + key, JSON.stringify(state.book)); } catch (e) {}
    }
    const qs = new URLSearchParams({
      provider: provider, novel: novelId, chapter: chapterId || '',
      key: key, index: String(index == null ? 0 : index), title: title || ''
    });
    location.href = 'reader.html?' + qs.toString();
  }
  function openFromProgress(p) {
    if (!p || !p.provider || !p.novel || !p.chapterId) { toast('进度信息不完整'); return; }
    openReader(p.provider, p.novel, p.chapterId, p.index || 0, p.title || '', p.key);
  }
  const SHELF_STATUS = {
    want: { label: '想读', cls: 'want' },
    reading: { label: '在读', cls: 'reading' },
    read: { label: '已读', cls: 'read' },
    dropped: { label: '弃读', cls: 'dropped' }
  };
  function normalizeShelf() {
    if (!Array.isArray(categories) || !categories.length) categories = ['未分类'];
    if (categories.indexOf('未分类') < 0) categories.unshift('未分类');
    shelf = (shelf || []).filter(x => x && x.key).map(x => {
      if (!x.status || !SHELF_STATUS[x.status]) x.status = (progress[x.key] && progress[x.key].chapterId) ? 'reading' : 'want';
      if (!x.category) x.category = '未分类';
      if (!Array.isArray(x.tags)) x.tags = [];
      if (x.subscribe == null) x.subscribe = true;
      x.autoDownload = !!x.autoDownload;
      x.newChapters = Number(x.newChapters || 0);
      x.total = Number(x.total || 0);
      x.addedAt = Number(x.addedAt || Date.now());
      x.updateAt = Number(x.updateAt || 0);
      return x;
    });
  }
  function saveShelf() { saveJSON('nr.shelf', shelf); saveJSON('nr.categories', categories); }
  function shelfFiltered() {
    const f = state.shelfFilter || {};
    const q = String(f.q || '').trim().toLowerCase();
    let list = shelf.slice();
    if (q) list = list.filter(x => [x.title, x.titleJp, x.author, (x.tags || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0);
    if (f.status && f.status !== 'all') list = list.filter(x => x.status === f.status);
    if (f.cat && f.cat !== 'all') list = list.filter(x => x.category === f.cat);
    if (f.tag && f.tag !== 'all') list = list.filter(x => (x.tags || []).indexOf(f.tag) >= 0);
    const sort = f.sort || 'recent';
    list.sort((a, b) => {
      if (sort === 'author') return String(a.author || '').localeCompare(String(b.author || ''), 'zh');
      if (sort === 'updated') return (b.updateAt || 0) - (a.updateAt || 0);
      if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
      if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
      return (b.lastReadAt || 0) - (a.lastReadAt || 0) || (b.addedAt || 0) - (a.addedAt || 0);
    });
    return list;
  }
  function shelfStatusChip(item) {
    const st = SHELF_STATUS[item.status] || SHELF_STATUS.want;
    return '<span class="shelf-pill ' + st.cls + '">' + st.label + '</span>';
  }
  function shelfAllTags() {
    const set = {};
    shelf.forEach(x => (x.tags || []).forEach(t => { if (t) set[t] = 1; }));
    return Object.keys(set).sort();
  }
  function shelfCardHtml(item) {
    const p = progress[item.key] || {};
    const pct = Math.max(0, Math.min(100, Math.round((p.percent || 0) * 100)));
    const last = p.title || '尚未开始阅读';
    const when = p.updatedAt ? relTime(Math.floor(p.updatedAt / 1000)) : relTime(Math.floor((item.addedAt || 0) / 1000));
    const selected = state.shelfSelected.has(item.key);
    const checkbox = state.shelfManage ? '<button class="shelf-check ' + (selected ? 'on' : '') + '" data-action="shelf-select" data-key="' + esc(item.key) + '" aria-label="选择">' + (selected ? icon('check') : '') + '</button>' : '';
    const update = item.newChapters > 0 ? '<span class="shelf-new">+' + item.newChapters + ' 章</span>' : '';
    const sub = item.subscribe ? '<span class="shelf-sub">订阅中</span>' : '<span class="shelf-sub off">已暂停</span>';
    return '<div class="shelf-card ' + (selected ? 'selected' : '') + '" data-action="shelf-card" data-key="' + esc(item.key) + '">'
      + checkbox
      + '<div class="shelf-cover">' + coverHtml(item.title, { cat: (PROVIDERS[item.provider] || {}).short || '' }) + '</div>'
      + '<div class="shelf-main"><div class="shelf-title-row"><h3>' + esc(item.title) + '</h3>' + update + '</div>'
      + '<div class="shelf-badges">' + shelfStatusChip(item) + '<span class="shelf-cat">' + esc(item.category || '未分类') + '</span>' + sub
      + (item.tags || []).slice(0, 2).map(t => '<span class="shelf-tag">#' + esc(t) + '</span>').join('') + '</div>'
      + '<div class="last">' + esc(last) + '</div>'
      + '<div class="progress"><i style="width:' + pct + '%"></i></div>'
      + '<div class="shelf-meta"><span>' + pct + '% · ' + esc(item.author || '') + '</span><span>' + when + '</span></div>'
      + '<div class="shelf-actions"><button class="btn btn-sm btn-primary" data-action="shelf-read" data-key="' + esc(item.key) + '">' + (p.chapterId ? '继续读' : '开始读') + '</button>'
      + '<button class="btn btn-sm btn-ghost" data-action="shelf-open" data-key="' + esc(item.key) + '">详情</button>'
      + '<button class="btn btn-sm btn-ghost" data-action="shelf-edit" data-key="' + esc(item.key) + '">管理</button></div></div></div>';
  }
  function toggleShelfCurrent() {
    const b = state.book;
    if (!b) return;
    const key = b._key;
    const idx = shelf.findIndex(x => x.key === key);
    if (idx >= 0) {
      shelf.splice(idx, 1);
      toast('已从书架移除');
    } else {
      shelf.unshift({
        key: key, provider: b._provider, novel: b._novel,
        title: b.titleZh || b.titleJp || '', titleJp: b.titleJp || '',
        author: (b.authors || []).map(a => a && a.name).filter(Boolean).join(' / '),
        total: (b.toc || []).length, addedAt: Date.now(),
        status: 'want', category: '未分类', tags: [],
        subscribe: settings.autoSubscribe !== false,
        autoDownload: false, newChapters: 0, updateAt: b.updateAt || Date.now()
      });
      toast(settings.autoSubscribe !== false ? '已收藏并自动订阅' : '已加入书架');
    }
    saveJSON('nr.shelf', shelf);
    render();
  }
  function shareCurrent() {
    const b = state.book;
    if (!b) return;
    const url = 'https://books.fishhawk.top/novel/' + encodePath(b._provider) + '/' + encodePath(b._novel);
    const text = (b.titleZh || b.titleJp) + '\n' + url;
    if (native && native.share) { try { native.share(text); return; } catch (e) {} }
    if (navigator.share) { navigator.share({ title: b.titleZh || b.titleJp, url: url }).catch(() => {}); }
  }

  /* ------------------------------------------------------------------ *
   *  Shelf
   * ------------------------------------------------------------------ */
  function shelfView() {
    normalizeShelf();
    const f = state.shelfFilter;
    const updates = shelf.filter(x => x.newChapters > 0).sort((a,b) => b.updateAt - a.updateAt);
    const list = shelfFiltered();
    let body;
    if (!shelf.length) {
      body = emptyState('shelf', '书架还是空的', '在作品详情页点收藏，会自动订阅新章节。', '去发现', 'go-home');
    } else {
      body = (updates.length ? '<div class="update-strip"><div class="update-strip-head"><b>有更新</b><span>' + updates.length + ' 本</span></div>'
        + updates.slice(0, 6).map(x => '<button class="update-chip" data-action="shelf-read" data-key="' + esc(x.key) + '"><span>' + esc(x.title) + '</span><b>+' + x.newChapters + ' 章</b></button>').join('') + '</div>' : '')
        + '<div class="shelf-tools"><div class="shelf-search">' + icon('search') + '<input id="shelf-q" value="' + esc(f.q) + '" placeholder="搜索书名、作者、标签"></div>'
        + '<button class="btn btn-sm btn-ghost" data-action="shelf-check">' + (state.subChecking ? '检查中…' : '检查更新') + '</button>'
        + '<button class="btn btn-sm btn-ghost" data-action="shelf-manage-toggle">' + (state.shelfManage ? '完成' : '管理') + '</button></div>'
        + '<div class="shelf-chips">'
        + [['all','全部'],['want','想读'],['reading','在读'],['read','已读'],['dropped','弃读']].map(x => '<button class="chip ' + (f.status === x[0] ? 'active' : '') + '" data-action="shelf-filter" data-kind="status" data-value="' + x[0] + '">' + x[1] + '</button>').join('')
        + '</div>'
        + '<div class="shelf-filter-row">'
        + '<select id="shelf-cat" aria-label="分类"><option value="all">全部分类</option>' + categories.map(c => '<option value="' + esc(c) + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
        + '<select id="shelf-tag" aria-label="标签"><option value="all">全部标签</option>' + shelfAllTags().map(t => '<option value="' + esc(t) + '"' + (f.tag === t ? ' selected' : '') + '>#' + esc(t) + '</option>').join('') + '</select>'
        + '<select id="shelf-sort" aria-label="排序"><option value="recent"' + (f.sort === 'recent' ? ' selected' : '') + '>最近阅读</option><option value="updated"' + (f.sort === 'updated' ? ' selected' : '') + '>更新时间</option><option value="added"' + (f.sort === 'added' ? ' selected' : '') + '>收藏时间</option><option value="author"' + (f.sort === 'author' ? ' selected' : '') + '>作者</option><option value="title"' + (f.sort === 'title' ? ' selected' : '') + '>书名</option></select>'
        + '</div>'
        + '<div class="shelf-cat-row">' + categories.map(c => '<button class="chip mini ' + (f.cat === c ? 'active' : '') + '" data-action="shelf-filter" data-kind="cat" data-value="' + esc(c) + '">' + esc(c) + '</button>').join('') + '<button class="chip mini add" data-action="shelf-add-category">+ 分类</button></div>'
        + (state.shelfManage ? '<div class="bulk-bar"><span>已选 ' + state.shelfSelected.size + ' 本</span><button data-action="shelf-select-all">全选</button><button data-action="bulk-category">分类</button><button data-action="bulk-status">状态</button><button data-action="bulk-subscribe">订阅</button><button data-action="bulk-remove" class="danger">删除</button></div>' : '')
        + (list.length ? list.map(shelfCardHtml).join('') : '<div class="empty small">没有符合条件的书</div>');
    }
    const content = topbar({ logo: true, brand: true, actions: '<button class="icon-btn" data-action="import-local" aria-label="导入本地书">' + icon('download') + '</button><button class="icon-btn" data-action="go-stats" aria-label="阅读统计">' + icon('star') + '</button><button class="icon-btn" data-action="go-search" aria-label="搜索">' + icon('search') + '</button>' })
      + '<div class="section-head"><h2>我的书架 <span class="sub">' + shelf.length + ' 本</span></h2>'
      + '<button class="link" data-action="import-local">导入 EPUB / TXT / SRT</button></div>' + body;
    return { html: shell(content, 'shelf'), tab: 'shelf' };
  }
  function checkShelfUpdates(manual) {
    if (state.subChecking) return;
    const targets = shelf.filter(x => x.subscribe && x.provider !== 'wenku');
    if (!targets.length) { if (manual) toast('没有已订阅的书'); return; }
    state.subChecking = true;
    if (manual) toast('正在检查订阅更新…');
    if (state.route.name === 'shelf') render();
    (async () => {
      let found = 0, errors = 0;
      for (const item of targets) {
        try {
          const d = await apiJson('novel/' + encodePath(item.provider) + '/' + encodePath(item.novel));
          const total = (d.toc || []).length;
          const old = Number(item.total || 0);
          if (total > old) {
            item.total = total;
            item.newChapters = total - old;
            item.updateAt = Date.now();
            found++;
            if (settings.autoDownloadNew && native && native.download) {
              try { native.download(item.provider, item.novel, 0, old + 1, 0); } catch (e) {}
            }
          }
        } catch (e) { errors++; }
      }
      saveShelf();
      try { localStorage.setItem('nr.subCheckAt', String(Date.now())); } catch (e) {}
      state.subChecking = false;
      if (state.route.name === 'shelf') render();
      if (found) toast('有 ' + found + ' 本更新，已放到书架顶部');
      else if (manual) toast(errors ? '检查完成，部分失败' : '暂时没有新章节');
    })();
  }
  function openShelfEdit(key) {
    const item = shelfBook(key);
    if (!item) return;
    showSheet('<h2>管理收藏</h2><p class="sheet-sub">' + esc(item.title) + '</p>'
      + '<div class="field"><label>阅读状态</label><select id="se-status">' + Object.keys(SHELF_STATUS).map(k => '<option value="' + k + '"' + (item.status === k ? ' selected' : '') + '>' + SHELF_STATUS[k].label + '</option>').join('') + '</select></div>'
      + '<div class="field" style="margin-top:8px"><label>分类</label><select id="se-cat">' + categories.map(c => '<option value="' + esc(c) + '"' + (item.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></div>'
      + '<div class="field" style="margin-top:8px"><label>标签（逗号分隔）</label><input id="se-tags" value="' + esc((item.tags || []).join(', ')) + '" placeholder="例如 奇幻, 追更"></div>'
      + '<div class="setting-row" style="padding:12px 0"><div class="st"><b>自动订阅新章节</b><span>暂停后不再检查这本书的更新</span></div><button class="switch ' + (item.subscribe ? 'on' : '') + '" id="se-sub" data-action="toggle-se-sub"></button></div>'
      + '<div class="setting-row" style="padding:12px 0;border:0"><div class="st"><b>自动下载新增章节</b><span>只下载新增部分，不动已有缓存</span></div><button class="switch ' + (item.autoDownload ? 'on' : '') + '" id="se-auto" data-action="toggle-se-auto"></button></div>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="shelf-remove" data-key="' + esc(key) + '">移出书架</button><button class="btn btn-primary" data-action="save-shelf-edit" data-key="' + esc(key) + '">保存</button></div>');
  }
  function saveShelfEdit(key) {
    const item = shelfBook(key);
    if (!item) return;
    item.status = (($('#se-status') || {}).value) || item.status;
    item.category = (($('#se-cat') || {}).value) || item.category;
    item.tags = String((($('#se-tags') || {}).value) || '').split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
    item.subscribe = !!(($('#se-sub') || {}).classList && $('#se-sub').classList.contains('on'));
    item.autoDownload = !!(($('#se-auto') || {}).classList && $('#se-auto').classList.contains('on'));
    if (item.tags.length && categories.indexOf(item.category) < 0) categories.push(item.category);
    saveShelf(); closeSheet(); toast('已保存'); render();
  }
  function openBulkSheet(kind) {
    if (!state.shelfSelected.size) { toast('先选择书籍'); return; }
    if (kind === 'category') {
      showSheet('<h2>批量分类</h2><div class="opt-list">' + categories.map(c => '<button class="opt" data-action="apply-bulk-category" data-value="' + esc(c) + '"><div class="radio"></div><div><b>' + esc(c) + '</b></div></button>').join('') + '</div>');
    } else if (kind === 'status') {
      showSheet('<h2>批量状态</h2><div class="opt-list">' + Object.keys(SHELF_STATUS).map(k => '<button class="opt" data-action="apply-bulk-status" data-value="' + k + '"><div class="radio"></div><div><b>' + SHELF_STATUS[k].label + '</b></div></button>').join('') + '</div>');
    }
  }

  async function importLocalBooks() {
    try {
      const raw = await invokeLong('importLocalBook');
      const arr = JSON.parse(raw || '[]');
      let added = 0;
      for (const m of arr) {
        const k = m._key || m.novelId;
        if (!k || shelf.some(x => x.key === k)) continue;
        const title = m.titleZh || m.titleJp || '本地书籍';
        shelf.unshift({
          key: k, provider: 'local', novel: m.novelId || k,
          title: title, titleJp: m.titleJp || '', author: m.author || '',
          total: (m.toc || []).length, addedAt: Date.now(),
          status: 'want', category: '本地导入', tags: [], subscribe: false,
          autoDownload: false, newChapters: 0, updateAt: Date.now()
        });
        if (categories.indexOf('本地导入') < 0) categories.push('本地导入');
        added++;
      }
      saveShelf();
      if (state.route.name === 'shelf') render();
      toast(added ? ('已导入 ' + added + ' 本本地书') : '没有新增书籍');
    } catch (e) {
      toast(e.message || '导入失败');
    }
  }
  function shelfBook(key) { return shelf.find(x => x.key === key); }
  function shelfRead(key) {
    const item = shelfBook(key);
    if (!item) return;
    item.status = 'reading';
    item.lastReadAt = Date.now();
    item.newChapters = 0;
    saveShelf();
    if (item.provider === 'local') {
      openReader('local', item.novel, '0', 0, item.title || '', item.key);
      return;
    }
    const p = progress[key];
    if (p && p.chapterId) openFromProgress(Object.assign({ key: key, provider: item.provider, novel: item.novel }, p));
    else {
      // Detail will pick the first readable chapter, but open directly when session cache exists.
      const cached = sessionStorage.getItem('novel:' + key);
      if (cached) {
        try {
          const b = JSON.parse(cached);
          const idx = (b.toc || []).findIndex(x => x && x.chapterId);
          if (idx >= 0) { openReader(item.provider, item.novel, b.toc[idx].chapterId, idx, b.toc[idx].titleZh || b.toc[idx].titleJp, key); return; }
        } catch (e) {}
      }
      navigate('#/book/' + encodePath(item.provider) + '/' + encodePath(item.novel));
    }
  }

  /* ------------------------------------------------------------------ *
   *  Reading statistics
   * ------------------------------------------------------------------ */
  function loadStats() {
    const s = loadJSON('nr.stats', {}) || {};
    s.daily = s.daily && typeof s.daily === 'object' ? s.daily : {};
    s.books = s.books && typeof s.books === 'object' ? s.books : {};
    s.chapters = s.chapters && typeof s.chapters === 'object' ? s.chapters : {};
    return s;
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return h + ' 小时 ' + m + ' 分';
    if (m) return m + ' 分钟';
    return sec + ' 秒';
  }
  function dayKey(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function statsTotals(st) {
    let seconds = 0, chapters = 0;
    Object.keys(st.daily).forEach(k => { const d = st.daily[k] || {}; seconds += Number(d.seconds || 0); chapters += Number(d.chapters || 0); });
    Object.keys(st.chapters).forEach(k => { chapters = Math.max(chapters, 0); });
    let chapterSet = {};
    Object.keys(st.chapters).forEach(k => (st.chapters[k] || []).forEach(id => { chapterSet[k + '|' + id] = 1; }));
    return { seconds: seconds, chapters: Object.keys(chapterSet).length, activeDays: Object.keys(st.daily).filter(k => (st.daily[k].seconds || 0) > 0).length };
  }
  function statsStreak(st) {
    let n = 0; const d = new Date();
    while (n < 3650) {
      const k = dayKey(d);
      if ((st.daily[k] && st.daily[k].seconds) || k === dayKey(new Date())) { n++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return n;
  }
  function statsBarsHtml(st, days) {
    const vals = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      vals.push({ key: k, label: (d.getMonth() + 1) + '/' + d.getDate(), sec: Number((st.daily[k] || {}).seconds || 0) });
    }
    const max = Math.max(60, ...vals.map(v => v.sec));
    return '<div class="stat-bars">' + vals.map((v, i) => '<div class="stat-bar-wrap" title="' + v.key + ' · ' + fmtDuration(v.sec) + '"><div class="stat-bar" style="height:' + Math.max(4, Math.round(v.sec / max * 100)) + '%"></div><span>' + (days <= 14 || i % 3 === 0 ? v.label : '') + '</span></div>').join('') + '</div>';
  }
  function statsView() {
    const st = loadStats();
    const t = statsTotals(st);
    const books = Object.keys(st.books).map(k => Object.assign({ key: k }, st.books[k])).sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
    const today = st.daily[dayKey()] || {};
    const statusCount = { want: 0, reading: 0, read: 0, dropped: 0 };
    shelf.forEach(x => { if (statusCount[x.status] != null) statusCount[x.status]++; });
    const progressList = shelf.slice().sort((a, b) => ((progress[b.key] || {}).updatedAt || 0) - ((progress[a.key] || {}).updatedAt || 0)).slice(0, 6);
    const body = '<div class="stats-hero"><div><b>' + fmtDuration(t.seconds) + '</b><span>累计阅读</span></div><div><b>' + t.chapters + '</b><span>累计章节</span></div><div><b>' + t.activeDays + '</b><span>阅读天数</span></div><div><b>' + statsStreak(st) + '</b><span>连续天数</span></div></div>'
      + '<div class="stat-card"><div class="card-title"><b>本月阅读趋势</b><span>今天 ' + fmtDuration(today.seconds) + '</span></div>' + statsBarsHtml(st, new Date().getDate()) + '</div>'
      + '<div class="stat-card"><div class="card-title"><b>阅读最多</b><span>按累计时长</span></div>'
      + (books.length ? books.slice(0, 5).map((x, i) => '<div class="rank-row"><span class="rank">' + (i + 1) + '</span><div class="rank-main"><b>' + esc(x.title || '未知作品') + '</b><span>' + (x.chapters || 0) + ' 章</span></div><span class="rank-time">' + fmtDuration(x.seconds || 0) + '</span></div>').join('') : '<div class="empty small">还没有阅读记录</div>') + '</div>'
      + '<div class="stat-card"><div class="card-title"><b>书架状态</b><span>' + shelf.length + ' 本</span></div><div class="status-grid">'
      + [['want', '想读'], ['reading', '在读'], ['read', '已读'], ['dropped', '弃读']].map(x => '<div><b>' + statusCount[x[0]] + '</b><span>' + x[1] + '</span></div>').join('') + '</div></div>'
      + '<div class="stat-card"><div class="card-title"><b>阅读进度</b><span>最近阅读</span></div>'
      + (progressList.length ? progressList.map(x => { const p = progress[x.key] || {}; const pct = Math.round((p.percent || 0) * 100); return '<button class="stat-progress" data-action="shelf-read" data-key="' + esc(x.key) + '"><span>' + esc(x.title) + '</span><i><b style="width:' + pct + '%"></b></i><em>' + pct + '%</em></button>'; }).join('') : '<div class="empty small">还没有阅读进度</div>') + '</div>'
      + '<button class="btn btn-primary btn-block" data-action="annual-report">生成年度阅读报告</button>';
    return { html: shell(topbar({ back: true, title: '阅读统计', sub: '你的阅读轨迹' }) + body, null), tab: null };
  }
  function annualReport() {
    const st = loadStats(); const t = statsTotals(st); const year = new Date().getFullYear();
    const books = Object.keys(st.books).map(k => Object.assign({ key: k }, st.books[k])).sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
    const months = [];
    for (let m = 0; m < 12; m++) { let sec = 0; Object.keys(st.daily).forEach(k => { if (k.indexOf(year + '-' + String(m + 1).padStart(2, '0')) === 0) sec += Number(st.daily[k].seconds || 0); }); months.push(sec); }
    const max = Math.max(60, ...months);
    const text = `Novelia ${year} 阅读报告
累计阅读：${fmtDuration(t.seconds)}
累计章节：${t.chapters} 章
阅读天数：${t.activeDays} 天
阅读最多：${books[0] ? books[0].title : '暂无'}
—— 用 Novelia 把喜欢的故事留在手机里。`;
    showSheet('<h2>' + year + ' 阅读报告</h2><p class="sheet-sub">你的这一年，藏在故事里。</p>'
      + '<div class="annual-hero"><b>' + fmtDuration(t.seconds) + '</b><span>累计阅读时长</span><div><em>' + t.chapters + '</em> 章 · <em>' + t.activeDays + '</em> 天</div></div>'
      + '<div class="annual-bars">' + months.map((sec, i) => '<div><i style="height:' + Math.max(3, Math.round(sec / max * 100)) + '%"></i><span>' + (i + 1) + '月</span></div>').join('') + '</div>'
      + '<div class="annual-top"><span>阅读最多</span><b>' + esc(books[0] ? books[0].title : '还没有记录') + '</b><span>' + (books[0] ? fmtDuration(books[0].seconds) : '') + '</span></div>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">关闭</button><button class="btn btn-primary" data-action="share-report" data-text="' + esc(text) + '">分享报告</button></div>');
  }
  /* ------------------------------------------------------------------ *
   *  Downloads
   * ------------------------------------------------------------------ */
  function refreshDownloads() {
    if (native && typeof native.downloads === 'function') {
      const raw = sync(() => native.downloads(), '[]');
      try { state.downloads = JSON.parse(raw || '[]'); } catch (e) { state.downloads = []; }
    }
    refreshStorage();
  }
  function refreshStorage() {
    if (native && typeof native.storage === 'function') {
      const raw = sync(() => native.storage(), '');
      try { state.storage = JSON.parse(raw || '{}'); } catch (e) {}
    }
  }
  function startDownloadPoll() {
    stopDownloadPoll();
    dlTimer = setInterval(() => {
      refreshDownloads();
      if (state.route.name === 'downloads') updateDownloadsDom();
      const badge = $('.tabbar .badge');
      if (badge) badge.style.display = state.downloads.some(d => d.status === 'downloading') ? '' : 'none';
    }, 1400);
  }
  function stopDownloadPoll() {
    if (dlTimer) { clearInterval(dlTimer); dlTimer = null; }
  }
  function showDownloadExportSheet() {
    const count = state.dlSelected.size;
    if (!count) { toast('先选择要导出的书'); return; }
    showSheet('<h2>导出 ' + count + ' 本</h2><p class="sheet-sub">选择格式后，再选择保存文件夹；只导出已下载章节。</p>'
      + '<div class="opt-list">'
      + '<button class="opt" data-action="export-selected-format" data-format="txt"><div class="radio"></div><div><b>TXT 纯文本</b><span>每本一个 .txt 文件</span></div></button>'
      + '<button class="opt" data-action="export-selected-format" data-format="epub"><div class="radio"></div><div><b>EPUB 电子书</b><span>每本一个 .epub 文件</span></div></button>'
      + '</div><div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button></div>');
  }
  async function exportSelected(format) {
    const items = state.downloads.filter(x => state.dlSelected.has(x.key)).map(x => ({ provider: x.providerId, novel: x.novelId, key: x.key, title: x.titleZh || x.titleJp }));
    if (!items.length) { toast('先选择要导出的书'); return; }
    closeSheet();
    toast('正在生成 ' + items.length + ' 本…');
    try {
      const res = await invokeLong('exportBooks', JSON.stringify(items), format);
      const m = String(res || '').match(/saved:(\d+)/);
      toast(m ? ('已导出 ' + m[1] + ' 本') : '已导出');
    } catch (e) {
      toast(e.message || '导出失败');
    }
  }
  function downloadsView() {
    const running = state.downloads.filter(d => d.status === 'downloading').length;
    const content = topbar({ logo: true, brand: true, actions: '<button class="icon-btn" data-action="go-search">' + icon('search') + '</button>' })
      + '<div class="section-head"><h2>下载 <span class="sub">' + (running ? running + ' 个进行中' : '离线缓存') + '</span></h2>'
      + '<button class="link" data-action="dl-manage-toggle">' + (state.dlManage ? '完成' : '管理') + '</button>'
      + '<button class="link" data-action="refresh-downloads">' + icon('refresh') + ' 刷新</button></div>'
      + (state.dlManage && state.downloads.length ? '<div class="dl-bulk"><span>已选 ' + state.dlSelected.size + ' 本</span><button data-action="dl-select-all">全选</button><button data-action="export-selected" class="primary">导出所选</button></div>' : '')
      + '<div class="card" style="padding:14px 16px"><div class="storage-line">' + icon('folder')
      + '<span>已用 <b>' + fmtBytes(state.storage.bytes) + '</b> · 剩余 ' + fmtBytes(state.storage.free) + '</span></div>'
      + '<div style="font-size:10px;color:var(--faint);margin-top:5px">下载保存在应用私有目录，卸载应用会一并清除。</div></div>'
      + '<div id="dl-list">' + downloadsListHtml() + '</div>';
    return { html: shell(content, 'downloads'), tab: 'downloads' };
  }
  function downloadsListHtml() {
    if (!state.downloads.length) {
      return '<div class="empty"><div class="e-icon">' + icon('download') + '</div><h3>还没有下载</h3>'
        + '<p>在作品详情页点「下载」，下载完成后即使断网也能读。</p>'
        + '<button class="btn btn-primary" data-action="go-home">去发现</button></div>';
    }
    return state.downloads.map(item => {
      const selected = state.dlSelected.has(item.key);
      const target = item.target || (item.limit > 0
        ? Math.min(item.limit, item.downloadable || item.total || 0)
        : (item.downloadable || item.total || 0));
      const done = item.done || 0;
      const pct = target ? Math.min(100, Math.round(done * 100 / target)) : 0;
      const st = statusOf(item);
      const title = item.titleZh || item.titleJp || '未命名作品';
      const limitText = (item.rangeStart > 1 || (item.rangeEnd > 0 && item.rangeEnd < (item.total || 0)))
        ? ('第 ' + (item.rangeStart || 1) + '-' + (item.rangeEnd || '末') + ' 章')
        : (item.limit > 0 ? '计划前 ' + item.limit + ' 章' : '整本');
      return '<div class="dl-card ' + (selected ? 'selected' : '') + '" data-action="dl-card" data-key="' + esc(item.key) + '">'
        + (state.dlManage ? '<button class="dl-check ' + (selected ? 'on' : '') + '" data-action="dl-select" data-key="' + esc(item.key) + '">' + (selected ? icon('check') : '') + '</button>' : '')
        + '<div class="dl-top">' + coverHtml(title, { cat: (PROVIDERS[item.providerId] || {}).short || '' })
        + '<div class="dl-info"><h3>' + esc(title) + '</h3><p><span>' + esc(item.author || '') + '</span><span>' + limitText + '</span><span>' + fmtBytes(item.bytes || 0) + '</span></p></div>'
        + '<span class="status-pill ' + st.cls + '">' + st.label + '</span></div>'
        + '<div class="dl-progress"><div class="dl-bar"><i style="width:' + pct + '%"></i></div>'
        + '<div class="dl-nums"><span>' + done + ' / ' + target + ' 章</span><span>' + pct + '%</span></div></div>'
        + (item.error ? '<div style="font-size:10px;color:var(--danger);margin-top:6px">' + esc(item.error) + '</div>' : '')
        + (state.dlManage ? '' : '<div class="dl-actions">' + downloadActions(item, st) + '</div>') + '</div>';
    }).join('') + '<div style="text-align:center;font-size:10px;color:var(--faint);padding:14px 0">下载任务在后台继续，退出应用后进度会保留。</div>';
  }
  function statusOf(item) {
    if (item.status === 'downloading') return { cls: 'run', label: '下载中' };
    if (item.status === 'done') return { cls: 'done', label: '已完成' };
    if (item.status === 'error') return { cls: 'error', label: '失败' };
    if (item.status === 'paused') return { cls: '', label: '已暂停' };
    return { cls: '', label: item.status || '等待中' };
  }
  function downloadActions(item, st) {
    let html = '';
    if (item.status === 'downloading') {
      html += '<button class="btn btn-ghost" data-action="pause-dl" data-key="' + esc(item.key) + '">' + icon('pause') + '暂停</button>';
    } else if (item.status === 'done') {
      html += '<button class="btn btn-primary" data-action="read-dl" data-key="' + esc(item.key) + '">' + icon('play') + '阅读</button>';
    } else {
      html += '<button class="btn btn-primary" data-action="resume-dl" data-key="' + esc(item.key) + '">' + icon('download') + (item.status === 'error' ? '重试' : '继续') + '</button>';
    }
    html += '<button class="btn btn-ghost" data-action="delete-dl" data-key="' + esc(item.key) + '">' + icon('trash') + '删除</button>';
    if (item.status !== 'done') html += '<button class="btn btn-ghost" data-action="open-dl-book" data-key="' + esc(item.key) + '">详情</button>';
    return html;
  }
  function updateDownloadsDom() {
    const list = $('#dl-list');
    if (list) list.innerHTML = downloadsListHtml();
    const storage = $('.storage-line');
    if (storage) storage.innerHTML = icon('folder') + '<span>已用 <b>' + fmtBytes(state.storage.bytes) + '</b> · 剩余 ' + fmtBytes(state.storage.free) + '</span>';
    const sub = $('.section-head .sub');
    if (sub) {
      const running = state.downloads.filter(d => d.status === 'downloading').length;
      sub.textContent = running ? running + ' 个进行中' : '离线缓存';
    }
  }
  function dlByKey(key) { return state.downloads.find(x => x.key === key); }
  function openDownloaded(key) {
    const item = dlByKey(key);
    if (!item) return;
    const raw = sync(() => native.meta(key), '');
    let meta = null;
    try { meta = JSON.parse(raw || 'null'); } catch (e) {}
    if (!meta) { toast('书籍数据缺失，请重新下载'); return; }
    const toc = Array.isArray(meta.toc) ? meta.toc : [];
    const p = progress[key];
    let idx = -1;
    if (p && p.chapterId) idx = toc.findIndex(x => x && x.chapterId === p.chapterId);
    if (idx < 0) idx = toc.findIndex(x => x && x.chapterId);
    if (idx < 0) { toast('暂无可读章节'); return; }
    try { sessionStorage.setItem('novel:' + key, JSON.stringify(meta)); } catch (e) {}
    const ch = toc[idx];
    openReader(item.providerId, item.novelId, ch.chapterId, idx, ch.titleZh || ch.titleJp, key);
  }
  function openDownloadedDetail(key) {
    const item = dlByKey(key);
    if (!item) return;
    navigate('#/book/' + encodePath(item.providerId) + '/' + encodePath(item.novelId));
  }

  /* ------------------------------------------------------------------ *
   *  Settings
   * ------------------------------------------------------------------ */
  function loadAuth() {
    if (native && typeof native.authInfo === 'function') {
      const raw = sync(() => native.authInfo(), '{}');
      try { state.auth = JSON.parse(raw || '{}'); } catch (e) {}
    }
    if (!state.auth || !state.auth.loggedIn) {
      state.auth = { loggedIn: false, user: '', canR18: false, ageDays: 0 };
      if (state.r18) { state.r18 = false; saveJSON('nr.r18', false); }
    }
    return state.auth;
  }
  function saveR18(value) {
    state.r18 = !!value;
    saveJSON('nr.r18', state.r18);
  }
  function r18Chip() {
    return '<button class="chip r18-chip ' + (state.r18 ? 'active' : '') + '" data-action="toggle-r18">R18</button>';
  }
  function reloadR18() {
    state.home.items = []; state.home.pageCount = 1;
    if (state.route.name === 'home') loadHome(0);
    else if (state.route.name === 'search' && (state.search.q || state.search.tags.length)) runSearch(true);
    else render();
  }
  function showR18Gate() {
    showSheet('<h2>R18 原生内容</h2>'
      + '<p class="sheet-sub">开启后会用你的原站账号请求 R18 书目，原生阅读器同样支持下载和离线。账号需满足原站 R18 权限（通常注册满 30 天）。</p>'
      + '<div class="notice">' + icon('alert') + '<span>仅限年满 18 周岁的用户。请确认你已成年，并遵守所在地法律法规。</span></div>'
      + '<label class="check-row"><input type="checkbox" id="r18-ok"><span>我已年满 18 周岁，自愿开启 R18 内容</span></label>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
      + '<button class="btn btn-primary" data-action="confirm-r18">确认开启</button></div>');
  }
  function showLoginSheet() {
    loadAuth();
    const a = state.auth;
    if (a.loggedIn) {
      showSheet('<h2>原站账号</h2><p class="sheet-sub">已登录：' + esc(a.user || '') + ' · 注册约 ' + (a.ageDays || 0) + ' 天</p>'
        + '<div class="notice">' + icon('info') + '<span>R18 是否可见由原站服务端权限决定；本应用只携带你的登录令牌，不绕过审核。</span></div>'
        + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">关闭</button>'
        + '<button class="btn btn-danger" data-action="logout-account">退出登录</button></div>');
      return;
    }
    showSheet('<h2>登录原站账号</h2>'
      + '<p class="sheet-sub">登录后可在原生界面访问 R18 书目。账号需满足原站权限，通常要求注册满 30 天。</p>'
      + '<div class="field"><label>用户名或邮箱</label><input id="login-user" autocomplete="username" placeholder="用户名 / 邮箱"></div>'
      + '<div class="field" style="margin-top:8px"><label>密码</label><input id="login-pass" type="password" autocomplete="current-password" placeholder="密码"></div>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
      + '<button class="btn btn-primary" id="login-btn" data-action="login-submit">登录</button></div>'
      + '<div class="note" style="text-align:center">没有账号？<button data-action="login-web" style="color:var(--primary)">去网页版注册 / 找回密码</button></div>');
  }
  function loadProxy() {
    if (native && typeof native.proxyGet === 'function') {
      const raw = sync(() => native.proxyGet(), '{}');
      try { state.proxy = JSON.parse(raw || '{}'); } catch (e) {}
    }
    if (native && typeof native.relayGet === 'function') {
      state.relay = sync(() => native.relayGet(), 'auto') || 'auto';
    }
  }
  function feedbackFormHtml() {
    return '<h2>问题反馈</h2>'
      + '<p class="sheet-sub">反馈会提交到 GitHub Issues；不会自动上传书架或阅读内容。</p>'
      + '<div class="feedback-form">'
      + '<label>类型<select id="feedback-type">'
      + '<option value="bug">Bug / 闪退</option>'
      + '<option value="feature">功能建议</option>'
      + '<option value="content">内容 / 章节问题</option>'
      + '<option value="other">其他</option>'
      + '</select></label>'
      + '<label>描述<textarea id="feedback-text" rows="5" maxlength="4000" placeholder="发生了什么？怎么复现？期望是什么？"></textarea></label>'
      + '<label>联系方式（可选）<input id="feedback-contact" placeholder="邮箱 / QQ / GitHub 用户名" maxlength="120"></label>'
      + '<label class="feedback-check"><input id="feedback-diagnostics" type="checkbox" checked> 附带版本、页面和 Android/WebView 信息</label>'
      + '</div>'
      + '<div class="sheet-actions">'
      + '<button class="btn btn-primary btn-block" data-action="submit-feedback">打开 GitHub 提交</button>'
      + '<button class="btn btn-ghost btn-block" data-action="copy-feedback">复制反馈内容</button>'
      + '<button class="btn btn-ghost btn-block" data-action="close-sheet">取消</button>'
      + '</div>';
  }
  function feedbackPayload() {
    const typeEl = $('#feedback-type');
    const textEl = $('#feedback-text');
    const contactEl = $('#feedback-contact');
    const diagEl = $('#feedback-diagnostics');
    const type = typeEl ? typeEl.value : 'other';
    const desc = textEl ? String(textEl.value || '').trim() : '';
    const contact = contactEl ? String(contactEl.value || '').trim() : '';
    const labels = { bug: 'Bug / 闪退', feature: '功能建议', content: '内容 / 章节问题', other: '其他' };
    if (desc.length < 5) return { error: '请至少写 5 个字描述问题' };
    let body = '## 类型\n' + (labels[type] || '其他') + '\n\n## 描述\n' + desc + '\n';
    if (contact) body += '\n## 联系方式\n' + contact + '\n';
    if (!diagEl || diagEl.checked) {
      const version = sync(() => native && native.version ? native.version() : '', '未知');
      const route = state.route ? state.route.name : '未知';
      const ua = navigator.userAgent || '';
      body += '\n## 环境\n- App: ' + version + '\n- 页面: ' + route + '\n- Android/WebView: ' + ua + '\n';
    }
    body += '\n---\n由 Novelia 内反馈模块生成';
    const summary = desc.split('\n')[0].slice(0, 48);
    const title = '[反馈] ' + (labels[type] || '其他') + (summary ? '：' + summary : '');
    return { title: title, body: body, text: title + '\n\n' + body };
  }
  function openForum() {
    const url = 'https://forum.novelia.cc/c/novel';
    try {
      if (native && native.openWeb) native.openWeb(url);
      else if (native && native.openExternal) native.openExternal(url);
      else window.open(url, '_blank');
    } catch (e) { toast('无法打开论坛'); }
  }
  function openFeedback() { showSheet(feedbackFormHtml()); }
  function submitFeedback() {
    const p = feedbackPayload();
    if (p.error) { toast(p.error); return; }
    const url = 'https://github.com/chlu7476-cpu/novelia-reader/issues/new?title=' + encodeURIComponent(p.title) + '&body=' + encodeURIComponent(p.body);
    try {
      if (native && native.openExternal) native.openExternal(url);
      else window.open(url, '_blank');
      closeSheet();
      toast('已打开 GitHub，登录后点 Submit 提交');
    } catch (e) { toast('无法打开浏览器'); }
  }
  async function sendFeedbackServer() {
    const p = feedbackPayload();
    if (p.error) { toast(p.error); return; }
    const typeEl = $('#feedback-type'); const contactEl = $('#feedback-contact');
    try {
      const r = await fetch(ONLINE_API + '/v1/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: typeEl ? typeEl.value : 'other', text: p.body, contact: contactEl ? contactEl.value : '', version: sync(() => native && native.version ? native.version() : '', ''), page: state.route ? state.route.name : '' })
      });
      if (!r.ok) throw new Error('服务器返回 ' + r.status);
      closeSheet(); toast('反馈已发送，谢谢');
    } catch (e) { toast(e.message || '发送失败，可改用 GitHub'); }
  }
  function copyFeedback() {
    const p = feedbackPayload();
    if (p.error) { toast(p.error); return; }
    try {
      if (native && native.copyText) native.copyText(p.text);
      else if (navigator.clipboard) navigator.clipboard.writeText(p.text);
      toast('反馈内容已复制');
    } catch (e) { toast('复制失败'); }
  }
  function maybeShowNotice(notice) {
    if (!notice || !notice.id) return false;
    let seen = '';
    try { seen = localStorage.getItem('nr.noticeSeen') || ''; } catch (e) {}
    if (seen === notice.id) return false;
    showSheet('<h2>' + esc(notice.title || '网络提示') + '</h2>'
      + '<div class="notice-box">' + esc(notice.message || '').replace(/\n/g, '<br>') + '</div>'
      + '<div class="sheet-actions"><button class="btn btn-primary btn-block" data-action="dismiss-notice" data-id="' + esc(notice.id) + '">' + esc(notice.button || '我知道了') + '</button></div>');
    return true;
  }
  const ONLINE_API = 'https://novelia-api.gainful-mantis.workers.dev';
  function onlineInstallId() {
    let id = '';
    try { id = localStorage.getItem('nr.installId') || ''; } catch (e) {}
    if (!id) {
      try { id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)); } catch (e) { id = 'n' + Date.now().toString(36); }
      try { localStorage.setItem('nr.installId', id); } catch (e) {}
    }
    return id;
  }
  function sendHeartbeat() {
    try {
      fetch(ONLINE_API + '/v1/heartbeat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: onlineInstallId(), v: sync(() => native && native.version ? native.version() : '', ''), p: 'android' }), cache: 'no-store'
      }).catch(function () {});
    } catch (e) {}
  }
  async function loadOnline() {
    if (state.online.loading) return;
    state.online.loading = true;
    const el = $('#online-count'); if (el) el.textContent = '正在获取…';
    try {
      const r = await fetch(ONLINE_API + '/v1/stats?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      state.online.count = Number(j.online) || 0; state.online.error = '';
    } catch (e) { state.online.error = e.message || '暂时无法获取'; }
    state.online.loading = false;
    const el2 = $('#online-count');
    if (el2) el2.textContent = state.online.error ? '暂时无法获取' : ('最近 5 分钟约 ' + (state.online.count || 0) + ' 人在线');
  }
  async function checkAppUpdate(manual) {
    if (state.appUpdate.checking) return;
    state.appUpdate.checking = true;
    if (manual) toast('正在检查更新…');
    try {
      const raw = await invoke('updateInfo');
      const info = JSON.parse(raw);
      if (!info.hasUpdate) {
        maybeShowNotice(info.notice);
        if (manual) toast('已是最新版本 ' + (info.currentName || ''));
        return;
      }
      state.pendingUpdate = info;
      showSheet(appUpdateSheet(info));
    } catch (e) {
      if (manual) toast(e.message || '检查更新失败');
    } finally {
      state.appUpdate.checking = false;
    }
  }
  function appUpdateSheet(info) {
    const notes = esc(info.notes || '修复问题并改进体验。').replace(/\n/g, '<br>');
    const size = info.size ? fmtBytes(info.size) : '约 117 KB';
    const forced = !!info.force || (!!info.minVersionCode && Number(info.currentCode || 0) < Number(info.minVersionCode));
    return '<h2>' + (forced ? '必须更新' : '发现新版本 ') + esc(info.versionName || '') + '</h2>'
      + '<p class="sheet-sub">当前 ' + esc(info.currentName || '') + ' · 新版本 ' + size + '</p>'
      + (forced ? '<div class="update-notes">当前版本过低，必须更新后才能继续使用。</div>' : '')
      + '<div class="update-notes">' + notes + '</div>'
      + '<div class="sheet-actions"><button class="btn btn-primary btn-block" id="app-update-btn" data-action="do-app-update">下载并安装</button>'
      + (forced ? '' : '<button class="btn btn-ghost btn-block" data-action="close-sheet">稍后</button>') + '</div>';
  }
  function maybeAutoCheckUpdate() {
    if (state.locked || state.autoUpdateChecked) return;
    state.autoUpdateChecked = true;
    checkAppUpdate(false);
  }
  function settingsView() {
    const p = state.proxy || {};
    const test = state.proxyResult;
    const content = topbar({ logo: true, brand: true })
      + '<div class="section-head"><h2>我的</h2></div>'
      + '<div class="setting-group"><h3>外观</h3><div class="setting-card">'
      + '<div class="setting-row"><div class="si">' + icon(settings.theme === 'dark' ? 'moon' : 'sun') + '</div><div class="st"><b>应用主题</b><span>跟随系统，或固定浅色 / 深色</span></div></div>'
      + '<div style="padding:0 15px 14px"><div class="segmented" data-seg="theme">'
      + ['auto', 'light', 'dark'].map(v => '<button data-action="set-theme" data-value="' + v + '" class="' + (settings.theme === v ? 'active' : '') + '">' + ({ auto: '跟随系统', light: '浅色', dark: '深色' }[v]) + '</button>').join('')
      + '</div></div>'
      + '<div class="setting-row"><div class="si">' + icon('list') + '</div><div class="st"><b>简洁模式</b><span>隐藏首页大图，扁平列表，减少装饰和动画</span></div><button class="switch ' + (settings.simpleMode ? 'on' : '') + '" data-action="toggle-simple-mode"></button></div>'
      + '</div></div>'

      + '<div class="setting-group"><h3>阅读</h3><div class="setting-card">'
      + settingRow('type', '默认阅读设置', readerSummary(), 'open-reader-settings', 'chevron')
      + settingRow('book', '书架与进度', shelf.length + ' 本收藏 · ' + Object.keys(progress).length + ' 本有进度', 'go-shelf', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>书架与订阅</h3><div class="setting-card">'
      + '<div class="setting-row"><div class="si">' + icon('bookmark') + '</div><div class="st"><b>收藏自动订阅</b><span>收藏新书时默认检查新章节</span></div><button class="switch ' + (settings.autoSubscribe !== false ? 'on' : '') + '" data-action="toggle-auto-subscribe"></button></div>'
      + '<div class="setting-row"><div class="si">' + icon('refresh') + '</div><div class="st"><b>自动检查订阅</b><span>启动时检查已订阅书籍的新章节</span></div><button class="switch ' + (settings.autoCheckShelf !== false ? 'on' : '') + '" data-action="toggle-auto-check"></button></div>'
      + '<div class="setting-row"><div class="si">' + icon('download') + '</div><div class="st"><b>自动下载新增章节</b><span>只下载新增部分，不动已有缓存</span></div><button class="switch ' + (settings.autoDownloadNew ? 'on' : '') + '" data-action="toggle-auto-download"></button></div>'
      + settingRow('star', '阅读统计', '阅读时长、章节、趋势和年度报告', 'go-stats', 'chevron')
      + '</div></div>'
      + '<div class="setting-group"><h3>账号</h3><div class="setting-card">'
      + settingRow('user', state.auth.loggedIn ? '已登录' : '登录原站账号', state.auth.loggedIn ? (state.auth.user + ' · 注册约 ' + (state.auth.ageDays || 0) + ' 天') : '登录后可开启 R18 原生阅读；账号需满足原站权限', 'open-login', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>隐私</h3><div class="setting-card">'
      + settingRow('user', state.privacy.hasPin ? '隐私锁已开启' : '隐私锁未开启', state.privacy.hasPin ? '冷启动需要 PIN；可隐藏最近任务和截图' : '设置 PIN，避免别人打开你的书架', 'open-privacy', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>备份与恢复</h3><div class="setting-card">'
      + settingRow('download', '导出备份', '书架、阅读进度、搜索记录、阅读设置和 R18 开关', 'export-backup', 'chevron')
      + settingRow('folder', '恢复备份', '从 Novelia JSON 备份恢复；不包含已下载章节和登录令牌', 'import-backup', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>社区</h3><div class="setting-card">'
      + settingRow('forum', '小说讨论区', '官方论坛，登录后可发主题、回复和讨论', 'open-forum', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>网页版</h3><div class="setting-card">'
      + settingRow('external', '网页版（含 R18）', '登录原站账号查看完整内容；进入前需确认已满 18 周岁', 'open-web-gate', 'chevron')
      + '</div></div>'

      + '<div class="setting-group"><h3>网络线路</h3><div class="setting-card">'
      + '<div class="setting-row"><div class="si">' + icon('cloud') + '</div><div class="st"><b>只读加速</b><span>直连失败时，通过第三方文本代理 r.jina.ai 读取目录和正文。</span><span style="color:var(--faint)">仅传输公开小说文本，不代理登录、图片或 R18 内容。</span></div></div>'
      + '<div style="padding:0 15px 14px"><div class="segmented" data-seg="relay">'
      + [['auto', '自动'], ['on', '强制开启'], ['off', '关闭']].map(x => '<button data-action="set-relay" data-value="' + x[0] + '" class="' + (state.relay === x[0] ? 'active' : '') + '">' + x[1] + '</button>').join('')
      + '</div><div class="note">自动模式会先直连，失败后再切换到只读加速；速度较慢，适合临时阅读，不建议大批量下载。</div></div></div></div>'

      + '<div class="setting-group"><h3>代理</h3><div class="setting-card">'
      + '<div class="setting-row"><div class="si">' + icon('wifi') + '</div><div class="st"><b>代理设置</b><span>如你有自己的 HTTP / SOCKS5 代理，可在这里填写；系统全局 VPN 通常无需填写。</span></div></div>'
      + '<div class="proxy-form">'
      + '<div class="field"><label>代理类型</label><select id="proxy-mode">'
      + '<option value="none"' + (p.mode === 'none' || !p.mode ? ' selected' : '') + '>不使用代理</option>'
      + '<option value="http"' + (p.mode === 'http' ? ' selected' : '') + '>HTTP / HTTPS</option>'
      + '<option value="socks"' + (p.mode === 'socks' ? ' selected' : '') + '>SOCKS5</option>'
      + '</select></div>'
      + '<div class="field-row"><div class="field"><label>主机</label><input id="proxy-host" placeholder="127.0.0.1" value="' + esc(p.host || '') + '"></div>'
      + '<div class="field" style="max-width:100px"><label>端口</label><input id="proxy-port" inputmode="numeric" placeholder="7890" value="' + esc(p.port || '') + '"></div></div>'
      + '<div class="proxy-actions"><button class="btn btn-ghost" data-action="save-proxy">保存</button>'
      + '<button class="btn btn-primary" data-action="test-proxy" ' + (state.proxyTesting ? 'disabled' : '') + '>' + (state.proxyTesting ? '<span class="spin"></span> 测试中' : '测试连接') + '</button></div>'
      + '<div id="proxy-result" class="test-result ' + (test ? 'show ' + (test.ok ? 'ok' : 'bad') : '') + '">' + (test ? esc(test.message || '') : '') + '</div>'
      + '<div class="note">说明：本应用不提供 VPN 或网络接入服务；只读加速只是文本代理，仅用于公开小说内容。请使用你自己的网络工具访问原站，并遵守当地网络规定。</div>'
      + '</div></div></div>'

      + '<div class="setting-group"><h3>存储</h3><div class="setting-card">'
      + '<div class="setting-row"><div class="si">' + icon('folder') + '</div><div class="st"><b>下载占用</b><span>' + fmtBytes(state.storage.bytes) + ' · 剩余 ' + fmtBytes(state.storage.free) + '</span></div>'
      + '<button class="btn btn-sm btn-danger" data-action="clear-downloads">清空</button></div>'
      + '</div></div>'

      + '<div class="setting-group"><h3>关于</h3><div class="setting-card"><div class="about-card">'
      + '<div class="logo">N</div><b>Novelia 阅读</b>'
      + '<p>非官方第三方客户端 · 版本 ' + esc(sync(() => native && native.version ? native.version() : '1.6.6', '1.0.1')) + '</p>'
      + '<p>内容来自 <span style="color:var(--primary)">轻小说机翻机器人</span>。本应用只提供阅读与缓存工具，不存储、不传播作品内容，版权归原作者与站点所有。</p>'
      + '<div class="divider"></div>'
      + '<button class="setting-row" style="width:100%;text-align:left" data-action="refresh-usage">'
      + '<div class="si">' + icon('user') + '</div><div class="st"><b>使用人数</b><span id="usage-count">正在获取…</span></div>'
      + '<div class="sv">' + icon('refresh') + '</div></button>'
      + '<div class="note" style="text-align:left;margin:8px 0 0">按首次安装匿名计数，不收集账号或阅读内容；公开计数器可能被刷，仅作参考。</div>'
      + '<button class="setting-row" style="width:100%;text-align:left" data-action="refresh-online">'
      + '<div class="si">' + icon('wifi') + '</div><div class="st"><b>在线人数</b><span id="online-count">点击刷新</span></div>'
      + '<div class="sv">' + icon('refresh') + '</div></button>'
      + '<button class="setting-row" style="width:100%;text-align:left" data-action="check-app-update">'
      + '<div class="si">' + icon('download') + '</div><div class="st"><b>检查更新</b><span>当前 ' + esc(sync(() => native && native.version ? native.version() : '1.6.6', '1.5.0')) + '</span></div>'
      + '<div class="sv">' + icon('right') + '</div></button>'
      + '<button class="setting-row" style="width:100%;text-align:left" data-action="open-feedback">'
      + '<div class="si">' + icon('edit') + '</div><div class="st"><b>问题反馈</b><span>Bug、建议、内容问题，提交到 GitHub Issues</span></div>'
      + '<div class="sv">' + icon('right') + '</div></button>'
      + '<div class="divider"></div>'
      + '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
      + '<button class="btn btn-sm btn-ghost" data-action="open-site">访问原站</button>'
      + '<button class="btn btn-sm btn-ghost" data-action="share-app">分享应用</button>'
      + '<button class="btn btn-sm btn-ghost" data-action="exit-app">退出</button>'
      + '</div></div></div></div>'
      + '<div style="height:10px"></div>';
    setTimeout(loadUsage, 80);
    return { html: shell(content, 'settings'), tab: 'settings' };
  }
  async function loadUsage(force) {
    const u = state.usage;
    if (u.loading) return;
    u.loading = true;
    const el = $('#usage-count');
    if (el) el.textContent = '正在获取…';
    try {
      const raw = await invoke('usageCount');
      const j = JSON.parse(raw);
      u.count = Number(j.count) || 0;
      u.error = '';
    } catch (e) {
      u.error = e.message || '暂时无法获取';
    }
    u.loading = false;
    const el2 = $('#usage-count');
    if (el2) el2.textContent = u.error ? '暂时无法获取' : ('约 ' + (u.count || 0).toLocaleString('zh-CN') + ' 次安装');
  }
  function settingRow(ic, title, sub, action, trailing) {
    return '<button class="setting-row" style="width:100%;text-align:left" data-action="' + action + '">'
      + '<div class="si">' + icon(ic) + '</div><div class="st"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>'
      + '<div class="sv">' + (trailing === 'chevron' ? icon('right') : '') + '</div></button>';
  }
  function readerSummary() {
    const r = settings.reader;
    const mode = { zh: '中文', jp: '日文', both: '双语' }[r.mode] || '中文';
    const theme = { paper: '纸白', sepia: '米黄', green: '护眼', dark: '夜间' }[r.theme] || '纸白';
    return mode + ' · ' + theme + ' · ' + r.fontSize + 'px';
  }
  function makeBackup() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
    return {
      filename: 'Novelia-Backup-' + stamp + '.json',
      json: JSON.stringify({
        app: 'novelia-reader',
        version: 1,
        exportedAt: now.toISOString(),
        data: {
          shelf: shelf,
          progress: progress,
          recent: recent,
          settings: settings,
          bookmarks: loadJSON('nr.bookmarks', {}) || {},
          r18: !!state.r18
        }
      })
    };
  }
  async function exportBackup() {
    try {
      saveSettings();
      const b = makeBackup();
      await invoke('exportBackup', b.json, b.filename);
      toast('备份已导出');
    } catch (e) {
      if (e.message !== '已取消') toast('导出失败：' + (e.message || '未知错误'));
    }
  }
  async function importBackup() {
    let text;
    try {
      text = await invoke('importBackup');
    } catch (e) {
      if (e.message !== '已取消') toast('读取失败：' + (e.message || '未知错误'));
      return;
    }
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast('不是有效的 JSON 备份'); return; }
    if (!obj || obj.app !== 'novelia-reader' || !obj.data || typeof obj.data !== 'object') {
      toast('这不是 Novelia 阅读的备份文件');
      return;
    }
    const d = obj.data;
    const shelfCount = Array.isArray(d.shelf) ? d.shelf.length : 0;
    const progCount = d.progress && typeof d.progress === 'object' ? Object.keys(d.progress).length : 0;
    const ok = await confirmDialog('恢复备份', '将恢复 ' + shelfCount + ' 本收藏、' + progCount + ' 本阅读进度，并覆盖当前阅读设置。已下载章节不会删除。', '恢复', true);
    if (!ok) return;
    shelf = Array.isArray(d.shelf) ? d.shelf.filter(x => x && x.key && x.provider && x.novel) : [];
    progress = d.progress && typeof d.progress === 'object' ? d.progress : {};
    recent = Array.isArray(d.recent) ? d.recent.filter(x => typeof x === 'string').slice(0, 20) : [];
    if (d.settings && typeof d.settings === 'object') {
      const raw = d.settings;
      const theme = ['auto', 'light', 'dark'].indexOf(raw.theme) >= 0 ? raw.theme : 'auto';
      settings = {
        theme: theme,
        wifiOnly: raw.wifiOnly !== false,
        reader: Object.assign({}, DEFAULT_SETTINGS.reader, raw.reader && typeof raw.reader === 'object' ? raw.reader : {})
      };
      saveSettings();
    }
    saveJSON('nr.shelf', shelf);
    saveJSON('nr.progress', progress);
    saveJSON('nr.recent', recent);
    saveJSON('nr.bookmarks', d.bookmarks && typeof d.bookmarks === 'object' ? d.bookmarks : {});
    loadAuth();
    state.r18 = !!d.r18 && state.auth.loggedIn;
    saveJSON('nr.r18', state.r18);
    applyTheme();
    toast('恢复成功，正在刷新');
    setTimeout(() => location.reload(), 550);
  }

  function showReaderSettings() {
    const r = settings.reader;
    const modes = [['zh', '译文'], ['jp', '原文'], ['both', '双语']];
    const themes = [['paper', '纸白'], ['sepia', '米黄'], ['green', '护眼'], ['dark', '夜间']];
    const engines = [['auto', '自动选择'], ['sakura', 'Sakura'], ['gpt', 'GPT'], ['youdao', '有道'], ['baidu', '百度']];
    const html = '<h2>阅读设置</h2><p class="sheet-sub">会应用到之后打开的所有章节。</p>'
      + '<div class="setting-group"><h3>显示</h3><div class="segmented" style="margin-bottom:10px">'
      + modes.map(m => '<button data-action="rs-mode" data-value="' + m[0] + '" class="' + (r.mode === m[0] ? 'active' : '') + '">' + m[1] + '</button>').join('') + '</div>'
      + '<div class="field"><label>译文引擎</label><select id="rs-engine">' + engines.map(e => '<option value="' + e[0] + '"' + (r.engine === e[0] ? ' selected' : '') + '>' + e[1] + '</option>').join('') + '</select></div></div>'
      + '<div class="setting-group"><h3>排版</h3>'
      + '<div class="setting-row" style="padding:0 0 10px;border:0"><div class="st"><b>字号</b><span><span id="fs-label">' + r.fontSize + '</span> px</span></div></div>'
      + '<input id="rs-font-size" type="range" min="15" max="28" step="1" value="' + r.fontSize + '" style="width:100%">'
      + '<div class="setting-row" style="padding:12px 0 10px;border:0"><div class="st"><b>行距</b><span><span id="lh-label">' + r.lineHeight + '</span> 倍</span></div></div>'
      + '<input id="rs-line-height" type="range" min="1.5" max="2.4" step="0.05" value="' + r.lineHeight + '" style="width:100%">'
      + '<div class="setting-row" style="padding:12px 0 10px;border:0"><div class="st"><b>衬线字体</b><span>更接近纸书排版</span></div><button class="switch ' + (r.serif ? 'on' : '') + '" data-action="rs-serif" aria-label="切换衬线字体"></button></div>'
      + '</div>'
      + '<div class="setting-group"><h3>翻页与显示</h3>'
      + '<div class="field"><label>翻页动画</label><select id="rs-animation">'
      + [['slide', '滑动翻页'], ['fade', '淡入翻页'], ['none', '无动画']].map(a => '<option value="' + a[0] + '"' + ((r.animation || 'slide') === a[0] ? ' selected' : '') + '>' + a[1] + '</option>').join('')
      + '</select></div>'
      + '<div class="setting-row" style="padding:10px 0 4px;border:0"><div class="st"><b>亮度</b><span id="rs-bright-label">' + (r.brightness > 0 ? Math.round(r.brightness * 100) + '%' : '跟随系统') + '</span></div></div>'
      + '<input id="rs-brightness" type="range" min="0" max="100" step="5" value="' + (r.brightness > 0 ? Math.round(r.brightness * 100) : 0) + '" style="width:100%">'
      + '<div class="setting-row" style="padding:6px 0 10px;border:0"><div class="st"><b>屏幕常亮</b><span>阅读时不清屏</span></div><button class="switch ' + (r.keepAwake !== false ? 'on' : '') + '" data-action="rs-awake" aria-label="切换屏幕常亮"></button></div>'
      + '</div>'
      + '<div class="setting-group"><h3>纸张</h3><div class="theme-swatches">'
      + themes.map(t => '<button class="swatch sw-' + t[0] + (r.theme === t[0] ? ' active' : '') + '" data-action="rs-theme" data-value="' + t[0] + '"><span></span>' + t[1] + '</button>').join('') + '</div></div>'
      + '<div class="sample-box" id="rs-sample" style="font-size:' + r.fontSize + 'px;line-height:' + r.lineHeight + ';font-family:' + (r.serif ? 'var(--serif)' : 'var(--font)') + '">　窗外的光线落在桌面上，空气里有一点纸张和咖啡的味道。</div>'
      + '<div class="sheet-actions"><button class="btn btn-primary btn-block" data-action="close-sheet">完成</button></div>';
    showSheet(html);
  }
  function setReaderSetting(k, v) {
    settings.reader[k] = v;
    saveSettings();
    const sample = $('#rs-sample');
    if (sample) {
      sample.style.fontSize = settings.reader.fontSize + 'px';
      sample.style.lineHeight = settings.reader.lineHeight;
      sample.style.fontFamily = settings.reader.serif ? 'var(--serif)' : 'var(--font)';
    }
  }
  async function saveProxyFromForm(silent) {
    const mode = ($('#proxy-mode') || {}).value || 'none';
    const host = ($('#proxy-host') || {}).value || '';
    const port = ($('#proxy-port') || {}).value || '';
    if (mode !== 'none' && (!host.trim() || !/^\d+$/.test(port.trim()))) {
      if (!silent) toast('请填写代理主机和端口');
      return false;
    }
    if (native && native.proxySet) {
      try { native.proxySet(mode, host.trim(), port.trim()); } catch (e) { toast('保存失败'); return false; }
    }
    state.proxy = { mode: mode, host: host.trim(), port: port.trim() };
    state.proxyResult = null;
    if (!silent) toast('代理设置已保存');
    return true;
  }
  async function testProxy() {
    if (state.proxyTesting) return;
    if (!(await saveProxyFromForm(true))) { toast('请先填写有效的代理地址'); return; }
    state.proxyTesting = true;
    state.proxyResult = null;
    render();
    try {
      const body = await invoke('testProxy');
      let r;
      try { r = JSON.parse(body); } catch (e) { r = { ok: true, message: String(body) }; }
      state.proxyResult = r;
    } catch (e) {
      state.proxyResult = { ok: false, message: e.message || '连接失败' };
    }
    state.proxyTesting = false;
    if (state.route.name === 'settings') render();
  }

  function showAgeGate(url) {
    state.webUrl = url || 'https://books.fishhawk.top/';
    showSheet('<h2>成人内容确认</h2>'
      + '<p class="sheet-sub">网页版会打开轻小说机翻机器人原站，可直接登录账号。R18 内容是否可见由原站账号权限决定，本应用不会绕过站点审核。</p>'
      + '<div class="notice">' + icon('alert') + '<span>R18 内容仅限年满 18 周岁的用户。请确认你已成年，并遵守所在地法律法规；未满 18 岁请勿继续。</span></div>'
      + '<label class="check-row"><input type="checkbox" id="age-ok"><span>我已年满 18 周岁，自愿访问成人内容</span></label>'
      + '<div class="sheet-actions"><button class="btn btn-ghost" data-action="close-sheet">取消</button>'
      + '<button class="btn btn-primary" data-action="confirm-web">进入网页版</button></div>');
  }

  /* ------------------------------------------------------------------ *
   *  Sheets / toast / confirm
   * ------------------------------------------------------------------ */
  function showSheet(html) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<div class="grab"></div><button class="sheet-x" data-action="close-sheet" aria-label="关闭">×</button>' + html;
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    scrim.addEventListener('click', closeSheet);
    requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
    state.sheet = { scrim: scrim, sheet: sheet };
  }
  function closeSheet() {
    if (!state.sheet) return;
    const s = state.sheet;
    state.sheet = null;
    s.scrim.classList.remove('show');
    s.sheet.classList.remove('show');
    setTimeout(() => { try { s.scrim.remove(); s.sheet.remove(); } catch (e) {} }, 280);
  }
  function confirmDialog(title, message, okText, danger) {
    return new Promise(resolve => {
      closeConfirm();
      const wrap = document.createElement('div');
      wrap.className = 'confirm-wrap';
      wrap.innerHTML = '<div class="confirm-card"><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p>'
        + '<div style="display:flex;gap:9px"><button class="btn btn-ghost" data-cancel style="flex:1">取消</button>'
        + '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-ok style="flex:1">' + esc(okText || '确定') + '</button></div></div>';
      document.body.appendChild(wrap);
      state.confirmEl = wrap;
      wrap.querySelector('[data-cancel]').addEventListener('click', () => { closeConfirm(); resolve(false); });
      wrap.querySelector('[data-ok]').addEventListener('click', () => { closeConfirm(); resolve(true); });
      wrap.addEventListener('click', e => { if (e.target === wrap) { closeConfirm(); resolve(false); } });
    });
  }
  function closeConfirm() {
    if (!state.confirmEl) return;
    const el = state.confirmEl;
    state.confirmEl = null;
    try { el.remove(); } catch (e) {}
  }
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ------------------------------------------------------------------ *
   *  Back button
   * ------------------------------------------------------------------ */
  window.App = {
    handleBack() {
      if (state.locked) return true;
      if (state.sheet) { closeSheet(); return true; }
      if (state.confirmEl) { closeConfirm(); return true; }
      if (state.route.name === 'home') return false;
      if (history.length > 1) { history.back(); return true; }
      location.href = 'home.html';
      return true;
    },
    onResume() {
      refreshDownloads();
      refreshStorage();
      if (state.route.name === 'downloads') { updateDownloadsDom(); }
    }
  };

  /* ------------------------------------------------------------------ *
   *  Events
   * ------------------------------------------------------------------ */
  document.addEventListener('click', async e => {
    const tab = e.target.closest('a.tab');
    if (tab) {
      const href = tab.getAttribute('href') || '';
      if (href.indexOf('home.html') === 0) return; // separate document, reliable home fallback
      e.preventDefault();
      navigate(href || '#/home');
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const key = el.getAttribute('data-key');
    if (el.hasAttribute('data-href')) {
      navigate(el.getAttribute('data-href'));
      return;
    }
    switch (action) {
      case 'go':
        navigate(el.getAttribute('data-href') || '#/home');
        break;
      case 'back':
        if (state.sheet) { closeSheet(); break; }
        if (state.route.name === 'home') { if (native && native.exit) native.exit(); }
        else if (history.length > 1) history.back();
        else location.href = 'home.html';
        break;
      case 'go-home':
        location.href = 'home.html';
        break;
      case 'go-search':
        navigate('#/search');
        break;
      case 'go-shelf':
        navigate('#/shelf');
        break;
      case 'scroll-home': {
        const list = $('#home-list');
        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'provider': {
        const p = el.getAttribute('data-provider');
        if (state.home.provider !== p) { state.home.provider = p; state.home.items = []; state.home.pageCount = 1; loadHome(0); }
        break;
      }
      case 'refresh-home':
        loadHome(0);
        break;
      case 'home-page': {
        const page = parseInt(el.getAttribute('data-page') || '0', 10) || 0;
        loadHome(Math.max(0, Math.min(state.home.pageCount - 1, page)));
        break;
      }
      case 'home-go': {
        const input = $('#home-page-input');
        const n = parseInt(input ? input.value : '1', 10) || 1;
        loadHome(Math.max(0, Math.min(state.home.pageCount - 1, n - 1)));
        break;
      }
      case 'retry-home':
        loadHome(0);
        break;
      case 'submit-search': {
        const q = (($('#search-input') || {}).value || '').trim();
        state.search.q = q;
        state.search.provider = state.search.provider || 'all';
        state.search.items = []; state.search.page = 0; state.search.done = false; state.search.ran = false;
        syncSearchUrl();
        if (q || state.search.tags.length) runSearch(true);
        else render();
        break;
      }
      case 'search-provider': {
        state.search.provider = el.getAttribute('data-provider');
        state.search.items = []; state.search.page = 0; state.search.done = false; state.search.ran = false;
        syncSearchUrl();
        if (state.search.q || state.search.tags.length) runSearch(true); else render();
        break;
      }
      case 'search-sort': {
        state.search.sort = parseInt(el.getAttribute('data-sort') || '0', 10) || 0;
        state.search.items = []; state.search.page = 0; state.search.done = false; state.search.ran = false;
        syncSearchUrl();
        if (state.search.q || state.search.tags.length) runSearch(true); else render();
        break;
      }
      case 'search-type':
        state.search.type = parseInt(el.getAttribute('data-value') || '0', 10) || 0;
        state.search.items = []; state.search.page = 0; state.search.done = false; state.search.ran = false;
        syncSearchUrl();
        if (state.search.q || state.search.tags.length) runSearch(true); else render();
        break;
      case 'search-translate':
        state.search.translate = parseInt(el.getAttribute('data-value') || '0', 10) || 0;
        state.search.items = []; state.search.page = 0; state.search.done = false; state.search.ran = false;
        syncSearchUrl();
        if (state.search.q || state.search.tags.length) runSearch(true); else render();
        break;
      case 'recent-search': {
        const q = el.getAttribute('data-q');
        state.search.q = q;
        state.search.tags = [];
        state.search.ran = false;
        syncSearchUrl();
        runSearch(true);
        break;
      }
      case 'toggle-tag':
        toggleTag(el.getAttribute('data-tag'), false);
        break;
      case 'open-tag-sheet':
        openTagSheet();
        break;
      case 'clear-tags':
        state.search.tags = [];
        state.search.ran = false;
        state.search.items = []; state.search.page = 0; state.search.done = false;
        syncSearchUrl();
        if (state.search.q) runSearch(true); else render();
        break;
      case 'tag-jump': {
        const tag = el.getAttribute('data-tag');
        if (!tag) break;
        state.search.q = '';
        state.search.provider = 'all';
        state.search.tags = [tag];
        state.search.ran = false;
        state.search.items = []; state.search.page = 0; state.search.done = false;
        navigate('#/search?p=all&t=' + encodeURIComponent(tag));
        break;
      }
      case 'open-forum':
        openForum();
        break;
      case 'open-web-gate':
        showAgeGate('https://books.fishhawk.top/');
        break;
      case 'confirm-web': {
        const cb = $('#age-ok');
        if (!cb || !cb.checked) { toast('请先确认你已年满 18 周岁'); break; }
        closeSheet();
        if (native && native.openWeb) {
          try { native.openWeb(state.webUrl || 'https://books.fishhawk.top/'); } catch (e) { toast('无法打开网页版'); }
        } else toast('请在 App 内打开网页版');
        break;
      }
      case 'search-page': {
        const page = parseInt(el.getAttribute('data-page') || '0', 10) || 0;
        runSearch(false, Math.max(0, Math.min(state.search.pageCount - 1, page)));
        break;
      }
      case 'search-go': {
        const input = $('#search-page-input');
        const n = parseInt(input ? input.value : '1', 10) || 1;
        runSearch(false, Math.max(0, Math.min(state.search.pageCount - 1, n - 1)));
        break;
      }
      case 'load-more-search':
        if (state.search.q || state.search.tags.length) runSearch(false);
        break;
      case 'retry-search':
        if (state.search.q || state.search.tags.length) runSearch(true, state.search.page || 0);
        break;
      case 'read': {
        const idx = parseInt(el.getAttribute('data-index') || '-1', 10);
        if (idx < 0 || !state.book || !state.book.toc[idx]) { toast('暂无已译章节'); break; }
        const ch = state.book.toc[idx];
        openReader(state.book._provider, state.book._novel, ch.chapterId, idx, ch.titleZh || ch.titleJp);
        break;
      }
      case 'chapter': {
        const idx = parseInt(el.getAttribute('data-index') || '-1', 10);
        if (idx < 0 || !state.book || !state.book.toc[idx]) break;
        const ch = state.book.toc[idx];
        if (!ch.chapterId) { toast('这一章还没有译文'); break; }
        openReader(state.book._provider, state.book._novel, ch.chapterId, idx, ch.titleZh || ch.titleJp);
        break;
      }
      case 'toc-more':
        state.tocLimit += 150;
        { const list = $('#toc-list'); if (list) list.innerHTML = tocListHtml(); }
        break;
      case 'intro-toggle': {
        const t = $('#intro-text');
        if (t) {
          t.classList.toggle('open');
          el.textContent = t.classList.contains('open') ? '收起' : '展开全部';
        }
        break;
      }
      case 'download-sheet':
        downloadSheet();
        break;
      case 'dl-choice':
        state.dlChoice = parseInt(el.getAttribute('data-limit') || '0', 10);
        state.dlChoiceSet = true;
        $$('.opt').forEach(x => x.classList.toggle('active', x === el));
        break;
      case 'download-start': {
        if (!state.book) break;
        const p = state.book._provider, n = state.book._novel;
        let limit = state.dlChoice || 0;
        let start = 0, end = 0;
        const startRaw = parseInt((($('#dl-start') || {}).value || '0'), 10) || 0;
        const endRaw = parseInt((($('#dl-end') || {}).value || '0'), 10) || 0;
        if (startRaw > 0 || endRaw > 0) {
          start = startRaw > 0 ? startRaw : 1;
          end = endRaw > 0 ? endRaw : 0;
          limit = 0;
          const total = (state.book.toc || []).length;
          if (start < 1 || start > total) { toast('起始章超出范围'); break; }
          if (end > 0 && (end < start || end > total)) { toast('结束章范围不正确'); break; }
        }
        const wifiOnly = !!($('#wifi-only') || {}).checked;
        settings.wifiOnly = wifiOnly;
        saveSettings();
        if (wifiOnly && native && native.isWifi && !native.isWifi()) {
          const ok = await confirmDialog('当前不是 Wi-Fi', '你开启了仅 Wi-Fi 下载。继续会使用移动数据，是否继续？', '继续下载', false);
          if (!ok) break;
        }
        if (native && native.requestNotifications) { try { native.requestNotifications(); } catch (e) {} }
        if (native && native.download) { try { native.download(p, n, limit, start, end); } catch (e) {} }
        closeSheet();
        toast('已加入下载队列');
        refreshDownloads();
        setTimeout(() => { if (state.route.name === 'book') render(); }, 400);
        break;
      }
      case 'continue-reading': {
        const p = latestProgress();
        if (p) openFromProgress(p);
        break;
      }
      case 'toggle-simple-mode':
        settings.simpleMode = !settings.simpleMode;
        saveSettings(); render(); toast(settings.simpleMode ? '已开启简洁模式' : '已关闭简洁模式');
        break;
      case 'toggle-auto-subscribe':
        settings.autoSubscribe = settings.autoSubscribe === false;
        saveSettings(); render(); toast(settings.autoSubscribe ? '收藏将自动订阅' : '收藏不再自动订阅');
        break;
      case 'toggle-auto-check':
        settings.autoCheckShelf = settings.autoCheckShelf === false;
        saveSettings(); render(); toast(settings.autoCheckShelf ? '启动时会检查更新' : '已关闭自动检查');
        break;
      case 'toggle-auto-download':
        settings.autoDownloadNew = !settings.autoDownloadNew;
        saveSettings(); render(); toast(settings.autoDownloadNew ? '新增章节会自动下载' : '已关闭自动下载');
        break;
      case 'toggle-shelf':
        toggleShelfCurrent();
        break;
      case 'share-book':
        shareCurrent();
        break;
      case 'retry-book':
        if (state.bookRef) { state.book = null; loadBook(state.bookRef.provider, state.bookRef.novelId); }
        break;
      case 'shelf-read':
        shelfRead(key);
        break;
      case 'go-stats':
        navigate('#/stats');
        break;
      case 'annual-report':
        annualReport();
        break;
      case 'share-report':
        if (native && native.share) native.share(el.getAttribute('data-text') || '');
        else if (navigator.share) navigator.share({ text: el.getAttribute('data-text') || '' }).catch(() => {});
        break;
      case 'shelf-check':
        checkShelfUpdates(true);
        break;
      case 'import-local':
        importLocalBooks();
        break;
      case 'shelf-manage-toggle':
        state.shelfManage = !state.shelfManage;
        state.shelfSelected = new Set();
        render();
        break;
      case 'shelf-filter': {
        const kind = el.getAttribute('data-kind') || 'status';
        const val = el.getAttribute('data-value') || 'all';
        if (kind === 'cat') state.shelfFilter.cat = val;
        else state.shelfFilter.status = val;
        render();
        break;
      }
      case 'shelf-add-category': {
        const name = String(prompt('新分类名称') || '').trim();
        if (name && categories.indexOf(name) < 0) { categories.push(name); saveShelf(); render(); }
        break;
      }
      case 'shelf-select': {
        const k = el.getAttribute('data-key');
        if (state.shelfSelected.has(k)) state.shelfSelected.delete(k); else state.shelfSelected.add(k);
        render();
        break;
      }
      case 'shelf-card':
        if (state.shelfManage) {
          const k = el.getAttribute('data-key');
          if (state.shelfSelected.has(k)) state.shelfSelected.delete(k); else state.shelfSelected.add(k);
          render();
        }
        break;
      case 'shelf-select-all':
        if (state.shelfSelected.size === shelfFiltered().length) state.shelfSelected = new Set();
        else state.shelfSelected = new Set(shelfFiltered().map(x => x.key));
        render();
        break;
      case 'shelf-edit':
        openShelfEdit(key);
        break;
      case 'save-shelf-edit':
        saveShelfEdit(key);
        break;
      case 'toggle-se-sub': {
        const b = $('#se-sub'); if (b) b.classList.toggle('on');
        break;
      }
      case 'toggle-se-auto': {
        const b = $('#se-auto'); if (b) b.classList.toggle('on');
        break;
      }
      case 'bulk-category':
        openBulkSheet('category');
        break;
      case 'bulk-status':
        openBulkSheet('status');
        break;
      case 'apply-bulk-category': {
        const c = el.getAttribute('data-value') || '未分类';
        shelf.forEach(x => { if (state.shelfSelected.has(x.key)) x.category = c; });
        saveShelf(); closeSheet(); render(); toast('已修改分类');
        break;
      }
      case 'apply-bulk-status': {
        const v = el.getAttribute('data-value') || 'want';
        shelf.forEach(x => { if (state.shelfSelected.has(x.key)) x.status = v; });
        saveShelf(); closeSheet(); render(); toast('已修改状态');
        break;
      }
      case 'bulk-subscribe':
        if (!state.shelfSelected.size) { toast('先选择书籍'); break; }
        shelf.forEach(x => { if (state.shelfSelected.has(x.key)) { x.subscribe = true; x.newChapters = x.newChapters || 0; } });
        saveShelf(); render(); toast('已恢复订阅');
        break;
      case 'bulk-remove': {
        if (!state.shelfSelected.size) { toast('先选择书籍'); break; }
        const ok = await confirmDialog('批量移出', '将移出 ' + state.shelfSelected.size + ' 本书，阅读进度和下载保留。', '移出', true);
        if (ok) {
          shelf = shelf.filter(x => !state.shelfSelected.has(x.key));
          state.shelfSelected = new Set();
          saveShelf(); render(); toast('已移出');
        }
        break;
      }
      case 'shelf-open': {
        const item = shelfBook(key);
        if (item) navigate('#/book/' + encodePath(item.provider) + '/' + encodePath(item.novel));
        break;
      }
      case 'shelf-remove': {
        const item = shelfBook(key);
        if (!item) break;
        const ok = await confirmDialog('移出书架', '只会移除收藏，阅读进度和已下载文件都会保留。', '移出', true);
        if (ok) { shelf = shelf.filter(x => x.key !== key); state.shelfSelected.delete(key); saveShelf(); toast('已移出书架'); render(); }
        break;
      }
      case 'refresh-downloads':
        refreshDownloads(); updateDownloadsDom(); toast('已刷新');
        break;
      case 'dl-manage-toggle':
        state.dlManage = !state.dlManage;
        state.dlSelected = new Set();
        render();
        break;
      case 'dl-select': {
        const k = el.getAttribute('data-key');
        if (state.dlSelected.has(k)) state.dlSelected.delete(k); else state.dlSelected.add(k);
        render();
        break;
      }
      case 'dl-card':
        if (state.dlManage) {
          const k = el.getAttribute('data-key');
          if (state.dlSelected.has(k)) state.dlSelected.delete(k); else state.dlSelected.add(k);
          render();
        }
        break;
      case 'dl-select-all':
        if (state.dlSelected.size === state.downloads.length) state.dlSelected = new Set();
        else state.dlSelected = new Set(state.downloads.map(x => x.key));
        render();
        break;
      case 'export-selected':
        showDownloadExportSheet();
        break;
      case 'export-selected-format':
        exportSelected(el.getAttribute('data-format') || 'txt');
        break;
      case 'pause-dl':
        if (native && native.pause) { try { native.pause(key); } catch (e) {} }
        toast('正在暂停…');
        setTimeout(() => { refreshDownloads(); updateDownloadsDom(); }, 500);
        break;
      case 'resume-dl': {
        const item = dlByKey(key);
        if (!item) break;
        if (native && native.resume) { try { native.resume(item.providerId, item.novelId, item.limit || 0, item.rangeStart || 1, item.rangeEnd || 0); } catch (e) {} }
        toast('已继续下载');
        setTimeout(() => { refreshDownloads(); updateDownloadsDom(); }, 500);
        break;
      }
      case 'check-update': {
        const item = dlByKey(key);
        if (!item) break;
        try {
          const metaRaw = sync(() => native.meta(key), '');
          const meta = metaRaw ? JSON.parse(metaRaw) : {};
          const oldCount = (meta.toc || []).length;
          const detail = await apiJson('novel/' + encodePath(item.providerId) + '/' + encodePath(item.novelId));
          const newCount = (detail.toc || []).length;
          if (newCount > oldCount) {
            const ok = await confirmDialog('发现更新', '新增 ' + (newCount - oldCount) + ' 章。现在下载新章节吗？', '下载更新', false);
            if (ok) {
              if (native && native.download) native.download(item.providerId, item.novelId, 0, oldCount + 1, 0);
              toast('已加入补更队列');
              setTimeout(() => { refreshDownloads(); updateDownloadsDom(); }, 500);
            }
          } else {
            toast('暂无新章节');
          }
        } catch (e) { toast(e.message || '检查更新失败'); }
        break;
      }
      case 'read-dl':
        openDownloaded(key);
        break;
      case 'open-dl-book':
        openDownloadedDetail(key);
        break;
      case 'delete-dl': {
        const item = dlByKey(key);
        if (!item) break;
        const ok = await confirmDialog('删除下载', '将删除《' + (item.titleZh || item.titleJp) + '》的全部本地章节，阅读进度保留。', '删除', true);
        if (ok) {
          if (native && native.remove) { try { native.remove(key); } catch (e) {} }
          refreshDownloads(); updateDownloadsDom(); toast('已删除');
        }
        break;
      }
      case 'refresh-online':
        loadOnline();
        break;
      case 'refresh-usage':
        loadUsage(true);
        break;
      case 'clear-downloads': {
        const ok = await confirmDialog('清空所有下载', '这会删除应用内缓存的全部章节，释放空间。书架和进度不变。', '清空', true);
        if (ok) {
          if (native && native.clearAll) { try { native.clearAll(); } catch (e) {} }
          refreshDownloads(); render(); toast('已清空下载');
        }
        break;
      }
      case 'toggle-r18':
        if (state.r18) {
          saveR18(false);
          toast('R18 已关闭');
          reloadR18();
        } else {
          showR18Gate();
        }
        break;
      case 'confirm-r18': {
        const cb = $('#r18-ok');
        if (!cb || !cb.checked) { toast('请先确认你已年满 18 周岁'); break; }
        loadAuth();
        if (state.auth.loggedIn) {
          saveR18(true);
          closeSheet();
          toast('R18 已开启');
          reloadR18();
        } else {
          state.pendingR18 = true;
          showLoginSheet();
        }
        break;
      }
      case 'open-login':
        showLoginSheet();
        break;
      case 'open-privacy':
        showPrivacySheet();
        break;
      case 'privacy-enable': {
        const pin = (($('#privacy-new') || {}).value || '').trim();
        const confirm = (($('#privacy-confirm') || {}).value || '').trim();
        if (!/^[0-9]{4,8}$/.test(pin)) { toast('PIN 需要 4-8 位数字'); break; }
        if (pin !== confirm) { toast('两次输入不一致'); break; }
        const r = native && native.privacySetPin ? native.privacySetPin(pin) : '请在 App 内设置';
        if (r !== 'ok') { toast(r || '设置失败'); break; }
        loadPrivacy();
        toast('隐私锁已开启');
        closeSheet();
        render();
        break;
      }
      case 'privacy-disable': {
        const pin = (($('#privacy-old') || {}).value || '').trim();
        const r = native && native.privacyClear ? native.privacyClear(pin) : '请在 App 内操作';
        if (r !== 'ok') { toast(r || 'PIN 不正确'); break; }
        loadPrivacy();
        state.locked = false;
        toast('隐私锁已关闭');
        closeSheet();
        render();
        break;
      }
      case 'privacy-recents':
        if (native && native.privacyHideRecents) {
          const next = !(state.privacy.hideRecents !== false);
          try { native.privacyHideRecents(next); } catch (e) {}
          state.privacy.hideRecents = next;
          el.classList.toggle('on', next);
          toast(next ? '已隐藏最近任务预览' : '已允许最近任务预览');
        }
        break;
      case 'unlock-pin': {
        const input = $('#lock-pin');
        const pin = input ? String(input.value || '').trim() : '';
        const ok = native && native.privacyVerify ? native.privacyVerify(pin) : false;
        if (ok) {
          state.locked = false;
          state.hiddenAt = 0;
          state.autoUpdateChecked = false;
          render();
          setTimeout(maybeAutoCheckUpdate, 300);
    setTimeout(sendHeartbeat, 1200);
    setInterval(sendHeartbeat, 60000);
    setTimeout(() => {
      if (!settings.autoCheckShelf || state.locked || !shelf.some(x => x.subscribe)) return;
      let last = 0; try { last = Number(localStorage.getItem('nr.subCheckAt') || 0) || 0; } catch (e) {}
      if (Date.now() - last > 30 * 60 * 1000) checkShelfUpdates(false);
    }, 5000);
        } else {
          const err = $('#lock-error');
          if (err) err.textContent = 'PIN 不正确';
          if (input) { input.value = ''; try { input.focus(); } catch (e) {} }
        }
        break;
      }
      case 'export-backup':
        exportBackup();
        break;
      case 'import-backup':
        importBackup();
        break;
      case 'login-submit': {
        const user = (($('#login-user') || {}).value || '').trim();
        const pass = (($('#login-pass') || {}).value || '');
        if (!user || !pass) { toast('请填写用户名和密码'); break; }
        const btn = $('#login-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 登录中'; }
        try {
          const raw = await invoke('authLogin', user, pass);
          let info = {};
          try { info = JSON.parse(raw); } catch (e) {}
          state.auth = info;
          const pending = state.pendingR18;
          state.pendingR18 = false;
          if (pending && state.auth.loggedIn) {
            saveR18(true);
            closeSheet();
            toast('登录成功，R18 已开启');
            reloadR18();
          } else {
            closeSheet();
            toast(state.auth.loggedIn ? '登录成功' : '登录失败');
            render();
          }
        } catch (e) {
          toast(e.message || '登录失败');
          if (btn) { btn.disabled = false; btn.textContent = '登录'; }
        }
        break;
      }
      case 'logout-account':
        if (native && native.authLogout) { try { native.authLogout(); } catch (e) {} }
        state.auth = { loggedIn: false, user: '', canR18: false, ageDays: 0 };
        state.r18 = false;
        saveJSON('nr.r18', false);
        closeSheet();
        toast('已退出登录');
        render();
        break;
      case 'login-web':
        closeSheet();
        if (native && native.openWeb) { try { native.openWeb('https://books.fishhawk.top/'); } catch (e) {} }
        break;
      case 'wenku-search': {
        const input = $('#wenku-search');
        state.wenku.query = input ? String(input.value || '').trim() : '';
        loadWenku(0);
        break;
      }
      case 'wenku-level':
        state.wenku.level = parseInt(el.getAttribute('data-level') || '0', 10) || 0;
        loadWenku(0);
        break;
      case 'wenku-page': {
        const page = parseInt(el.getAttribute('data-page') || '0', 10) || 0;
        loadWenku(Math.max(0, Math.min(state.wenku.pageCount - 1, page)));
        break;
      }
      case 'wenku-go': {
        const input = $('#wenku-page-input');
        const n = parseInt(input ? input.value : '1', 10) || 1;
        loadWenku(Math.max(0, Math.min(state.wenku.pageCount - 1, n - 1)));
        break;
      }
      case 'retry-wenku':
        loadWenku(state.wenku.page || 0);
        break;
      case 'retry-wenku-book':
        if (state.wenkuBookId) { state.wenkuBook = null; loadWenkuBook(state.wenkuBookId); }
        break;
      case 'wenku-read':
        readWenkuVolume(el.getAttribute('data-id'), el.getAttribute('data-vid'), el.getAttribute('data-translator'), el.getAttribute('data-title'));
        break;
      case 'wenku-web':
        if (native && native.openWeb) { try { native.openWeb('https://books.fishhawk.top/wenku/' + encodePath(el.getAttribute('data-id') || '')); } catch (e) {} }
        break;
      case 'open-comments':
        openComments();
        break;
      case 'check-app-update':
        checkAppUpdate(true);
        break;
      case 'open-feedback':
        openFeedback();
        break;
      case 'send-feedback-server':
        sendFeedbackServer();
        break;
      case 'submit-feedback':
        submitFeedback();
        break;
      case 'copy-feedback':
        copyFeedback();
        break;
      case 'do-app-update': {
        const info = state.pendingUpdate;
        if (!info) break;
        const btn = $('#app-update-btn');
        if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
        try {
          await invoke('installUpdate', info.apkUrl, info.sha256 || '');
          toast('已打开安装器，请确认安装');
          closeSheet();
        } catch (e) {
          if (btn) { btn.disabled = false; btn.textContent = '下载并安装'; }
          toast(e.message || '更新失败');
        }
        break;
      }
      case 'load-more-comments':
        loadComments(false, state.comments.page + 1);
        break;
      case 'comment-prev':
        loadComments(false, state.comments.page - 1);
        break;
      case 'comment-next':
        loadComments(false, state.comments.page + 1);
        break;
      case 'comment-go': {
        const input = $('#comment-page-input');
        const n = parseInt(input ? input.value : '1', 10) || 1;
        loadComments(false, n);
        break;
      }
      case 'retry-comment-list':
        loadComments(true);
        break;
      case 'retry-comment-preview':
        loadCommentPreview(true);
        break;
      case 'comment-reply': {
        state.commentRoot = parseInt(el.getAttribute('data-id') || '0', 10) || 0;
        state.commentReplyName = el.getAttribute('data-user') || '';
        updateComposer();
        const input = $('#comment-input');
        if (input) { try { input.focus(); } catch (e) {} }
        break;
      }
      case 'cancel-reply':
        state.commentRoot = 0;
        state.commentReplyName = '';
        updateComposer();
        break;
      case 'send-comment': {
        if (!state.auth.loggedIn) { showLoginSheet(); break; }
        const input = $('#comment-input');
        const text = input ? String(input.value || '').trim() : '';
        if (!text) { toast('先写点内容'); break; }
        if (!state.book) break;
        const key = commentKey(state.book._provider, state.book._novel);
        const btn = $('#comment-send');
        if (btn) { btn.disabled = true; btn.textContent = '发送中…'; }
        try {
          await invoke('commentSend', key, text, state.commentRoot || 0);
          state.commentRoot = 0;
          state.commentReplyName = '';
          updateComposer();
          toast('评论已发送');
          loadComments(true);
        } catch (e) {
          toast(e.message || '发送失败');
          if (btn) { btn.disabled = false; btn.textContent = '发送'; }
        }
        break;
      }
      case 'comment-web': {
        const url = el.getAttribute('data-url') || 'https://books.fishhawk.top/';
        if (native && native.openWeb) { try { native.openWeb(url); } catch (e) { toast('无法打开网页版'); } }
        else toast('请在 App 内打开网页版');
        break;
      }
      case 'set-relay': {
        state.relay = el.getAttribute('data-value') || 'auto';
        if (native && native.relaySet) { try { native.relaySet(state.relay); } catch (e) {} }
        $$('[data-action="set-relay"]').forEach(x => x.classList.toggle('active', x === el));
        toast(state.relay === 'off' ? '已关闭只读加速' : (state.relay === 'on' ? '已强制使用只读加速' : '直连失败时自动使用只读加速'));
        break;
      }
      case 'set-theme':
        settings.theme = el.getAttribute('data-value');
        saveSettings(); applyTheme(); render();
        break;
      case 'open-reader-settings':
        showReaderSettings();
        break;
      case 'rs-mode':
        setReaderSetting('mode', el.getAttribute('data-value'));
        $$('[data-action="rs-mode"]').forEach(x => x.classList.toggle('active', x === el));
        break;
      case 'rs-theme':
        setReaderSetting('theme', el.getAttribute('data-value'));
        $$('[data-action="rs-theme"]').forEach(x => x.classList.toggle('active', x === el));
        break;
      case 'rs-serif':
        setReaderSetting('serif', !settings.reader.serif);
        el.classList.toggle('on', settings.reader.serif);
        break;
      case 'rs-awake':
        setReaderSetting('keepAwake', settings.reader.keepAwake === false);
        el.classList.toggle('on', settings.reader.keepAwake !== false);
        break;
      case 'save-proxy':
        if (await saveProxyFromForm(false)) render();
        break;
      case 'test-proxy':
        testProxy();
        break;
      case 'open-site':
        if (native && native.openExternal) { try { native.openExternal('https://books.fishhawk.top/'); } catch (e) {} }
        break;
      case 'share-app':
        if (native && native.share) { try { native.share('Novelia 阅读 · 轻小说机翻阅读器\nhttps://books.fishhawk.top/'); } catch (e) {} }
        break;
      case 'exit-app':
        if (native && native.exit) { try { native.exit(); } catch (e) {} }
        break;
      case 'dismiss-notice':
        try { localStorage.setItem('nr.noticeSeen', el.getAttribute('data-id') || ''); } catch (e) {}
        closeSheet();
        break;
      case 'close-sheet':
        closeSheet();
        break;
      default:
        break;
    }
  });

  document.addEventListener('submit', e => {
    if (e.target && e.target.id === 'search-form') {
      e.preventDefault();
      const btn = $('[data-action="submit-search"]');
      if (btn) btn.click();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'search-input') {
      e.preventDefault();
      const btn = $('[data-action="submit-search"]');
      if (btn) btn.click();
    } else if (e.key === 'Enter' && e.target && e.target.id === 'wenku-search') {
      e.preventDefault();
      const btn = $('[data-action="wenku-search"]');
      if (btn) btn.click();
    }
  });
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'shelf-q') {
      state.shelfFilter.q = e.target.value;
      const cards = $('.shelf-filtered-list');
      render();
      const input = $('#shelf-q');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    } else if (e.target && e.target.id === 'toc-search') {
      state.tocQuery = e.target.value;
      state.tocLimit = 120;
      const list = $('#toc-list');
      if (list) list.innerHTML = tocListHtml();
    } else if (e.target && e.target.id === 'rs-font-size') {
      setReaderSetting('fontSize', parseInt(e.target.value, 10) || 18);
      const l = $('#fs-label'); if (l) l.textContent = settings.reader.fontSize;
    } else if (e.target && e.target.id === 'rs-line-height') {
      setReaderSetting('lineHeight', parseFloat(e.target.value) || 1.95);
      const l = $('#lh-label'); if (l) l.textContent = settings.reader.lineHeight;
    } else if (e.target && e.target.id === 'rs-brightness') {
      const v = parseInt(e.target.value, 10) || 0;
      setReaderSetting('brightness', v <= 0 ? -1 : v / 100);
      const l = $('#rs-bright-label'); if (l) l.textContent = v <= 0 ? '跟随系统' : v + '%';
    }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'shelf-cat') {
      state.shelfFilter.cat = e.target.value; render(); return;
    }
    if (e.target && e.target.id === 'shelf-tag') {
      state.shelfFilter.tag = e.target.value; render(); return;
    }
    if (e.target && e.target.id === 'shelf-sort') {
      state.shelfFilter.sort = e.target.value; render(); return;
    }
    if (e.target && e.target.id === 'rs-engine') {
      setReaderSetting('engine', e.target.value);
    } else if (e.target && e.target.id === 'rs-animation') {
      setReaderSetting('animation', e.target.value);
    }
  });

  window.addEventListener('hashchange', onRoute);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { state.hiddenAt = Date.now(); return; }
    sendHeartbeat();
    if (state.privacy.hasPin && !state.locked && state.hiddenAt && Date.now() - state.hiddenAt > 60000) {
      state.locked = true;
      render();
    }
    state.hiddenAt = 0;
  });
  document.addEventListener('keydown', function (e) {
    if (state.locked && e.key === 'Enter' && e.target && e.target.id === 'lock-pin') {
      e.preventDefault();
      const btn = document.querySelector('[data-action="unlock-pin"]');
      if (btn) btn.click();
    }
  });
  window.addEventListener('scroll', function () {
    document.body.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });
  window.addEventListener('pageshow', function () {
    // Returning from the reader via bfcache: refresh local progress and theme.
    settings = loadSettings();
    shelf = loadJSON('nr.shelf', []) || [];
    progress = loadJSON('nr.progress', {}) || {};
    recent = loadJSON('nr.recent', []) || [];
    normalizeShelf();
    shelf.forEach(x => {
      const p = progress[x.key];
      if (p && p.chapterId) {
        x.lastReadAt = Math.max(x.lastReadAt || 0, p.updatedAt || 0);
        if (p.percent >= 0.995) x.status = 'read';
        else if (x.status === 'want') x.status = 'reading';
      }
    });
    saveShelf();
    applyTheme();
    refreshDownloads();
    if (state.route.name === 'home' || state.route.name === 'shelf' || state.route.name === 'downloads' || state.route.name === 'settings') render();
    else if (state.route.name === 'book' && state.book) render();
  });

  /* ------------------------------------------------------------------ *
   *  Boot
   * ------------------------------------------------------------------ */
  try {
    applyTheme();
    normalizeShelf();
    loadAuth();
    loadPrivacy();
    if (state.privacy.hasPin) state.locked = true;
    refreshDownloads();
    state.route = parseRoute();
    onRoute();
    setTimeout(maybeAutoCheckUpdate, 300);
    setTimeout(sendHeartbeat, 1200);
    setInterval(sendHeartbeat, 60000);
    setTimeout(() => {
      if (!settings.autoCheckShelf || state.locked || !shelf.some(x => x.subscribe)) return;
      let last = 0; try { last = Number(localStorage.getItem('nr.subCheckAt') || 0) || 0; } catch (e) {}
      if (Date.now() - last > 30 * 60 * 1000) checkShelfUpdates(false);
    }, 5000);
  } catch (e) {
    try {
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:1000;padding:12px;border-radius:10px;background:#7a2e2e;color:#fff;font:12px/1.5 monospace;white-space:pre-wrap;word-break:break-all';
      box.textContent = '启动失败：' + ((e && (e.stack || e.message)) || String(e));
      document.body.appendChild(box);
    } catch (ignored) {}
  }
})();
