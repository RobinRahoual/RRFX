/* RR FX — panneau : onglets, bloc d'état, application des effets et des rampes. */
(function () {
  'use strict';
  const Core = window.RRFXCore, Lib = window.RRFXLibrary, Pv = window.RRFXPreview;
  const Store = window.RRFXStorage, Host = window.RRFXHost, Keys = window.RRFXShortcuts, Updates = window.RRFXUpdates;
  const Audio = window.RRFXAudio, Media = window.RRFXMedia, Share = window.RRFXShare, Packs = window.RRFXPacks, Community = window.RRFXCommunity;
  const { h, hotText, actionGroup, picker, checkbox, row, section, CurveEditor, RampEditor, Player } = window.RRFXUI;

  const INSTAGRAM_URL = 'https://www.instagram.com/robin.rahoual/';
  const LONG_TASK_MS = 8000; // au-delà, signal de fin
  const MAX_LOG_LINES = 300;
  const MAX_HISTORY = 10;

  const PLACEMENTS = [
    { v: 'cut', label: 'Coupe la plus proche' },
    { v: 'cuts', label: 'Toutes les coupes de la sélection' },
    { v: 'markers', label: 'Marqueurs de la séquence' },
    { v: 'playhead', label: 'Tête de lecture' },
    { v: 'clipStart', label: 'Début des clips sélectionnés' },
    { v: 'clipEnd', label: 'Fin des clips sélectionnés' },
    { v: 'full', label: 'Clips sélectionnés entiers' }
  ];
  const VARIATIONS = [
    { v: 'same', label: 'Identique partout' },
    { v: 'seed', label: 'Variation aléatoire' },
    { v: 'category', label: 'Effet au hasard (même catégorie)' },
    { v: 'favorites', label: 'Effet au hasard (favoris)' }
  ];
  const RAMP_PLACEMENTS = [
    { v: 'pre', label: 'Avant la coupe' },
    { v: 'post', label: 'Après la coupe' },
    { v: 'playhead', label: 'Autour de la tête de lecture' },
    { v: 'full', label: 'Clip entier' }
  ];
  const DEFAULT_SETTINGS = {
    target: 'adjustment', placement: 'cut', side: 'both', vary: 'seed', adjNodeId: null, adjName: '', registry: {},
    tab: 'effects', confirmRamp: true, confirmUndo: true, compact: false, endSound: true, checkUpdates: true, shortcuts: null, copyLook: true,
    volumeFollow: false, volumeInfluence: 60, overlays: [], overlayBlend: 8, overlayBlendLearned: false,
    ramp: { points: Core.RAMP_PRESETS.intoCut.points, frames: 12, placement: 'pre', segments: 10, anchor: 'auto', interp: 'keep', preset: 'intoCut' }
  };

  const S = {
    lib: null, ctx: null, demo: false, busy: false, cancel: false,
    tab: 'effects', cat: 'all', search: '', favOnly: false,
    cur: null, params: null, resolved: null, compat: null,
    player: null, rampPlayer: null, curveEd: null, rampEd: null,
    logLines: [], shortcuts: null, capturing: null, update: null,
    mineView: 'mine', comm: { list: null, loading: false, error: '', search: '', sort: 'popular', type: 'all', at: 0 }
  };

  // ---------------------------------------------------------------- utils

  const $ = id => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const settings = () => S.lib.settings;
  const registry = () => Core.mergeRegistry(settings().registry, S.resolved);
  const fps = () => (S.ctx && S.ctx.fps) || 25;
  const CATS = Lib.CATEGORIES.concat([{ id: 'overlay', label: 'Overlays' }]);
  const catLabel = id => (CATS.find(c => c.id === id) || { label: id === 'mine' ? 'Mes effets' : id }).label;
  // Modes de fusion de l'Opacité de Premiere (valeurs de script) et leur équivalent pour l'aperçu.
  const BLENDS = [
    { v: 8, label: 'Écran', css: 'screen' }, { v: 10, label: 'Densité linéaire - (Ajout)', css: 'lighter' },
    { v: 7, label: 'Éclaircir', css: 'lighten' }, { v: 12, label: 'Incrustation', css: 'overlay' },
    { v: 13, label: 'Lumière tamisée', css: 'soft-light' }, { v: 3, label: 'Produit', css: 'multiply' }, { v: 0, label: 'Normal', css: 'source-over' }
  ];
  const plural = (n, one, many) => n + ' ' + (n > 1 ? (many || one + 's') : one);
  const errorMessage = e => (e && e.message ? e.message : String(e));
  const clone = o => JSON.parse(JSON.stringify(o));

  function show(el, visible) { el.classList.toggle('hidden', !visible); }
  function setDisabled(el, disabled) { el.disabled = !!disabled; }

  // localStorage peut être indisponible : les préférences restent alors en mémoire.
  const memory = new Map();
  const storage = (() => { try { return window.localStorage || null; } catch (e) { return null; } })()
    || { getItem: k => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)) };

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { Store.save(S.lib); } catch (e) { log('Sauvegarde impossible : ' + errorMessage(e), 'error'); }
    }, 250);
  }

  // ---------------------------------------------------------------- journal

  function log(message, level) {
    level = level || 'info';
    S.logLines.push({ message, level });
    if (S.logLines.length > MAX_LOG_LINES) S.logLines.shift();
    const box = $('log');
    if (box) {
      box.appendChild(h('div', { class: level }, message));
      while (box.childNodes.length > MAX_LOG_LINES) box.removeChild(box.firstChild);
    }
  }

  // ---------------------------------------------------------------- bloc d'état

  function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  }

  const status = (() => {
    let title = '', started = 0, phaseLabel = '', phaseStarted = 0, ticker = null, lastUpdate = 0, frame = 0, kindNow = 'idle';
    const SPINNER = ['◐', '◓', '◑', '◒'];
    const setKind = kind => { kindNow = kind; $('status').className = 'status ' + kind; };

    // Toutes les 250 ms : icône animée et temps écoulé, pour voir que ça tourne.
    function tick() {
      frame = (frame + 1) % SPINNER.length;
      $('status-icon').textContent = SPINNER[frame];
      $('status-title').textContent = title + ' · ' + formatDuration(Date.now() - started);
    }
    function start(text, cancellable) {
      title = text; started = Date.now(); phaseLabel = '';
      setKind('running');
      show($('cancel'), !!cancellable);
      show($('status-close'), false);
      show($('status-log'), false);
      show($('progress'), false);
      $('progress-fill').style.width = '0%';
      $('status-detail').textContent = 'Démarrage…';
      if (ticker) clearInterval(ticker);
      ticker = setInterval(tick, 250);
      tick();
    }
    function phase(label) {
      phaseLabel = label; phaseStarted = Date.now(); lastUpdate = 0;
      $('status-detail').textContent = label + '…';
    }
    // Mise à jour limitée à ~10 fois par seconde.
    function progress(done, total, name) {
      const now = Date.now();
      if (done < total && now - lastUpdate < 100) return;
      lastUpdate = now;
      show($('progress'), total > 1);
      $('progress-fill').style.width = Math.round(Math.min(done, total) / Math.max(1, total) * 100) + '%';
      let text = phaseLabel + ' · ' + Math.min(done + (name ? 1 : 0), total) + '/' + total;
      if (name) text += ' · ' + name;
      if (done >= 2 && done < total) {
        const remaining = (now - phaseStarted) / done * (total - done);
        if (remaining > 1500) text += ' · encore ~' + formatDuration(remaining);
      }
      $('status-detail').textContent = text;
    }
    // kind : "ok" | "warn" | "error" | "idle"
    function finish(kind, text, detail) {
      if (ticker) clearInterval(ticker);
      ticker = null;
      setKind(kind);
      $('status-icon').textContent = { ok: '✓', warn: '⚠', error: '✕', idle: '' }[kind] || '';
      $('status-title').textContent = text;
      $('status-detail').textContent = detail || '';
      show($('cancel'), false);
      show($('progress'), false);
      show($('status-close'), kind !== 'idle');
      show($('status-log'), kind === 'warn' || kind === 'error');
      if (kind === 'idle') renderIdleDetail();
    }
    function reset() { finish('idle', 'Prêt', ''); }
    return { start, phase, progress, finish, reset, get kind() { return kindNow; } };
  })();

  function renderIdleDetail() {
    if (status.kind !== 'idle') return;
    const c = S.ctx;
    let text;
    if (!c) text = 'Connexion à Premiere…';
    else if (!c.hasSequence) text = 'Ouvre une séquence dans Premiere.';
    else {
      const parts = [c.name, (Math.round(c.fps * 100) / 100) + ' i/s'];
      parts.push(c.selection ? plural(c.selection, 'clip sélectionné', 'clips sélectionnés') : 'aucun clip sélectionné');
      if (c.markers) parts.push(plural(c.markers, 'marqueur'));
      text = parts.join(' · ');
    }
    if (S.demo) text = 'Mode démo (hors Premiere) · ' + text;
    $('status-detail').textContent = text;
  }

  function setBusy(value) {
    S.busy = value;
    renderCTA();
    renderUndo();
  }

  // Exécute une tâche avec le bloc d'état. La tâche renvoie { kind, title, detail } ;
  // une exception = échec.
  async function runTask(label, task, cancellable) {
    if (S.busy) return null;
    S.cancel = false;
    setBusy(true);
    status.start(label, cancellable);
    const started = Date.now();
    try {
      const result = (await task()) || { kind: 'ok', title: 'Terminé' };
      status.finish(result.kind, result.title, result.detail);
      if (Date.now() - started > LONG_TASK_MS && result.kind !== 'idle') signalEnd();
      return result;
    } catch (e) {
      status.finish('error', 'Échec', errorMessage(e));
      log(errorMessage(e), 'error');
      if (Date.now() - started > LONG_TASK_MS) signalEnd();
      return { kind: 'error' };
    } finally {
      setBusy(false);
      refreshContext();
    }
  }

  // ---------------------------------------------------------------- signal de fin

  function flash(el) {
    let n = 0;
    const timer = setInterval(() => {
      el.classList.toggle('flash', n % 2 === 0);
      if (++n >= 6) { clearInterval(timer); el.classList.remove('flash'); }
    }, 250);
  }

  let audio = null;
  function playEndSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.35);
        o.connect(g).connect(audio.destination);
        o.start(t + i * 0.12);
        o.stop(t + i * 0.12 + 0.4);
      });
    } catch (e) { /* audio indisponible : le clignotement suffit */ }
  }

  function signalEnd() {
    flash($('status'));
    if (settings().endSound) playEndSound();
  }

  // ---------------------------------------------------------------- fenêtres

  function modal(title, body, buttons) {
    return new Promise(resolve => {
      const root = $('modal-root');
      const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const primary = buttons.find(b => b.primary);
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && primary) { e.stopPropagation(); e.preventDefault(); close(typeof primary.value === 'function' ? primary.value() : primary.value); }
      };
      const box = h('div', { class: 'modal' },
        h('div', { class: 'modal-title' }, title),
        h('div', { class: 'modal-body' }, body),
        h('footer', null, buttons.map(b => {
          const el = h('button', { class: b.primary ? 'cta' : 'button-secondary' }, b.label);
          el.addEventListener('click', () => close(typeof b.value === 'function' ? b.value() : b.value));
          return el;
        })));
      const back = h('div', { class: 'modal-back' }, box);
      back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
      root.innerHTML = '';
      root.appendChild(back);
      document.addEventListener('keydown', onKey, true);
      const first = box.querySelector('input.textfield');
      if (first) { first.focus(); first.select(); }
    });
  }

  function promptName(title, value) {
    const input = h('input', { class: 'textfield', value: value || '' });
    return modal(title, input, [
      { label: 'Annuler', value: null },
      { label: 'Enregistrer', primary: true, value: () => input.value.trim() || null }
    ]);
  }

  async function confirmDialog(title, text, okLabel, settingKey) {
    if (settingKey && !settings()[settingKey]) return true;
    const dont = settingKey ? checkbox('Ne plus demander', false, () => {}) : null;
    const ok = await modal(title, h('div', null, h('p', null, text), dont), [
      { label: 'Annuler', value: false },
      { label: okLabel, primary: true, value: true }
    ]);
    if (ok && dont && dont.querySelector('input').checked) { settings()[settingKey] = false; persist(); }
    return !!ok;
  }

  // ---------------------------------------------------------------- thème

  function applyTheme() {
    const env = Host.hostEnv();
    const c = env && env.appSkinInfo && env.appSkinInfo.panelBackgroundColor && env.appSkinInfo.panelBackgroundColor.color;
    let light = false;
    if (c) {
      const r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
      light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
      document.documentElement.style.setProperty('--bg', 'rgb(' + r + ',' + g + ',' + b + ')');
    }
    document.body.classList.toggle('theme-light', light);
    document.body.classList.toggle('theme-dark', !light);
    if (S.curveEd) S.curveEd.draw();
    if (S.rampEd) S.rampEd.draw();
  }

  // ---------------------------------------------------------------- contexte Premiere

  let ctxPending = false;
  async function refreshContext() {
    if (ctxPending || S.busy) return;
    ctxPending = true;
    try {
      const r = await Host.call('getContext', {});
      if (r && r.ok) {
        S.ctx = r;
        renderIdleDetail();
      }
    } finally {
      ctxPending = false;
    }
  }

  // ---------------------------------------------------------------- effets (entrées)

  function entries() {
    const out = Lib.EFFECTS.map(def => ({ key: 'b:' + def.id, kind: 'builtin', name: def.name, cat: def.cat, def }));
    S.lib.items.forEach(item => {
      if (item.type === 'preset') {
        const def = Lib.byId[item.data.base];
        if (def) out.push({ key: 'u:' + item.id, kind: 'preset', name: item.name, cat: item.cat || def.cat, def, item });
      } else if (item.type === 'captured' && Array.isArray(item.data.components)) {
        out.push({ key: 'u:' + item.id, kind: 'captured', name: item.name, cat: item.cat || 'mine', def: null, item });
      }
    });
    (settings().overlays || []).forEach(o => out.push({ key: 'o:' + o.id, kind: 'overlay', name: o.name, cat: 'overlay', def: null, overlay: o }));
    // Packs fournis : dessinés par RR FX, fabriqués en images à la première utilisation.
    Packs.ALL.forEach(d => out.push({ key: 'p:' + d.id, kind: 'overlay', name: d.name, cat: 'overlay', def: null, overlay: { id: 'pack:' + d.id, name: d.name, kind: 'sequence', pack: d.id, start: 'random' } }));
    return out;
  }

  const entryByKey = key => entries().find(e => e.key === key) || null;

  function defaultParams(entry) {
    if (entry.kind === 'overlay') return { frames: 10, intensity: 85, curve: Core.curveValue('easeInOut'), start: entry.overlay.start || 'random' };
    if (entry.kind === 'captured') return { frames: Math.max(1, entry.item.data.frames || 8), stretch: true, mirror: true };
    const p = Core.paramDefaults(entry.def);
    if (entry.kind === 'preset') Object.assign(p, clone(entry.item.data.params || {}));
    return p;
  }

  function compileFor(entry, params, side, N, rate) {
    if (entry.kind === 'overlay') return Core.compileOverlay(params, side, N, settings().overlayBlend);
    if (entry.kind === 'captured') return Core.compileCaptured(entry.item.data, side, N, { stretch: params.stretch, mirror: params.mirror }, registry());
    return Core.compileEffect(entry.def, params, side, N, rate, registry());
  }

  // Tous les effets se posent sur un calque de réglage. Seuls ceux qui ont besoin des images
  // du plan (Motion blur / Écho : « CLIP FX ») se posent sur une copie du plan.
  const targetFor = entry => (entry.kind === 'overlay' ? 'overlay' : entry.def && entry.def.target ? entry.def.target : 'adjustment');

  function activeSides() {
    const pl = settings().placement, side = settings().side;
    if (pl === 'clipStart') return ['post'];
    if (pl === 'clipEnd') return ['pre'];
    if (pl === 'full') return [side === 'pre' ? 'pre' : 'post'];
    return side === 'both' ? ['pre', 'post'] : [side];
  }

  const isFav = entry => S.lib.favorites.indexOf(entry.key) >= 0;
  function toggleFav(entry) {
    const i = S.lib.favorites.indexOf(entry.key);
    if (i >= 0) S.lib.favorites.splice(i, 1); else S.lib.favorites.push(entry.key);
    persist();
  }

  // ---------------------------------------------------------------- aperçus

  function previewFrames(entry, params, sides) {
    const N = Math.max(1, Math.round(params.frames));
    const specs = {
      pre: sides.indexOf('pre') >= 0 ? compileFor(entry, params, 'pre', N, fps()) : null,
      post: sides.indexOf('post') >= 0 ? compileFor(entry, params, 'post', N, fps()) : null
    };
    return Pv.buildTimeline(specs, { pre: N, post: N }, 6);
  }

  // ---------------------------------------------------------------- overlays (médias)

  const fileURL = p => {
    const u = String(p).replace(/\\/g, '/');
    return 'file://' + (u[0] === '/' ? '' : '/') + encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F');
  };
  const ovMedia = new Map();
  // L'image ou la vidéo d'un overlay, chargée une fois (lecture en boucle, muette).
  function overlayMedia(o, onReady) {
    let m = ovMedia.get(o.id);
    if (!m) {
      const isImage = o.kind === 'image';
      const el = isImage ? new Image() : document.createElement('video');
      m = { el, ready: false, waiting: [] };
      ovMedia.set(o.id, m);
      const ok = () => { m.ready = true; m.waiting.splice(0).forEach(f => f()); };
      if (isImage) el.onload = ok;
      else {
        el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto';
        el.addEventListener('loadeddata', () => { try { el.currentTime = Math.min(1, (el.duration || 2) * 0.3); } catch (e) { /* lecture seule */ } ok(); }, { once: true });
      }
      el.onerror = () => { m.failed = true; };
      el.src = o.url || fileURL(o.path);
    }
    if (m.ready) onReady && onReady(m);
    else if (onReady) m.waiting.push(() => onReady(m));
    return m;
  }

  function blendCss(v) { return (BLENDS.find(b => b.v === Number(v)) || BLENDS[0]).css; }

  // Image n d'un overlay de pack, dessinée à la taille voulue (canevas réutilisé).
  const packCanvas = {};
  function packFrame(id, w, h, n) {
    const key = w + 'x' + h;
    const c = packCanvas[key] || (packCanvas[key] = document.createElement('canvas'));
    c.width = w; c.height = h;
    const total = Packs.frameCount(fps()), i = ((Math.round(n) % total) + total) % total;
    Packs.draw(c.getContext('2d'), w, h, i / (total - 1), i, Packs.byId[id]);
    return c;
  }

  // Fabrique (une fois) la séquence d'images JPEG d'un overlay de pack, à la taille de la
  // séquence. Renvoie { path: première image, fps } ou null si arrêté.
  async function buildPack(def, rate) {
    const size = Packs.frameSize(S.ctx && S.ctx.frameW, S.ctx && S.ctx.frameH), total = Packs.frameCount(rate);
    if (!Store.fs) return { path: Packs.fileName(def, 0), fps: rate };
    const dir = Store.path.join(Store.dir, 'Overlays', Packs.folderName(def, size.W, size.H, rate));
    const first = Store.path.join(dir, Packs.fileName(def, 0)).replace(/\\/g, '/');
    if (Store.fs.existsSync(Store.path.join(dir, 'ok.json'))) return { path: first, fps: rate };
    Store.fs.mkdirSync(dir, { recursive: true });
    status.phase('Fabrication de « ' + def.name + ' » (' + size.W + '×' + size.H + ', une seule fois)');
    const c = document.createElement('canvas');
    c.width = size.W; c.height = size.H;
    const g = c.getContext('2d');
    for (let i = 0; i < total; i++) {
      if (S.cancel) return null;
      status.progress(i, total, '');
      Packs.draw(g, size.W, size.H, i / (total - 1), i, def);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Image de l\'overlay non fabriquée (mémoire ?)');
      Store.fs.writeFileSync(Store.path.join(dir, Packs.fileName(def, i)), new Uint8Array(await blob.arrayBuffer()));
    }
    Store.fs.writeFileSync(Store.path.join(dir, 'ok.json'), JSON.stringify({ id: def.id, frames: total, fps: rate, W: size.W, H: size.H }));
    log('Overlay « ' + def.name + ' » fabriqué : ' + dir, 'ok');
    return { path: first, fps: rate };
  }

  function drawOverlayOn(g, entry, alpha, n) {
    if (alpha <= 0.001) return;
    const cw = g.canvas.width, ch = g.canvas.height;
    if (entry.overlay.pack) {
      const img = packFrame(entry.overlay.pack, cw, ch, n || 0);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = Math.min(1, alpha);
      g.globalCompositeOperation = blendCss(settings().overlayBlend);
      g.drawImage(img, 0, 0);
      g.restore();
      return;
    }
    const m = overlayMedia(entry.overlay);
    if (!m.ready) return;
    const el = m.el;
    const iw = el.videoWidth || el.naturalWidth || 16, ih = el.videoHeight || el.naturalHeight || 9, k = Math.max(cw / iw, ch / ih);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = Math.min(1, alpha);
    g.globalCompositeOperation = blendCss(settings().overlayBlend);
    try { g.drawImage(el, (cw - iw * k) / 2, (ch - ih * k) / 2, iw * k, ih * k); } catch (e) { /* vidéo pas encore lisible */ }
    g.restore();
  }

  const OVERLAY_FILES = /\.(mov|mp4|m4v|webm|png|jpe?g)$/i;
  function overlayFrom(file) {
    const p = typeof file === 'string' ? file : file.path || file.name;
    const name = String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    return { id: uid(), name, path: p, kind: /\.(png|jpe?g)$/i.test(p) ? 'image' : 'video', start: 'random', url: typeof file === 'string' ? undefined : file.url };
  }
  function addOverlayList(list) {
    const st = settings(), known = new Set(st.overlays.map(o => o.path));
    const fresh = list.map(overlayFrom).filter(o => OVERLAY_FILES.test(o.path) && !known.has(o.path));
    if (!fresh.length) { status.finish('warn', 'Aucun overlay ajouté', 'Formats pris en charge : MOV, MP4, WEBM, PNG, JPG (ou déjà dans la liste).'); return; }
    st.overlays = st.overlays.concat(fresh);
    persist();
    S.cat = 'overlay';
    S.cur = entryByKey('o:' + fresh[0].id);
    S.params = defaultParams(S.cur);
    renderEffectsView();
    status.finish('ok', plural(fresh.length, 'overlay ajouté', 'overlays ajoutés'), 'Choisis-en un, règle sa durée et son mode de fusion, puis applique-le sur tes coupes.');
  }
  function addOverlays(fromFolder) {
    if (fromFolder === true) {
      const dirs = Store.pickFiles('Choisir un dossier d\'overlays', [], true);
      if (dirs && dirs.length) addOverlayList(Store.listFiles(dirs[0], OVERLAY_FILES, 200, 3));
      return;
    }
    const picked = Store.pickFiles('Choisir des overlays (vidéos ou images)', ['mov', 'mp4', 'm4v', 'webm', 'png', 'jpg', 'jpeg']);
    if (picked) { if (picked.length) addOverlayList(picked); return; }
    // Hors de Premiere (démo) : sélecteur du navigateur.
    const input = h('input', { type: 'file', class: 'hidden', multiple: true, accept: 'video/*,image/png,image/jpeg' });
    input.addEventListener('change', () => addOverlayList(Array.from(input.files).map(f => ({ name: f.name, url: URL.createObjectURL(f) }))));
    input.click();
  }
  async function learnBlend() {
    const r = await Host.call('readBlend', {});
    if (!r.ok) return status.finish('error', 'Mode de fusion illisible', r.error);
    settings().overlayBlend = Number(r.value);
    settings().overlayBlendLearned = true;
    persist();
    renderInspector();
    const known = BLENDS.find(b => b.v === Number(r.value));
    status.finish('ok', 'Mode de fusion appris', (known ? known.label : 'valeur ' + r.value) + ' : utilisé pour tous les overlays.');
  }

  // Aperçu sur la vraie image : 2 images exportées autour de la coupe la plus proche.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image illisible'));
      img.src = src;
    });
  }
  function grabRealFrames() {
    return runTask('Aperçu réel', async () => {
      const dir = Store.cacheDir();
      if (!dir) return { kind: 'warn', title: 'Disponible dans Premiere', detail: 'L\'aperçu sur ta séquence exporte deux images de la timeline : il faut le panneau dans Premiere.' };
      Store.listFiles(dir, /^rrfx-frame-/, 50, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
      status.phase('Export de deux images autour de la coupe');
      const r = await Host.call('grabFrames', { folder: dir.replace(/\\/g, '/'), prefix: 'rrfx-frame-' + uid() + '-' });
      if (!r.ok) return { kind: 'error', title: 'Aperçu réel impossible', detail: r.error };
      // Premiere écrit les fichiers après coup : on attend qu'ils existent (avec ou sans .png).
      const found = [];
      for (let t = 0; t < 40 && found.length < r.files.length; t++) {
        found.length = 0;
        r.files.forEach(f => { const g = [f, f + '.png'].find(x => Store.fs.existsSync(x) && Store.fs.statSync(x).size > 0); if (g) found.push(g); });
        if (found.length < r.files.length) await new Promise(res => setTimeout(res, 150));
      }
      if (found.length < r.files.length) return { kind: 'error', title: 'Aperçu réel impossible', detail: 'Premiere n\'a pas écrit les images (' + dir + ').' };
      const imgs = await Promise.all(found.map(f => loadImage(fileURL(f) + '?' + Date.now())));
      Pv.setShots(imgs[0], imgs[1]);
      renderInspector();
      return { kind: 'ok', title: 'Aperçu sur ta séquence', detail: 'Images autour de la coupe à ' + r.cut.toFixed(2) + ' s. « Plans de test » pour revenir.' };
    });
  }
  function useTestShots() {
    Pv.resetShots();
    renderInspector();
  }

  function drawThumb(canvas, entry) {
    if (entry.kind === 'overlay' && entry.overlay.pack) {
      const g = canvas.getContext('2d');
      Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
      drawOverlayOn(g, entry, 0.95, Math.round(fps() * 0.8));
      return;
    }
    if (entry.kind === 'overlay') {
      const g = canvas.getContext('2d');
      Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
      overlayMedia(entry.overlay, () => { Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null); drawOverlayOn(g, entry, 0.9); });
      return;
    }
    try {
      const p = defaultParams(entry);
      const side = entry.kind === 'captured' ? (entry.item.data.origin || 'post') : 'pre';
      const N = Math.max(2, Math.round(p.frames));
      const spec = compileFor(entry, p, side, N, 25);
      let i = side === 'pre' ? N - 1 : 0, j = side === 'pre' ? N - 2 : 1;
      // Un pic tout noir (dips) ne dit rien : on montre l'image d'avant.
      if (Pv.stateAt(spec, i).opacity < 0.15) { i = j; j = side === 'pre' ? Math.max(0, i - 1) : Math.min(N - 1, i + 1); }
      Pv.render(canvas.getContext('2d'), Pv.shots()[side === 'pre' ? 'A' : 'B'], Pv.stateAt(spec, i), Pv.stateAt(spec, j));
    } catch (e) {
      log('Vignette « ' + entry.name + ' » : ' + errorMessage(e), 'warn');
    }
  }

  let thumbAnim = null;
  function animateThumb(canvas, entry) {
    stopThumb();
    if (entry.kind === 'overlay' && entry.overlay.pack) {
      // Survol d'un overlay de pack : il défile sur le plan de test.
      const g = canvas.getContext('2d');
      let n = 0, last = 0;
      const loop = ts => {
        thumbAnim = requestAnimationFrame(loop);
        if (ts - last < 40) return;
        last = ts;
        Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
        drawOverlayOn(g, entry, 0.95, n++);
      };
      thumbAnim = requestAnimationFrame(loop);
      return;
    }
    if (entry.kind === 'overlay') return;
    let frames;
    try { frames = previewFrames(entry, defaultParams(entry), ['pre', 'post']); } catch (e) { return; }
    let n = 0, last = 0;
    const g = canvas.getContext('2d');
    const loop = ts => {
      thumbAnim = requestAnimationFrame(loop);
      if (ts - last < 40) return;
      last = ts;
      Pv.renderTimelineFrame(g, frames, n);
      n = (n + 1) % frames.length;
    };
    thumbAnim = requestAnimationFrame(loop);
  }
  function stopThumb() {
    if (thumbAnim) cancelAnimationFrame(thumbAnim);
    thumbAnim = null;
  }

  // ---------------------------------------------------------------- onglet Effets

  function renderEffectsView() {
    const view = $('view-effects');
    view.innerHTML = '';
    const search = h('input', { class: 'textfield', placeholder: 'Rechercher un effet', value: S.search, spellcheck: 'false' });
    search.addEventListener('input', () => { S.search = search.value; renderGrid(); });
    const fav = h('button', { class: 'action icon' + (S.favOnly ? ' selected on' : ''), title: 'Favoris uniquement' }, '★');
    fav.addEventListener('click', () => { S.favOnly = !S.favOnly; fav.classList.toggle('selected', S.favOnly); fav.classList.toggle('on', S.favOnly); renderGrid(); });
    view.appendChild(h('div', { class: 'search' }, search, fav));

    const chips = h('div', { class: 'chips' });
    [{ id: 'all', label: 'Tout' }].concat(CATS, [{ id: 'mine', label: 'Mes effets' }]).forEach(c => {
      const b = h('button', { class: 'action' + (S.cat === c.id ? ' selected' : '') }, c.label);
      b.addEventListener('click', () => {
        S.cat = c.id;
        chips.querySelectorAll('.action').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        renderGrid();
      });
      chips.appendChild(b);
    });
    view.appendChild(chips);
    view.appendChild(h('div', { class: 'grid', id: 'grid' }));
    view.appendChild(h('div', { id: 'inspector' }));
    renderGrid();
    renderInspector();
  }

  function visibleEntries() {
    const q = Core.normName(S.search);
    return entries().filter(e => {
      if (S.favOnly && !isFav(e)) return false;
      if (S.cat === 'mine' && e.kind === 'builtin') return false;
      if (S.cat !== 'all' && S.cat !== 'mine' && e.cat !== S.cat) return false;
      if (q && Core.normName(e.name + ' ' + catLabel(e.cat)).indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderGrid() {
    const grid = $('grid');
    if (!grid) return;
    stopThumb();
    grid.innerHTML = '';
    const list = visibleEntries();
    if (S.cat === 'overlay') {
      const add = h('div', { class: 'card add-card', title: 'Light leaks, grain, poussière, flares… (vidéos ou images)' }, h('div', { class: 'thumb add-thumb' }, '＋'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, 'Ajouter des overlays')));
      add.addEventListener('click', () => addOverlays(false));
      grid.appendChild(add);
      if (Store.onDisk) {
        const folder = h('div', { class: 'card add-card', title: 'Ajoute toutes les vidéos et images d\'un dossier (pack d\'overlays)' }, h('div', { class: 'thumb add-thumb' }, '▤'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, 'Ajouter un dossier')));
        folder.addEventListener('click', () => addOverlays(true));
        grid.appendChild(folder);
      }
    }
    if (!list.length) {
      if (S.cat === 'overlay') return;
      grid.appendChild(h('div', { class: 'empty' }, S.cat === 'mine'
        ? 'Aucun effet perso : enregistre un preset (« ＋ Preset » sur un effet) ou capture un clip dans « Mes effets ».'
        : 'Aucun effet ne correspond.'));
      return;
    }
    list.forEach(e => {
      const cv = h('canvas', { width: 160, height: 90 });
      const card = h('div', { class: 'card' + (S.cur && S.cur.key === e.key ? ' on' : ''), 'data-key': e.key, title: e.def ? e.def.desc : 'Effet capturé' },
        h('div', { class: 'thumb' }, cv, e.kind !== 'builtin' ? h('span', { class: 'user-mark' }, e.kind === 'overlay' && e.overlay.pack ? Packs.byId[e.overlay.pack].packName : ({ captured: 'capturé', overlay: 'overlay' })[e.kind] || 'preset') : null),
        h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, e.name),
          e.def && e.def.target ? h('span', { class: 'tag' }, 'COPIE') : null,
          isFav(e) ? h('span', { class: 'fav-mark' }, '★') : null));
      card.addEventListener('click', () => selectEntry(e));
      card.addEventListener('mouseenter', () => animateThumb(cv, e));
      card.addEventListener('mouseleave', () => { stopThumb(); drawThumb(cv, e); });
      grid.appendChild(card);
      drawThumb(cv, e);
    });
  }

  function selectEntry(e, keepParams) {
    S.cur = e;
    if (!keepParams) S.params = defaultParams(e);
    if (e.kind === 'captured' && e.item.data.origin && settings().placement !== 'full' && settings().side !== 'both') settings().side = e.item.data.origin;
    const grid = $('grid');
    if (grid) grid.querySelectorAll('.card').forEach(c => c.classList.toggle('on', c.dataset.key === e.key));
    renderInspector();
    renderCTA();
  }

  let pvFrames = [];
  function buildStrip(strip) {
    strip.innerHTML = '';
    const counts = { A: 0, pre: 0, post: 0, B: 0 };
    pvFrames.forEach(f => { counts[f.zone]++; });
    ['A', 'pre', 'post', 'B'].forEach(z => {
      if (counts[z]) strip.appendChild(h('div', { class: 'zone ' + z, style: { flex: String(counts[z]) } }, z === 'pre' ? 'PRE' : z === 'post' ? 'POST' : ''));
    });
    strip.appendChild(h('div', { class: 'cutmark', style: { left: (pvFrames.findIndex(f => f.shot === 'B') / Math.max(1, pvFrames.length) * 100) + '%' } }));
    strip.appendChild(h('div', { class: 'pv-head', id: 'pv-head' }));
  }

  function paramChanged(final) {
    if (S.player) S.player.redraw();
    if (S.curveEd) S.curveEd.draw();
    if (final) { const strip = $('pv-strip'); if (strip) buildStrip(strip); }
  }

  function renderInspector() {
    const ins = $('inspector');
    if (!ins) return;
    if (S.player) { S.player.stop(); S.player = null; }
    S.curveEd = null;
    ins.innerHTML = '';
    const e = S.cur;
    if (!e) {
      ins.appendChild(h('div', { class: 'empty' }, 'Choisis un effet ci-dessus.'));
      return;
    }
    const p = S.params, def = e.def, st = settings();

    const star = h('button', { class: 'action quiet icon' + (isFav(e) ? ' on' : ''), title: 'Favori' }, isFav(e) ? '★' : '☆');
    star.addEventListener('click', () => { toggleFav(e); star.textContent = isFav(e) ? '★' : '☆'; star.classList.toggle('on', isFav(e)); renderGrid(); });
    const save = h('button', { class: 'action quiet', title: e.kind === 'captured' ? 'Dupliquer avec ces réglages' : 'Enregistrer ces réglages comme preset' }, '＋ Preset');
    save.addEventListener('click', saveAsPreset);
    ins.appendChild(h('div', { class: 'effect-head' },
      h('span', { class: 'effect-name' }, e.name),
      h('span', { class: 'badge' }, e.kind === 'captured' ? 'capturé' : e.kind === 'overlay' ? 'overlay' : e.kind === 'preset' ? 'preset · ' + catLabel(e.cat) : catLabel(e.cat)),
      h('div', { class: 'effect-tools' }, star, save)));
    if (def && def.desc) ins.appendChild(h('div', { class: 'note' }, def.desc));
    if (e.kind === 'overlay') {
      ins.appendChild(h('div', { class: 'note' }, e.overlay.pack
        ? 'Pack « ' + Packs.byId[e.overlay.pack].packName + ' », fourni avec RR FX. À la première utilisation, il est fabriqué à la taille de ta séquence (quelques secondes), puis réutilisé.'
        : e.overlay.path || e.overlay.name));
    }

    // Aperçu
    const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
    const play = h('button', { class: 'action quiet icon', title: 'Lecture / pause' }, '❚❚');
    const strip = h('div', { class: 'pv-strip', id: 'pv-strip' });
    const g = cv.getContext('2d');
    pvFrames = previewFrames(e, p, activeSides());
    S.player = Player({
      length: () => pvFrames.length,
      fps: () => fps(),
      draw: n => {
        if (!pvFrames[n]) return;
        Pv.renderTimelineFrame(g, pvFrames, n);
        if (S.cur && S.cur.kind === 'overlay') {
          const f = pvFrames[n], pr = f.spec && f.spec[0].props.find(x => x.key === 'opacity');
          if (pr) drawOverlayOn(g, S.cur, (pr.values ? pr.values[Math.min(f.i, pr.values.length - 1)] : pr.static) / 100, n);
        }
        const head = $('pv-head');
        if (head) head.style.left = (n / Math.max(1, pvFrames.length - 1) * 100) + '%';
      }
    });
    const redraw = S.player.redraw;
    S.player.redraw = () => { pvFrames = previewFrames(S.cur, S.params, activeSides()); redraw(); };
    const setPlay = on => { play.textContent = on ? '❚❚' : '▶'; };
    play.addEventListener('click', () => setPlay(S.player.toggle()));
    strip.addEventListener('pointerdown', ev => {
      const seek = x => { const r = strip.getBoundingClientRect(); S.player.seek(Math.round(Core.clamp((x - r.left) / r.width, 0, 1) * (pvFrames.length - 1))); };
      if (S.player.playing) setPlay(S.player.toggle());
      seek(ev.clientX);
      strip.setPointerCapture(ev.pointerId);
      const mv = m => seek(m.clientX);
      const up = () => { strip.removeEventListener('pointermove', mv); strip.removeEventListener('pointerup', up); };
      strip.addEventListener('pointermove', mv);
      strip.addEventListener('pointerup', up);
    });
    buildStrip(strip);
    if (e.kind === 'overlay' && !e.overlay.pack) overlayMedia(e.overlay, m => { if (m.el.play) { const p2 = m.el.play(); if (p2 && p2.catch) p2.catch(() => {}); } });
    const real = h('button', { class: 'action quiet', title: Pv.isReal() ? 'Revenir aux plans de test' : 'Utiliser les images de ta séquence autour de la coupe la plus proche' }, Pv.isReal() ? 'Plans de test' : '📷 Ma vraie image');
    real.addEventListener('click', () => (Pv.isReal() ? useTestShots() : grabRealFrames()));
    ins.appendChild(h('div', { class: 'preview' },
      h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, Pv.isReal() ? 'Aperçu sur ta séquence' : 'Aperçu simulé')),
      h('div', { class: 'pv-bar' }, play, strip, real)));

    // Placement
    const pl = st.placement;
    let sideCtl;
    if (pl === 'clipStart' || pl === 'clipEnd') {
      sideCtl = h('span', { class: 'muted' }, pl === 'clipStart' ? 'POST, depuis le début' : 'PRE, jusqu\'à la fin');
    } else {
      const opts = [{ v: 'pre', label: 'PRE', cls: 'pre' }, { v: 'post', label: 'POST', cls: 'post' }];
      if (pl !== 'full') opts.push({ v: 'both', label: 'PRE + POST' });
      sideCtl = actionGroup(opts, pl === 'full' ? (st.side === 'pre' ? 'pre' : 'post') : st.side, v => { st.side = v; persist(); paramChanged(true); });
    }
    const forced = def && def.target;
    const multi = pl === 'cuts' || pl === 'markers';
    const where = e.kind === 'overlay' ? 'Overlay posé au-dessus du clip'
      : forced ? 'CLIP FX : copie du plan au-dessus du clip' : 'Calque de réglage au-dessus du clip';
    const volRows = [];
    if (e.kind !== 'captured') {
      volRows.push(h('div', { class: 'field' }, checkbox('Intensité qui suit le volume de la musique', st.volumeFollow, v => { st.volumeFollow = v; persist(); renderInspector(); })));
      if (st.volumeFollow) volRows.push(row('Influence', hotText({ value: st.volumeInfluence, min: 0, max: 100, step: 5, unit: '%', onChange: v => { st.volumeInfluence = v; persist(); } })));
    }
    ins.appendChild(section('Placement', [
      row('Côté', sideCtl),
      row('Position', picker(PLACEMENTS, pl, v => { st.placement = v; persist(); renderInspector(); })),
      multi ? row('Entre les coupes', picker(VARIATIONS, st.vary, v => { st.vary = v; persist(); }), { title: 'Varier le résultat à chaque coupe ou marqueur' }) : null,
      row('Posé sur', h('span', { class: 'muted', title: forced ? 'Un calque de réglage ne peut pas mélanger les images du plan : cet effet se pose sur une copie du passage. Le clip d\'origine n\'est jamais modifié.' : 'Le clip d\'origine n\'est jamais modifié' }, where)),
      volRows
    ]));

    // Paramètres
    const rows = [row('Durée', hotText({ value: p.frames, min: 1, max: 240, step: 1, unit: 'i', onChange: (v, fin) => { p.frames = v; paramChanged(fin); } }), { title: 'Durée de chaque côté, en images' })];
    if (e.kind === 'overlay') {
      rows.push(row('Opacité', hotText({ value: Math.min(100, p.intensity), min: 0, max: 100, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
      rows.push(row('Départ dans l\'overlay', actionGroup([{ v: 'random', label: 'Au hasard' }, { v: 'start', label: 'Début' }, { v: 'middle', label: 'Milieu' }], p.start, v => { p.start = v; })));
      const blendOpts = BLENDS.map(b => ({ v: String(b.v), label: b.label }));
      if (!BLENDS.some(b => b.v === Number(st.overlayBlend))) blendOpts.unshift({ v: String(st.overlayBlend), label: 'Mode appris (' + st.overlayBlend + ')' });
      const learn = h('button', { class: 'action quiet', title: 'Règle le mode de fusion voulu sur un clip dans Premiere, sélectionne-le, puis clique ici' }, 'Apprendre');
      learn.addEventListener('click', learnBlend);
      rows.push(row('Mode de fusion', h('div', { class: 'row-ctl' }, picker(blendOpts, String(st.overlayBlend), v => { st.overlayBlend = Number(v); persist(); paramChanged(true); }), learn)));
      const remove = h('button', { class: 'action quiet danger' }, 'Retirer de la liste');
      remove.addEventListener('click', () => {
        st.overlays = st.overlays.filter(o => o.id !== e.overlay.id);
        persist();
        S.cur = entries()[0];
        S.params = defaultParams(S.cur);
        renderGrid();
        renderInspector();
      });
      if (!e.overlay.pack) rows.push(h('div', { class: 'row-buttons' }, remove));
    } else if (e.kind === 'captured') {
      rows.push(h('div', { class: 'field' }, checkbox('Étirer l\'animation à la durée', p.stretch, v => { p.stretch = v; paramChanged(true); })));
      rows.push(h('div', null, checkbox('Miroir pour l\'autre côté de la coupe', p.mirror, v => { p.mirror = v; paramChanged(true); })));
      const d = e.item.data;
      rows.push(h('div', { class: 'note' }, (d.components || []).map(c => c.displayName).join(' · ') + ' — capturé sur ' + plural(d.frames || 0, 'image')));
    } else {
      rows.push(row('Intensité', hotText({ value: p.intensity, min: 0, max: 200, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
      (def.params || []).forEach(q => {
        if (q.type === 'range') rows.push(row(q.label, hotText({ value: p[q.key], min: q.min, max: q.max, step: q.step, unit: q.unit, onChange: (v, fin) => { p[q.key] = v; paramChanged(fin); } })));
        else if (q.type === 'select') rows.push(row(q.label, actionGroup(q.options.map(o => ({ v: o.v, label: o.label })), p[q.key], v => { p[q.key] = v; paramChanged(true); })));
      });
    }
    const reset = h('button', { class: 'action quiet', title: 'Revenir aux valeurs par défaut' }, 'Réinitialiser');
    reset.addEventListener('click', () => { S.params = defaultParams(e); renderInspector(); });
    ins.appendChild(section('Paramètres', rows, reset));

    // Courbe
    if ((def && !def.noCurve) || e.kind === 'overlay') {
      const ccv = h('canvas', { class: 'curve-canvas' });
      const presetPick = picker(Object.keys(Core.CURVE_PRESETS).map(k => ({ v: k, label: Core.CURVE_PRESETS[k].label })).concat([{ v: 'custom', label: 'Personnalisée' }]),
        curvePresetName(p.curve), v => { if (v !== 'custom') { p.curve = Core.curveValue(v); paramChanged(true); } });
      ins.appendChild(section('Courbe', [
        ccv,
        row('Préréglage', presetPick),
        h('div', { class: 'note' }, 'Glisse les poignées. La moitié droite (POST) est le miroir de la gauche (PRE).')
      ]));
      S.curveEd = CurveEditor(ccv, {
        get: () => p.curve,
        set: (c, fin) => { p.curve = c; presetPick.setValue(curvePresetName(c)); paramChanged(fin); },
        sides: () => activeSides(),
        frames: () => p.frames
      });
      requestAnimationFrame(() => S.curveEd && S.curveEd.draw());
    }
  }

  function curvePresetName(c) {
    for (const k in Core.CURVE_PRESETS) {
      if (Core.CURVE_PRESETS[k].v.every((x, i) => Math.abs(x - c[i]) < 0.005)) return k;
    }
    return 'custom';
  }

  async function saveAsPreset() {
    const e = S.cur;
    if (!e) return;
    if (e.kind === 'captured') {
      const name = await promptName('Dupliquer l\'effet capturé', e.name + ' (copie)');
      if (!name) return;
      const data = clone(e.item.data);
      if (S.params.frames !== data.frames && data.frames) {
        data.components.forEach(c => c.props.forEach(pr => { if (pr.values) pr.values = Core.fitValues(pr.values, S.params.frames, data.origin || 'post', S.params.stretch); }));
        data.frames = S.params.frames;
      }
      S.lib.items.push({ id: uid(), type: 'captured', name, cat: e.item.cat || 'mine', created: Date.now(), data });
      persist();
      renderGrid();
      status.finish('ok', 'Enregistré : ' + name, 'Dans « Mes effets ».');
      return;
    }
    const name = await promptName('Enregistrer comme preset', e.kind === 'preset' ? e.name : e.name + ' perso');
    if (!name) return;
    const data = { base: e.def.id, params: clone(S.params) };
    let item = S.lib.items.find(i => i.type === 'preset' && i.name === name);
    if (item) item.data = data;
    else {
      item = { id: uid(), type: 'preset', name, cat: e.def.cat, created: Date.now(), data };
      S.lib.items.push(item);
    }
    persist();
    renderGrid();
    selectEntry(entryByKey('u:' + item.id), true);
    status.finish('ok', 'Preset enregistré : ' + name, 'Retrouve-le dans la catégorie « Mes effets ».');
  }

  // ---------------------------------------------------------------- appliquer un effet

  // Une entrée par zone (PRE/POST d'une coupe). Les deux côtés d'une même coupe
  // reçoivent le même effet tiré au hasard.
  function buildPlan(e, targets, vary, rate, factors) {
    let pool = null;
    if (vary === 'favorites') {
      pool = entries().filter(isFav);
      if (!pool.length) log('Aucun favori : effets tirés dans la même catégorie.', 'warn');
    }
    if (vary === 'category' || (vary === 'favorites' && !pool.length)) pool = entries().filter(x => x.cat === e.cat);
    const runSeed = Math.floor(Math.random() * 1000) + 1;
    const cutIndex = new Map();
    return targets.map(t => {
      const key = t.side === 'pre' ? t.end : t.start;
      if (!cutIndex.has(key)) cutIndex.set(key, cutIndex.size);
      const k = cutIndex.get(key);
      let entry = e, params = S.params;
      if (pool && pool.length) {
        entry = pool[Math.floor(Core.hash(k, runSeed) * pool.length) % pool.length];
        params = Object.assign(defaultParams(entry), entry.kind === 'captured' ? { frames: S.params.frames } : { frames: S.params.frames, intensity: S.params.intensity });
      }
      if (vary !== 'same' && params.seed !== undefined) params = Object.assign({}, params, { seed: ((params.seed + k * 17 + runSeed) % 99) + 1 });
      const f = factors ? factors.get(key) : 1;
      if (f && f !== 1 && params.intensity != null) params = Object.assign({}, params, { intensity: Core.clamp(Math.round(params.intensity * f), 0, 200) });
      return {
        entry, mode: targetFor(entry), label: entry.name + ' ' + t.side.toUpperCase(),
        overlay: entry.kind === 'overlay' ? { path: entry.overlay.path, name: entry.overlay.name, kind: entry.overlay.kind, pack: entry.overlay.pack, start: params.start, seed: runSeed + k } : undefined,
        target: Object.assign({}, t, { name: 'RR FX · ' + entry.name, fx: Core.toWire(compileFor(entry, params, t.side, t.frames, rate)) })
      };
    });
  }

  function applyEffect() {
    const e = S.cur;
    if (!e) return null;
    const st = settings();
    const multi = st.placement === 'cuts' || st.placement === 'markers';
    return runTask('Application · ' + e.name, async () => {
      status.phase('Analyse de la timeline');
      const r = await Host.call('resolve', { placement: st.placement, sides: activeSides(), frames: S.params.frames, target: targetFor(e) });
      if (!r.ok) {
        (r.warnings || []).forEach(w => log(w, 'warn'));
        return { kind: 'error', title: 'Rien n\'a été appliqué', detail: r.error };
      }
      // Intensité selon le volume de la musique à chaque coupe.
      let factors = null;
      if (st.volumeFollow && e.kind !== 'captured' && app.services.volumeFactors) {
        status.phase('Volume de la musique');
        try {
          const cuts = Array.from(new Set(r.targets.map(t => (t.side === 'pre' ? t.end : t.start))));
          const tps = 254016000000, vals = await app.services.volumeFactors(cuts.map(c => c / tps), st.volumeInfluence);
          factors = new Map(cuts.map((c, i) => [c, vals[i]]));
          log('Intensité selon le volume : ' + vals.map(v => '×' + v.toFixed(2)).join(' '), 'info');
        } catch (err) {
          log('Volume de la musique indisponible : ' + errorMessage(err), 'warn');
        }
      }
      const plan = buildPlan(e, r.targets, multi ? st.vary : 'same', r.fps, factors);
      if (!plan.some(x => x.target.fx.length)) return { kind: 'error', title: 'Rien à appliquer', detail: 'Cet effet ne contient aucun réglage utilisable.' };
      // Overlays de pack : fabriqués une fois à la taille de la séquence.
      const packs = Array.from(new Set(plan.filter(x => x.overlay && x.overlay.pack).map(x => x.overlay.pack)));
      for (const id of packs) {
        const made = await buildPack(Packs.byId[id], r.fps || fps());
        if (!made) return { kind: 'warn', title: 'Arrêté', detail: 'Overlay « ' + Packs.byId[id].name + ' » pas fabriqué.' };
        plan.forEach(x => { if (x.overlay && x.overlay.pack === id) Object.assign(x.overlay, { path: made.path, fps: made.fps }); });
      }

      status.phase(plan.length > 1 ? 'Pose des effets' : 'Pose de l\'effet');
      const created = [], warnings = (r.warnings || []).slice();
      let done = 0, failed = 0, firstError = '';
      for (let i = 0; i < plan.length; i++) {
        if (S.cancel) break;
        status.progress(i, plan.length, plan[i].label);
        const res = await Host.call('apply', { target: plan[i].mode, name: plan[i].target.name, overlay: plan[i].overlay, targets: [plan[i].target], adjNodeId: st.adjNodeId, refreshAdj: i === 0, copyLook: st.copyLook });
        if (!res.ok) {
          failed++;
          firstError = firstError || res.error;
          log(plan[i].label + ' : ' + res.error, 'error');
          if (!done) break; // même cause à chaque coupe (pas de calque de réglage…) : inutile d'insister
          continue;
        }
        done++;
        created.push.apply(created, res.created || []);
        warnings.push.apply(warnings, res.warnings || []);
      }
      status.progress(plan.length, plan.length, '');
      if (created.length) pushHistory({ date: Date.now(), label: multi ? e.name + ' × ' + done : e.name, entries: created });
      Array.from(new Set(warnings)).forEach(w => log(w, 'warn'));

      const what = plural(done, 'zone');
      if (!done) return { kind: 'error', title: 'Rien n\'a été appliqué', detail: firstError };
      log(e.name + ' : ' + what + (failed ? ', ' + plural(failed, 'échec') : ''), failed ? 'warn' : 'ok');
      if (S.cancel) return { kind: 'warn', title: 'Arrêté · ' + what + ' posée(s)', detail: 'Le reste n\'a pas été appliqué.' };
      if (failed) return { kind: 'warn', title: e.name + ' · ' + what + ', ' + plural(failed, 'échec'), detail: firstError };
      if (warnings.length) return { kind: 'warn', title: e.name + ' appliqué · ' + what, detail: plural(new Set(warnings).size, 'remarque') + ' dans le journal.' };
      const on = { copy: 'Sur une copie du plan (CLIP FX) au-dessus du clip.', overlay: 'Overlays posés au-dessus du clip.', adjustment: 'Sur des calques de réglage « RR FX · … ».' };
      return { kind: 'ok', title: e.name + ' appliqué · ' + what, detail: on[targetFor(e)] || on.adjustment };
    }, true);
  }

  // ---------------------------------------------------------------- historique / annulation

  function pushHistory(op) {
    const list = S.lib.history;
    list.push(op);
    while (list.length > MAX_HISTORY) list.shift();
    persist();
    renderUndo();
  }

  function renderUndo() {
    const last = S.lib && S.lib.history[S.lib.history.length - 1];
    const b = $('undo');
    setDisabled(b, S.busy || !last);
    b.textContent = last ? '↶ Annuler (' + last.entries.length + ')' : '↶ Annuler';
    b.title = last ? 'Retirer : ' + last.label : 'Rien à annuler';
    show(b, !S.busy);
  }

  function describeOp(op) {
    const d = new Date(op.date);
    return op.label + ' (' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ')';
  }

  async function undoLast() {
    const last = S.lib.history[S.lib.history.length - 1];
    if (!last || S.busy) return;
    if (!(await confirmDialog('Annuler la dernière opération ?', describeOp(last) + ' : les calques et effets posés par RR FX seront retirés. Ce que tu as modifié depuis n\'est pas touché.', 'Annuler l\'opération', 'confirmUndo'))) return;
    await runTask('Annulation', async () => {
      status.phase('Retrait des effets');
      const r = await Host.call('undo', { entries: last.entries });
      if (!r.ok) return { kind: 'error', title: 'Annulation impossible', detail: r.error };
      S.lib.history.pop();
      persist();
      const parts = [];
      if (r.removed) parts.push(plural(r.removed, 'calque retiré', 'calques retirés'));
      if (r.effects) parts.push(plural(r.effects, 'effet retiré', 'effets retirés'));
      if (r.skipped) parts.push(r.skipped + ' laissé(s) tel quel (modifié depuis, ou à annuler avec Ctrl+Z / Cmd+Z)');
      log('Annulation de ' + last.label + ' : ' + (parts.join(', ') || 'rien à retirer'), r.skipped ? 'warn' : 'ok');
      return { kind: r.skipped ? 'warn' : 'ok', title: 'Annulation terminée', detail: parts.join(' · ') };
    });
  }

  async function clearAll(o) {
    if (S.busy) return;
    const where = o.scope === 'selection' ? 'dans la zone sélectionnée' : 'dans toute la séquence';
    const yes = await modal('Tout effacer ' + where + ' ?', h('p', null, 'Les calques, copies, overlays et textes « RR FX · … »' + (o.markers ? ' et les marqueurs RR FX' : '') + ' seront retirés. Tes clips restent intacts. Ctrl+Z / Cmd+Z dans Premiere pour revenir en arrière.'), [
      { label: 'Garder', value: false }, { label: 'Tout effacer', primary: true, value: true }]);
    if (!yes) return;
    await runTask('Nettoyage', async () => {
      status.phase('Retrait des éléments RR FX');
      const r = await Host.call('clearAll', { scope: o.scope, markers: o.markers, multicam: true });
      if (!r.ok) return { kind: 'error', title: 'Nettoyage impossible', detail: r.error };
      if (o.scope === 'sequence') { S.lib.history = []; persist(); renderUndo(); }
      const parts = [plural(r.removed, 'élément retiré', 'éléments retirés')];
      if (o.markers) parts.push(plural(r.markers, 'marqueur retiré', 'marqueurs retirés'));
      log('Nettoyage ' + where + ' : ' + parts.join(', '), 'ok');
      if (app.tabs.music && S.tab === 'music' && app.tabs.music.redraw) app.tabs.music.redraw();
      return { kind: 'ok', title: r.removed || r.markers ? 'Séquence nettoyée' : 'Rien à effacer', detail: parts.join(' · ') };
    });
  }

  // ---------------------------------------------------------------- onglet Speed ramp

  const ramp = () => settings().ramp;

  function rampPreviewFrames() {
    const R = ramp(), N = Math.max(2, R.frames), pieces = Core.rampPieces(R.points, N, R.segments);
    const before = R.placement === 'post' ? 0 : 10, after = R.placement === 'pre' ? 0 : 10;
    const speeds = [];
    for (let i = 0; i < before; i++) speeds.push(100);
    pieces.forEach(p => { for (let i = 0; i < p.frames; i++) speeds.push(p.speed); });
    for (let i = 0; i < after; i++) speeds.push(100);
    let tau = 0;
    return speeds.map(s => { const f = { tau, speed: s }; tau += s / 100; return f; });
  }

  function rampInfo() {
    const R = ramp(), pieces = Core.rampPieces(R.points, R.frames, R.segments), speeds = pieces.map(p => p.speed);
    return { src: Core.rampSourceFrames(pieces), min: Math.min.apply(null, speeds), max: Math.max.apply(null, speeds) };
  }

  function renderRampView() {
    const view = $('view-ramp');
    if (S.rampPlayer) { S.rampPlayer.stop(); S.rampPlayer = null; }
    view.innerHTML = '';
    const R = ramp();

    const chips = h('div', { class: 'chips' });
    const presets = Object.keys(Core.RAMP_PRESETS).map(k => ({ key: k, label: Core.RAMP_PRESETS[k].label, data: Core.RAMP_PRESETS[k] }))
      .concat(S.lib.items.filter(i => i.type === 'ramp').map(i => ({ key: 'u:' + i.id, label: '★ ' + i.name, data: i.data })));
    presets.forEach(pr => {
      const b = h('button', { class: 'action' + (R.preset === pr.key ? ' selected' : '') }, pr.label);
      b.addEventListener('click', () => {
        R.points = clone(pr.data.points);
        if (pr.data.placement) R.placement = pr.data.placement;
        if (pr.data.frames) R.frames = pr.data.frames;
        if (pr.data.segments) R.segments = pr.data.segments;
        R.preset = pr.key;
        persist();
        renderRampView();
      });
      chips.appendChild(b);
    });
    const saveBtn = h('button', { class: 'action quiet' }, '＋ Enregistrer');
    saveBtn.addEventListener('click', saveRamp);
    view.appendChild(section('Préréglages', chips, saveBtn));

    const cv = h('canvas', { class: 'ramp-canvas' });
    const info = h('div', { class: 'ramp-info' });
    const refreshInfo = () => {
      const I = rampInfo();
      info.innerHTML = '';
      info.appendChild(h('span', null, 'Vitesse ', h('b', null, Math.round(I.min) + '–' + Math.round(I.max) + ' %')));
      info.appendChild(h('span', null, 'Média utilisé ', h('b', null, (Math.round(I.src * 10) / 10) + ' i'), ' pour ' + R.frames + ' i'));
    };
    view.appendChild(section('Courbe de vitesse', [cv, info, h('div', { class: 'note' }, 'Glisse les points · double-clic pour ajouter ou supprimer · Alt+clic supprime.')]));
    const changed = fin => {
      refreshInfo();
      if (S.rampEd) S.rampEd.draw();
      if (fin) { persist(); if (S.rampPlayer) S.rampPlayer.redraw(); }
    };
    S.rampEd = RampEditor(cv, {
      points: () => R.points,
      set: (pts, fin) => {
        R.points = pts;
        if (R.preset) { R.preset = null; chips.querySelectorAll('.action').forEach(c => c.classList.remove('selected')); }
        changed(fin);
      },
      frames: () => R.frames,
      segments: () => R.segments
    });
    refreshInfo();

    view.appendChild(section('Réglages', [
      row('Position', picker(RAMP_PLACEMENTS, R.placement, v => { R.placement = v; persist(); if (S.rampPlayer) S.rampPlayer.redraw(); })),
      row('Durée', hotText({ value: R.frames, min: 2, max: 600, step: 1, unit: 'i', onChange: (v, fin) => { R.frames = v; changed(fin); } })),
      row('Morceaux', hotText({ value: R.segments, min: 2, max: 32, step: 1, unit: '', onChange: (v, fin) => { R.segments = v; changed(fin); } }), { title: 'Plus de morceaux = rampe plus douce, mais plus de coupes dans la timeline' }),
      row('Ancre', picker([
        { v: 'auto', label: 'Auto (coupe fixe)' },
        { v: 'end', label: 'Garder l\'image de fin' },
        { v: 'start', label: 'Garder l\'image de début' }
      ], R.anchor, v => { R.anchor = v; persist(); }), { title: 'Quelle image reste à sa place. La durée dans la timeline ne change jamais.' }),
      row('Interpolation', picker([
        { v: 'keep', label: 'Ne pas changer' },
        { v: 'blend', label: 'Fusion d\'images' },
        { v: 'flow', label: 'Flux optique' }
      ], R.interp, v => { R.interp = v; persist(); }))
    ]));

    const pcv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
    const pg = pcv.getContext('2d');
    let frames = rampPreviewFrames();
    S.rampPlayer = Player({ length: () => frames.length, fps: () => fps(), draw: n => { const f = frames[n]; if (f) Pv.drawRampScene(pg, f.tau, f.speed); } });
    const redraw = S.rampPlayer.redraw;
    S.rampPlayer.redraw = () => { frames = rampPreviewFrames(); redraw(); };
    view.appendChild(section('Aperçu', h('div', { class: 'pv-frame' }, pcv, h('span', { class: 'pv-label' }, 'Aperçu simulé'))));
    view.appendChild(h('div', { class: 'note' }, 'La rampe est posée sur une copie du passage, juste au-dessus du clip, en morceaux de vitesse constante (Premiere ne laisse pas les scripts piloter le remappage temporel). Le clip d\'origine, son son et la coupe ne bougent pas ; ↶ Annuler retire la copie.'));
    requestAnimationFrame(() => S.rampEd && S.rampEd.draw());
  }

  async function saveRamp() {
    const R = ramp();
    const name = await promptName('Enregistrer la rampe', 'Ma rampe');
    if (!name) return;
    const item = { id: uid(), type: 'ramp', name, created: Date.now(), data: { points: clone(R.points), frames: R.frames, segments: R.segments, placement: R.placement } };
    S.lib.items.push(item);
    R.preset = 'u:' + item.id;
    persist();
    renderRampView();
    status.finish('ok', 'Rampe enregistrée : ' + name, 'Elle apparaît dans les préréglages.');
  }

  async function applyRamp() {
    const R = ramp();
    if (S.busy) return;
    if (!(await confirmDialog('Appliquer la rampe ?', 'Une copie du passage, découpée en ' + R.segments + ' morceaux à vitesses différentes, va être posée juste au-dessus du clip. Le clip d\'origine, son son et la coupe ne bougent pas. Le bouton ↶ Annuler la retire.', 'Appliquer', 'confirmRamp'))) return;
    await runTask('Speed ramp', async () => {
      status.phase('Analyse du clip');
      const r = await Host.call('rampResolve', { placement: R.placement, frames: R.frames });
      if (!r.ok) return { kind: 'error', title: 'Rampe non appliquée', detail: r.error };
      status.phase('Pose de la copie et des vitesses');
      const pieces = Core.rampPieces(R.points, r.frames, R.segments);
      const anchor = R.anchor === 'auto' ? r.anchor : R.anchor;
      const res = await Host.call('rampApply', { track: r.track, clipStart: r.clipStart, clipName: r.clipName, regionStart: r.regionStart, pieces, anchor, interp: R.interp, copyLook: settings().copyLook });
      if (res.created && res.created.length) pushHistory({ date: Date.now(), label: 'Rampe · ' + r.clipName, entries: res.created });
      if (!res.ok) {
        (res.warnings || []).forEach(w => log(w, 'warn'));
        return { kind: 'error', title: 'Rampe non appliquée', detail: res.error };
      }
      (res.warnings || []).forEach(w => log(w, 'warn'));
      log('Rampe sur ' + r.clipName + ' : ' + res.pieces + ' morceaux, ' + (Math.round(res.sourceFrames * 10) / 10) + ' i de média', 'ok');
      const bad = (res.warnings || []).some(w => /vérifier/.test(w));
      const notes = (res.warnings || []).length;
      return { kind: bad ? 'warn' : 'ok', title: 'Rampe appliquée · ' + res.pieces + ' morceaux', detail: 'Copie de ' + r.clipName + ' sur V' + (res.track + 1) + (bad ? ' · certains morceaux sont à vérifier (journal)' : notes ? ' · ' + plural(notes, 'remarque') + ' dans le journal' : '') };
    });
  }

  // ---------------------------------------------------------------- onglet Mes effets

  const captureOpts = { name: '', cat: 'mine', intrinsic: false };

  function renderMineView() {
    const view = $('view-mine');
    view.innerHTML = '';
    view.appendChild(h('div', { class: 'mine-switch' }, actionGroup([{ v: 'mine', label: 'Ma bibliothèque' }, { v: 'community', label: '🌐 Communauté' }], S.mineView, v => { S.mineView = v; renderMineView(); renderCTA(); })));
    if (S.mineView === 'community') { renderCommunity(view); return; }
    const nameIn = h('input', { class: 'textfield', placeholder: 'Nom (par défaut : nom du clip)', value: captureOpts.name });
    nameIn.addEventListener('input', () => { captureOpts.name = nameIn.value; });
    view.appendChild(section('Capturer un effet', [
      h('div', { class: 'note' }, 'Monte ton effet dans Premiere (sur un clip ou un calque de réglage, avec ses images clés, effets tiers compris), sélectionne-le dans la timeline puis clique sur « Capturer la sélection » en haut. Effets, valeurs et animations sont enregistrés et réutilisables comme les effets intégrés.'),
      row('Nom', nameIn),
      row('Catégorie', picker([{ v: 'mine', label: 'Mes effets' }].concat(Lib.CATEGORIES.map(c => ({ v: c.id, label: c.label }))), captureOpts.cat, v => { captureOpts.cat = v; })),
      h('div', { class: 'field' }, checkbox('Inclure Trajectoire et Opacité', captureOpts.intrinsic, v => { captureOpts.intrinsic = v; }))
    ]));

    const imp = h('button', { class: 'action' }, 'Importer…');
    imp.addEventListener('click', importItems);
    const exp = h('button', { class: 'action' }, 'Tout exporter…');
    exp.addEventListener('click', () => exportItems(S.lib.items, 'RRFX-bibliotheque.json'));
    const shareAll = h('button', { class: 'action' }, 'Tout partager');
    shareAll.addEventListener('click', () => shareItems(S.lib.items, 'Ma bibliothèque'));
    const paste = h('button', { class: 'action' }, 'Coller un code…');
    paste.addEventListener('click', pasteCode);
    view.appendChild(section('Ma bibliothèque', [h('div', { id: 'mine-list' }), h('div', { class: 'row-buttons' }, imp, exp), h('div', { class: 'row-buttons' }, paste, shareAll), h('div', { class: 'note' }, 'Partager donne un code « RRFX1:… » à envoyer en message : la personne le colle dans « Coller un code… ». Fichier : ' + Store.location)]));
    renderMineList();
  }

  function capture() {
    return runTask('Capture', async () => {
      status.phase('Lecture des effets du clip sélectionné');
      const r = await Host.call('capture', { includeIntrinsic: captureOpts.intrinsic });
      if (!r.ok) return { kind: 'error', title: 'Capture impossible', detail: r.error };
      const data = Object.assign({}, r);
      delete data.ok;
      const item = { id: uid(), type: 'captured', name: captureOpts.name.trim() || r.name, cat: captureOpts.cat, created: Date.now(), data };
      S.lib.items.push(item);
      persist();
      captureOpts.name = '';
      if (S.tab === 'mine') renderMineView();
      const n = r.components.length;
      log('Capturé : ' + item.name + ' · ' + plural(n, 'effet') + (r.frames ? ' · ' + r.frames + ' images animées' : '') + (r.skipped ? ' · ' + r.skipped + ' paramètre(s) illisible(s) ignoré(s)' : ''), r.skipped ? 'warn' : 'ok');
      return { kind: 'ok', title: 'Capturé : ' + item.name, detail: plural(n, 'effet') + (r.frames ? ' · ' + plural(r.frames, 'image animée', 'images animées') : ' · sans animation') + ' · catégorie « ' + catLabel(item.cat) + ' »' };
    });
  }

  function renderMineList() {
    const list = $('mine-list');
    if (!list) return;
    list.innerHTML = '';
    if (!S.lib.items.length) {
      list.appendChild(h('div', { class: 'note' }, 'Rien pour l\'instant : enregistre un preset (« ＋ Preset » sur un effet), une rampe, ou capture un clip.'));
      return;
    }
    const types = { preset: ['≡', 'Preset'], captured: ['◎', 'Capturé'], ramp: ['⤳', 'Rampe'] };
    S.lib.items.slice().sort((a, b) => b.created - a.created).forEach(item => {
      const [ic, label] = types[item.type] || ['•', item.type];
      let meta = label;
      if (item.type === 'preset') meta += ' · ' + ((Lib.byId[item.data.base] || {}).name || '?');
      if (item.type === 'captured') meta += ' · ' + plural((item.data.components || []).length, 'effet') + ' · ' + (item.data.frames || 0) + ' i';
      if (item.type === 'ramp') meta += ' · ' + item.data.frames + ' i';
      const btn = (text, title, fn, cls) => { const b = h('button', { class: 'action quiet' + (cls ? ' ' + cls : ''), title }, text); b.addEventListener('click', fn); return b; };
      const li = h('div', { class: 'list-item' },
        h('span', { class: 'li-icon' }, ic),
        h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, item.name), h('div', { class: 'li-meta' }, meta)),
        h('div', { class: 'li-actions' },
          btn('Ouvrir', 'Ouvrir', () => openItem(item)),
          btn('✎', 'Renommer', async () => { const n = await promptName('Renommer', item.name); if (n) { item.name = n; persist(); renderMineList(); } }),
          btn('⤓', 'Exporter', () => exportItems([item], item.name.replace(/[^\w\-]+/g, '_') + '.rrfx.json')),
          btn('⇪', 'Partager (code à copier-coller)', () => shareItems([item], item.name)),
          btn('🌐', 'Publier dans la bibliothèque en ligne', () => publishItems([item], item.name)),
          btn('✕', 'Supprimer', () => deleteItem(item), 'danger')));
      li.addEventListener('dblclick', () => openItem(item));
      list.appendChild(li);
    });
  }

  async function deleteItem(item) {
    const yes = await modal('Supprimer « ' + item.name + ' » ?', h('p', null, 'C\'est définitif. Exporte-le d\'abord pour le garder.'), [
      { label: 'Garder', value: false }, { label: 'Supprimer', primary: true, value: true }]);
    if (!yes) return;
    S.lib.items = S.lib.items.filter(i => i !== item);
    S.lib.favorites = S.lib.favorites.filter(k => k !== 'u:' + item.id);
    if (S.cur && S.cur.key === 'u:' + item.id) { S.cur = entries()[0]; S.params = defaultParams(S.cur); }
    persist();
    renderMineList();
  }

  function openItem(item) {
    if (item.type === 'ramp') {
      const R = ramp();
      R.points = clone(item.data.points);
      R.frames = item.data.frames;
      R.segments = item.data.segments;
      R.placement = item.data.placement || R.placement;
      R.preset = 'u:' + item.id;
      persist();
      switchTab('ramp');
      return;
    }
    const e = entryByKey('u:' + item.id);
    if (!e) return;
    S.cat = 'mine';
    S.cur = e;
    S.params = defaultParams(e);
    switchTab('effects');
  }

  function exportItems(items, name) {
    if (!items.length) { status.finish('warn', 'Rien à exporter', 'La bibliothèque est vide.'); return; }
    try {
      const out = Store.exportJSON({ rrfx: 1, exported: new Date().toISOString(), items }, name);
      if (out) { status.finish('ok', plural(items.length, 'élément exporté', 'éléments exportés'), out); log('Exporté : ' + out, 'ok'); }
    } catch (e) {
      status.finish('error', 'Export impossible', errorMessage(e));
    }
  }

  // Ajoute à la bibliothèque les éléments valides ; renvoie leur nombre.
  function addItems(list) {
    let n = 0;
    list.forEach(it => {
      if (!it || ['preset', 'captured', 'ramp'].indexOf(it.type) < 0 || !it.data || typeof it.name !== 'string') return;
      if (it.type === 'preset' && !Lib.byId[it.data.base]) return;
      if (it.type === 'captured' && !Array.isArray(it.data.components)) return;
      if (it.type === 'ramp' && !Array.isArray(it.data.points)) return;
      S.lib.items.push(Object.assign({}, it, { id: uid(), created: Date.now() }));
      n++;
    });
    persist();
    renderMineList();
    return n;
  }

  async function importItems() {
    let packs = [];
    try { packs = await Store.importJSON(); } catch (e) { status.finish('error', 'Import impossible', errorMessage(e)); return; }
    if (!packs.length) return;
    const n = addItems([].concat.apply([], packs.map(pack => (pack && Array.isArray(pack.items) ? pack.items : []))));
    if (n) status.finish('ok', plural(n, 'élément importé', 'éléments importés'), 'Dans « Mes effets ».');
    else status.finish('warn', 'Rien d\'importé', 'Aucun effet RR FX valide dans ce fichier.');
  }

  function copyText(text, field) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => copyText(text, null));
    if (field) { field.focus(); field.select(); }
    let done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    return Promise.resolve(done);
  }

  function shareItems(items, label) {
    if (!items.length) { status.finish('warn', 'Rien à partager', 'La bibliothèque est vide.'); return; }
    const code = Share.encode(items, Store.zip);
    const field = h('textarea', { class: 'code share-code', readonly: true, rows: 4, spellcheck: 'false' }, code);
    const msg = h('div', { class: 'note' }, plural(items.length, 'élément', 'éléments') + ' · ' + code.length + ' caractères. Envoie ce code : il se colle dans RR FX > Mes effets > « Coller un code… ».');
    const copy = h('button', { class: 'action' }, 'Copier');
    copy.addEventListener('click', () => copyText(code, field).then(ok => { copy.textContent = ok ? 'Copié ✓' : 'Sélectionne et copie (Ctrl/Cmd+C)'; field.select(); }));
    modal('Partager · ' + label, h('div', null, field, msg, h('div', { class: 'row-buttons' }, copy)), [{ label: 'Fermer', primary: true, value: true }]);
    setTimeout(() => { field.focus(); field.select(); }, 0);
    log('Code de partage créé : ' + label + ' (' + plural(items.length, 'élément', 'éléments') + ')', 'info');
  }

  async function pasteCode() {
    const field = h('textarea', { class: 'code share-code', rows: 4, spellcheck: 'false', placeholder: 'RRFX1:…' });
    setTimeout(() => field.focus(), 0);
    const code = await modal('Coller un code RR FX', h('div', null, field, h('div', { class: 'note' }, 'Colle ici un code reçu (il commence par « RRFX1: »).')), [
      { label: 'Annuler', value: null }, { label: 'Ajouter', primary: true, value: () => field.value }]);
    if (!code) return;
    let items;
    try { items = Share.decode(code, Store.zip); } catch (e) { status.finish('error', 'Code invalide', errorMessage(e)); return; }
    const n = addItems(items);
    if (n) status.finish('ok', plural(n, 'effet ajouté', 'effets ajoutés'), items.map(i => i.name).slice(0, 4).join(', ') + (items.length > 4 ? '…' : ''));
    else status.finish('warn', 'Rien d\'ajouté', 'Ce code ne contient pas d\'effet compatible avec cette version.');
  }

  // ---------------------------------------------------------------- bibliothèque en ligne

  const decodeCode = code => Share.decode(code, Store.zip);
  const fromCommunity = e => S.lib.items.filter(i => i.from && i.from.number === e.number);

  async function loadCommunity(force) {
    const C = S.comm;
    if (C.loading) return;
    C.loading = true;
    C.error = '';
    renderCommunityList();
    try {
      const r = await Community.load({ fetch: (u, o) => fetch(u, o), storage, decode: decodeCode, force });
      C.list = r.list;
      C.error = r.error || '';
      C.at = Date.now();
      if (r.error) log('Bibliothèque en ligne : ' + r.error, 'warn');
    } finally {
      C.loading = false;
      renderCommunityList();
    }
  }

  function renderCommunity(view) {
    const C = S.comm;
    const search = h('input', { class: 'textfield', placeholder: 'Rechercher (nom, auteur, style…)', value: C.search, spellcheck: 'false' });
    search.addEventListener('input', () => { C.search = search.value; renderCommunityList(); });
    const refresh = h('button', { class: 'action quiet', title: 'Relire la bibliothèque sur GitHub' }, '↻');
    refresh.addEventListener('click', () => loadCommunity(true));
    view.appendChild(section('Bibliothèque en ligne', [
      h('div', { class: 'note' }, 'Les effets publiés par les utilisateurs de RR FX. « Ajouter » les range dans ta bibliothèque, comme les tiens. Pour aimer un effet : ❤ ouvre sa page, ajoute la réaction 👍.'),
      h('div', { class: 'search' }, search, refresh),
      row('Trier', actionGroup([{ v: 'popular', label: 'Les plus aimés' }, { v: 'recent', label: 'Les plus récents' }], C.sort, v => { C.sort = v; renderCommunityList(); })),
      row('Type', picker([{ v: 'all', label: 'Tout' }, { v: 'preset', label: 'Presets' }, { v: 'captured', label: 'Effets capturés' }, { v: 'ramp', label: 'Rampes' }], C.type, v => { C.type = v; renderCommunityList(); })),
      h('div', { id: 'comm-list' })
    ]));
    view.appendChild(section('Publier', [
      h('div', { class: 'note' }, 'Le bouton du haut (ou 🌐 sur un effet de ta bibliothèque) ouvre le formulaire de publication dans ton navigateur, déjà rempli : il reste à cliquer sur « Submit new issue » (compte GitHub gratuit). Ton effet apparaît ensuite ici pour tout le monde.')
    ]));
    if (!C.list || Date.now() - C.at > Community.CACHE_MS) loadCommunity(false);
    else renderCommunityList();
  }

  // Petite vignette d'un preset ou d'un effet capturé partagé.
  function communityThumb(it) {
    const cv = h('canvas', { width: 160, height: 90 });
    let entry = null;
    if (it.type === 'preset' && Lib.byId[it.data.base]) entry = { kind: 'preset', name: it.name, def: Lib.byId[it.data.base], item: it };
    if (it.type === 'captured') entry = { kind: 'captured', name: it.name, def: null, item: it };
    if (entry) drawThumb(cv, entry);
    else {
      const g = cv.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 160, 90);
      g.fillStyle = '#9ab'; g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText('⤳', 80, 56);
    }
    return h('div', { class: 'comm-thumb' }, cv);
  }

  function renderCommunityList() {
    const box = $('comm-list'), C = S.comm;
    if (!box) return;
    box.innerHTML = '';
    if (C.loading && !C.list) { box.appendChild(h('div', { class: 'note' }, 'Chargement de la bibliothèque…')); return; }
    if (C.error) box.appendChild(h('div', { class: 'note warn' }, '⚠ ' + C.error));
    const list = Community.filter(C.list || [], C);
    if (!list.length) {
      box.appendChild(h('div', { class: 'note' }, (C.list && C.list.length) ? 'Aucun effet ne correspond.' : 'Personne n\'a encore publié d\'effet : sois le premier !'));
      return;
    }
    list.slice(0, 120).forEach(e => {
      const mine = fromCommunity(e), date = new Date(e.created);
      const add = h('button', { class: 'action' }, mine.length ? 'Ouvrir' : 'Ajouter');
      add.addEventListener('click', () => {
        if (mine.length) return openItem(mine[0]);
        const n = addItems(e.items.map(it => Object.assign({}, it, { from: { number: e.number, author: e.author } })));
        if (n) status.finish('ok', 'Ajouté : ' + e.name, 'Par @' + e.author + (n > 1 ? ' · ' + plural(n, 'effet') : '') + ' · dans « Mes effets ».');
        else status.finish('warn', 'Rien d\'ajouté', 'Cet effet n\'est pas compatible avec ta version de RR FX.');
        renderCommunityList();
      });
      const like = h('button', { class: 'action quiet', title: 'Ouvrir sa page pour l\'aimer (réaction 👍) ou commenter' }, '❤ ' + e.likes);
      like.addEventListener('click', () => Host.openURL(e.url));
      const types = e.types.map(t => Community.TYPES[t] || t).join(', ') + (e.items.length > 1 ? ' × ' + e.items.length : '');
      box.appendChild(h('div', { class: 'comm-item' },
        communityThumb(e.items[0]),
        h('div', { class: 'li-text' },
          h('div', { class: 'li-name' }, e.name),
          h('div', { class: 'li-meta' }, types + ' · @' + e.author + ' · ' + date.toLocaleDateString('fr-FR')),
          e.desc ? h('div', { class: 'comm-desc' }, e.desc) : null,
          h('div', { class: 'row-buttons' }, add, like))));
    });
  }

  // Ouvre le formulaire de publication pré-rempli (le code va dans l'adresse s'il n'est pas trop long).
  async function publishItems(items, defaultName) {
    if (!items.length) { status.finish('warn', 'Rien à publier', 'Ta bibliothèque est vide : enregistre un preset ou capture un effet.'); return; }
    const name = h('input', { class: 'textfield', value: defaultName || items[0].name });
    const desc = h('textarea', { class: 'code lyrics', rows: 4, placeholder: 'Pour quel genre de montage, sur quelle musique…' });
    const ok = await modal('Publier dans la bibliothèque en ligne', h('div', null,
      row('Nom', name), desc,
      h('div', { class: 'note' }, (items.length > 1 ? plural(items.length, 'effet') + ', publiés ensemble. ' : '') + 'Le formulaire s\'ouvre dans ton navigateur : vérifie, puis « Submit new issue ». Publié sous ton nom GitHub, visible par tous.')), [
      { label: 'Annuler', value: false }, { label: 'Ouvrir le formulaire', primary: true, value: true }]);
    if (!ok || !name.value.trim()) return;
    const code = Share.encode(items, Store.zip);
    const p = Community.publishURL({ name: name.value.trim(), desc: desc.value.trim(), code });
    if (!p.withCode) await copyText(code, null);
    Host.openURL(p.url);
    log('Publication ouverte dans le navigateur : ' + name.value.trim(), 'info');
    status.finish('ok', 'Formulaire ouvert dans ton navigateur', p.withCode
      ? 'Clique sur « Submit new issue » : ton effet apparaîtra dans la bibliothèque en ligne.'
      : 'Le code était trop long pour l\'adresse : il est copié, colle-le dans « Code RR FX », puis « Submit new issue ».');
  }

  async function publishPicker() {
    if (!S.lib.items.length) { status.finish('warn', 'Rien à publier', 'Enregistre un preset (＋ Preset), une rampe, ou capture un effet d\'abord.'); return; }
    const opts = S.lib.items.slice().sort((a, b) => b.created - a.created).map(i => ({ v: i.id, label: i.name }));
    let pick = opts[0].v;
    const ok = await modal('Quel effet publier ?', picker(opts, pick, v => { pick = v; }), [
      { label: 'Annuler', value: false }, { label: 'Continuer', primary: true, value: true }]);
    if (!ok) return;
    const item = S.lib.items.find(i => i.id === pick);
    if (item) publishItems([item], item.name);
  }

  // ---------------------------------------------------------------- onglet Réglages

  function renderSettingsView() {
    const view = $('view-settings');
    view.innerHTML = '';
    const st = settings();

    const find = h('button', { class: 'action' }, 'Rechercher');
    find.addEventListener('click', async () => {
      const r = await Host.call('adjustmentInfo', { nodeId: st.adjNodeId });
      if (!r.ok) return status.finish('error', 'Recherche impossible', r.error);
      if (!r.found) return status.finish('warn', 'Aucun calque de réglage', 'Crée-en un : Fichier > Nouveau > Calque de réglage.');
      st.adjNodeId = r.nodeId; st.adjName = r.name; persist();
      renderSettingsView();
      status.finish('ok', 'Calque de réglage trouvé', r.name);
    });
    const fromSel = h('button', { class: 'action' }, 'Utiliser la sélection du Projet');
    fromSel.addEventListener('click', async () => {
      const r = await Host.call('adjustmentFromSelection', {});
      if (!r.ok) return status.finish('error', 'Aucun élément sélectionné', r.error);
      st.adjNodeId = r.nodeId; st.adjName = r.name; persist();
      renderSettingsView();
      status.finish('ok', 'Calque de réglage défini', r.name);
    });
    view.appendChild(section('Calques', [
      h('div', { class: 'note' }, 'Comme 2WIN, RR FX pose les effets sur des calques de réglage « RR FX · … » au-dessus du clip, qui n\'est jamais modifié. Exceptions « CLIP FX » : la speed ramp et le Motion blur (Écho) ont besoin des images du plan, qu\'un calque de réglage ne peut ni ralentir ni mélanger. Ils se posent donc sur une copie du passage, issue d\'un sous-clip vidéo seule (chutier « RR FX ») : tes pistes audio ne sont jamais touchées.'),
      h('div', { class: 'field' }, checkbox('Recopier le cadrage et l\'étalonnage du clip sur les copies CLIP FX', st.copyLook, v => { st.copyLook = v; persist(); })),
      h('div', { class: 'note' }, 'Les courbes et LUT de Lumetri ne se recopient pas : étalonne plutôt sur un calque de réglage.'),
      h('div', { class: 'note' }, 'Calque de réglage utilisé : ' + (st.adjName || 'recherche automatique dans le projet') + '. Il en faut un dans le projet : Fichier > Nouveau > Calque de réglage.'),
      h('div', { class: 'row-buttons' }, find, fromSel)
    ]));

    // Nettoyage
    const clean = { scope: 'sequence', markers: true };
    const wipe = h('button', { class: 'action danger' }, 'Tout effacer');
    wipe.addEventListener('click', () => clearAll(clean));
    view.appendChild(section('Nettoyage', [
      h('div', { class: 'note' }, 'Retire tout ce que RR FX a posé : calques de réglage, copies CLIP FX, overlays, textes et sons « RR FX · … », et réactive les caméras éteintes par le montage multicam. Tes clips ne sont pas supprimés.'),
      row('Zone', actionGroup([{ v: 'sequence', label: 'Toute la séquence' }, { v: 'selection', label: 'Zone sélectionnée' }], clean.scope, v => { clean.scope = v; })),
      h('div', { class: 'field' }, checkbox('Retirer aussi les marqueurs RR FX (temps forts)', clean.markers, v => { clean.markers = v; })),
      h('div', { class: 'row-buttons' }, wipe)
    ]));

    // Effets Premiere détectés
    const fx = h('div');
    const reg = registry();
    Object.keys(Core.REGISTRY).filter(t => !Core.REGISTRY[t].intrinsic).forEach(type => {
      const found = S.resolved ? S.resolved[type] : undefined;
      fx.appendChild(h('div', { class: 'fx-status' },
        h('span', { class: found ? 'ok' : (S.resolved ? 'missing' : 'muted') }, found ? '✓' : (S.resolved ? '✕' : '…')),
        h('span', null, found || (S.resolved ? reg[type].names[0] + ' introuvable' : reg[type].names[0]))));
    });
    const detect = h('button', { class: 'action quiet' }, 'Détecter à nouveau');
    detect.addEventListener('click', async () => { await detectEffects(true); renderSettingsView(); });
    view.appendChild(section('Effets Premiere utilisés', [fx, h('div', { class: 'note' }, 'Noms détectés dans la langue de ton Premiere. Un effet introuvable ? Voir « Avancé » plus bas.')], detect));

    // Raccourcis
    const sc = h('div');
    Object.keys(Keys.ACTIONS).forEach(action => {
      const b = h('button', { class: 'action', 'data-shortcut': action });
      b.addEventListener('click', () => { S.capturing = S.capturing === action ? null : action; renderShortcuts(); });
      sc.appendChild(h('div', { class: 'shortcut-row' }, h('span', null, Keys.ACTIONS[action]), b));
    });
    view.appendChild(section('Raccourcis clavier', [h('div', { class: 'note' }, 'Actifs quand le panneau RR FX est sélectionné (clique dedans, puis appuie sur la touche). Échap arrête une opération en cours. Clique sur une touche pour la changer.'), sc]));
    renderShortcuts();

    // Signal de fin
    const test = h('button', { class: 'action quiet' }, 'Tester le signal');
    test.addEventListener('click', () => { status.finish('ok', 'Test du signal de fin', 'Le bilan clignote et le son est joué (si activé).'); signalEnd(); });
    view.appendChild(section('Signal de fin', [
      checkbox('Jouer un son à la fin', st.endSound, v => { st.endSound = v; persist(); }),
      h('div', { class: 'note' }, 'Pour les opérations de plus de 8 s (beaucoup de coupes, rampes) : le bilan clignote.'),
      h('div', { class: 'row-buttons' }, test)
    ]));

    // Confirmations
    view.appendChild(section('Confirmations', [
      h('div', null, checkbox('Demander avant d\'appliquer une rampe', st.confirmRamp, v => { st.confirmRamp = v; persist(); })),
      h('div', null, checkbox('Demander avant d\'annuler', st.confirmUndo, v => { st.confirmUndo = v; persist(); }))
    ]));

    // Mises à jour
    const check = h('button', { class: 'action' }, 'Vérifier maintenant');
    check.addEventListener('click', () => checkUpdates(true));
    view.appendChild(section('Mises à jour', [
      h('div', { class: 'note' }, 'Version installée : ' + Host.VERSION + (S.ctx && S.ctx.app ? ' · Premiere ' + S.ctx.app : '')),
      checkbox('Vérifier les mises à jour au démarrage', st.checkUpdates, v => { st.checkUpdates = v; persist(); }),
      h('div', { class: 'row-buttons' }, check)
    ]));

    // Avancé
    const ta = h('textarea', { class: 'code', spellcheck: 'false', rows: 6 }, JSON.stringify(st.registry || {}, null, 2));
    const saveReg = h('button', { class: 'action' }, 'Enregistrer');
    saveReg.addEventListener('click', () => {
      try {
        const v = JSON.parse(ta.value || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('il faut un objet { … }');
        st.registry = v; persist();
        status.finish('ok', 'Correspondance enregistrée', '');
        renderGrid();
      } catch (e) { status.finish('error', 'JSON invalide', errorMessage(e)); }
    });
    const out = h('pre', { class: 'code hidden' });
    const showOut = text => { out.textContent = text; out.classList.remove('hidden'); };
    const diag = h('button', { class: 'action' }, 'Analyser le clip sélectionné');
    diag.addEventListener('click', async () => { const r = await Host.call('diagnose', {}); showOut(r.ok ? r.text : r.error); });
    const listFx = h('button', { class: 'action' }, 'Lister les effets vidéo');
    listFx.addEventListener('click', async () => { const r = await Host.call('listEffects', {}); showOut(r.ok ? (r.names.join('\n') || '(aucun)') : r.error); });
    const defaults = h('button', { class: 'action quiet' }, 'Valeurs par défaut');
    defaults.addEventListener('click', () => showOut(JSON.stringify(Core.REGISTRY, null, 2)));
    view.appendChild(section('Avancé', [
      h('div', { class: 'note' }, 'Correspondance des effets : nom exact d\'un effet ou numéro d\'un paramètre, si la détection automatique se trompe. Exemple : ', h('code', null, '{"wave": {"names": ["Déformation de la vague"]}}')),
      ta, h('div', { class: 'row-buttons' }, saveReg, defaults),
      h('div', { class: 'row-buttons' }, diag, listFx), out
    ]));

    // Bibliothèque
    const openDir = h('button', { class: 'action', disabled: !Store.onDisk }, 'Ouvrir le dossier');
    openDir.addEventListener('click', () => Store.openFolder());
    view.appendChild(section('Bibliothèque', [h('div', { class: 'note' }, Store.location), h('div', { class: 'row-buttons' }, openDir)]));

    // Journal
    const clear = h('button', { class: 'action quiet' }, 'Effacer');
    const box = h('div', { class: 'log', id: 'log' }, S.logLines.map(l => h('div', { class: l.level }, l.message)));
    clear.addEventListener('click', () => { S.logLines = []; box.innerHTML = ''; });
    view.appendChild(section('Journal', box, clear));
  }

  // ---------------------------------------------------------------- raccourcis clavier

  const SHORTCUT_ACTIONS = {
    apply: () => applyEffect(),
    ramp: () => applyRamp(),
    undo: () => undoLast(),
    capture: () => capture(),
    beats: () => app.actions.beats && app.actions.beats(),
    sync: () => app.actions.sync && app.actions.sync()
  };

  function renderShortcuts() {
    document.querySelectorAll('[data-shortcut]').forEach(b => {
      const a = b.getAttribute('data-shortcut');
      b.textContent = S.capturing === a ? 'Appuie sur une touche…' : S.shortcuts[a] || '—';
    });
  }

  function registerKeys() {
    Host.registerKeys(Keys.keyInterest(S.shortcuts, Host.isMac));
  }

  function onKeyDown(event) {
    if ($('modal-root').childNodes.length) return;
    if (S.capturing) {
      event.preventDefault();
      if (event.key === 'Escape') S.capturing = null;
      else if (event.key === 'Backspace' || event.key === 'Delete') { S.shortcuts = Keys.assign(S.shortcuts, S.capturing, ''); S.capturing = null; }
      else {
        const key = Keys.normalizeKey(event);
        if (!key) return;
        S.shortcuts = Keys.assign(S.shortcuts, S.capturing, key);
        S.capturing = null;
      }
      settings().shortcuts = S.shortcuts;
      persist();
      registerKeys();
      renderShortcuts();
      return;
    }
    if (event.key === 'Escape' && S.busy) { requestCancel(); return; }
    const tag = String((event.target && event.target.tagName) || '').toLowerCase();
    if (S.busy || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const action = Keys.actionFor(S.shortcuts, Keys.normalizeKey(event));
    if (action) { event.preventDefault(); SHORTCUT_ACTIONS[action](); }
  }

  function requestCancel() {
    if (!S.busy) return;
    S.cancel = true;
    $('status-detail').textContent = 'Arrêt après la zone en cours…';
  }

  // ---------------------------------------------------------------- mode réduit, menu, CTA

  function applyCompact(compact) {
    $('panel').classList.toggle('compact', compact);
    $('toggle-compact').textContent = compact ? '▾ Réglages' : '▴ Réduire';
  }
  function toggleCompact() {
    settings().compact = !settings().compact;
    persist();
    applyCompact(settings().compact);
    setMenu();
  }

  function setMenu() {
    Host.setMenu([
      { id: 'apply', label: 'Appliquer l\'effet choisi' },
      { id: 'ramp', label: 'Appliquer la rampe' },
      { id: 'capture', label: 'Capturer la sélection' },
      { id: 'beats', label: 'Poser les marqueurs des temps forts' },
      { id: 'sync', label: 'Synchroniser la sélection sur la musique' },
      { id: 'undo', label: 'Annuler la dernière opération RR FX' },
      { id: 'clear', label: 'Tout effacer (séquence)…' },
      { separator: true },
      { id: 'compact', label: 'Mode réduit', checked: settings().compact },
      { id: 'instagram', label: '@robin.rahoual sur Instagram' }
    ], id => {
      if (id === 'compact') return toggleCompact();
      if (id === 'instagram') return Host.openURL(INSTAGRAM_URL);
      if (id === 'clear') return clearAll({ scope: 'sequence', markers: true });
      if (SHORTCUT_ACTIONS[id]) SHORTCUT_ACTIONS[id]();
    });
  }

  function ctaAction() {
    if (app.tabs[S.tab]) return app.tabs[S.tab].cta();
    if (S.tab === 'ramp') return { label: 'Appliquer la rampe', run: applyRamp, enabled: true };
    if (S.tab === 'mine' && S.mineView === 'community') return { label: 'Publier un de mes effets…', run: publishPicker, enabled: true };
    if (S.tab === 'mine') return { label: 'Capturer la sélection', run: capture, enabled: true };
    return { label: S.cur ? 'Appliquer · ' + S.cur.name : 'Appliquer', run: applyEffect, enabled: !!S.cur };
  }
  function renderCTA() {
    const a = ctaAction(), b = $('cta');
    b.textContent = a.label;
    setDisabled(b, S.busy || !a.enabled);
  }

  function switchTab(tab) {
    if (S.tab !== tab && app.tabs[S.tab] && app.tabs[S.tab].leave) app.tabs[S.tab].leave();
    S.tab = tab;
    settings().tab = tab;
    persist();
    stopThumb();
    if (S.player) { S.player.stop(); S.player = null; }
    if (S.rampPlayer) { S.rampPlayer.stop(); S.rampPlayer = null; }
    S.curveEd = null;
    S.rampEd = null;
    S.capturing = null;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => { v.classList.toggle('on', v.id === 'view-' + tab); if (v.id !== 'view-' + tab) v.innerHTML = ''; });
    if (tab === 'effects') renderEffectsView();
    if (tab === 'ramp') renderRampView();
    if (tab === 'mine') renderMineView();
    if (tab === 'settings') renderSettingsView();
    if (app.tabs[tab]) app.tabs[tab].render($('view-' + tab));
    renderCTA();
    $('scroll').scrollTop = 0;
  }

  // ---------------------------------------------------------------- mises à jour

  function showUpdate(update) {
    S.update = update;
    if (!update) { show($('update-banner'), false); return; }
    $('update-text').textContent = '⬆ RR FX ' + update.version + ' est disponible (tu as la ' + Host.VERSION + '). Télécharge le pack, puis lance le script d\'installation.';
    show($('update-banner'), true);
  }

  async function checkUpdates(force) {
    const update = await Updates.checkForUpdate({ fetch: (u, o) => fetch(u, o), storage, currentVersion: Host.VERSION, force });
    showUpdate(update);
    if (force) {
      if (update) log('Nouvelle version disponible : ' + update.version, 'ok');
      else log('RR FX ' + Host.VERSION + ' est à jour (ou GitHub est injoignable).', 'info');
      status.finish(update ? 'ok' : 'idle', update ? 'Mise à jour disponible' : 'Prêt', update ? 'RR FX ' + update.version : '');
    }
  }

  // ---------------------------------------------------------------- démarrage

  async function detectEffects(force) {
    const r = await Host.call('listEffects', {});
    if (!r.ok || !Array.isArray(r.names) || !r.names.length) {
      if (force) log('Liste des effets Premiere indisponible' + (r.error ? ' : ' + r.error : ''), 'warn');
      return;
    }
    S.resolved = Core.resolveEffectNames(r.names, Core.mergeRegistry(settings().registry));
    const missing = Object.keys(S.resolved).filter(t => !S.resolved[t]);
    if (missing.length) log('Effets Premiere introuvables : ' + missing.map(t => Core.REGISTRY[t].names[0]).join(', ') + ' (Réglages > Avancé)', 'warn');
    else if (force) log('Tous les effets Premiere utilisés sont trouvés.', 'ok');
  }

  function bindHeader() {
    $('instagram').addEventListener('click', () => Host.openURL(INSTAGRAM_URL));
    $('toggle-compact').addEventListener('click', toggleCompact);
    $('cta').addEventListener('click', () => { const a = ctaAction(); if (a.enabled && !S.busy) a.run(); });
    $('undo').addEventListener('click', undoLast);
    $('cancel').addEventListener('click', requestCancel);
    $('status-close').addEventListener('click', () => status.reset());
    $('status-log').addEventListener('click', () => {
      switchTab('settings');
      const box = $('log');
      if (box) box.scrollIntoView();
    });
    $('update-download').addEventListener('click', () => S.update && Host.openURL(S.update.downloadUrl));
    $('update-page').addEventListener('click', () => S.update && Host.openURL(S.update.pageUrl));
    $('update-later').addEventListener('click', () => { if (S.update) Updates.dismissUpdate(storage, S.update.version); showUpdate(null); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.addEventListener('keydown', onKeyDown);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.curveEd) S.curveEd.draw(); if (S.rampEd) S.rampEd.draw(); }, 60); });
  }

  // ---------------------------------------------------------------- modules (Musique, Textes…)

  const app = {
    S, Core, Lib, Pv, Store, Host, Audio, Media, Share,
    UI: window.RRFXUI, settings, persist, log, status, runTask, modal, promptName, confirmDialog,
    plural, clone, errorMessage, pushHistory, renderCTA, switchTab, fps, registry, uid,
    tabs: {}, actions: {}, services: {}
  };
  window.RRFXApp = app;
  function loadFeatures() {
    (window.RRFXFeatures || []).forEach(feature => {
      try { feature(app); } catch (e) { log('Module du panneau indisponible : ' + errorMessage(e), 'error'); }
    });
  }

  async function boot() {
    try {
      S.lib = Store.load();
    } catch (e) {
      S.lib = { version: 1, favorites: [], items: [], history: [], settings: {} };
      log('Bibliothèque illisible : ' + errorMessage(e), 'error');
    }
    S.lib.settings = Object.assign(clone(DEFAULT_SETTINGS), S.lib.settings);
    S.lib.settings.ramp = Object.assign(clone(DEFAULT_SETTINGS.ramp), S.lib.settings.ramp);
    if (!PLACEMENTS.some(p => p.v === S.lib.settings.placement)) S.lib.settings.placement = 'cut';
    // 1.3 : tout se pose sur un calque de réglage (sauf CLIP FX, imposé par l'effet).
    S.lib.settings.target = 'adjustment';
    if (!Array.isArray(S.lib.settings.overlays)) S.lib.settings.overlays = [];
    S.shortcuts = Keys.withDefaults(S.lib.settings.shortcuts);

    applyTheme();
    Host.on('com.adobe.csxs.events.ThemeColorChanged', applyTheme);
    bindHeader();
    applyCompact(settings().compact);
    S.cur = entries()[0];
    S.params = defaultParams(S.cur);
    status.reset();
    renderUndo();
    loadFeatures();
    switchTab(['effects', 'ramp', 'mine', 'settings'].concat(Object.keys(app.tabs)).indexOf(settings().tab) >= 0 ? settings().tab : 'effects');

    const init = await Host.init();
    S.demo = init.demo;
    log('RR FX ' + Host.VERSION + ' · plugin par @robin.rahoual sur Instagram' + (S.demo ? ' · mode démo' : ''), 'info');
    if (!init.demo && !init.loaded) {
      status.finish('error', 'Script Premiere non chargé', 'Redémarre Premiere. Si ça persiste, réinstalle RR FX.');
      log('Version du script chargé : « ' + (init.version || 'aucune') + ' », attendue ' + Host.VERSION, 'error');
    }
    const c = await Host.call('compat', {});
    if (c.ok) {
      S.compat = c;
      if (c.missing.length) {
        status.finish('error', 'Plugin à mettre à jour', 'Cette version de Premiere ne fournit plus : ' + c.missing.join(', ') + '.');
        log('Fonctions Premiere manquantes : ' + c.missing.join(', '), 'error');
      }
      if (c.optional.length) log('Fonctions optionnelles absentes : ' + c.optional.join(', '), 'warn');
      if (c.app) log('Premiere ' + c.app, 'info');
    }
    await detectEffects(false);
    registerKeys();
    setMenu();
    await refreshContext();
    if (S.tab === 'settings') renderSettingsView();
    setInterval(() => { if (!document.hidden) refreshContext(); }, 2000);
    if (settings().checkUpdates && !S.demo) checkUpdates(false).catch(() => {});
  }

  window.addEventListener('error', e => log('Erreur du panneau : ' + e.message, 'error'));
  window.addEventListener('unhandledrejection', e => log('Erreur du panneau : ' + errorMessage(e.reason), 'error'));
  document.addEventListener('DOMContentLoaded', () => {
    boot().catch(e => {
      try { status.finish('error', 'Initialisation incomplète', errorMessage(e)); } catch (ignored) { /* panneau indisponible */ }
      log('Initialisation incomplète du panneau : ' + errorMessage(e), 'error');
    });
  });
})();
