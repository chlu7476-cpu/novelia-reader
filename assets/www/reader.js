(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const native = window.Native || null;
  const contentEl = $('#content');
  const sheetEl = $('#r-sheet');
  const scrimEl = $('#r-scrim');
  const toastEl = $('#r-toast');

  const DEFAULT_SETTINGS = {
    theme: 'auto',
    reader: { mode: 'zh', engine: 'auto', fontSize: 18, lineHeight: 1.8, theme: 'paper', serif: false, animation: 'slide', brightness: -1, keepAwake: true, layout: 'page', autoTurn: 0, bg: '', tapLeft: 'prev', tapRight: 'next', tapCenter: 'menu' }
  };
  function loadJSON(k, d) {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadSettings() {
    const raw = loadJSON('nr.settings', {}) || {};
    return { theme: raw.theme || 'auto', simpleMode: !!raw.simpleMode, reader: Object.assign({}, DEFAULT_SETTINGS.reader, raw.reader || {}) };
  }
  let settings = loadSettings();
  function saveSettings() { saveJSON('nr.settings', settings); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function sync(fn, fallback) {
    try { const v = fn(); return v == null || v === '' ? fallback : v; } catch (e) { return fallback; }
  }
  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function keyFor(p, n) {
    if (native && native.key) { const k = sync(() => native.key(p, n), ''); if (k) return k; }
    return (p + '__' + n).replace(/[^A-Za-z0-9._-]/g, '_');
  }

  /* ---------------- bridge ---------------- */
  class ApiError extends Error { constructor(status, msg) { super(msg || '请求失败'); this.status = status; } }
  const pending = new Map();
  let seq = 0;
  window.NativeBridge = {
    resolve(id, status, body) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (status === 200) p.resolve(body || '');
      else p.reject(new ApiError(status, clean(body)));
    }
  };
  function clean(body) {
    let s = String(body == null ? '' : body).trim();
    try { const j = JSON.parse(s); s = j.message || j.error || s; } catch (e) {}
    s = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  }
  function invoke(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      if (!native || typeof native[method] !== 'function') { reject(new ApiError(0, '请在 App 内打开阅读器')); return; }
      const id = 'r' + (++seq);
      const timer = setTimeout(() => { pending.delete(id); reject(new ApiError(0, '请求超时')); }, 46000);
      pending.set(id, { resolve, reject, timer });
      try { native[method].apply(native, [id].concat(args)); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(new ApiError(0, e.message || '调用失败')); }
    });
  }
  async function api(path) { return invoke('api', path); }
  async function apiJson(path) {
    const t = await api(path);
    try { return JSON.parse(t); } catch (e) { throw new ApiError(0, '返回数据格式异常'); }
  }

  /* ---------------- state ---------------- */
  const qs = new URLSearchParams(location.search);
  const provider = qs.get('provider') || '';
  const novel = qs.get('novel') || '';
  const isWenku = provider === 'wenku';
  const isLocal = provider === 'local';
  let key = qs.get('key') || keyFor(provider, novel);
  let meta = null;
  let toc = [];
  let chapter = null;
  let chapterId = qs.get('chapter') || '';
  let showBarsOnNextRender = true;
  let index = parseInt(qs.get('index') || '-1', 10);
  let offline = false;
  let engine = 'auto';
  let loading = false;
  let restorePercent = 0;
  let initial = true;
  let sheetKind = '';
  let tocFilter = '';
  let tocLimit = 500;
  let progressAll = loadJSON('nr.progress', {}) || {};
  let bookmarks = loadJSON('nr.bookmarks', {}) || {};
  let speaking = false;
  let fadeTimer = null;
  let prefetch = { id: '', data: null };
  let page = 0;
  let totalPages = 1;
  let pageStep = 0;
  let pendingRestore = null;
  let suppressClickUntil = 0;
  let barsTimer = null;
  let stats = loadJSON('nr.stats', {}) || {};
  let statsStart = Date.now();
  let statsTimer = null;

  function bookTitle() {
    if (chapter && (chapter.novelTitleZh || chapter.novelTitleJp)) return chapter.novelTitleZh || chapter.novelTitleJp;
    if (meta) return meta.titleZh || meta.titleJp || '';
    return '';
  }
  function chapterTitle() {
    if (!chapter) return '';
    return chapter.titleZh || chapter.titleJp || ('第 ' + (index + 1) + ' 章');
  }
  function chapIndexById(id) {
    for (let i = 0; i < toc.length; i++) if (toc[i] && toc[i].chapterId === id) return i;
    return -1;
  }
  function pickEngine(ch) {
    const wanted = settings.reader.engine || 'auto';
    if (wanted !== 'auto') return wanted;
    let best = 'sakura', bestCount = -1;
    ['sakura', 'gpt', 'youdao', 'baidu'].forEach(e => {
      const arr = ch[e + 'Paragraphs'];
      let n = 0;
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) if (String(arr[i] || '').trim()) n++;
      if (n > bestCount) { bestCount = n; best = e; }
    });
    return best;
  }

  /* ---------------- reading stats ---------------- */
  function dayKey(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function ensureStats() {
    if (!stats.daily) stats.daily = {};
    if (!stats.books) stats.books = {};
    if (!stats.chapters) stats.chapters = {};
  }
  function flushStats(force) {
    ensureStats();
    const now = Date.now();
    let sec = Math.round((now - statsStart) / 1000);
    if (!force && sec < 5) return;
    if (sec < 0) sec = 0;
    statsStart = now;
    if (!sec) return;
    const k = dayKey();
    const d = stats.daily[k] || (stats.daily[k] = { seconds: 0, chapters: 0 });
    d.seconds += sec;
    const bk = stats.books[key] || (stats.books[key] = { title: bookTitle() || '', seconds: 0, chapters: 0, lastAt: 0 });
    bk.seconds += sec;
    bk.lastAt = now;
    if (!bk.title) bk.title = bookTitle() || '';
    stats.totalSeconds = (Number(stats.totalSeconds) || 0) + sec;
    saveJSON('nr.stats', stats);
  }
  function startStatsTimer() {
    statsStart = Date.now();
    clearInterval(statsTimer);
    statsTimer = setInterval(() => flushStats(true), 20000);
  }
  function markChapterRead() {
    ensureStats();
    if (!chapterId) return;
    const ids = stats.chapters[key] || (stats.chapters[key] = []);
    if (ids.indexOf(chapterId) >= 0) return;
    ids.push(chapterId);
    const k = dayKey();
    const d = stats.daily[k] || (stats.daily[k] = { seconds: 0, chapters: 0 });
    d.chapters += 1;
    const bk = stats.books[key] || (stats.books[key] = { title: bookTitle() || '', seconds: 0, chapters: 0, lastAt: 0 });
    bk.chapters = ids.length;
    bk.title = bk.title || bookTitle() || '';
    saveJSON('nr.stats', stats);
  }
  /* ---------------- load ---------------- */
  async function init() {
    applyStyle();
    applyEnvironment();
    if (!provider || !novel) { showError('链接不完整', '缺少作品信息，请从作品详情页打开。'); return; }
    showLoading();
    try {
      let cached = null;
      if (isWenku || isLocal) {
        const raw = sync(() => native.meta(key), '');
        if (raw) { try { cached = JSON.parse(raw); } catch (e) {} }
        if (!cached) throw new ApiError(0, '文库缓存不存在，请返回重新下载');
      } else {
        try { cached = JSON.parse(sessionStorage.getItem('novel:' + key) || 'null'); } catch (e) {}
        if (!cached && native && native.meta) {
          const raw = sync(() => native.meta(key), '');
          if (raw) { try { cached = JSON.parse(raw); } catch (e) {} }
        }
        if (!cached) {
          cached = await apiJson('novel/' + enc(provider) + '/' + enc(novel));
        }
      }
      meta = cached || {};
      meta._key = key;
      meta._provider = provider;
      meta._novel = novel;
      toc = Array.isArray(meta.toc) ? meta.toc : [];
      if (!chapterId) {
        const saved = progressAll[key];
        if (saved && saved.chapterId && saved.novel === novel) chapterId = saved.chapterId;
        else {
          const first = toc.find(x => x && x.chapterId);
          if (first) chapterId = first.chapterId;
        }
      }
      if (index < 0) index = chapIndexById(chapterId);
      if (index < 0) index = toc.findIndex(x => x && x.chapterId);
      if (!chapterId && index >= 0) chapterId = toc[index].chapterId;
      const saved = progressAll[key];
      restorePercent = (initial && saved && saved.chapterId === chapterId) ? (saved.percent || 0) : 0;
      if (!chapterId) throw new ApiError(0, '这本书还没有可阅读的译文章节');
      await loadChapter(chapterId, index, initial);
      initial = false;
      startStatsTimer();
    } catch (e) {
      showError('无法打开这一章', e.message || '请检查网络，或在设置中配置代理后重试。');
    }
  }

  async function loadChapter(id, idx, isInitial) {
    if (!id) { toast('没有下一章了'); return; }
    loading = true;
    showLoading();
    try {
      let ch = null;
      let local = false;
      if (isWenku || isLocal) {
        if (idx < 0) idx = chapIndexById(id);
        const raw = sync(() => native.localChapter(key, idx), '');
        if (!raw) throw new ApiError(0, '文库章节缓存不存在');
        ch = JSON.parse(raw);
        local = true;
      }
      if (!ch && prefetch.data && prefetch.id === id) {
        ch = prefetch.data;
        prefetch = { id: '', data: null };
      }
      if (!ch && idx >= 0) {
        const raw = sync(() => native.localChapter(key, idx), '');
        if (raw) {
          try { ch = JSON.parse(raw); local = true; } catch (e) {}
        }
      }
      if (!ch) {
        ch = await apiJson('novel/' + enc(provider) + '/' + enc(novel) + '/chapter/' + enc(id));
      }
      chapter = ch;
      chapterId = id;
      index = idx >= 0 ? idx : chapIndexById(id);
      offline = local;
      engine = pickEngine(ch);
      loading = false;
      stopSpeaking();
      clearTimeout(saveTimer);
      pendingRestore = isInitial ? restorePercent : 0;
      showBarsOnNextRender = !!isInitial;
      render();
      markChapterRead();
      updateUrl();
      setTimeout(prefetchNext, 500);
    } catch (e) {
      loading = false;
      showError(offline ? '这一章没有缓存' : '章节加载失败', e.message || '请检查网络后重试。');
    }
  }

  function showLoading() {
    totalPages = 1; page = 0;
    contentEl.innerHTML = '<div class="r-loading"><span></span><p>正在取出这一章…</p></div>';
  }

  function showError(title, message) {
    totalPages = 1; page = 0;
    contentEl.innerHTML = '<div class="r-error"><div class="ic"><svg viewBox="0 0 24 24"><path d="M12 4 2.8 20h18.4Z"/><path d="M12 9v5M12 17v.1"/></svg></div>'
      + '<b>' + esc(title) + '</b><p>' + esc(message) + '</p>'
      + '<div style="display:flex;gap:8px"><button class="r-btn" data-act="retry">重试</button>'
      + '<button class="r-btn ghost" data-act="back">返回</button></div></div>';
  }

  /* ---------------- layout / auto turn ---------------- */
  function isScrollLayout() { return settings.reader.layout === 'scroll' || settings.reader.layout === 'vertical'; }
  function applyLayoutClasses() {
    const pages = $('#reader-pages');
    if (!pages) return;
    const scroll = isScrollLayout();
    contentEl.classList.toggle('scroll-layout', scroll);
    contentEl.classList.toggle('vertical-layout', settings.reader.layout === 'vertical');
    document.body.classList.toggle('scroll-layout-body', scroll);
    if (!scroll) contentEl.scrollTop = 0;
  }
  let autoTimer = null;
  function clearAutoTurn() { clearTimeout(autoTimer); autoTimer = null; }
  function scheduleAutoTurn() {
    clearAutoTurn();
    const sec = Number(settings.reader.autoTurn || 0);
    if (!sec || sheetKind || !chapter) return;
    autoTimer = setTimeout(() => { nextPage(); }, sec * 1000);
  }
  function tapAction(action) {
    if (action === 'menu') toggleBars();
    else if (action === 'next') nextPage();
    else if (action === 'prev') prevPage();
    else if (action === 'toc') openToc();
    else if (action === 'settings') openSettings();
  }
  /* ---------------- render ---------------- */
  function render() {
    if (!chapter) return;
    const bt = bookTitle() || 'Novelia';
    const ct = chapterTitle();
    document.title = ct + ' · ' + bt;
    $('#book-title').textContent = bt;
    $('#chapter-title').textContent = ct;
    const art = paragraphsHtml();
    const total = toc.length || 0;
    const label = total ? ('第 ' + (index + 1) + ' / ' + total + ' 章') : '';
    const engineName = { auto: '自动', sakura: 'Sakura', gpt: 'GPT', youdao: '有道', baidu: '百度' }[settings.reader.engine] || engine;
    const modeName = { zh: '译文', jp: '原文', both: '双语' }[settings.reader.mode] || '译文';
    let sub = '';
    if (chapter.titleZh && chapter.titleJp) sub = chapter.titleJp;
    const head = '<div class="chapter-head"><div class="ch-num">' + (label || 'CHAPTER') + '</div>'
      + '<h1>' + esc(ct) + '</h1>'
      + (sub ? '<div class="ch-book">' + esc(sub) + '</div>' : '')
      + '<div class="ch-tags"><span class="chip">' + esc(modeName) + '</span>'
      + '<span class="chip">' + esc(engineName) + '</span>'
      + (offline ? '<span class="chip ok">已缓存</span>' : '<span class="chip">在线</span>')
      + '</div></div>';
    const nextExists = hasNextChapter();
    const end = '<div class="chapter-end">· 本章完 ·</div>'
      + '<div class="end-card"><b>' + (nextExists ? '下一章' : '已经读到最后一章') + '</b>'
      + '<span>' + (nextExists ? '可以继续往下读了' : '可以回到目录挑一章，或稍后再来。') + '</span>'
      + (nextExists ? '<button class="next-btn" data-act="next">继续阅读 →</button>' : '<button class="next-btn" data-act="toc">回到目录</button>')
      + '</div>';
    contentEl.innerHTML = '<div class="reader-pages" id="reader-pages">' + head + art + end + '</div>';
    applyStyle();
    applyLayoutClasses();
    const keep = pendingRestore != null ? pendingRestore : currentPercent();
    pendingRestore = null;
    layoutPages(keep);
    if (showBarsOnNextRender) {
      showBarsOnNextRender = false;
      showBarsTemporarily();
    }
    updateReaderButtons();
  }

  function currentPercent() {
    if (isScrollLayout()) {
      const max = contentEl.scrollHeight - contentEl.clientHeight;
      return max > 4 ? Math.max(0, Math.min(1, contentEl.scrollTop / max)) : 0;
    }
    return totalPages > 1 ? page / (totalPages - 1) : 0;
  }

  function layoutPages(keep) {
    const pagesEl = $('#reader-pages');
    if (!pagesEl) return;
    clearTimeout(fadeTimer);
    pagesEl.style.transition = 'none';
    pagesEl.style.opacity = '1';
    pagesEl.style.transform = 'translateX(0px)';
    if (isScrollLayout()) {
      pagesEl.style.width = '100%';
      pagesEl.style.height = 'auto';
      pagesEl.style.columnWidth = 'auto';
      pagesEl.style.columnGap = '0';
      const vh = Math.max(1, contentEl.clientHeight);
      totalPages = Math.max(1, Math.ceil(pagesEl.scrollHeight / vh));
      pageStep = vh;
      const target = Math.max(0, Math.min(totalPages - 1, Math.round((keep || 0) * (totalPages - 1))));
      setPage(target, false);
      attachImageRelayout();
      scheduleAutoTurn();
      return;
    }
    contentEl.scrollTop = 0;
    pagesEl.style.width = '100%';
    pagesEl.style.height = '100%';
    const w = Math.max(1, pagesEl.clientWidth);
    pagesEl.style.columnWidth = w + 'px';
    pagesEl.style.columnGap = '42px';
    const cs = getComputedStyle(pagesEl);
    const gap = parseFloat(cs.columnGap) || 42;
    const sw = pagesEl.scrollWidth;
    totalPages = Math.max(1, Math.round((sw + gap) / (w + gap)));
    pageStep = w + gap;
    const target = Math.max(0, Math.min(totalPages - 1, Math.round((keep || 0) * (totalPages - 1))));
    setPage(target, false);
    pagesEl.style.transition = '';
    attachImageRelayout();
    scheduleAutoTurn();
  }

  function setPage(p, animate) {
    const pagesEl = $('#reader-pages');
    if (!pagesEl) return;
    page = Math.max(0, Math.min(totalPages - 1, p | 0));
    if (isScrollLayout()) {
      pageStep = Math.max(1, contentEl.clientHeight);
      contentEl.scrollTo({ top: page * pageStep, behavior: animate ? 'smooth' : 'auto' });
      updateNav(); updateProgressUI(); updateTopProgress(); scheduleAutoTurn();
      return;
    }
    const target = 'translateX(' + (-page * pageStep) + 'px)';
    const anim = settings.reader.animation || 'slide';
    clearTimeout(fadeTimer);
    if (!animate || anim === 'none') {
      pagesEl.style.transition = 'none';
      pagesEl.style.opacity = '1';
      pagesEl.style.transform = target;
    } else if (anim === 'fade') {
      pagesEl.style.transition = 'opacity .16s ease';
      pagesEl.style.opacity = '0';
      fadeTimer = setTimeout(() => {
        pagesEl.style.transition = 'none';
        pagesEl.style.transform = target;
        requestAnimationFrame(() => {
          pagesEl.style.transition = 'opacity .16s ease';
          pagesEl.style.opacity = '1';
        });
      }, 140);
    } else {
      pagesEl.style.transition = 'transform .26s cubic-bezier(.22,.8,.26,1)';
      pagesEl.style.opacity = '1';
      pagesEl.style.transform = target;
    }
    updateNav();
    updateProgressUI();
    updateTopProgress();
    if (animate && !document.body.classList.contains('bars-hidden')) scheduleBarsHide();
    scheduleAutoTurn();
  }

  function relayout() {
    const pct = currentPercent();
    applyStyle();
    applyLayoutClasses();
    requestAnimationFrame(() => layoutPages(pct));
  }

  function attachImageRelayout() {
    const imgs = document.querySelectorAll('#reader-pages img');
    for (let i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) imgs[i].addEventListener('load', relayout, { once: true });
    }
  }

  function textToHtml(text) {
    let t = String(text == null ? '' : text).replace(/^[\s\u3000]+/, '').replace(/\s+$/, '');
    if (!t) return '';
    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      return '<figure><img src="' + esc(img[2]) + '" alt="' + esc(img[1]) + '" loading="lazy">'
        + (img[1] ? '<figcaption>' + esc(img[1]) + '</figcaption>' : '') + '</figure>';
    }
    if (/^https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?$/i.test(t)) {
      return '<figure><img src="' + esc(t) + '" alt="" loading="lazy"></figure>';
    }
    return esc(t).replace(/\n/g, '<br>');
  }

  function paragraphBlock(text, cls) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return '';
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(t)) return textToHtml(t);
    return '<p class="' + cls + '">' + textToHtml(t) + '</p>';
  }

  function paragraphsHtml() {
    const jp = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    const zh = Array.isArray(chapter[engine + 'Paragraphs']) ? chapter[engine + 'Paragraphs'] : [];
    const mode = settings.reader.mode || 'zh';
    let html = '';
    let blankRun = 0;
    let zhCount = 0, jpCount = 0;
    for (let i = 0; i < Math.max(jp.length, zh.length); i++) {
      const j = String(jp[i] == null ? '' : jp[i]).trim();
      const z = String(zh[i] == null ? '' : zh[i]).trim();
      if (j) jpCount++;
      if (z) zhCount++;
      if (!j && !z) {
        blankRun++;
        continue;
      }
      if (blankRun >= 2) html += '<div class="scene-break">· · ·</div>';
      blankRun = 0;
      if (mode === 'jp') {
        if (j) html += paragraphBlock(j, '');
      } else if (mode === 'both') {
        html += '<div class="pair">';
        if (j) html += paragraphBlock(j, 'jp');
        if (z) html += paragraphBlock(z, 'zh');
        html += '</div>';
      } else {
        if (z) html += paragraphBlock(z, '');
        else if (j) html += paragraphBlock(j, 'jp');
      }
    }
    let notice = '';
    if (mode !== 'jp' && zhCount === 0) {
      notice = '<div class="fallback-note">本章暂无可用译文，已显示日文原文。你可以在阅读设置里切换显示方式。</div>';
    } else if (mode === 'zh' && zhCount < jpCount) {
      notice = '<div class="fallback-note">本章部分段落暂无译文，已用日文原文补齐。</div>';
    }
    return notice + '<article class="article">' + html + '</article>';
  }

  function hasPrevChapter() {
    return !!(chapter && (chapter.prevId || (index > 0 && toc[index - 1] && toc[index - 1].chapterId)));
  }
  function hasNextChapter() {
    return !!(chapter && (chapter.nextId || (index < toc.length - 1 && toc[index + 1] && toc[index + 1].chapterId)));
  }
  function updateNav() {
    const prev = hasPrevChapter();
    const next = hasNextChapter();
    const atFirst = page <= 0;
    const atLast = page >= totalPages - 1;
    const pBtn = $('#prev-btn'), nBtn = $('#next-btn');
    if (pBtn) {
      pBtn.disabled = atFirst && !prev;
      const span = pBtn.querySelector('span');
      if (span) span.textContent = atFirst ? '上一章' : '上一页';
      const prevTitle = chapter && chapter.prevId ? toc[chapIndexById(chapter.prevId)] : null;
      $('#prev-label').textContent = atFirst
        ? (prevTitle ? (prevTitle.titleZh || prevTitle.titleJp || '') : (prev ? '上一章' : '已是开头'))
        : '回到上一页';
    }
    if (nBtn) {
      nBtn.disabled = atLast && !next;
      const span = nBtn.querySelector('span');
      if (span) span.textContent = atLast ? '下一章' : '下一页';
      const nextTitle = chapter && chapter.nextId ? toc[chapIndexById(chapter.nextId)] : null;
      $('#next-label').textContent = atLast
        ? (nextTitle ? (nextTitle.titleZh || nextTitle.titleJp || '') : (next ? '下一章' : '已是结尾'))
        : '翻到下一页';
    }
    const total = toc.length;
    const idx = $('#idx-label');
    if (idx) idx.textContent = total ? ('第 ' + (index + 1) + ' / ' + total + ' 章') : '—';
  }

  function updateProgressUI() {
    const pct = currentPercent();
    const label = $('#pct-label');
    if (label) label.textContent = Math.round(pct * 100) + '%';
    const bar = $('#read-progress');
    if (bar) bar.style.width = (pct * 100) + '%';
    saveProgressDebounced(pct);
  }
  function updateTopProgress() {
    const bar = $('#read-progress');
    if (bar) bar.style.width = (currentPercent() * 100) + '%';
  }

  let saveTimer = null;
  function saveProgressDebounced(pct) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProgress(pct), 260);
  }
  function saveProgress(pct) {
    if (!chapter) return;
    if (pct == null) pct = currentPercent();
    pct = Math.max(0, Math.min(1, pct));
    progressAll[key] = {
      key: key, provider: provider, novel: novel,
      chapterId: chapterId, index: index,
      title: chapterTitle(), novelTitle: bookTitle(),
      percent: pct, updatedAt: Date.now()
    };
    saveJSON('nr.progress', progressAll);
  }

  function updateUrl() {
    try {
      const q = new URLSearchParams({
        provider: provider, novel: novel, chapter: chapterId, key: key,
        index: String(index), title: chapterTitle()
      });
      history.replaceState(null, '', 'reader.html?' + q.toString());
    } catch (e) {}
  }

  function prefetchNext() {
    if (isWenku || isLocal) return;
    const next = chapter && chapter.nextId;
    if (!next || loading) return;
    const idx = chapIndexById(next);
    if (idx < 0) return;
    if (sync(() => native.localChapter(key, idx), '')) return;
    api('novel/' + enc(provider) + '/' + enc(novel) + '/chapter/' + enc(next))
      .then(body => { try { prefetch = { id: next, data: JSON.parse(body) }; } catch (e) {} })
      .catch(() => {});
  }

  /* ---------------- navigation ---------------- */
  function goChapter(id, idx) {
    if (!id) { toast('没有更多章节了'); return; }
    closeSheet();
    loadChapter(id, idx, false);
    hideBars(true);
  }
  function goPrev() {
    if (!chapter) return;
    let id = chapter.prevId;
    let i = id ? chapIndexById(id) : -1;
    if (!id && index > 0) {
      for (let k = index - 1; k >= 0; k--) { if (toc[k] && toc[k].chapterId) { id = toc[k].chapterId; i = k; break; } }
    }
    if (!id) { toast('已经是第一章了'); return; }
    goChapter(id, i);
  }
  function goNext() {
    if (!chapter) return;
    let id = chapter.nextId;
    let i = id ? chapIndexById(id) : -1;
    if (!id && index < toc.length - 1) {
      for (let k = index + 1; k < toc.length; k++) { if (toc[k] && toc[k].chapterId) { id = toc[k].chapterId; i = k; break; } }
    }
    if (!id) { toast('已经是最后一章了'); return; }
    goChapter(id, i);
  }
  function nextPage() {
    if (page < totalPages - 1) {
      setPage(page + 1, true);
      if (page >= totalPages - 2) prefetchNext();
    } else {
      goNext();
    }
  }
  function prevPage() {
    if (page > 0) setPage(page - 1, true);
    else goPrev();
  }
  function goBack() {
    if (history.length > 1) history.back();
    else location.href = 'index.html#/home';
  }

  /* ---------------- toc / settings sheets ---------------- */
  function showSheet(html, kind) {
    clearAutoTurn();
    sheetKind = kind || '';
    sheetEl.innerHTML = '<div class="grab"></div><button class="sheet-x" data-act="close-sheet" aria-label="关闭">×</button>' + html;
    sheetEl.classList.add('show');
    scrimEl.classList.add('show');
    document.body.classList.add('sheet-open');
  }
  function closeSheet() {
    if (!sheetEl.classList.contains('show')) return;
    sheetKind = '';
    sheetEl.classList.remove('show');
    scrimEl.classList.remove('show');
    document.body.classList.remove('sheet-open');
    scheduleAutoTurn();
  }
  function tocRows() {
    const q = tocFilter.trim().toLowerCase();
    const rows = [];
    toc.forEach((item, i) => {
      if (!item) return;
      if (q) {
        const hay = ((item.titleZh || '') + ' ' + (item.titleJp || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      rows.push({ item: item, i: i });
    });
    if (!rows.length) return '<div style="text-align:center;color:var(--r-faint);font-size:11.5px;padding:24px">没有匹配的章节</div>';
    const shown = rows.slice(0, tocLimit);
    return shown.map(r => {
      const item = r.item;
      const enabled = !!item.chapterId;
      const cur = r.i === index;
      return '<button class="toc-row' + (cur ? ' current' : '') + (enabled ? '' : ' disabled') + '" data-chapter="' + esc(item.chapterId || '') + '" data-index="' + r.i + '">'
        + '<span class="n">' + (r.i + 1) + '</span>'
        + '<span class="t">' + esc(item.titleZh || item.titleJp || ('第 ' + (r.i + 1) + ' 章'))
        + (item.titleZh && item.titleJp ? '<small>' + esc(item.titleJp) + '</small>' : '') + '</span></button>';
    }).join('') + (rows.length > shown.length ? '<button class="toc-more" data-act="toc-more">显示更多（' + (rows.length - shown.length) + '）</button>' : '');
  }
  function openToc() {
    tocFilter = '';
    tocLimit = 500;
    const bt = bookTitle() || '目录';
    showSheet('<h2>目录</h2><p class="s-sub">' + esc(bt) + ' · 共 ' + toc.length + ' 章</p>'
      + '<div class="r-toc-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>'
      + '<input id="toc-filter" placeholder="在目录中查找…" autocomplete="off"></div>'
      + '<div id="toc-rows">' + tocRows() + '</div>', 'toc');
    setTimeout(() => {
      const cur = $('.toc-row.current');
      if (cur) cur.scrollIntoView({ block: 'center' });
      const inp = $('#toc-filter');
      if (inp && !('ontouchstart' in window)) inp.focus();
    }, 80);
  }
  function applyEnvironment() {
    try {
      if (native && native.setBrightness) native.setBrightness(settings.reader.brightness > 0 ? settings.reader.brightness : -1);
      if (native && native.keepScreenOn) native.keepScreenOn(settings.reader.keepAwake !== false);
    } catch (e) {}
  }
  function bookmarksFor() { return Array.isArray(bookmarks[key]) ? bookmarks[key] : []; }
  function isBookmarked() {
    return bookmarksFor().some(x => x && x.chapterId === chapterId);
  }
  function updateReaderButtons() {
    const b = document.querySelector('[data-act="bookmark"]');
    if (b) b.classList.toggle('active', isBookmarked());
    const sp = document.querySelector('[data-act="speak"]');
    if (sp) sp.classList.toggle('active', speaking);
  }
  function toggleBookmark() {
    if (!chapter) return;
    const list = bookmarksFor();
    const i = list.findIndex(x => x && x.chapterId === chapterId);
    if (i >= 0) {
      list.splice(i, 1);
      toast('已移除书签');
    } else {
      list.push({
        chapterId: chapterId, index: index,
        title: chapterTitle(), percent: currentPercent(), createdAt: Date.now()
      });
      toast('已添加书签');
    }
    bookmarks[key] = list;
    saveJSON('nr.bookmarks', bookmarks);
    updateReaderButtons();
  }
  function showBookmarks() {
    const list = bookmarksFor();
    let body = '';
    if (!list.length) {
      body = '<p class="s-sub">这本书还没有书签。翻到想记住的页面，点顶部书签按钮即可。</p>';
    } else {
      body = '<div class="bookmark-list">' + list.slice().sort((a, b) => (a.index || 0) - (b.index || 0)).map(bm =>
        '<div class="bookmark-row"><button class="bi" data-chapter="' + esc(bm.chapterId) + '" data-index="' + (bm.index || 0) + '">' + (bm.index + 1) + '</button>'
        + '<button class="bt" data-chapter="' + esc(bm.chapterId) + '" data-index="' + (bm.index || 0) + '"><b>' + esc(bm.title || ('第 ' + (bm.index + 1) + ' 章')) + '</b>'
        + '<span>' + Math.round((bm.percent || 0) * 100) + '% · ' + commentDateSafe(bm.createdAt) + '</span></button>'
        + '<button class="del" data-act="bookmark-delete" data-id="' + esc(bm.chapterId) + '">×</button></div>'
      ).join('') + '</div>';
    }
    showSheet('<h2>书签</h2><p class="s-sub">' + esc(bookTitle() || '') + ' · ' + list.length + ' 个</p>' + body
      + '<div class="r-actions" style="margin-top:12px"><button data-act="bookmark">' + (isBookmarked() ? '移除当前页书签' : '添加当前页书签') + '</button></div>', 'bookmarks');
  }
  function commentDateSafe(value) {
    const t = typeof value === 'number' ? value : Date.parse(String(value || ''));
    if (!isFinite(t)) return '';
    const diff = Date.now() - t;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    const d = new Date(t);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function stopSpeaking() {
    speaking = false;
    try { if (native && native.stopSpeak) native.stopSpeak(); } catch (e) {}
    updateReaderButtons();
  }
  function speakChapter() {
    if (!native || !native.speak) { toast('当前环境不支持朗读'); return; }
    if (speaking) { stopSpeaking(); toast('已停止朗读'); return; }
    const jp = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    const zh = Array.isArray(chapter[engine + 'Paragraphs']) ? chapter[engine + 'Paragraphs'] : [];
    const useZh = settings.reader.mode !== 'jp' && zh.some(x => String(x || '').trim());
    const arr = useZh ? zh : jp;
    const text = arr.map(x => String(x || '').trim())
      .filter(Boolean).filter(x => !/^!\[[^\]]*\]\(/.test(x)).join('\n');
    if (!text) { toast('本章没有可朗读的内容'); return; }
    try {
      native.speak(text);
      speaking = true;
      updateReaderButtons();
      toast('开始朗读');
    } catch (e) { toast('朗读启动失败'); }
  }
  function chapterPlainText() {
    if (!chapter) return '';
    const jp = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    const zh = Array.isArray(chapter[engine + 'Paragraphs']) ? chapter[engine + 'Paragraphs'] : [];
    const mode = settings.reader.mode || 'zh';
    const arr = mode === 'jp' ? jp : (mode === 'both' ? [] : (zh.some(x => String(x || '').trim()) ? zh : jp));
    if (mode === 'both') {
      const out = [];
      for (let i = 0; i < Math.max(jp.length, zh.length); i++) {
        if (jp[i]) out.push(String(jp[i]));
        if (zh[i]) out.push(String(zh[i]));
      }
      return out.filter(x => x && !/^!\[[^\]]*\]\(/.test(x)).join('\n');
    }
    return arr.map(x => String(x == null ? '' : x).trim()).filter(x => x && !/^!\[[^\]]*\]\(/.test(x)).join('\n');
  }
  function showExportSheet() {
    showSheet('<h2>导出书籍</h2><p class="s-sub">只导出已经下载到本机的章节；插图暂不包含在 EPUB 中。</p>'
      + '<div class="opt-list">'
      + '<button class="opt" data-act="export-format" data-format="txt"><div class="radio"></div><div><b>TXT 纯文本</b><span>兼容性最好，适合导入其他阅读器</span></div></button>'
      + '<button class="opt" data-act="export-format" data-format="epub"><div class="radio"></div><div><b>EPUB 电子书</b><span>带目录和章节，适合大多数阅读器</span></div></button>'
      + '</div><div class="r-actions"><button data-act="close-sheet">取消</button></div>');
  }
  async function doExport(format) {
    closeSheet();
    toast('正在生成 ' + (format === 'epub' ? 'EPUB' : 'TXT') + '…');
    try {
      await invoke('exportBook', provider, novel, format);
      toast('已导出');
    } catch (e) {
      toast(e.message || '导出失败');
    }
  }
  function settingsSheetHtml() {
    const r = settings.reader;
    const modes = [['zh', '译文'], ['jp', '原文'], ['both', '双语']];
    const themes = [['paper', '纸白'], ['sepia', '米黄'], ['green', '护眼'], ['dark', '夜间']];
    return '<h2>阅读设置</h2><p class="s-sub">修改会立即生效，并记住到下一章。</p>'
      + '<div class="set-group"><label>显示方式</label><div class="seg">'
      + modes.map(m => '<button data-set="mode" data-value="' + m[0] + '" class="' + (r.mode === m[0] ? 'active' : '') + '">' + m[1] + '</button>').join('') + '</div></div>'
      + '<div class="set-group"><label>阅读模式</label><div class="seg">'
      + [['page', '左右翻页'], ['scroll', '滚动'], ['vertical', '上下翻页']].map(m => '<button data-set="layout" data-value="' + m[0] + '" class="' + ((r.layout || 'page') === m[0] ? 'active' : '') + '">' + m[1] + '</button>').join('') + '</div></div>'
      + '<div class="set-group"><label>译文引擎</label><div class="choice-row">'
      + [['auto', '自动'], ['sakura', 'Sakura'], ['gpt', 'GPT'], ['youdao', '有道'], ['baidu', '百度']].map(e => '<button class="choice ' + (r.engine === e[0] ? 'active' : '') + '" data-set="engine" data-value="' + e[0] + '">' + e[1] + '</button>').join('')
      + '</div></div>'
      + '<div class="set-group"><label>排版</label>'
      + '<div class="row-between"><div><b>字号</b><span><span id="fs-num">' + r.fontSize + '</span> px</span></div></div>'
      + '<input class="r-range" id="fs-range" type="range" min="15" max="28" step="1" value="' + r.fontSize + '">'
      + '<div class="row-between"><div><b>行距</b><span><span id="lh-num">' + r.lineHeight + '</span> 倍</span></div></div>'
      + '<input class="r-range" id="lh-range" type="range" min="1.5" max="2.4" step="0.05" value="' + r.lineHeight + '">'
      + '<div class="row-between"><div><b>衬线字体</b><span>更接近纸书</span></div><button class="r-switch ' + (r.serif ? 'on' : '') + '" data-set="serif"></button></div>'
      + '</div>'
      + '<div class="set-group"><label>翻页与显示</label>'
      + '<div class="mini-label">翻页动画</div><div class="choice-row">'
      + [['slide', '滑动'], ['fade', '淡入'], ['none', '无动画']].map(a => '<button class="choice ' + ((r.animation || 'slide') === a[0] ? 'active' : '') + '" data-set="animation" data-value="' + a[0] + '">' + a[1] + '</button>').join('')
      + '</div><div class="mini-label">自动翻页</div><div class="choice-row">'
      + [['0', '关闭'], ['5', '5 秒'], ['10', '10 秒'], ['20', '20 秒'], ['30', '30 秒']].map(a => '<button class="choice ' + (String(r.autoTurn || 0) === a[0] ? 'active' : '') + '" data-set="autoTurn" data-value="' + a[0] + '">' + a[1] + '</button>').join('')
      + '</div>'
      + '<div class="row-between"><div><b>亮度</b><span id="bright-num">' + (r.brightness > 0 ? Math.round(r.brightness * 100) + '%' : '跟随系统') + '</span></div></div>'
      + '<input class="r-range" id="brightness-range" type="range" min="0" max="100" step="5" value="' + (r.brightness > 0 ? Math.round(r.brightness * 100) : 0) + '">'
      + '<div class="row-between"><div><b>屏幕常亮</b><span>阅读时不清屏</span></div><button class="r-switch ' + (r.keepAwake !== false ? 'on' : '') + '" data-set="awake"></button></div>'
      + '</div>'
      + '<div class="set-group"><label>背景</label><div class="row-between"><div><b>自定义背景色</b><span>会覆盖纸张主题</span></div><input type="color" id="reader-bg" value="' + (r.bg || '#fbfaf6') + '" style="width:44px;height:32px;border:0;border-radius:8px;background:transparent"></div></div>'
      + '<div class="set-group"><label>字体</label><div class="row-between"><div><b>自定义字体</b><span>支持 TTF / OTF</span></div><button class="r-mini" data-act="import-font">导入</button><button class="r-mini" data-act="clear-font">默认</button></div>'
      + '<input id="font-file" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf" style="display:none">'
      + '</div>'
      + '<div class="set-group"><label>手势</label>'
      + '<div class="gesture-block"><span>点左侧</span><div class="choice-row">' + [['prev','上一页'],['next','下一页'],['menu','菜单'],['toc','目录'],['settings','设置']].map(x => '<button class="choice ' + ((r.tapLeft || 'prev') === x[0] ? 'active' : '') + '" data-set="tapLeft" data-value="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>'
      + '<div class="gesture-block"><span>点中间</span><div class="choice-row">' + [['menu','菜单'],['prev','上一页'],['next','下一页'],['toc','目录'],['settings','设置']].map(x => '<button class="choice ' + ((r.tapCenter || 'menu') === x[0] ? 'active' : '') + '" data-set="tapCenter" data-value="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>'
      + '<div class="gesture-block"><span>点右侧</span><div class="choice-row">' + [['next','下一页'],['prev','上一页'],['menu','菜单'],['toc','目录'],['settings','设置']].map(x => '<button class="choice ' + ((r.tapRight || 'next') === x[0] ? 'active' : '') + '" data-set="tapRight" data-value="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>'
      + '</div>'
      + '<div class="set-group"><label>纸张</label><div class="themes">'
      + themes.map(t => '<button class="theme-btn th-' + t[0] + (r.theme === t[0] ? ' active' : '') + '" data-set="theme" data-value="' + t[0] + '"><i></i>' + t[1] + '</button>').join('')
      + '</div></div>'
      + '<p class="s-sub" style="margin-top:2px">音量键：音量＋上一页，音量－下一页。</p>'
      + '<div class="r-actions"><button data-act="bookmark">' + (isBookmarked() ? '移除书签' : '添加书签') + '</button>'
      + '<button data-act="bookmarks">书签列表</button><button data-act="speak">' + (speaking ? '停止朗读' : '朗读本章') + '</button></div>'
      + '<div class="r-actions"><button data-act="search-chapter">章节内搜索</button><button data-act="copy-chapter">复制本章</button></div>'
      + '<div class="r-actions"><button data-act="download-all">下载整本</button><button data-act="share">分享作品</button></div>' 
      + '<div class="r-actions" style="margin-top:8px"><button class="primary" data-act="close-sheet">完成</button></div>';
  }
  function openSettings() {
    showSheet(settingsSheetHtml(), 'settings');
  }
  function refreshSettingsSheet() {
    if (sheetKind !== 'settings') return;
    const y = sheetEl.scrollTop;
    sheetEl.innerHTML = '<div class="grab"></div>' + settingsSheetHtml();
    sheetEl.scrollTop = y;
  }

  /* ---------------- style ---------------- */
  function applyStyle() {
    const r = settings.reader;
    document.documentElement.dataset.readerTheme = r.theme;
    document.body.classList.toggle('simple-mode', !!settings.simpleMode);
    document.documentElement.style.setProperty('--r-size', r.fontSize + 'px');
    document.documentElement.style.setProperty('--r-lh', String(r.lineHeight));
    let font = r.serif ? 'var(--r-serif)' : '-apple-system, BlinkMacSystemFont, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    try {
      const custom = JSON.parse(localStorage.getItem('nr.font') || 'null');
      if (custom && custom.data) {
        let st = document.getElementById('nr-custom-font');
        if (!st) { st = document.createElement('style'); st.id = 'nr-custom-font'; document.head.appendChild(st); }
        st.textContent = '@font-face{font-family:NoveliaCustom;src:url(' + custom.data + ');}';
        font = 'NoveliaCustom, ' + font;
      }
    } catch (e) {}
    document.documentElement.style.setProperty('--r-font', font);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    let bg = { paper: '#fbfaf6', sepia: '#f4ead5', green: '#e2ecdb', dark: '#151a16' }[r.theme] || '#fbfaf6';
    if (r.bg) { bg = r.bg; const lum = (parseInt(bg.slice(1,3),16)*299 + parseInt(bg.slice(3,5),16)*587 + parseInt(bg.slice(5,7),16)*114) / 1000; document.documentElement.style.setProperty('--r-text', lum > 150 ? '#1b211c' : '#edf3ee'); }
    else document.documentElement.style.removeProperty('--r-text');
    document.documentElement.style.setProperty('--r-bg', bg);
    if (metaTheme) metaTheme.setAttribute('content', bg);
    if (native && native.setDark) { try { native.setDark(r.theme === 'dark'); } catch (e) {} }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  /* ---------------- bars / gestures ---------------- */
  function setVolumePaging(enabled) {
    try { if (native && native.setVolumePaging) native.setVolumePaging(!!enabled); } catch (e) {}
  }
  function hideBars(hidden) {
    const next = !!hidden;
    document.body.classList.toggle('bars-hidden', next);
    setVolumePaging(next);
  }
  function scheduleBarsHide() {
    clearTimeout(barsTimer);
    barsTimer = setTimeout(() => {
      if (!sheetEl.classList.contains('show')) hideBars(true);
    }, 3800);
  }
  function showBarsTemporarily() {
    hideBars(false);
    scheduleBarsHide();
  }
  function toggleBars() {
    const hide = !document.body.classList.contains('bars-hidden');
    hideBars(hide);
    if (hide) clearTimeout(barsTimer);
    else scheduleBarsHide();
  }

  let scrollSyncTimer = null;
  contentEl.addEventListener('scroll', () => {
    if (!isScrollLayout()) return;
    clearTimeout(scrollSyncTimer);
    scrollSyncTimer = setTimeout(() => {
      pageStep = Math.max(1, contentEl.clientHeight);
      page = Math.max(0, Math.min(totalPages - 1, Math.round(contentEl.scrollTop / pageStep)));
      updateNav(); updateProgressUI(); updateTopProgress();
    }, 60);
  }, { passive: true });
  contentEl.addEventListener('click', e => {
    if (e.target.closest('button, a')) return;
    if (Date.now() < suppressClickUntil) return;
    const sel = window.getSelection && String(window.getSelection().toString() || '');
    if (sel) return;
    if (sheetEl.classList.contains('show')) return;
    const x = e.clientX;
    const y = e.clientY;
    const r = settings.reader;
    if (x < window.innerWidth * 0.4) tapAction(r.tapLeft || 'prev');
    else if (x > window.innerWidth * 0.6) tapAction(r.tapRight || 'next');
    else tapAction(r.tapCenter || 'menu');
  });

  let tx = 0, ty = 0, tt = 0;
  contentEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    clearAutoTurn();
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
  }, { passive: true });
  contentEl.addEventListener('touchend', e => {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Date.now() - tt > 700) return;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      suppressClickUntil = Date.now() + 420;
      if (dx < 0) nextPage(); else prevPage();
    }
    setTimeout(scheduleAutoTurn, 1200);
  }, { passive: true });

  /* ---------------- events ---------------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act],[data-set],[data-chapter]');
    if (!el) {
      if (e.target === scrimEl) closeSheet();
      return;
    }
    if (el.hasAttribute('data-chapter')) {
      const id = el.getAttribute('data-chapter');
      const idx = parseInt(el.getAttribute('data-index') || '-1', 10);
      if (id) goChapter(id, idx);
      return;
    }
    if (el.hasAttribute('data-set')) {
      const keySet = el.getAttribute('data-set');
      const val = el.getAttribute('data-value');
      if (keySet === 'mode') {
        settings.reader.mode = val; saveSettings(); engine = pickEngine(chapter || {}); render(); refreshSettingsSheet();
      } else if (keySet === 'layout') {
        settings.reader.layout = val; saveSettings(); relayout(); refreshSettingsSheet();
      } else if (keySet === 'engine') {
        settings.reader.engine = val; saveSettings(); engine = pickEngine(chapter || {}); render(); refreshSettingsSheet();
      } else if (keySet === 'animation') {
        settings.reader.animation = val; saveSettings(); refreshSettingsSheet();
      } else if (keySet === 'autoTurn') {
        settings.reader.autoTurn = parseInt(val, 10) || 0; saveSettings(); scheduleAutoTurn(); refreshSettingsSheet();
      } else if (keySet === 'tapLeft' || keySet === 'tapCenter' || keySet === 'tapRight') {
        settings.reader[keySet] = val; saveSettings(); refreshSettingsSheet();
      } else if (keySet === 'theme') {
        settings.reader.theme = val; saveSettings(); applyStyle(); refreshSettingsSheet();
      } else if (keySet === 'serif') {
        settings.reader.serif = !settings.reader.serif; saveSettings(); relayout(); refreshSettingsSheet();
      } else if (keySet === 'awake') {
        settings.reader.keepAwake = settings.reader.keepAwake === false;
        saveSettings(); applyEnvironment(); refreshSettingsSheet();
      }
      return;
    }
    const act = el.getAttribute('data-act');
    switch (act) {
      case 'back': goBack(); break;
      case 'toc': openToc(); break;
      case 'settings': openSettings(); break;
      case 'prev': prevPage(); break;
      case 'next': nextPage(); break;
      case 'retry': init(); break;
      case 'close-sheet': closeSheet(); break;
      case 'toc-more': tocLimit += 500; { const r = $('#toc-rows'); if (r) r.innerHTML = tocRows(); } break;
      case 'export-book':
        if (isWenku || isLocal) { toast('文库缓存暂不支持导出'); break; }
        showExportSheet();
        break;
      case 'export-format':
        doExport(el.getAttribute('data-format') || 'txt');
        break;
      case 'download-all':
        if (isWenku || isLocal) { toast('文库已缓存，无需重复下载'); break; }
        if (native && native.download) {
          try {
            const queued = native.download(provider, novel, 0, 1, 0);
            if (!queued) throw new Error('下载服务未启动');
            if (native.requestNotifications) native.requestNotifications();
            toast('已加入下载队列');
          } catch (err) { toast('下载启动失败：' + (err && err.message ? err.message : '请检查通知权限')); }
        } else toast('请在 App 内使用下载');
        break;
      case 'bookmark': toggleBookmark(); if (sheetKind === 'bookmarks') showBookmarks(); else refreshSettingsSheet(); break;
      case 'bookmarks': showBookmarks(); break;
      case 'bookmark-delete': {
        const id = el.getAttribute('data-id');
        const list = bookmarksFor().filter(x => x && x.chapterId !== id);
        bookmarks[key] = list; saveJSON('nr.bookmarks', bookmarks);
        updateReaderButtons(); showBookmarks(); toast('已删除书签'); break;
      }
      case 'speak': speakChapter(); refreshSettingsSheet(); break;
      case 'search-chapter': {
        const q = String(prompt('章节内搜索') || '').trim();
        if (!q) break;
        const ok = window.find ? window.find(q, false, false, true) : false;
        toast(ok ? '已定位到「' + q + '」' : '没有找到「' + q + '」');
        break;
      }
      case 'copy-chapter': {
        const text = chapterPlainText();
        if (!text) { toast('本章没有可复制的内容'); break; }
        try {
          if (native && native.copyText) native.copyText(text);
          else if (navigator.clipboard) navigator.clipboard.writeText(text);
          toast('本章内容已复制');
        } catch (e) { toast('复制失败'); }
        break;
      }
      case 'import-font': {
        const f = $('#font-file'); if (f) f.click();
        break;
      }
      case 'clear-font':
        try { localStorage.removeItem('nr.font'); } catch (e) {}
        applyStyle(); refreshSettingsSheet(); toast('已恢复默认字体');
        break;
      case 'share':
        if (native && native.share) {
          const url = isLocal ? '' : (isWenku ? ('https://books.fishhawk.top/wenku/' + enc(novel)) : ('https://books.fishhawk.top/novel/' + enc(provider) + '/' + enc(novel)));
          try { native.share((bookTitle() || '') + (url ? '\n' + url : '')); } catch (err) {}
        }
        break;
      default: break;
    }
  });
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'toc-filter') {
      tocFilter = e.target.value;
      tocLimit = 500;
      const r = $('#toc-rows');
      if (r) r.innerHTML = tocRows();
    } else if (e.target && e.target.id === 'fs-range') {
      settings.reader.fontSize = parseInt(e.target.value, 10) || 18;
      saveSettings(); relayout();
      const n = $('#fs-num'); if (n) n.textContent = settings.reader.fontSize;
    } else if (e.target && e.target.id === 'lh-range') {
      settings.reader.lineHeight = parseFloat(e.target.value) || 1.95;
      saveSettings(); relayout();
      const n = $('#lh-num'); if (n) n.textContent = settings.reader.lineHeight;
    } else if (e.target && e.target.id === 'brightness-range') {
      const v = parseInt(e.target.value, 10) || 0;
      settings.reader.brightness = v <= 0 ? -1 : v / 100;
      saveSettings(); applyEnvironment();
      const n = $('#bright-num'); if (n) n.textContent = v <= 0 ? '跟随系统' : v + '%';
    }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'auto-turn') {
      settings.reader.autoTurn = parseInt(e.target.value, 10) || 0;
      saveSettings(); scheduleAutoTurn();
    } else if (e.target && e.target.id === 'reader-bg') {
      settings.reader.bg = e.target.value || '';
      saveSettings(); applyStyle();
    } else if (e.target && e.target.id === 'gesture-left') {
      settings.reader.tapLeft = e.target.value; saveSettings();
    } else if (e.target && e.target.id === 'gesture-center') {
      settings.reader.tapCenter = e.target.value; saveSettings();
    } else if (e.target && e.target.id === 'gesture-right') {
      settings.reader.tapRight = e.target.value; saveSettings();
    } else if (e.target && e.target.id === 'font-file') {
      const file = e.target.files && e.target.files[0];
      if (file) {
        if (file.size > 4 * 1024 * 1024) { toast('字体文件不能超过 4 MB'); e.target.value = ''; return; }
        const rd = new FileReader();
        rd.onload = () => {
          try {
            localStorage.setItem('nr.font', JSON.stringify({ name: file.name, data: String(rd.result || '') }));
            applyStyle(); refreshSettingsSheet(); toast('已应用字体：' + file.name);
          } catch (err) { toast('字体保存失败'); }
        };
        rd.readAsDataURL(file);
      }
      e.target.value = '';
    } else if (e.target && e.target.id === 'engine-select') {
      settings.reader.engine = e.target.value;
      saveSettings();
      engine = pickEngine(chapter || {});
      render();
    } else if (e.target && e.target.id === 'anim-select') {
      settings.reader.animation = e.target.value;
      saveSettings();
    }
  });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 60000) {
      try {
        const info = native && native.privacyInfo ? JSON.parse(native.privacyInfo()) : null;
        if (info && info.hasPin) { location.href = 'index.html#/home'; return; }
      } catch (e) {}
    }
    hiddenAt = 0;
  });
  window.addEventListener('pagehide', () => {
    flushStats(true);
    saveProgress();
    stopSpeaking();
    try {
      if (native && native.setBrightness) native.setBrightness(-1);
      if (native && native.keepScreenOn) native.keepScreenOn(false);
    } catch (e) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushStats(true); saveProgress(); }
    else { statsStart = Date.now(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') prevPage();
    else if (e.key === 'ArrowRight') nextPage();
    else if (e.key === 'Escape') closeSheet();
  });

  window.ReaderApp = {
    turnPage(dir) {
      if (sheetEl.classList.contains('show')) closeSheet();
      if (dir < 0) prevPage(); else nextPage();
      return true;
    },
    handleBack() {
      if (sheetEl.classList.contains('show')) { closeSheet(); return true; }
      goBack();
      return true;
    }
  };

  init();
})();
