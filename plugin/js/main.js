/* RR FX : panneau : onglets, bloc d'état, application des effets et des rampes. */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const Core = window.RRFXCore, Lib = window.RRFXLibrary, Pv = window.RRFXPreview, Sons = window.RRFXSons;
  const Store = window.RRFXStorage, Host = window.RRFXHost, Keys = window.RRFXShortcuts, Updates = window.RRFXUpdates;
  const Audio = window.RRFXAudio, Media = window.RRFXMedia, Share = window.RRFXShare, Packs = window.RRFXPacks, Community = window.RRFXCommunity;
  const { h, hotText, actionGroup, picker, checkbox, row, section, CurveEditor, RampEditor, Player } = window.RRFXUI;

  const INSTAGRAM_URL = 'https://www.instagram.com/robin.rahoual/';
  const LONG_TASK_MS = 8000; // au-delà, signal de fin
  const MAX_LOG_LINES = 300;
  const MAX_HISTORY = 50;

  const PLACEMENTS = [
    { v: 'cut', label: _T('Coupe la plus proche') },
    { v: 'cuts', label: _T('Toutes les coupes de la sélection') },
    { v: 'allcuts', label: _T('Toutes les coupes de la séquence') },
    { v: 'markers', label: _T('Marqueurs de la séquence') },
    { v: 'beats', label: _T('Temps forts de la musique (sans marqueurs)') },
    { v: 'playhead', label: _T('Tête de lecture') },
    { v: 'clipStart', label: _T('Début des clips sélectionnés') },
    { v: 'clipEnd', label: _T('Fin des clips sélectionnés') },
    { v: 'full', label: _T('Clips sélectionnés entiers') },
    { v: 'allclips', label: _T('Tous les plans de la séquence') }
  ];
  // Positions à plusieurs coupes, positions « plan entier », et ce que Premiere reçoit.
  const isMulti = pl => pl === 'cuts' || pl === 'allcuts' || pl === 'markers' || pl === 'beats';
  const isFull = pl => pl === 'full' || pl === 'allclips';
  const hostPlacement = pl => ({ beats: 'markers', allcuts: 'cuts', allclips: 'full' }[pl] || pl);
  const VARIATIONS = [
    { v: 'same', label: _T('Identique partout') },
    { v: 'seed', label: _T('Variation aléatoire') },
    { v: 'category', label: _T('Effet au hasard (même catégorie)') },
    { v: 'favorites', label: _T('Effet au hasard (favoris)') },
    { v: 'chain', label: _T('Enchaînement (effets choisis)') }
  ];
  const RAMP_PLACEMENTS = [
    { v: 'pre', label: _T('Avant la coupe') },
    { v: 'post', label: _T('Après la coupe') },
    { v: 'playhead', label: _T('Autour de la tête de lecture') },
    { v: 'full', label: _T('Clip entier') }
  ];
  const DEFAULT_SETTINGS = {
    target: 'adjustment', placement: 'cut', side: 'both', vary: 'seed', adjNodeId: null, adjName: '', registry: {},
    tab: 'express', confirmRamp: true, confirmUndo: true, compact: false, endSound: true, checkUpdates: true, shortcuts: null, copyLook: true,
    volumeFollow: false, volumeInfluence: 60, overlays: [], overlayBlend: 8, overlayBlendLearned: false, chain: { keys: [], order: 'cycle' }, sfx: 'none',
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
  const catLabel = id => (CATS.find(c => c.id === id) || { label: id === 'mine' ? _T('Mes effets') : id }).label;
  // Modes de fusion de l'Opacité de Premiere (valeurs de script) et leur équivalent pour l'aperçu.
  const BLENDS = [
    { v: 8, label: _T('Écran'), css: 'screen' }, { v: 10, label: _T('Densité linéaire - (Ajout)'), css: 'lighter' },
    { v: 7, label: _T('Éclaircir'), css: 'lighten' }, { v: 12, label: _T('Incrustation'), css: 'overlay' },
    { v: 13, label: _T('Lumière tamisée'), css: 'soft-light' }, { v: 3, label: _T('Produit'), css: 'multiply' }, { v: 0, label: 'Normal', css: 'source-over' }
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
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try { if (S.lib) Store.save(S.lib); } catch (e) { log(_T('Sauvegarde impossible : ') + errorMessage(e), 'error'); }
    ((window.RRFXApp && window.RRFXApp.afterSave) || []).forEach(fn => { try { fn(); } catch (e) { log(errorMessage(e), 'warn'); } });
  }
  function persist() {
    if (S.lib) S.lib.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  // Panneau fermé ou rechargé avant l'enregistrement différé : on enregistre tout de suite.
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
  window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });

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
      $('status-detail').textContent = _T('Démarrage…');
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
        if (remaining > 1500) text += _T(' · encore ~') + formatDuration(remaining);
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
    function reset() { finish('idle', _T('Prêt'), ''); }
    return { start, phase, progress, finish, reset, get kind() { return kindNow; } };
  })();

  function renderIdleDetail() {
    if (status.kind !== 'idle') return;
    const c = S.ctx;
    let text;
    if (!c) text = _T('Connexion à Premiere…');
    else if (!c.hasSequence) text = _T('Ouvre une séquence dans Premiere.');
    else {
      const parts = [c.name, (Math.round(c.fps * 100) / 100) + _T(' i/s')];
      parts.push(c.selection ? plural(c.selection, _T('clip sélectionné'), _T('clips sélectionnés')) : _T('aucun clip sélectionné'));
      if (c.markers) parts.push(plural(c.markers, _T('marqueur')));
      text = parts.join(' · ');
    }
    if (S.demo) text = _T('Mode démo (hors Premiere) · ') + text;
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
      const result = (await task()) || { kind: 'ok', title: _T('Terminé') };
      status.finish(result.kind, result.title, result.detail);
      if (Date.now() - started > LONG_TASK_MS && result.kind !== 'idle') signalEnd();
      return result;
    } catch (e) {
      status.finish('error', _T('Échec'), errorMessage(e));
      log(errorMessage(e), 'error');
      if (Date.now() - started > LONG_TASK_MS) signalEnd();
      return { kind: 'error', title: _T('Échec'), detail: errorMessage(e) };
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
      { label: _T('Annuler'), value: null },
      { label: _T('Enregistrer'), primary: true, value: () => input.value.trim() || null }
    ]);
  }

  async function confirmDialog(title, text, okLabel, settingKey) {
    if (settingKey && !settings()[settingKey]) return true;
    const dont = settingKey ? checkbox(_T('Ne plus demander'), false, () => {}) : null;
    const ok = await modal(title, h('div', null, h('p', null, text), dont), [
      { label: _T('Annuler'), value: false },
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
    window.RRFXUI.css.reset();
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
    if (isFull(pl)) return [side === 'pre' ? 'pre' : 'post'];
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

  // Les vidéos d'overlays ne tournent que pendant qu'on regarde leur aperçu.
  function pauseOverlayVideos(except) {
    ovMedia.forEach((m, id) => { if (id !== except && m.el.pause && !m.el.paused) m.el.pause(); });
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
    status.phase(_T('Fabrication de « ') + def.name + _T(' » (') + size.W + '×' + size.H + _T(', une seule fois)'));
    const c = document.createElement('canvas');
    c.width = size.W; c.height = size.H;
    const g = c.getContext('2d');
    for (let i = 0; i < total; i++) {
      if (S.cancel) return null;
      status.progress(i, total, '');
      Packs.draw(g, size.W, size.H, i / (total - 1), i, def);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error(_T('Image de l\'overlay non fabriquée (mémoire ?)'));
      Store.fs.writeFileSync(Store.path.join(dir, Packs.fileName(def, i)), new Uint8Array(await blob.arrayBuffer()));
    }
    Store.fs.writeFileSync(Store.path.join(dir, 'ok.json'), JSON.stringify({ id: def.id, frames: total, fps: rate, W: size.W, H: size.H }));
    log(_T('Overlay « ') + def.name + _T(' » fabriqué : ') + dir, 'ok');
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
    if (!fresh.length) { status.finish('warn', _T('Aucun overlay ajouté'), _T('Formats pris en charge : MOV, MP4, WEBM, PNG, JPG (ou déjà dans la liste).')); return; }
    st.overlays = st.overlays.concat(fresh);
    persist();
    S.cat = 'overlay';
    S.cur = entryByKey('o:' + fresh[0].id);
    S.params = defaultParams(S.cur);
    renderEffectsView();
    status.finish('ok', plural(fresh.length, _T('overlay ajouté'), _T('overlays ajoutés')), _T('Choisis-en un, règle sa durée et son mode de fusion, puis applique-le sur tes coupes.'));
  }
  function addOverlays(fromFolder) {
    if (fromFolder === true) {
      const dirs = Store.pickFiles(_T('Choisir un dossier d\'overlays'), [], true);
      if (dirs && dirs.length) addOverlayList(Store.listFiles(dirs[0], OVERLAY_FILES, 200, 3));
      return;
    }
    const picked = Store.pickFiles(_T('Choisir des overlays (vidéos ou images)'), ['mov', 'mp4', 'm4v', 'webm', 'png', 'jpg', 'jpeg']);
    if (picked) { if (picked.length) addOverlayList(picked); return; }
    // Hors de Premiere (démo) : sélecteur du navigateur.
    const input = h('input', { type: 'file', class: 'hidden', multiple: true, accept: 'video/*,image/png,image/jpeg' });
    input.addEventListener('change', () => addOverlayList(Array.from(input.files).map(f => ({ name: f.name, url: URL.createObjectURL(f) }))));
    input.click();
  }
  async function learnBlend() {
    const r = await Host.call('readBlend', {});
    if (!r.ok) return status.finish('error', _T('Mode de fusion illisible'), r.error);
    settings().overlayBlend = Number(r.value);
    settings().overlayBlendLearned = true;
    persist();
    renderInspector();
    const known = BLENDS.find(b => b.v === Number(r.value));
    status.finish('ok', _T('Mode de fusion appris'), (known ? known.label : _T('valeur ') + r.value) + _T(' : utilisé pour tous les overlays.'));
  }

  // Aperçu sur la vraie image : 2 images exportées autour de la coupe la plus proche.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(_T('image illisible')));
      img.src = src;
    });
  }
  function grabRealFrames() {
    return runTask(_T('Aperçu réel'), async () => {
      const dir = Store.cacheDir();
      if (!dir) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('L\'aperçu sur ta séquence exporte deux images de la timeline : il faut le panneau dans Premiere.') };
      Store.listFiles(dir, /^rrfx-frame-/, 50, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
      status.phase(_T('Export de deux images autour de la coupe'));
      const r = await Host.call('grabFrames', { folder: dir.replace(/\\/g, '/'), prefix: 'rrfx-frame-' + uid() + '-' });
      if (!r.ok) return { kind: 'error', title: _T('Aperçu réel impossible'), detail: r.error };
      // Premiere écrit les fichiers après coup : on attend qu'ils existent (avec ou sans .png).
      const found = [];
      for (let t = 0; t < 40 && found.length < r.files.length; t++) {
        found.length = 0;
        r.files.forEach(f => { const g = [f, f + '.png'].find(x => Store.fs.existsSync(x) && Store.fs.statSync(x).size > 0); if (g) found.push(g); });
        if (found.length < r.files.length) await new Promise(res => setTimeout(res, 150));
      }
      if (found.length < r.files.length) return { kind: 'error', title: _T('Aperçu réel impossible'), detail: _T('Premiere n\'a pas écrit les images (') + dir + ').' };
      const imgs = await Promise.all(found.map(f => loadImage(fileURL(f) + '?' + Date.now())));
      Pv.setShots(imgs[0], imgs[1]);
      renderInspector();
      return { kind: 'ok', title: _T('Aperçu sur ta séquence'), detail: _T('Images autour de la coupe à ') + r.cut.toFixed(2) + _T(' s. « Plans de test » pour revenir.') };
    });
  }
  /* Images « propres » de la timeline aux instants donnés (secondes) : looks, titres et
     overlays coupés pendant l'export (level : on garde les étalonnages RR FX de niveau
     inférieur, 2 = conversion seule). Renvoie des ImageData de largeur w. Hors de Premiere :
     les plans de test. */
  async function grabClean(times, level, w, onProgress) {
    w = w || 320;
    const toData = img => {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, h2 = Math.max(1, Math.round(w * ih / iw));
      const c = document.createElement('canvas');
      c.width = w; c.height = h2;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h2);
      return g.getImageData(0, 0, w, h2);
    };
    const dir = Store.cacheDir();
    if (!dir || S.demo) return times.map((t, i) => toData(Pv.shots()[i % 2 ? 'B' : 'A']));
    Store.listFiles(dir, /^rrfx-clean-/, 400, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
    const r = await Host.call('framesBegin', { times, level, folder: dir.replace(/\\/g, '/'), prefix: 'rrfx-clean-' + uid() + '-' });
    if (!r.ok) throw new Error(r.error);
    const found = new Array(r.files.length).fill(null);
    try {
      // Premiere écrit les images après coup (avec ou sans .png) : on les attend.
      const limit = 40 + r.files.length * 8;
      for (let t = 0; t < limit && found.some(f => !f); t++) {
        r.files.forEach((f, i) => { if (!found[i]) found[i] = [f, f + '.png'].find(x => Store.fs.existsSync(x) && Store.fs.statSync(x).size > 0) || null; });
        if (onProgress) onProgress(found.filter(Boolean).length / found.length);
        if (found.some(f => !f)) await new Promise(res => setTimeout(res, 150));
      }
      // Une image tout juste créée peut être encore en cours d'écriture.
      await new Promise(res => setTimeout(res, 250));
    } finally {
      await Host.call('framesEnd', { off: r.off });
    }
    if (found.some(f => !f)) throw new Error(_T('Premiere n\'a pas écrit toutes les images (') + dir + ').');
    const imgs = await Promise.all(found.map(f => loadImage(fileURL(f) + '?' + Date.now())));
    found.forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
    return imgs.map(toData);
  }
  function useTestShots() {
    Pv.resetShots();
    renderInspector();
  }

  // Vignettes déjà dessinées, par jeu d'images de test : changer d'onglet ou de catégorie ne
  // recalcule pas les flous et les filés de chaque carte.
  const thumbCache = new WeakMap();
  function drawThumb(canvas, entry) {
    if (entry.kind === 'overlay' && !entry.overlay.pack) {
      const g = canvas.getContext('2d');
      Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
      overlayMedia(entry.overlay, () => { Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null); drawOverlayOn(g, entry, 0.9); });
      return;
    }
    const shots = Pv.shots();
    let cache = thumbCache.get(shots);
    if (!cache) thumbCache.set(shots, cache = new Map());
    const key = entry.key + '|' + canvas.width + 'x' + canvas.height + '|' + (entry.overlay ? fps() : entry.item ? window.RRFXAssets.hashText(JSON.stringify(entry.item.data)) : '');
    const hit = cache.get(key), g = canvas.getContext('2d');
    if (hit) { g.drawImage(hit, 0, 0); return; }
    if (!paintThumb(canvas, entry)) return;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    cache.set(key, copy);
  }

  function paintThumb(canvas, entry) {
    if (entry.kind === 'overlay') {
      const g = canvas.getContext('2d');
      Pv.render(g, Pv.shots().A, Pv.stateAt(null, 0), null);
      drawOverlayOn(g, entry, 0.95, Math.round(fps() * 0.8));
      return true;
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
      return true;
    } catch (e) {
      log(_T('Vignette « ') + entry.name + _T(' » : ') + errorMessage(e), 'warn');
      return false;
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
    const search = h('input', { class: 'textfield', placeholder: _T('Rechercher un effet'), value: S.search, spellcheck: 'false' });
    search.addEventListener('input', () => { S.search = search.value; renderGrid(); });
    const fav = h('button', { class: 'action icon' + (S.favOnly ? ' selected on' : ''), title: _T('Favoris uniquement') }, '★');
    fav.addEventListener('click', () => { S.favOnly = !S.favOnly; fav.classList.toggle('selected', S.favOnly); fav.classList.toggle('on', S.favOnly); renderGrid(); });
    view.appendChild(h('div', { class: 'search' }, search, fav));

    const chips = h('div', { class: 'chips' });
    [{ id: 'all', label: _T('Tout') }].concat(CATS, [{ id: 'mine', label: _T('Mes effets') }]).forEach(c => {
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
      const add = h('div', { class: 'card add-card', title: _T('Light leaks, grain, poussière, flares… (vidéos ou images)') }, h('div', { class: 'thumb add-thumb' }, '＋'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, _T('Ajouter des overlays'))));
      add.addEventListener('click', () => addOverlays(false));
      grid.appendChild(add);
      if (Store.onDisk) {
        const folder = h('div', { class: 'card add-card', title: _T('Ajoute toutes les vidéos et images d\'un dossier (pack d\'overlays)') }, h('div', { class: 'thumb add-thumb' }, '▤'), h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, _T('Ajouter un dossier'))));
        folder.addEventListener('click', () => addOverlays(true));
        grid.appendChild(folder);
      }
    }
    if (!list.length) {
      if (S.cat === 'overlay') return;
      grid.appendChild(h('div', { class: 'empty' }, S.cat === 'mine'
        ? _T('Aucun effet perso : enregistre un preset (« ＋ Preset » sur un effet) ou capture un clip dans « Mes effets ».')
        : _T('Aucun effet ne correspond.')));
      return;
    }
    list.forEach(e => {
      const cv = h('canvas', { width: 160, height: 90 });
      const card = h('div', { class: 'card' + (S.cur && S.cur.key === e.key ? ' on' : ''), 'data-key': e.key, title: e.def ? e.def.desc : _T('Effet capturé') },
        h('div', { class: 'thumb' }, cv, e.kind !== 'builtin' ? h('span', { class: 'user-mark' }, e.kind === 'overlay' && e.overlay.pack ? Packs.byId[e.overlay.pack].packName : ({ captured: _T('capturé'), overlay: 'overlay' })[e.kind] || 'preset') : null),
        h('div', { class: 'card-meta' }, h('span', { class: 'card-name' }, e.name),
          e.def && e.def.target ? h('span', { class: 'tag', title: _T('Posé sur une copie du plan (un calque de réglage ne peut pas mélanger les images)') }, 'CLIP FX') : null,
          isFav(e) ? h('span', { class: 'fav-mark' }, '★') : null,
          settings().vary === 'chain' && settings().chain.keys.includes(e.key) ? h('span', { class: 'chain-mark', title: _T('Dans l\'enchaînement') }, String(settings().chain.keys.indexOf(e.key) + 1)) : null));
      card.addEventListener('click', ev => (ev.shiftKey ? toggleChain(e) : selectEntry(e)));
      card.addEventListener('mouseenter', () => animateThumb(cv, e));
      card.addEventListener('mouseleave', () => { stopThumb(); drawThumb(cv, e); });
      grid.appendChild(card);
      drawThumb(cv, e);
    });
  }

  function selectEntry(e, keepParams) {
    S.cur = e;
    if (!keepParams) S.params = defaultParams(e);
    if (e.kind === 'captured' && e.item.data.origin && !isFull(settings().placement) && settings().side !== 'both') settings().side = e.item.data.origin;
    // Les mouvements (Ken Burns, zoom lent, punch-in…) se posent sur tout le plan.
    if (e.def && e.def.cat === 'motion' && !isFull(settings().placement)) {
      settings().placement = 'full';
      persist();
      status.finish('ok', e.name + _T(' : sur les clips entiers'), _T('Ce mouvement dure tout le plan. Sélectionne tes clips, puis applique.'));
    }
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
      ins.appendChild(h('div', { class: 'empty' }, _T('Choisis un effet ci-dessus.')));
      return;
    }
    const p = S.params, def = e.def, st = settings();

    const star = h('button', { class: 'action quiet icon' + (isFav(e) ? ' on' : ''), title: _T('Favori') }, isFav(e) ? '★' : '☆');
    star.addEventListener('click', () => { toggleFav(e); star.textContent = isFav(e) ? '★' : '☆'; star.classList.toggle('on', isFav(e)); renderGrid(); });
    const save = h('button', { class: 'action quiet', title: e.kind === 'captured' ? _T('Dupliquer avec ces réglages') : _T('Enregistrer ces réglages comme preset') }, '＋ Preset');
    save.addEventListener('click', saveAsPreset);
    ins.appendChild(h('div', { class: 'effect-head' },
      h('span', { class: 'effect-name' }, e.name),
      h('span', { class: 'badge' }, e.kind === 'captured' ? _T('capturé') : e.kind === 'overlay' ? 'overlay' : e.kind === 'preset' ? 'preset · ' + catLabel(e.cat) : catLabel(e.cat)),
      h('div', { class: 'effect-tools' }, star, e.kind === 'overlay' ? null : save)));
    if (def && def.desc) ins.appendChild(h('div', { class: 'note' }, def.desc));
    if (def && def.face) ins.appendChild(h('div', { class: 'hint-box' }, def.track === 'object'
      ? _T('🎯 Au moment d\'appliquer, la première image du plan s\'affiche : entoure l\'objet, RR FX le suit dans tout le plan.')
      : _T('🙂 Le visage est cherché et suivi automatiquement dans chaque plan au moment d\'appliquer (quelques secondes). L\'aperçu ci-dessous suppose un visage en haut du cadre.')));
    if (e.kind === 'overlay') {
      ins.appendChild(h('div', { class: 'note' }, e.overlay.pack
        ? _T('Pack « ') + Packs.byId[e.overlay.pack].packName + _T(' », fourni avec RR FX. À la première utilisation, il est fabriqué à la taille de ta séquence (quelques secondes), puis réutilisé.')
        : e.overlay.path || e.overlay.name));
    }

    // Aperçu
    const cv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
    const play = h('button', { class: 'action quiet icon', title: _T('Lecture / pause') }, '❚❚');
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
    pauseOverlayVideos(e.kind === 'overlay' ? e.overlay.id : null);
    if (e.kind === 'overlay' && !e.overlay.pack) overlayMedia(e.overlay, m => { if (m.el.play && S.cur === e) { const p2 = m.el.play(); if (p2 && p2.catch) p2.catch(() => {}); } });
    const real = h('button', { class: 'action quiet', title: Pv.isReal() ? _T('Revenir aux plans de test') : _T('Utiliser les images de ta séquence autour de la coupe la plus proche') }, Pv.isReal() ? _T('Plans de test') : _T('📷 Ma vraie image'));
    real.addEventListener('click', () => (Pv.isReal() ? useTestShots() : grabRealFrames()));
    ins.appendChild(h('div', { class: 'preview' },
      h('div', { class: 'pv-frame' }, cv, h('span', { class: 'pv-label' }, Pv.isReal() ? _T('Aperçu sur ta séquence') : _T('Aperçu simulé'))),
      h('div', { class: 'pv-bar' }, play, strip, real)));

    // Placement
    const pl = st.placement;
    let sideCtl;
    if (pl === 'clipStart' || pl === 'clipEnd') {
      sideCtl = h('span', { class: 'muted' }, pl === 'clipStart' ? _T('POST, depuis le début') : _T('PRE, jusqu\'à la fin'));
    } else {
      const opts = [{ v: 'pre', label: 'PRE', cls: 'pre' }, { v: 'post', label: 'POST', cls: 'post' }];
      if (!isFull(pl)) opts.push({ v: 'both', label: 'PRE + POST' });
      sideCtl = actionGroup(opts, isFull(pl) ? (st.side === 'pre' ? 'pre' : 'post') : st.side, v => { st.side = v; persist(); paramChanged(true); });
    }
    const forced = def && def.target;
    const multi = isMulti(pl);
    const where = e.kind === 'overlay' ? _T('Overlay posé au-dessus du clip')
      : forced ? _T('CLIP FX : copie du plan au-dessus du clip') : _T('Calque de réglage au-dessus du clip');
    const volRows = [];
    if (e.kind !== 'captured') {
      volRows.push(h('div', { class: 'field' }, checkbox(_T('Intensité qui suit le volume de la musique'), st.volumeFollow, v => { st.volumeFollow = v; persist(); renderInspector(); })));
      if (st.volumeFollow) volRows.push(row('Influence', hotText({ value: st.volumeInfluence, min: 0, max: 100, step: 5, unit: '%', onChange: v => { st.volumeInfluence = v; persist(); } })));
    }
    ins.appendChild(section('Placement', [
      row(_T('Côté'), sideCtl),
      row('Position', picker(PLACEMENTS, pl, v => { st.placement = v; persist(); renderInspector(); renderCTA(); })),
      multi ? row(_T('Entre les coupes'), picker(VARIATIONS, st.vary, v => { st.vary = v; persist(); renderInspector(); renderCTA(); }), { title: _T('Varier le résultat à chaque coupe ou marqueur') }) : null,
      multi && st.vary === 'chain' ? chainRow() : null,
      isFull(pl) ? row(_T('Plans'), actionGroup([{ v: false, label: _T('Tous') }, { v: true, label: _T('Un sur deux') }], !!st.alternate, v => { st.alternate = v; persist(); }), { title: _T('Un sur deux : alterne cadrage large et serré, pour masquer les jump cuts') }) : null,
      row(_T('Posé sur'), h('span', { class: 'muted', title: forced ? _T('Un calque de réglage ne peut pas mélanger les images du plan : cet effet se pose sur une copie du passage. Le clip d\'origine n\'est jamais modifié.') : _T('Le clip d\'origine n\'est jamais modifié') }, where)),
      volRows,
      row(_T('Son'),  picker(SFX_CHOICES, st.sfx || 'none', v => { st.sfx = v; persist(); }), { title: _T('Sons fournis par RR FX, calés pour que leur moment fort tombe sur la coupe (piste audio libre, ta musique n\'est pas touchée)') })
    ]));

    // Paramètres
    const rows = [row(_T('Durée'), hotText({ value: p.frames, min: 1, max: 240, step: 1, unit: 'i', onChange: (v, fin) => { p.frames = v; paramChanged(fin); } }), { title: _T('Durée de chaque côté, en images') })];
    if (e.kind === 'overlay') {
      rows.push(row(_T('Opacité'), hotText({ value: Math.min(100, p.intensity), min: 0, max: 100, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
      rows.push(row(_T('Départ dans l\'overlay'), actionGroup([{ v: 'random', label: _T('Au hasard') }, { v: 'start', label: _T('Début') }, { v: 'middle', label: _T('Milieu') }], p.start, v => { p.start = v; })));
      const blendOpts = BLENDS.map(b => ({ v: String(b.v), label: b.label }));
      if (!BLENDS.some(b => b.v === Number(st.overlayBlend))) blendOpts.unshift({ v: String(st.overlayBlend), label: _T('Mode appris (') + st.overlayBlend + ')' });
      const learn = h('button', { class: 'action quiet', title: _T('Règle le mode de fusion voulu sur un clip dans Premiere, sélectionne-le, puis clique ici') }, _T('Apprendre'));
      learn.addEventListener('click', learnBlend);
      rows.push(row(_T('Mode de fusion'), h('div', { class: 'row-ctl' }, picker(blendOpts, String(st.overlayBlend), v => { st.overlayBlend = Number(v); persist(); paramChanged(true); }), learn)));
      const remove = h('button', { class: 'action quiet danger' }, _T('Retirer de la liste'));
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
      rows.push(h('div', { class: 'field' }, checkbox(_T('Étirer l\'animation à la durée'), p.stretch, v => { p.stretch = v; paramChanged(true); })));
      rows.push(h('div', null, checkbox(_T('Miroir pour l\'autre côté de la coupe'), p.mirror, v => { p.mirror = v; paramChanged(true); })));
      const d = e.item.data;
      rows.push(h('div', { class: 'note' }, (d.components || []).map(c => c.displayName).join(' · ') + _T(' · capturé sur ') + plural(d.frames || 0, _T('image'))));
    } else {
      rows.push(row(_T('Intensité'), hotText({ value: p.intensity, min: 0, max: 200, step: 1, unit: '%', onChange: (v, fin) => { p.intensity = v; paramChanged(fin); } })));
      (def.params || []).forEach(q => {
        if (q.type === 'range') rows.push(row(q.label, hotText({ value: p[q.key], min: q.min, max: q.max, step: q.step, unit: q.unit, onChange: (v, fin) => { p[q.key] = v; paramChanged(fin); } })));
        else if (q.type === 'select') rows.push(row(q.label, actionGroup(q.options.map(o => ({ v: o.v, label: o.label })), p[q.key], v => { p[q.key] = v; paramChanged(true); })));
      });
    }
    const reset = h('button', { class: 'action quiet', title: _T('Revenir aux valeurs par défaut') }, _T('Réinitialiser'));
    reset.addEventListener('click', () => { S.params = defaultParams(e); renderInspector(); });
    ins.appendChild(section(_T('Paramètres'), rows, reset));

    // Courbe
    if ((def && !def.noCurve) || e.kind === 'overlay') {
      const ccv = h('canvas', { class: 'curve-canvas' });
      const presetPick = picker(Object.keys(Core.CURVE_PRESETS).map(k => ({ v: k, label: Core.CURVE_PRESETS[k].label })).concat([{ v: 'custom', label: _T('Personnalisée') }]),
        curvePresetName(p.curve), v => { if (v !== 'custom') { p.curve = Core.curveValue(v); paramChanged(true); } });
      ins.appendChild(section(_T('Courbe'), [
        ccv,
        row(_T('Préréglage'), presetPick),
        h('div', { class: 'note' }, _T('Glisse les poignées. La moitié droite (POST) est le miroir de la gauche (PRE).'))
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
    if (!e || e.kind === 'overlay') return;
    if (e.kind === 'captured') {
      const name = await promptName(_T('Dupliquer l\'effet capturé'), e.name + _T(' (copie)'));
      if (!name) return;
      const data = clone(e.item.data);
      if (S.params.frames !== data.frames && data.frames) {
        data.components.forEach(c => c.props.forEach(pr => { if (pr.values) pr.values = Core.fitValues(pr.values, S.params.frames, data.origin || 'post', S.params.stretch); }));
        data.frames = S.params.frames;
      }
      S.lib.items.push({ id: uid(), type: 'captured', name, cat: e.item.cat || 'mine', created: Date.now(), data });
      persist();
      renderGrid();
      status.finish('ok', _T('Enregistré : ') + name, _T('Dans « Mes effets ».'));
      return;
    }
    const name = await promptName(_T('Enregistrer comme preset'), e.kind === 'preset' ? e.name : e.name + _T(' perso'));
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
    status.finish('ok', _T('Preset enregistré : ') + name, _T('Retrouve-le dans la catégorie « Mes effets ».'));
  }

  // ---------------------------------------------------------------- appliquer un effet

  // Une entrée par zone (PRE/POST d'une coupe). Les deux côtés d'une même coupe
  // reçoivent le même effet tiré au hasard.
  // ---------------------------------------------------------------- enchaînement d'effets

  function chainEntries() {
    const all = entries(), c = settings().chain;
    return c.keys.map(k => all.find(x => x.key === k)).filter(Boolean);
  }
  const chainOn = () => {
    const st = settings();
    return isMulti(st.placement) && st.vary === 'chain' && chainEntries().length > 0;
  };
  function toggleChain(e) {
    const c = settings().chain, i = c.keys.indexOf(e.key);
    if (i >= 0) c.keys.splice(i, 1); else c.keys.push(e.key);
    if (settings().vary !== 'chain' && i < 0) settings().vary = 'chain';
    persist();
    renderGrid();
    renderInspector();
    renderCTA();
    const multi = isMulti(settings().placement);
    status.finish('ok', i >= 0 ? e.name + _T(' retiré de l\'enchaînement') : e.name + _T(' ajouté à l\'enchaînement'), plural(c.keys.length, _T('effet')) + ' : ' + chainEntries().map(x => x.name).join(' → ') + (multi ? '' : _T('. Choisis la position Temps forts, Marqueurs ou Toutes les coupes pour l\'appliquer.')));
  }

  function chainRow() {
    const c = settings().chain, list = chainEntries();
    const box = h('div', { class: 'chain' });
    list.forEach((x, i) => {
      const chip = h('span', { class: 'chain-chip', title: _T('Retirer') }, h('b', null, String(i + 1)), x.name, h('span', { class: 'chain-x' }, '✕'));
      chip.addEventListener('click', () => toggleChain(x));
      box.appendChild(chip);
    });
    const add = h('button', { class: 'action quiet', disabled: !S.cur || c.keys.includes(S.cur.key), title: _T('Ou Maj + clic sur une carte') }, '+ ' + (S.cur ? S.cur.name : _T('effet affiché')));
    add.addEventListener('click', () => S.cur && toggleChain(S.cur));
    box.appendChild(add);
    return [
      row(_T('Enchaînement'), box, { title: _T('Les effets se succèdent sur les coupes, marqueurs ou temps forts. Maj + clic sur une carte pour ajouter ou retirer.') }),
      list.length ? row(_T('Ordre'), actionGroup([{ v: 'cycle', label: _T('Dans l\'ordre') }, { v: 'random', label: _T('Au hasard') }], c.order, v => { c.order = v; persist(); })) : h('div', { class: 'note' }, _T('Ajoute 2 à 4 effets : Maj + clic sur les cartes, ou le bouton ci-dessus.'))
    ];
  }

  // Sons fournis : fabriqués une fois dans Documents/RRFX/Sons.
  const SFX_CHOICES = [{ v: 'none', label: _T('Aucun') }, { v: 'mix', label: _T('Whooshs variés + impacts sur les temps forts') }, { v: 'whoosh', label: 'Whoosh' }, { v: 'impact', label: _T('Hit court') }]
    .concat(Sons.SOUNDS.filter(x => !['whoosh', 'hit'].includes(x.id)).map(x => ({ v: x.id, label: x.name })));
  function ensureSound(id) {
    const snd = Sons.byId(id);
    if (!Store.fs) return 'RRFX ' + snd.name + '.wav';
    const dir = Store.path.join(Store.dir, 'Sons'), file = Store.path.join(dir, 'RRFX ' + snd.name + '.wav');
    if (!Store.fs.existsSync(file)) {
      Store.fs.mkdirSync(dir, { recursive: true });
      const w = Sons.wav(Sons.render(id));
      Store.fs.writeFileSync(file, Buffer.from(w.buffer, w.byteOffset, w.byteLength));
    }
    return file;
  }

  function buildPlan(e, targets, vary, rate, factors) {
    let pool = null;
    if (vary === 'favorites') {
      pool = entries().filter(isFav);
      if (!pool.length) log(_T('Aucun favori : effets tirés dans la même catégorie.'), 'warn');
    }
    if (vary === 'category' || (vary === 'favorites' && !pool.length)) pool = entries().filter(x => x.cat === e.cat);
    const chain = vary === 'chain' ? chainEntries() : null;
    const runSeed = Math.floor(Math.random() * 1000) + 1;
    const cutIndex = new Map();
    return targets.map(t => {
      const key = t.side === 'pre' ? t.end : t.start;
      if (!cutIndex.has(key)) cutIndex.set(key, cutIndex.size);
      const k = cutIndex.get(key);
      let entry = e, params = S.params;
      if (chain && chain.length) {
        // Enchaînement : les effets choisis tournent d'une coupe à l'autre (ou au hasard).
        entry = settings().chain.order === 'random' ? chain[Math.floor(Core.hash(k, runSeed) * chain.length) % chain.length] : chain[k % chain.length];
        params = Object.assign(defaultParams(entry), entry.kind === 'captured' ? { frames: S.params.frames } : { frames: S.params.frames, intensity: S.params.intensity });
      } else if (pool && pool.length) {
        entry = pool[Math.floor(Core.hash(k, runSeed) * pool.length) % pool.length];
        params = Object.assign(defaultParams(entry), entry.kind === 'captured' ? { frames: S.params.frames } : { frames: S.params.frames, intensity: S.params.intensity });
      }
      if (vary !== 'same' && params.seed !== undefined) params = Object.assign({}, params, { seed: ((params.seed + k * 17 + runSeed) % 99) + 1 });
      const f = factors ? factors.get(key) : 1;
      if (f && f !== 1 && params.intensity != null) params = Object.assign({}, params, { intensity: Core.clamp(Math.round(params.intensity * f), 0, 200) });
      // Zoom visage : les yeux suivis dans ce plan (sinon, des yeux typiques d'une face cam).
      if (t.face && entry.def && entry.def.face) params = Object.assign({}, params, { face: t.face });
      return {
        entry, mode: targetFor(entry), label: entry.name + ' ' + t.side.toUpperCase(),
        overlay: entry.kind === 'overlay' ? { path: entry.overlay.path, name: entry.overlay.name, kind: entry.overlay.kind, pack: entry.overlay.pack, start: params.start, seed: runSeed + k } : undefined,
        target: Object.assign({}, t, { name: 'RR FX · ' + entry.name, fx: Core.toWire(compileFor(entry, params, t.side, t.frames, rate)) })
      };
    });
  }

  function applyEffect() {
    const st = settings(), chained = chainOn();
    const e = chained ? Object.assign({}, chainEntries()[0], { name: _T('Enchaînement') }) : S.cur;
    if (!e) return null;
    const multi = isMulti(st.placement);
    return runTask(_T('Application · ') + e.name, async () => {
      status.phase(_T('Analyse de la timeline'));
      // Temps forts : détectés dans la musique, sans passer par des marqueurs.
      let times;
      if (st.placement === 'beats') {
        if (!app.services.beatTimes) return { kind: 'error', title: _T('Musique indisponible'), detail: _T('Onglet Musique introuvable.') };
        status.phase(_T('Temps forts de la musique'));
        times = await app.services.beatTimes();
        if (!times.length) return { kind: 'warn', title: _T('Aucun temps fort'), detail: _T('Règle la détection dans l\'onglet Musique (sensibilité, type).') };
      }
      const r = await Host.call('resolve', { placement: hostPlacement(st.placement), scope: st.placement === 'allcuts' || st.placement === 'allclips' ? 'sequence' : '', times, sides: activeSides(), frames: S.params.frames, target: targetFor(e) });
      if (!r.ok) {
        (r.warnings || []).forEach(w => log(w, 'warn'));
        return { kind: 'error', title: _T('Rien n\'a été appliqué'), detail: r.error };
      }
      // Intensité selon le volume de la musique à chaque coupe.
      let factors = null;
      if (st.volumeFollow && e.kind !== 'captured' && app.services.volumeFactors) {
        status.phase(_T('Volume de la musique'));
        try {
          const cuts = Array.from(new Set(r.targets.map(t => (t.side === 'pre' ? t.end : t.start))));
          const tps = 254016000000, vals = await app.services.volumeFactors(cuts.map(c => c / tps), st.volumeInfluence);
          factors = new Map(cuts.map((c, i) => [c, vals[i]]));
          log(_T('Intensité selon le volume : ') + vals.map(v => '×' + v.toFixed(2)).join(' '), 'info');
        } catch (err) {
          log(_T('Volume de la musique indisponible : ') + errorMessage(err), 'warn');
        }
      }
      // « Un plan sur deux » (punch-in sur les jump cuts) : un clip visé sur deux, dans l'ordre.
      if (isFull(st.placement) && st.alternate) r.targets = r.targets.slice().sort((a, b) => a.start - b.start).filter((t, i) => i % 2 === 1);
      if (!r.targets.length) return { kind: 'warn', title: _T('Un seul plan'), detail: _T('« Un plan sur deux » : sélectionne au moins deux clips.') };
      // Zoom visage / objet : le visage (ou l'objet entouré) est cherché dans chaque plan visé,
      // puis suivi image par image.
      let faceNote = '';
      const tracked = (chained ? chainEntries() : [e]).find(x => x.def && x.def.face);
      if (tracked && app.services.trackFaces) {
        const object = tracked.def.track === 'object';
        status.phase(object ? _T('Suivi de l\'objet') : _T('Recherche du visage'));
        const follow = S.params.follow || (tracked.def.id === 'face-stab' ? 'tight' : 'smooth');
        const tr = object ? await app.services.trackObject(r.targets, follow) : await app.services.trackFaces(r.targets, follow);
        r.targets.forEach((t, i) => { t.face = tr.faces[i]; });
        const found = tr.faces.filter(Boolean).length, what = object ? _T('Objet suivi') : _T('Visage suivi');
        faceNote = found === r.targets.length ? what + _T(' dans ') + plural(found, _T('plan')) + '.' : what + _T(' dans ') + found + _T(' plan(s) sur ') + r.targets.length + _T(' ; ailleurs, zoom vers le haut du cadre.');
        if (found < r.targets.length) log((object ? _T('Objet') : _T('Visage')) + _T(' introuvable dans ') + plural(r.targets.length - found, _T('plan')) + _T(' : zoom vers le haut du cadre') + (object ? '.' : _T(' (visage de face, assez grand et éclairé ?).')), 'warn');
      }
      const plan = buildPlan(e, r.targets, multi ? st.vary : 'same', r.fps, factors);
      if (!plan.some(x => x.target.fx.length)) return { kind: 'error', title: _T('Rien à appliquer'), detail: _T('Cet effet ne contient aucun réglage utilisable.') };
      // Overlays de pack : fabriqués une fois à la taille de la séquence.
      const packs = Array.from(new Set(plan.filter(x => x.overlay && x.overlay.pack).map(x => x.overlay.pack)));
      for (const id of packs) {
        const made = await buildPack(Packs.byId[id], r.fps || fps());
        if (!made) return { kind: 'warn', title: _T('Arrêté'), detail: _T('Overlay « ') + Packs.byId[id].name + _T(' » pas fabriqué.') };
        plan.forEach(x => { if (x.overlay && x.overlay.pack === id) Object.assign(x.overlay, { path: made.path, fps: made.fps }); });
      }

      status.phase(plan.length > 1 ? _T('Pose des effets') : _T('Pose de l\'effet'));
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
      // Sons sur les transitions (whooshs, impacts fournis), calés sur chaque coupe.
      let sounds = 0;
      if (st.sfx && st.sfx !== 'none' && done && !S.cancel) {
        status.phase(_T('Sons sur les transitions'));
        const cuts = Array.from(new Set(plan.map(x => (x.target.side === 'pre' ? x.target.end : x.target.start)))).sort((a, b) => a - b);
        const strong = factors ? cuts.map((c, i) => ((factors.get(c) || 1) > 1.15 ? i : -1)).filter(i => i >= 0) : cuts.map((c, i) => (i % 4 === 3 ? i : -1)).filter(i => i >= 0);
        for (const part of Sons.plan(cuts.map(c => c / 254016000000), st.sfx, strong)) {
          try {
            const snd = Sons.byId(part.id), res = await Host.call('placeAsset', { kind: 'audio', path: ensureSound(part.id), name: snd.name, times: part.times });
            if (res.ok) { created.push.apply(created, res.created); sounds += res.created.length; warnings.push.apply(warnings, res.warnings || []); } else warnings.push(_T('Sons : ') + res.error);
          } catch (err) { warnings.push(_T('Sons : ') + errorMessage(err)); }
        }
      }
      if (created.length) pushHistory({ date: Date.now(), label: multi ? e.name + ' × ' + done : e.name, entries: created });
      Array.from(new Set(warnings)).forEach(w => log(w, 'warn'));

      const what = plural(done, 'zone') + (sounds ? ' + ' + plural(sounds, _T('son')) : '');
      if (!done) return { kind: 'error', title: _T('Rien n\'a été appliqué'), detail: firstError };
      log(e.name + ' : ' + what + (failed ? ', ' + plural(failed, _T('échec')) : ''), failed ? 'warn' : 'ok');
      if (S.cancel) return { kind: 'warn', title: _T('Arrêté · ') + what + _T(' posée(s)'), detail: _T('Le reste n\'a pas été appliqué.') };
      if (failed) return { kind: 'warn', title: e.name + ' · ' + what + ', ' + plural(failed, _T('échec')), detail: firstError };
      if (warnings.length) return { kind: 'warn', title: e.name + _T(' appliqué · ') + what, detail: (faceNote ? faceNote + ' ' : '') + plural(new Set(warnings).size, _T('remarque')) + _T(' dans le journal.') };
      if (faceNote) return { kind: faceNote.includes('introuvable') || faceNote.includes(_T(' sur ')) ? 'warn' : 'ok', title: e.name + _T(' appliqué · ') + what, detail: faceNote };
      const on = { copy: _T('Sur une copie du plan (CLIP FX) au-dessus du clip.'), overlay: _T('Overlays posés au-dessus du clip.'), adjustment: _T('Sur des calques de réglage « RR FX · … ».') };
      return { kind: 'ok', title: e.name + _T(' appliqué · ') + what, detail: on[targetFor(e)] || on.adjustment };
    }, true);
  }

  // ---------------------------------------------------------------- historique / annulation

  function pushHistory(op) {
    const list = S.lib.history;
    // Séquence de l'opération : l'annuler plus tard la rouvre si besoin.
    if (S.ctx && S.ctx.seqId && !op.seq) { op.seq = S.ctx.seqId; op.seqName = S.ctx.name; }
    list.push(op);
    while (list.length > MAX_HISTORY) list.shift();
    persist();
    renderUndo();
  }

  function renderUndo() {
    const last = S.lib && S.lib.history[S.lib.history.length - 1];
    const b = $('undo');
    setDisabled(b, S.busy || !last);
    b.textContent = last ? _T('↶ Annuler (') + last.entries.length + ')' : _T('↶ Annuler');
    b.title = last ? _T('Retirer : ') + last.label : _T('Rien à annuler');
    show(b, !S.busy);
    const hb = $('history');
    if (hb) { show(hb, !S.busy); setDisabled(hb, !S.lib || !S.lib.history.length); }
  }

  function describeOp(op) {
    const d = new Date(op.date);
    return op.label + ' (' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ')';
  }

  async function undoLast() {
    const last = S.lib.history[S.lib.history.length - 1];
    if (!last || S.busy) return;
    if (!(await confirmDialog(_T('Annuler la dernière opération ?'), describeOp(last) + _T(' : les calques et effets posés par RR FX seront retirés. Ce que tu as modifié depuis n\'est pas touché.'), _T('Annuler l\'opération'), 'confirmUndo'))) return;
    await undoOps([last]);
  }

  /* Annule des opérations de l'historique, de la plus récente à la plus ancienne. Chaque
     opération rouvre sa séquence si une autre est ouverte. */
  function undoOps(ops) {
    return runTask(ops.length > 1 ? _T('Annulation de ') + plural(ops.length, _T('opération')) : _T('Annulation'), async () => {
      const todo = ops.slice().sort((a, b) => S.lib.history.indexOf(b) - S.lib.history.indexOf(a));
      const sum = { removed: 0, effects: 0, skipped: 0 }, errors = [];
      for (let i = 0; i < todo.length; i++) {
        if (S.cancel) break;
        const op = todo[i];
        status.progress(i, todo.length, op.label);
        const r = await Host.call('undo', { entries: op.entries, seq: op.seq || '' });
        if (!r.ok) { errors.push(op.label + ' : ' + r.error); continue; }
        S.lib.history = S.lib.history.filter(x => x !== op);
        ['removed', 'effects', 'skipped'].forEach(k => { sum[k] += r[k] || 0; });
        log(_T('Annulation de ') + op.label + (r.skipped ? ' : ' + r.skipped + _T(' élément(s) modifié(s) depuis, laissé(s) tel(s) quel(s)') : ''), r.skipped ? 'warn' : 'ok');
      }
      persist();
      renderUndo();
      const parts = [];
      if (sum.removed) parts.push(plural(sum.removed, _T('calque retiré'), _T('calques retirés')));
      if (sum.effects) parts.push(plural(sum.effects, _T('effet retiré'), _T('effets retirés')));
      if (sum.skipped) parts.push(sum.skipped + _T(' laissé(s) tel quel (modifié depuis, ou à annuler avec Ctrl+Z / Cmd+Z)'));
      errors.forEach(e => log(e, 'error'));
      if (errors.length && errors.length === todo.length) return { kind: 'error', title: _T('Annulation impossible'), detail: errors[0] };
      return { kind: sum.skipped || errors.length ? 'warn' : 'ok', title: _T('Annulation terminée'), detail: parts.concat(errors.length ? [plural(errors.length, _T('opération non annulée'), _T('opérations non annulées')) + _T(' (journal)')] : []).join(' · ') || _T('Rien à retirer.') };
    });
  }

  // Historique détaillé : toutes les opérations RR FX, à annuler une par une ou jusqu'à un point.
  async function showHistory() {
    if (S.busy) return;
    const list = h('div', { class: 'hist-list' });
    let pick = null;
    const draw = () => {
      list.innerHTML = '';
      const ops = S.lib.history.slice().reverse();
      if (!ops.length) { list.appendChild(h('div', { class: 'note' }, _T('Aucune opération RR FX à annuler.'))); return; }
      ops.forEach((op, i) => {
        const one = h('button', { class: 'action quiet', title: _T('Annuler seulement cette opération') }, _T('Annuler'));
        one.addEventListener('click', () => { pick = [op]; close(); });
        const upTo = i ? h('button', { class: 'action quiet', title: _T('Annuler celle-ci et les ') + i + _T(' plus récentes') }, _T('Jusqu\'ici')) : null;
        if (upTo) upTo.addEventListener('click', () => { pick = ops.slice(0, i + 1); close(); });
        const d = new Date(op.date), time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const other = op.seq && S.ctx && S.ctx.seqId && op.seq !== S.ctx.seqId;
        list.appendChild(h('div', { class: 'list-item hist-item' },
          h('span', { class: 'li-icon' }, String(ops.length - i)),
          h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, op.label), h('div', { class: 'li-meta' }, time + ' · ' + plural(op.entries.length, _T('élément')) + (op.seqName ? ' · ' + (other ? '↪ ' : '') + op.seqName : ''))),
          h('div', { class: 'li-actions hist-actions' }, upTo, one)));
      });
    };
    let close = () => {};
    draw();
    const all = h('button', { class: 'action quiet danger', disabled: !S.lib.history.length }, _T('Tout annuler'));
    all.addEventListener('click', () => { pick = S.lib.history.slice(); close(); });
    const p = modal(_T('Historique RR FX'), h('div', null, h('div', { class: 'note' }, _T('Les ') + MAX_HISTORY + _T(' dernières opérations, la plus récente en haut. « Annuler » retire seulement celle-là ; « Jusqu\'ici » retire aussi toutes les plus récentes. Une opération d\'une autre séquence la rouvre.')), list, h('div', { class: 'row-buttons' }, all)), [{ label: _T('Fermer'), value: null }]);
    close = () => { const b = document.querySelector('#modal-root .modal footer button'); if (b) b.click(); };
    await p;
    if (!pick || !pick.length) return;
    const ask = pick.length > 1 ? _T('Annuler ') + plural(pick.length, _T('opération')) + ' ?' : _T('Annuler « ') + pick[0].label + _T(' » ?');
    if (!(await confirmDialog(ask, _T('Les calques et effets posés par RR FX seront retirés. Ce que tu as modifié depuis n\'est pas touché.'), _T('Annuler')))) return;
    await undoOps(pick);
  }

  async function clearAll(o) {
    if (S.busy) return;
    const where = o.scope === 'selection' ? _T('dans la zone sélectionnée') : _T('dans toute la séquence');
    const yes = await modal(_T('Tout effacer ') + where + ' ?', h('p', null, _T('Les calques, copies, overlays et textes « RR FX · … »') + (o.markers ? _T(' et les marqueurs RR FX') : '') + _T(' seront retirés. Tes clips restent intacts. Ctrl+Z / Cmd+Z dans Premiere pour revenir en arrière.')), [
      { label: _T('Garder'), value: false }, { label: _T('Tout effacer'), primary: true, value: true }]);
    if (!yes) return;
    await runTask(_T('Nettoyage'), async () => {
      status.phase(_T('Retrait des éléments RR FX'));
      const r = await Host.call('clearAll', { scope: o.scope, markers: o.markers, multicam: true });
      if (!r.ok) return { kind: 'error', title: _T('Nettoyage impossible'), detail: r.error };
      if (o.scope === 'sequence') { S.lib.history = []; persist(); renderUndo(); }
      const parts = [plural(r.removed, _T('élément retiré'), _T('éléments retirés'))];
      if (o.markers) parts.push(plural(r.markers, _T('marqueur retiré'), _T('marqueurs retirés')));
      log(_T('Nettoyage ') + where + ' : ' + parts.join(', '), 'ok');
      if (app.tabs.music && S.tab === 'music' && app.tabs.music.redraw) app.tabs.music.redraw();
      return { kind: 'ok', title: r.removed || r.markers ? _T('Séquence nettoyée') : _T('Rien à effacer'), detail: parts.join(' · ') };
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

    // Préréglages rangés par usage, puis tes rampes enregistrées ou importées.
    const presets = Object.keys(Core.RAMP_PRESETS).map(k => ({ key: k, label: Core.RAMP_PRESETS[k].label, data: Core.RAMP_PRESETS[k], group: Core.RAMP_PRESETS[k].placement }))
      .concat(S.lib.items.filter(i => i.type === 'ramp').map(i => ({ key: 'u:' + i.id, label: '★ ' + i.name, data: i.data, group: 'mine' })));
    const GROUPS = [['pre', _T('Avant la coupe')], ['post', _T('Après la coupe')], ['playhead', _T('Sur le temps fort')], ['full', _T('Plan entier')], ['mine', _T('Mes rampes')]];
    const chips = h('div', { class: 'ramp-groups' });
    GROUPS.forEach(([g, title]) => {
      const list = presets.filter(pr => pr.group === g);
      if (!list.length) return;
      const row_ = h('div', { class: 'chips' }, h('span', { class: 'chips-group' }, title));
      list.forEach(pr => {
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
        row_.appendChild(b);
      });
      chips.appendChild(row_);
    });
    const impRamp = h('button', { class: 'action', title: _T('Rampes reçues (.json, code de partage dans Mes effets)') }, _T('Importer des rampes…'));
    impRamp.addEventListener('click', () => importItems().then(() => renderRampView()));
    chips.appendChild(h('div', { class: 'row-buttons' }, impRamp));
    const saveBtn = h('button', { class: 'action quiet' }, _T('＋ Enregistrer'));
    saveBtn.addEventListener('click', saveRamp);
    view.appendChild(section(_T('Préréglages'), chips, saveBtn));

    const cv = h('canvas', { class: 'ramp-canvas' });
    const info = h('div', { class: 'ramp-info' });
    const refreshInfo = () => {
      const I = rampInfo();
      info.innerHTML = '';
      info.appendChild(h('span', null, _T('Vitesse '), h('b', null, Math.round(I.min) + '–' + Math.round(I.max) + ' %')));
      info.appendChild(h('span', null, _T('Média utilisé '), h('b', null, (Math.round(I.src * 10) / 10) + _T(' i')), _T(' pour ') + R.frames + _T(' i')));
    };
    view.appendChild(section(_T('Courbe de vitesse'), [cv, info, h('div', { class: 'note' }, _T('Glisse les points · double-clic pour ajouter ou supprimer · Alt+clic supprime.'))]));
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

    view.appendChild(section(_T('Réglages'), [
      row('Position', picker(RAMP_PLACEMENTS, R.placement, v => { R.placement = v; persist(); if (S.rampPlayer) S.rampPlayer.redraw(); })),
      row(_T('Durée'), hotText({ value: R.frames, min: 2, max: 600, step: 1, unit: 'i', onChange: (v, fin) => { R.frames = v; changed(fin); } })),
      row(_T('Sur le tempo'), actionGroup([0.5, 1, 2, 4].map(n => ({ v: n, label: n === 0.5 ? _T('½ temps') : n + _T(' temps') })), null, n => tempoRamp(n)), { title: _T('Durée de la rampe = un nombre de temps de la musique de la séquence') }),
      row(_T('Morceaux'), hotText({ value: R.segments, min: 2, max: 32, step: 1, unit: '', onChange: (v, fin) => { R.segments = v; changed(fin); } }), { title: _T('Plus de morceaux = rampe plus douce, mais plus de coupes dans la timeline') }),
      row(_T('Ancre'), picker([
        { v: 'auto', label: _T('Auto (coupe fixe)') },
        { v: 'end', label: _T('Garder l\'image de fin') },
        { v: 'start', label: _T('Garder l\'image de début') }
      ], R.anchor, v => { R.anchor = v; persist(); }), { title: _T('Quelle image reste à sa place. La durée dans la timeline ne change jamais.') }),
      row('Interpolation', picker([
        { v: 'keep', label: _T('Ne pas changer') },
        { v: 'blend', label: _T('Fusion d\'images') },
        { v: 'flow', label: _T('Flux optique') }
      ], R.interp, v => { R.interp = v; persist(); }))
    ]));

    const pcv = h('canvas', { class: 'pv-canvas', width: 640, height: 360 });
    const pg = pcv.getContext('2d');
    let frames = rampPreviewFrames();
    S.rampPlayer = Player({ length: () => frames.length, fps: () => fps(), draw: n => { const f = frames[n]; if (f) Pv.drawRampScene(pg, f.tau, f.speed); } });
    const redraw = S.rampPlayer.redraw;
    S.rampPlayer.redraw = () => { frames = rampPreviewFrames(); redraw(); };
    view.appendChild(section(_T('Aperçu'), h('div', { class: 'pv-frame' }, pcv, h('span', { class: 'pv-label' }, _T('Aperçu simulé')))));
    view.appendChild(h('div', { class: 'note' }, _T('La rampe est posée sur une copie du passage, juste au-dessus du clip, en morceaux de vitesse constante (Premiere ne laisse pas les scripts piloter le remappage temporel). Le clip d\'origine, son son et la coupe ne bougent pas ; ↶ Annuler retire la copie.')));
    requestAnimationFrame(() => S.rampEd && S.rampEd.draw());
  }

  // Durée de la rampe calée sur le tempo de la musique (onglet Musique).
  function tempoRamp(beats) {
    return runTask('Tempo', async () => {
      if (!app.services.tempo) return { kind: 'error', title: _T('Musique indisponible'), detail: '' };
      status.phase(_T('Tempo de la musique'));
      const bpm = await app.services.tempo();
      if (!bpm) return { kind: 'warn', title: _T('Tempo introuvable'), detail: _T('La musique n\'a pas de pulsation régulière assez nette.') };
      const R = ramp();
      R.frames = Math.max(2, Math.round(beats * 60 / bpm * fps()));
      persist();
      renderRampView();
      return { kind: 'ok', title: _T('Rampe de ') + R.frames + _T(' images'), detail: (beats === 0.5 ? _T('½ temps') : plural(beats, _T('temps'), _T('temps'))) + _T(' à ~') + String(bpm).replace('.', ',') + ' BPM.' };
    });
  }

  async function saveRamp() {
    const R = ramp();
    const name = await promptName(_T('Enregistrer la rampe'), _T('Ma rampe'));
    if (!name) return;
    const item = { id: uid(), type: 'ramp', name, created: Date.now(), data: { points: clone(R.points), frames: R.frames, segments: R.segments, placement: R.placement } };
    S.lib.items.push(item);
    R.preset = 'u:' + item.id;
    persist();
    renderRampView();
    status.finish('ok', _T('Rampe enregistrée : ') + name, _T('Elle apparaît dans les préréglages.'));
  }

  async function applyRamp() {
    const R = ramp();
    if (S.busy) return;
    if (!(await confirmDialog(_T('Appliquer la rampe ?'), _T('Une copie du passage, découpée en ') + R.segments + _T(' morceaux à vitesses différentes, va être posée juste au-dessus du clip. Le clip d\'origine, son son et la coupe ne bougent pas. Le bouton ↶ Annuler la retire.'), _T('Appliquer'), 'confirmRamp'))) return;
    await runTask('Speed ramp', async () => {
      status.phase(_T('Analyse du clip'));
      const r = await Host.call('rampResolve', { placement: R.placement, frames: R.frames });
      if (!r.ok) return { kind: 'error', title: _T('Rampe non appliquée'), detail: r.error };
      status.phase(_T('Pose de la copie et des vitesses'));
      const pieces = Core.rampPieces(R.points, r.frames, R.segments);
      const anchor = R.anchor === 'auto' ? r.anchor : R.anchor;
      const res = await Host.call('rampApply', { track: r.track, clipStart: r.clipStart, clipName: r.clipName, regionStart: r.regionStart, pieces, anchor, interp: R.interp, copyLook: settings().copyLook });
      if (res.created && res.created.length) pushHistory({ date: Date.now(), label: _T('Rampe · ') + r.clipName, entries: res.created });
      if (!res.ok) {
        (res.warnings || []).forEach(w => log(w, 'warn'));
        return { kind: 'error', title: _T('Rampe non appliquée'), detail: res.error };
      }
      (res.warnings || []).forEach(w => log(w, 'warn'));
      log(_T('Rampe sur ') + r.clipName + ' : ' + res.pieces + _T(' morceaux, ') + (Math.round(res.sourceFrames * 10) / 10) + _T(' i de média'), 'ok');
      const bad = (res.warnings || []).some(w => /vérifier/.test(w));
      const notes = (res.warnings || []).length;
      return { kind: bad ? 'warn' : 'ok', title: _T('Rampe appliquée · ') + res.pieces + _T(' morceaux'), detail: _T('Copie de ') + r.clipName + _T(' sur V') + (res.track + 1) + (bad ? _T(' · certains morceaux sont à vérifier (journal)') : notes ? ' · ' + plural(notes, _T('remarque')) + _T(' dans le journal') : '') };
    });
  }

  // ---------------------------------------------------------------- onglet Mes effets

  const captureOpts = { name: '', cat: 'mine', intrinsic: false };

  function renderMineView() {
    const view = $('view-mine');
    view.innerHTML = '';
    view.appendChild(h('div', { class: 'mine-switch' }, actionGroup([{ v: 'mine', label: _T('Ma bibliothèque') }, { v: 'community', label: _T('🌐 Communauté') }], S.mineView, v => { S.mineView = v; renderMineView(); renderCTA(); })));
    if (S.mineView === 'community') { renderCommunity(view); return; }
    const nameIn = h('input', { class: 'textfield', placeholder: _T('Nom (par défaut : nom du clip)'), value: captureOpts.name });
    nameIn.addEventListener('input', () => { captureOpts.name = nameIn.value; });
    view.appendChild(section(_T('Capturer un effet'), [
      h('div', { class: 'note' }, _T('Monte ton effet dans Premiere (sur un clip ou un calque de réglage, avec ses images clés, effets tiers compris), sélectionne-le dans la timeline puis clique sur « Capturer la sélection » en haut. Effets, valeurs et animations sont enregistrés et réutilisables comme les effets intégrés.')),
      row(_T('Nom'), nameIn),
      row(_T('Catégorie'), picker([{ v: 'mine', label: _T('Mes effets') }].concat(Lib.CATEGORIES.map(c => ({ v: c.id, label: c.label }))), captureOpts.cat, v => { captureOpts.cat = v; })),
      h('div', { class: 'field' }, checkbox(_T('Inclure Trajectoire et Opacité'), captureOpts.intrinsic, v => { captureOpts.intrinsic = v; }))
    ]));

    const imp = h('button', { class: 'action go', title: _T('Presets (.json), packs (.rrfxpack), LUTs (.cube), couleurs (.ase), modèles de texte (.mogrt)…') }, _T('Importer…'));
    imp.addEventListener('click', importItems);
    const exp = h('button', { class: 'action' }, _T('Tout exporter…'));
    exp.addEventListener('click', () => exportItems(S.lib.items, 'RRFX-bibliotheque.json'));
    const shareAll = h('button', { class: 'action' }, _T('Tout partager'));
    shareAll.addEventListener('click', () => shareItems(S.lib.items, _T('Ma bibliothèque')));
    const paste = h('button', { class: 'action' }, _T('Coller un code…'));
    paste.addEventListener('click', pasteCode);
    view.appendChild(section(_T('Ma bibliothèque'), [h('div', { id: 'mine-filter' }), h('div', { id: 'mine-list' }), h('div', { class: 'row-buttons' }, imp, exp), h('div', { class: 'row-buttons' }, paste, shareAll), h('div', { class: 'note' }, _T('« Importer… » reconnaît tout seul ce que tu lui donnes : presets et exports RR FX (.json), packs (.rrfxpack), LUTs (.cube, .3dl…), nuanciers (.ase), modèles de texte (.mogrt). « Tout partager » donne un code à envoyer en message. Bibliothèque enregistrée dans : ') + Store.location)]));
    if (app.stylePacks) view.appendChild(app.stylePacks.section());
    renderMineList();
  }

  function capture() {
    return runTask('Capture', async () => {
      status.phase(_T('Lecture des effets du clip sélectionné'));
      const r = await Host.call('capture', { includeIntrinsic: captureOpts.intrinsic });
      if (!r.ok) return { kind: 'error', title: _T('Capture impossible'), detail: r.error };
      const data = Object.assign({}, r);
      delete data.ok;
      const item = { id: uid(), type: 'captured', name: captureOpts.name.trim() || r.name, cat: captureOpts.cat, created: Date.now(), data };
      S.lib.items.push(item);
      persist();
      captureOpts.name = '';
      if (S.tab === 'mine') renderMineView();
      const n = r.components.length;
      log(_T('Capturé : ') + item.name + ' · ' + plural(n, _T('effet')) + (r.frames ? ' · ' + r.frames + _T(' images animées') : '') + (r.skipped ? ' · ' + r.skipped + _T(' paramètre(s) illisible(s) ignoré(s)') : ''), r.skipped ? 'warn' : 'ok');
      return { kind: 'ok', title: _T('Capturé : ') + item.name, detail: plural(n, _T('effet')) + (r.frames ? ' · ' + plural(r.frames, _T('image animée'), _T('images animées')) : _T(' · sans animation')) + _T(' · catégorie « ') + catLabel(item.cat) + _T(' »') };
    });
  }

  /* Types d'éléments de la bibliothèque (Mes effets). Chaque module ajoute les siens
     (animations de texte, styles de texte, couleurs, dégradés, styles Express…) : ils
     s'importent, s'exportent, se partagent par code et se publient tous de la même façon.
     icon, label ; valid(data) : contenu acceptable ; meta(item) : détail ; open(item). */
  const ITEM_TYPES = {
    preset: { icon: '≡', label: 'Preset', valid: d => !!Lib.byId[d.base], meta: it => (Lib.byId[it.data.base] || {}).name || '?' },
    captured: { icon: '◎', label: _T('Capturé'), valid: d => Array.isArray(d.components), meta: it => plural((it.data.components || []).length, _T('effet')) + ' · ' + (it.data.frames || 0) + _T(' i') },
    ramp: { icon: '⤳', label: _T('Rampe'), valid: d => Array.isArray(d.points), meta: it => it.data.frames + _T(' i') },
    look: { icon: '◐', label: 'Look', valid: d => !!d.params && typeof d.params === 'object', open: it => app.services.openLook && app.services.openLook(it) }
  };

  /* Recherche et filtre par type, dès que la bibliothèque s'allonge. Le champ reste en place
     (pas de perte du curseur) ; seules les puces et la liste sont refaites. */
  const mineFilter = { q: '', type: 'all' };
  function renderMineFilter() {
    const box = $('mine-filter');
    if (!box) return;
    const items = S.lib.items, counts = {};
    items.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
    const types = Object.keys(counts);
    if (items.length < 6 || !types.length) { box.innerHTML = ''; mineFilter.q = ''; mineFilter.type = 'all'; return; }
    if (mineFilter.type !== 'all' && !counts[mineFilter.type]) mineFilter.type = 'all';
    let input = box.querySelector('input');
    if (!input) {
      input = h('input', { class: 'textfield', placeholder: _T('Rechercher dans ') + plural(items.length, _T('élément')), value: mineFilter.q, 'aria-label': _T('Rechercher dans la bibliothèque') });
      input.addEventListener('input', () => { mineFilter.q = input.value; renderMineItems(); });
      box.appendChild(h('div', { class: 'search-row' }, input));
      box.appendChild(h('div', { class: 'chips mine-chips' }));
    }
    input.placeholder = _T('Rechercher dans ') + plural(items.length, _T('élément'));
    const chips = box.querySelector('.mine-chips');
    chips.innerHTML = '';
    [['all', _T('Tout'), items.length]].concat(types.map(t => [t, (ITEM_TYPES[t] || { label: t }).label, counts[t]])).forEach(([v, label, n]) => {
      const b = h('button', { class: 'action' + (mineFilter.type === v ? ' selected' : '') }, label + ' ', h('span', { class: 'count' }, String(n)));
      b.addEventListener('click', () => { mineFilter.type = v; renderMineList(); });
      chips.appendChild(b);
    });
  }

  function renderMineList() {
    renderMineFilter();
    renderMineItems();
  }

  function renderMineItems() {
    const list = $('mine-list');
    if (!list) return;
    list.innerHTML = '';
    if (!S.lib.items.length) {
      list.appendChild(h('div', { class: 'note' }, _T('Rien pour l\'instant : enregistre un preset (« ＋ Preset » sur un effet), une rampe, un look, un style de texte… ou capture un clip. « Importer… » ajoute ce qu\'on t\'a envoyé.')));
      return;
    }
    const q = mineFilter.q.trim().toLowerCase();
    const shown = S.lib.items.filter(i => (mineFilter.type === 'all' || i.type === mineFilter.type) && (!q || i.name.toLowerCase().includes(q)));
    if (!shown.length) { list.appendChild(h('div', { class: 'note' }, _T('Rien ne correspond.'))); return; }
    shown.sort((a, b) => b.created - a.created).forEach(item => {
      const T = ITEM_TYPES[item.type] || { icon: '•', label: item.type }, ic = T.icon;
      let meta = T.label;
      try { if (T.meta) meta += ' · ' + T.meta(item); } catch (e) { /* détail illisible : le nom suffit */ }
      const btn = (text, title, fn, cls) => { const b = h('button', { class: 'action quiet' + (cls ? ' ' + cls : ''), title }, text); b.addEventListener('click', fn); return b; };
      const li = h('div', { class: 'list-item' },
        h('span', { class: 'li-icon' }, ic),
        h('div', { class: 'li-text' }, h('div', { class: 'li-name' }, item.name), h('div', { class: 'li-meta' }, meta)),
        h('div', { class: 'li-actions' },
          btn(_T('Ouvrir'), _T('Ouvrir (ou double-clic)'), () => openItem(item), 'li-main'),
          btn('✎', _T('Renommer'), async () => { const n = await promptName(_T('Renommer'), item.name); if (n) { item.name = n; persist(); renderMineList(); } }),
          btn('⤓', _T('Exporter'), () => exportItems([item], item.name.replace(/[^\w\-]+/g, '_') + '.rrfx.json')),
          btn('⇪', _T('Partager (code à copier-coller)'), () => shareItems([item], item.name)),
          btn('🌐', _T('Publier dans la bibliothèque en ligne'), () => publishItems([item], item.name)),
          btn('✕', _T('Supprimer'), () => deleteItem(item), 'danger')));
      li.addEventListener('dblclick', () => openItem(item));
      list.appendChild(li);
    });
  }

  async function deleteItem(item) {
    const yes = await modal(_T('Supprimer « ') + item.name + _T(' » ?'), h('p', null, _T('C\'est définitif. Exporte-le d\'abord pour le garder.')), [
      { label: _T('Garder'), value: false }, { label: _T('Supprimer'), primary: true, value: true }]);
    if (!yes) return;
    S.lib.items = S.lib.items.filter(i => i !== item);
    S.lib.favorites = S.lib.favorites.filter(k => k !== 'u:' + item.id);
    // Gardé pour la synchro : supprimé ici, il l'est aussi sur tes autres ordinateurs.
    (S.lib.removed || (S.lib.removed = [])).push(item.id);
    if (S.cur && S.cur.key === 'u:' + item.id) { S.cur = entries()[0]; S.params = defaultParams(S.cur); }
    persist();
    renderMineList();
  }

  function openItem(item) {
    const T = ITEM_TYPES[item.type];
    if (T && T.open) { T.open(item); return; }
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
    if (!items.length) { status.finish('warn', _T('Rien à exporter'), _T('La bibliothèque est vide.')); return; }
    try {
      const out = Store.exportJSON({ rrfx: 1, exported: new Date().toISOString(), items }, name);
      if (out) { status.finish('ok', plural(items.length, _T('élément exporté'), _T('éléments exportés')), out); log(_T('Exporté : ') + out, 'ok'); }
    } catch (e) {
      status.finish('error', _T('Export impossible'), errorMessage(e));
    }
  }

  // Ajoute à la bibliothèque les éléments valides ; renvoie leur nombre.
  function addItems(list) {
    let n = 0;
    list.forEach(it => {
      const T = it && ITEM_TYPES[it.type];
      if (!T || !it.data || typeof it.data !== 'object' || typeof it.name !== 'string') return;
      try { if (T.valid && !T.valid(it.data)) return; } catch (e) { return; }
      S.lib.items.push(Object.assign({}, it, { id: uid(), created: Date.now() }));
      n++;
    });
    persist();
    renderMineList();
    return n;
  }

  /* Fichiers choisis par l'utilisateur → [{ name, ext, path, bytes }] (boîte de dialogue de
     Premiere, ou du navigateur en mode démo). */
  function pickFiles(title, exts) {
    const paths = Store.pickFiles(title, exts);
    if (paths !== null) return Promise.resolve(paths.map(p => ({ name: Store.path.basename(p), ext: Store.path.extname(p).slice(1).toLowerCase(), path: p, bytes: new Uint8Array(Store.fs.readFileSync(p)) })));
    return new Promise(resolve => {
      const input = h('input', { type: 'file', class: 'hidden', multiple: true, accept: exts.map(e => '.' + e).join(',') });
      input.addEventListener('change', () => Promise.all(Array.from(input.files).map(f => f.arrayBuffer().then(b => ({ name: f.name, ext: (/\.([^.]+)$/.exec(f.name) || [0, ''])[1].toLowerCase(), path: null, bytes: new Uint8Array(b) })))).then(resolve, () => resolve([])));
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    });
  }

  /* Importeurs par type de fichier : chaque module ajoute les siens ({ exts, label, run(files) }
     → { n, what }, ou { handled } quand l'importeur a déjà affiché son propre résultat). « Importer… » de Mes effets reconnaît tout seul ce qu'on lui donne. */
  const importers = [{
    exts: ['json'], label: _T('presets RR FX (.json)'),
    run: files => {
      const items = [].concat(...files.map(f => { const j = JSON.parse(new TextDecoder().decode(f.bytes)); return Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [j]; }));
      return { n: addItems(items), what: _T('dans Mes effets') };
    }
  }];

  async function importItems() {
    const exts = Array.from(new Set([].concat(...importers.map(i => i.exts))));
    const files = await pickFiles(_T('Importer des presets, packs, LUTs, couleurs ou modèles'), exts);
    if (!files.length) return;
    const done = [], bad = [];
    let handled = false;
    for (const imp of importers) {
      const mine = files.filter(f => imp.exts.indexOf(f.ext) >= 0);
      if (!mine.length) continue;
      try {
        const r = await imp.run(mine);
        if (r && r.n) done.push(plural(r.n, _T('élément')) + ' ' + (r.what || ''));
        if (r && r.handled) handled = true;
      } catch (e) { bad.push(mine.map(f => f.name).join(', ') + ' : ' + errorMessage(e)); }
    }
    files.filter(f => !importers.some(i => i.exts.indexOf(f.ext) >= 0)).forEach(f => bad.push(f.name + _T(' : type non reconnu')));
    bad.forEach(b => log(b, 'warn'));
    renderMineList();
    if (done.length) status.finish(bad.length ? 'warn' : 'ok', _T('Importé'), done.join(' · ') + (bad.length ? ' · ' + plural(bad.length, _T('fichier')) + _T(' ignoré(s) (journal)') : ''));
    else if (!handled) status.finish('warn', _T('Rien d\'importé'), bad[0] || _T('Aucun élément valide dans ces fichiers.'));
  }

  function copyText(text, field) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => copyText(text, null));
    if (field) { field.focus(); field.select(); }
    let done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    return Promise.resolve(done);
  }

  function shareItems(items, label) {
    if (!items.length) { status.finish('warn', _T('Rien à partager'), _T('La bibliothèque est vide.')); return; }
    const code = Share.encode(items, Store.zip);
    const field = h('textarea', { class: 'code share-code', readonly: true, rows: 4, spellcheck: 'false' }, code);
    const msg = h('div', { class: 'note' }, plural(items.length, _T('élément'), _T('éléments')) + ' · ' + code.length + _T(' caractères. Envoie ce code : il se colle dans RR FX > Mes effets > « Coller un code… ».'));
    const copy = h('button', { class: 'action' }, _T('Copier'));
    copy.addEventListener('click', () => copyText(code, field).then(ok => { copy.textContent = ok ? _T('Copié ✓') : _T('Sélectionne et copie (Ctrl/Cmd+C)'); field.select(); }));
    modal(_T('Partager · ') + label, h('div', null, field, msg, h('div', { class: 'row-buttons' }, copy)), [{ label: _T('Fermer'), primary: true, value: true }]);
    setTimeout(() => { field.focus(); field.select(); }, 0);
    log(_T('Code de partage créé : ') + label + ' (' + plural(items.length, _T('élément'), _T('éléments')) + ')', 'info');
  }

  async function pasteCode() {
    const field = h('textarea', { class: 'code share-code', rows: 4, spellcheck: 'false', placeholder: 'RRFX1:…' });
    setTimeout(() => field.focus(), 0);
    const code = await modal(_T('Coller un code RR FX'), h('div', null, field, h('div', { class: 'note' }, _T('Colle ici un code reçu (il commence par « RRFX1: »).'))), [
      { label: _T('Annuler'), value: null }, { label: _T('Ajouter'), primary: true, value: () => field.value }]);
    if (!code) return;
    let items;
    try { items = Share.decode(code, Store.zip); } catch (e) { status.finish('error', _T('Code invalide'), errorMessage(e)); return; }
    const n = addItems(items);
    if (n) status.finish('ok', plural(n, _T('élément ajouté'), _T('éléments ajoutés')), items.map(i => i.name).slice(0, 4).join(', ') + (items.length > 4 ? '…' : ''));
    else status.finish('warn', _T('Rien d\'ajouté'), _T('Ce code ne contient pas d\'effet compatible avec cette version.'));
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
      if (force) commThumbs.clear();
      C.list = r.list;
      C.error = r.error || '';
      C.at = Date.now();
      if (r.error) log(_T('Bibliothèque en ligne : ') + r.error, 'warn');
    } finally {
      C.loading = false;
      renderCommunityList();
    }
  }

  function renderCommunity(view) {
    const C = S.comm;
    const search = h('input', { class: 'textfield', placeholder: _T('Rechercher (nom, auteur, style…)'), value: C.search, spellcheck: 'false' });
    search.addEventListener('input', () => { C.search = search.value; renderCommunityList(); });
    const refresh = h('button', { class: 'action quiet', title: _T('Relire la bibliothèque sur GitHub') }, '↻');
    refresh.addEventListener('click', () => loadCommunity(true));
    view.appendChild(section(_T('Bibliothèque en ligne'), [
      h('div', { class: 'note' }, _T('Les effets publiés par les utilisateurs de RR FX. « Ajouter » les range dans ta bibliothèque, comme les tiens. Pour aimer un effet : ❤ ouvre sa page, ajoute la réaction 👍.')),
      h('div', { class: 'search' }, search, refresh),
      row(_T('Trier'), actionGroup([{ v: 'popular', label: _T('Les plus aimés') }, { v: 'recent', label: _T('Les plus récents') }], C.sort, v => { C.sort = v; renderCommunityList(); })),
      row('Type', picker([{ v: 'all', label: _T('Tout') }, { v: 'preset', label: 'Presets' }, { v: 'captured', label: _T('Effets capturés') }, { v: 'ramp', label: _T('Rampes') }, { v: 'look', label: _T('Looks (couleur)') }, { v: 'textStyle', label: _T('Styles de texte') }, { v: 'titleAnim', label: _T('Animations de texte') }, { v: 'gradient', label: _T('Dégradés') }, { v: 'palette', label: 'Palettes' }, { v: 'xpStyle', label: _T('Styles Express') }, { v: 'projectTemplate', label: _T('Modèles de projet') }], C.type, v => { C.type = v; renderCommunityList(); })),
      h('div', { id: 'comm-list' })
    ]));
    view.appendChild(section(_T('Publier'), [
      h('div', { class: 'note' }, _T('Le bouton du haut (ou 🌐 sur un effet de ta bibliothèque) ouvre le formulaire de publication dans ton navigateur, déjà rempli : il reste à cliquer sur « Submit new issue » (compte GitHub gratuit). Ton effet apparaît ensuite ici pour tout le monde.'))
    ]));
    if (!C.list || Date.now() - C.at > Community.CACHE_MS) loadCommunity(false);
    else renderCommunityList();
  }

  // Petite vignette d'un preset ou d'un effet capturé partagé (dessinée une fois par effet publié).
  const commThumbs = new Map();
  function communityThumb(e) {
    if (!commThumbs.has(e.number)) commThumbs.set(e.number, drawCommunityThumb(e.items[0]));
    return h('div', { class: 'comm-thumb' }, commThumbs.get(e.number));
  }
  function drawCommunityThumb(it) {
    const cv = h('canvas', { width: 160, height: 90 });
    let entry = null;
    if (it.type === 'preset' && Lib.byId[it.data.base]) entry = { kind: 'preset', name: it.name, def: Lib.byId[it.data.base], item: it };
    if (it.type === 'captured') entry = { kind: 'captured', name: it.name, def: null, item: it };
    if (it.type === 'look' && window.RRFXDevelop) {
      // Un look : le plan de test passé dans sa LUT.
      const g = cv.getContext('2d');
      g.drawImage(Pv.shots().A, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90);
      window.RRFXAssets.applyLut(d.data, window.RRFXDevelop.buildLut(it.data.params, 9));
      g.putImageData(d, 0, 0);
      return cv;
    }
    if (entry) drawThumb(cv, entry);
    else {
      const g = cv.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, 160, 90);
      g.fillStyle = '#9ab'; g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText('⤳', 80, 56);
    }
    return cv;
  }

  function renderCommunityList() {
    const box = $('comm-list'), C = S.comm;
    if (!box) return;
    box.innerHTML = '';
    if (C.loading && !C.list) { box.appendChild(h('div', { class: 'note' }, _T('Chargement de la bibliothèque…'))); return; }
    if (C.error) box.appendChild(h('div', { class: 'note warn' }, '⚠ ' + C.error));
    const list = Community.filter(C.list || [], C);
    if (!list.length) {
      box.appendChild(h('div', { class: 'note' }, (C.list && C.list.length) ? _T('Aucun effet ne correspond.') : _T('Personne n\'a encore publié d\'effet : sois le premier !')));
      return;
    }
    list.slice(0, 120).forEach(e => {
      const mine = fromCommunity(e), date = new Date(e.created);
      const add = h('button', { class: 'action' }, mine.length ? _T('Ouvrir') : _T('Ajouter'));
      add.addEventListener('click', () => {
        if (mine.length) return openItem(mine[0]);
        const n = addItems(e.items.map(it => Object.assign({}, it, { from: { number: e.number, author: e.author } })));
        if (n) status.finish('ok', _T('Ajouté : ') + e.name, _T('Par @') + e.author + (n > 1 ? ' · ' + plural(n, _T('effet')) : '') + _T(' · dans « Mes effets ».'));
        else status.finish('warn', _T('Rien d\'ajouté'), _T('Cet effet n\'est pas compatible avec ta version de RR FX.'));
        renderCommunityList();
      });
      const like = h('button', { class: 'action quiet', title: _T('Ouvrir sa page pour l\'aimer (réaction 👍) ou commenter') }, '❤ ' + e.likes);
      like.addEventListener('click', () => Host.openURL(e.url));
      const types = e.types.map(t => Community.TYPES[t] || t).join(', ') + (e.items.length > 1 ? ' × ' + e.items.length : '');
      box.appendChild(h('div', { class: 'comm-item' },
        communityThumb(e),
        h('div', { class: 'li-text' },
          h('div', { class: 'li-name' }, e.name),
          h('div', { class: 'li-meta' }, types + ' · @' + e.author + ' · ' + date.toLocaleDateString('fr-FR')),
          e.desc ? h('div', { class: 'comm-desc' }, e.desc) : null,
          h('div', { class: 'row-buttons' }, add, like))));
    });
  }

  // Ouvre le formulaire de publication pré-rempli (le code va dans l'adresse s'il n'est pas trop long).
  async function publishItems(items, defaultName) {
    if (!items.length) { status.finish('warn', _T('Rien à publier'), _T('Ta bibliothèque est vide : enregistre un preset ou capture un effet.')); return; }
    const name = h('input', { class: 'textfield', value: defaultName || items[0].name });
    const desc = h('textarea', { class: 'code lyrics', rows: 4, placeholder: _T('Pour quel genre de montage, sur quelle musique…') });
    const ok = await modal(_T('Publier dans la bibliothèque en ligne'), h('div', null,
      row(_T('Nom'), name), desc,
      h('div', { class: 'note' }, (items.length > 1 ? plural(items.length, _T('effet')) + _T(', publiés ensemble. ') : '') + _T('Le formulaire s\'ouvre dans ton navigateur : vérifie, puis « Submit new issue ». Publié sous ton nom GitHub, visible par tous.'))), [
      { label: _T('Annuler'), value: false }, { label: _T('Ouvrir le formulaire'), primary: true, value: true }]);
    if (!ok || !name.value.trim()) return;
    const code = Share.encode(items, Store.zip);
    const p = Community.publishURL({ name: name.value.trim(), desc: desc.value.trim(), code });
    if (!p.withCode) await copyText(code, null);
    Host.openURL(p.url);
    log(_T('Publication ouverte dans le navigateur : ') + name.value.trim(), 'info');
    status.finish('ok', _T('Formulaire ouvert dans ton navigateur'), p.withCode
      ? _T('Clique sur « Submit new issue » : ton effet apparaîtra dans la bibliothèque en ligne.')
      : _T('Le code était trop long pour l\'adresse : il est copié, colle-le dans « Code RR FX », puis « Submit new issue ».'));
  }

  async function publishPicker() {
    if (!S.lib.items.length) { status.finish('warn', _T('Rien à publier'), _T('Enregistre un preset (＋ Preset), une rampe, ou capture un effet d\'abord.')); return; }
    const opts = S.lib.items.slice().sort((a, b) => b.created - a.created).map(i => ({ v: i.id, label: i.name }));
    let pick = opts[0].v;
    const ok = await modal(_T('Quel effet publier ?'), picker(opts, pick, v => { pick = v; }), [
      { label: _T('Annuler'), value: false }, { label: _T('Continuer'), primary: true, value: true }]);
    if (!ok) return;
    const item = S.lib.items.find(i => i.id === pick);
    if (item) publishItems([item], item.name);
  }

  // ---------------------------------------------------------------- onglet Réglages

  function renderSettingsView() {
    const view = $('view-settings');
    view.innerHTML = '';
    const st = settings();

    // Langue, en texte bilingue pour qu'on la trouve quelle que soit la langue. Le panneau se recharge.
    const I = window.RRFXI18n;
    if (I) {
      const langSec = section('Langue · Language', [
        actionGroup([{ v: 'fr', label: '🇫🇷 Français' }, { v: 'en', label: '🇬🇧 English' }], I.lang, v => { if (v === I.lang) return; I.setLang(v); location.reload(); }),
        h('div', { class: 'note' }, _T('Le panneau se recharge dans la langue choisie. Tes réglages et ta bibliothèque sont gardés.'))
      ]);
      langSec.dataset.sec = 'lang';
      view.appendChild(langSec);
    }

    const find = h('button', { class: 'action' }, _T('Rechercher'));
    find.addEventListener('click', async () => {
      const r = await Host.call('adjustmentInfo', { nodeId: st.adjNodeId });
      if (!r.ok) return status.finish('error', _T('Recherche impossible'), r.error);
      if (!r.found) return status.finish('warn', _T('Aucun calque de réglage'), _T('Crée-en un : Fichier > Nouveau > Calque de réglage.'));
      st.adjNodeId = r.nodeId; st.adjName = r.name; persist();
      renderSettingsView();
      status.finish('ok', _T('Calque de réglage trouvé'), r.name);
    });
    const fromSel = h('button', { class: 'action' }, _T('Utiliser la sélection du Projet'));
    fromSel.addEventListener('click', async () => {
      const r = await Host.call('adjustmentFromSelection', {});
      if (!r.ok) return status.finish('error', _T('Aucun élément sélectionné'), r.error);
      st.adjNodeId = r.nodeId; st.adjName = r.name; persist();
      renderSettingsView();
      status.finish('ok', _T('Calque de réglage défini'), r.name);
    });
    view.appendChild(section(_T('Calques'), [
      h('div', { class: 'note' }, _T('RR FX pose les effets sur des calques de réglage « RR FX · … » au-dessus du clip, qui n\'est jamais modifié. Exceptions « CLIP FX » : la speed ramp et le Motion blur (Écho) ont besoin des images du plan, qu\'un calque de réglage ne peut ni ralentir ni mélanger. Ils se posent donc sur une copie du passage, issue d\'un sous-clip vidéo seule (chutier « RR FX ») : tes pistes audio ne sont jamais touchées.')),
      h('div', { class: 'field' }, checkbox(_T('Recopier le cadrage et l\'étalonnage du clip sur les copies CLIP FX'), st.copyLook, v => { st.copyLook = v; persist(); })),
      h('div', { class: 'note' }, _T('Les courbes et LUT de Lumetri ne se recopient pas : étalonne plutôt sur un calque de réglage.')),
      h('div', { class: 'note' }, _T('Calque de réglage utilisé : ') + (st.adjName || _T('recherche automatique dans le projet')) + _T('. Il en faut un dans le projet : Fichier > Nouveau > Calque de réglage.')),
      h('div', { class: 'row-buttons' }, find, fromSel)
    ]));

    // Nettoyage
    const clean = { scope: 'sequence', markers: true };
    const wipe = h('button', { class: 'action danger' }, _T('Tout effacer'));
    wipe.addEventListener('click', () => clearAll(clean));
    view.appendChild(section(_T('Nettoyage'), [
      h('div', { class: 'note' }, _T('Retire tout ce que RR FX a posé : calques de réglage, copies CLIP FX, overlays, textes et sons « RR FX · … », et réactive les caméras éteintes par le montage multicam. Tes clips ne sont pas supprimés.')),
      row(_T('Zone'), actionGroup([{ v: 'sequence', label: _T('Toute la séquence') }, { v: 'selection', label: _T('Zone sélectionnée') }], clean.scope, v => { clean.scope = v; })),
      h('div', { class: 'field' }, checkbox(_T('Retirer aussi les marqueurs RR FX (temps forts)'), clean.markers, v => { clean.markers = v; })),
      h('div', { class: 'row-buttons' }, wipe)
    ]));

    // Effets Premiere détectés
    const fx = h('div');
    const reg = registry();
    Object.keys(Core.REGISTRY).filter(t => !Core.REGISTRY[t].intrinsic).forEach(type => {
      const found = S.resolved ? S.resolved[type] : undefined;
      fx.appendChild(h('div', { class: 'fx-status' },
        h('span', { class: found ? 'ok' : (S.resolved ? 'missing' : 'muted') }, found ? '✓' : (S.resolved ? '✕' : '…')),
        h('span', null, found || (S.resolved ? reg[type].names[0] + _T(' introuvable') : reg[type].names[0]))));
    });
    const detect = h('button', { class: 'action quiet' }, _T('Détecter à nouveau'));
    detect.addEventListener('click', async () => { await detectEffects(true); renderSettingsView(); });
    view.appendChild(section(_T('Effets Premiere utilisés'), [fx, h('div', { class: 'note' }, _T('Noms détectés dans la langue de ton Premiere. Un effet introuvable ? Voir « Avancé » plus bas.'))], detect));

    // Raccourcis : toutes les actions, une touche (ou Maj+touche) chacune.
    const sc = h('div');
    Object.keys(Keys.ACTIONS).filter(a => actionFn(a)).forEach(action => {
      const b = h('button', { class: 'action', 'data-shortcut': action });
      b.addEventListener('click', () => { S.capturing = S.capturing === action ? null : action; renderShortcuts(); });
      sc.appendChild(h('div', { class: 'shortcut-row' }, h('span', null, Keys.ACTIONS[action]), b));
    });
    view.appendChild(section(_T('Raccourcis clavier'), [h('div', { class: 'note' }, _T('Actifs quand le panneau RR FX est sélectionné (clique dedans, puis appuie sur la touche). Une lettre ou un chiffre, seul ou avec Maj. Clique sur une touche pour la changer, Retour arrière pour la retirer. Échap arrête une opération en cours.')), sc], null, true));
    renderShortcuts();
    // Sections des autres modules (télécommande, synchro…).
    (app.settingsExtras || []).forEach(fn => { const el = fn(); if (el) view.appendChild(el); });

    // Signal de fin
    const test = h('button', { class: 'action quiet' }, _T('Tester le signal'));
    test.addEventListener('click', () => { status.finish('ok', _T('Test du signal de fin'), _T('Le bilan clignote et le son est joué (si activé).')); signalEnd(); });
    view.appendChild(section(_T('Signal de fin'), [
      checkbox(_T('Jouer un son à la fin'), st.endSound, v => { st.endSound = v; persist(); }),
      h('div', { class: 'note' }, _T('Pour les opérations de plus de 8 s (beaucoup de coupes, rampes) : le bilan clignote.')),
      h('div', { class: 'row-buttons' }, test)
    ]));

    // Confirmations
    view.appendChild(section('Confirmations', [
      h('div', null, checkbox(_T('Demander avant d\'appliquer une rampe'), st.confirmRamp, v => { st.confirmRamp = v; persist(); })),
      h('div', null, checkbox(_T('Demander avant d\'annuler'), st.confirmUndo, v => { st.confirmUndo = v; persist(); }))
    ]));

    // Mises à jour
    const check = h('button', { class: 'action' }, _T('Vérifier maintenant'));
    check.addEventListener('click', () => checkUpdates(true));
    if (app.diagnostic) view.appendChild(app.diagnostic.section());
    view.appendChild(section(_T('Mises à jour'), [
      h('div', { class: 'note' }, _T('Version installée : ') + Host.VERSION + (S.ctx && S.ctx.app ? ' · Premiere ' + S.ctx.app : '')),
      checkbox(_T('Vérifier les mises à jour au démarrage'), st.checkUpdates, v => { st.checkUpdates = v; persist(); }),
      h('div', { class: 'row-buttons' }, check)
    ]));

    // Avancé
    const ta = h('textarea', { class: 'code', spellcheck: 'false', rows: 6 }, JSON.stringify(st.registry || {}, null, 2));
    const saveReg = h('button', { class: 'action' }, _T('Enregistrer'));
    saveReg.addEventListener('click', () => {
      try {
        const v = JSON.parse(ta.value || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(_T('il faut un objet { … }'));
        st.registry = v; persist();
        status.finish('ok', _T('Correspondance enregistrée'), '');
        renderGrid();
      } catch (e) { status.finish('error', _T('JSON invalide'), errorMessage(e)); }
    });
    const out = h('pre', { class: 'code hidden' });
    const showOut = text => { out.textContent = text; out.classList.remove('hidden'); };
    const diag = h('button', { class: 'action' }, _T('Analyser le clip sélectionné'));
    diag.addEventListener('click', async () => { const r = await Host.call('diagnose', {}); showOut(r.ok ? r.text : r.error); });
    const listFx = h('button', { class: 'action' }, _T('Lister les effets vidéo'));
    listFx.addEventListener('click', async () => { const r = await Host.call('listEffects', {}); showOut(r.ok ? (r.names.join('\n') || '(aucun)') : r.error); });
    const defaults = h('button', { class: 'action quiet' }, _T('Valeurs par défaut'));
    defaults.addEventListener('click', () => showOut(JSON.stringify(Core.REGISTRY, null, 2)));
    view.appendChild(section(_T('Avancé'), [
      h('div', { class: 'note' }, _T('Correspondance des effets : nom exact d\'un effet ou numéro d\'un paramètre, si la détection automatique se trompe. Exemple : '), h('code', null, '{"wave": {"names": ["Déformation de la vague"]}}')),
      ta, h('div', { class: 'row-buttons' }, saveReg, defaults),
      h('div', { class: 'row-buttons' }, diag, listFx), out
    ]));

    // Bibliothèque
    const openDir = h('button', { class: 'action', disabled: !Store.onDisk }, _T('Ouvrir le dossier'));
    openDir.addEventListener('click', () => Store.openFolder());
    view.appendChild(section(_T('Bibliothèque'), [h('div', { class: 'note' }, Store.location), h('div', { class: 'row-buttons' }, openDir)]));

    // Journal
    const clear = h('button', { class: 'action quiet' }, _T('Effacer'));
    const box = h('div', { class: 'log', id: 'log' }, S.logLines.map(l => h('div', { class: l.level }, l.message)));
    clear.addEventListener('click', () => { S.logLines = []; box.innerHTML = ''; });
    view.appendChild(section(_T('Journal'), box, clear));
  }

  // ---------------------------------------------------------------- raccourcis clavier

  const SHORTCUT_ACTIONS = {
    apply: () => applyEffect(),
    ramp: () => applyRamp(),
    undo: () => undoLast(),
    history: () => showHistory(),
    palette: () => app.services.palette && app.services.palette(),
    capture: () => capture()
  };
  // Une action des raccourcis ou de la télécommande : celles du panneau, sinon celles des onglets.
  const actionFn = id => SHORTCUT_ACTIONS[id] || (app.actions[id] ? () => app.actions[id]() : null);
  function runAction(id) {
    const fn = actionFn(id);
    if (!fn) return false;
    fn();
    return true;
  }

  function renderShortcuts() {
    document.querySelectorAll('[data-shortcut]').forEach(b => {
      const a = b.getAttribute('data-shortcut');
      b.textContent = S.capturing === a ? _T('Appuie sur une touche…') : Keys.label(S.shortcuts[a], _T('Maj')) || _T('Aucune');
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
    if (action && actionFn(action)) { event.preventDefault(); runAction(action); }
  }

  function requestCancel() {
    if (!S.busy) return;
    S.cancel = true;
    // Tâche qui tourne hors de Premiere (téléchargement…) : arrêtée aussi.
    if (S.onCancel) { try { S.onCancel(); } catch (e) { /* déjà finie */ } }
    $('status-detail').textContent = _T('Arrêt après la zone en cours…');
  }

  // ---------------------------------------------------------------- mode réduit, menu, CTA

  function applyCompact(compact) {
    $('panel').classList.toggle('compact', compact);
    $('toggle-compact').textContent = compact ? _T('▾ Réglages') : _T('▴ Réduire');
  }
  function toggleCompact() {
    settings().compact = !settings().compact;
    persist();
    applyCompact(settings().compact);
    setMenu();
  }

  function setMenu() {
    Host.setMenu([
      { id: 'express', label: _T('Lancer le montage express') },
      { id: 'palette', label: _T('Recherche rapide (Ctrl+K)') },
      { separator: true },
      { id: 'apply', label: _T('Appliquer l\'effet choisi') },
      { id: 'ramp', label: _T('Appliquer la rampe') },
      { id: 'capture', label: _T('Capturer la sélection') },
      { id: 'beats', label: _T('Poser les marqueurs des temps forts') },
      { id: 'sync', label: _T('Synchroniser la sélection sur la musique') },
      { id: 'convert', label: _T('Convertir le LOG en Rec.709 (caméra enregistrée)') },
      { id: 'autoFix', label: _T('Expo et balance des blancs auto') },
      { id: 'silences', label: _T('Couper les silences (plans sélectionnés)') },
      { id: 'undo', label: _T('Annuler la dernière opération RR FX') },
      { id: 'history', label: _T('Historique des opérations…') },
      { id: 'clear', label: _T('Tout effacer (séquence)…') },
      { separator: true },
      { id: 'compact', label: _T('Mode réduit'), checked: settings().compact },
      { id: 'instagram', label: _T('@robin.rahoual sur Instagram') }
    ], id => {
      if (id === 'compact') return toggleCompact();
      if (id === 'instagram') return Host.openURL(INSTAGRAM_URL);
      if (id === 'clear') return clearAll({ scope: 'sequence', markers: true });
      if (id === 'autoFix') return app.actions.autoFix && app.actions.autoFix();
      if (id === 'silences') return app.actions.cutSilences && app.actions.cutSilences();
      if (id === 'palette') return app.services.palette && app.services.palette();
      if (id === 'history') return showHistory();
      runAction(id);
    });
  }

  function ctaAction() {
    if (app.tabs[S.tab]) return app.tabs[S.tab].cta();
    if (S.tab === 'ramp') return { label: _T('Appliquer la rampe'), run: applyRamp, enabled: true };
    if (S.tab === 'mine' && S.mineView === 'community') return { label: _T('Publier un de mes effets…'), run: publishPicker, enabled: true };
    if (S.tab === 'mine') return { label: _T('Capturer la sélection'), run: capture, enabled: true };
    if (S.tab === 'effects' && chainOn()) return { label: _T('Appliquer l\'enchaînement · ') + plural(chainEntries().length, _T('effet')), run: applyEffect, enabled: true };
    return { label: S.cur ? _T('Appliquer · ') + S.cur.name : _T('Appliquer'), run: applyEffect, enabled: !!S.cur };
  }
  function renderCTA() {
    const a = ctaAction(), b = $('cta');
    b.textContent = a.label;
    setDisabled(b, S.busy || !a.enabled);
  }

  // Fondu sur les bords de la barre d'onglets quand elle déborde.
  function updateTabFade() {
    const t = $('tabs');
    if (!t) return;
    t.classList.toggle('more-left', t.scrollLeft > 2);
    t.classList.toggle('more-right', t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
  }

  // Position de défilement de chaque onglet : on retrouve sa place en revenant.
  const tabScroll = {};
  function switchTab(tab) {
    if (S.tab !== tab && app.tabs[S.tab] && app.tabs[S.tab].leave) app.tabs[S.tab].leave();
    if (S.tab !== tab) tabScroll[S.tab] = $('scroll').scrollTop;
    S.tab = tab;
    settings().tab = tab;
    persist();
    stopThumb();
    pauseOverlayVideos(null);
    if (S.player) { S.player.stop(); S.player = null; }
    if (S.rampPlayer) { S.rampPlayer.stop(); S.rampPlayer = null; }
    S.curveEd = null;
    S.rampEd = null;
    S.capturing = null;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    const on = document.querySelector('.tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateTabFade();
    document.querySelectorAll('.view').forEach(v => { v.classList.toggle('on', v.id === 'view-' + tab); if (v.id !== 'view-' + tab) v.innerHTML = ''; });
    if (tab === 'effects') renderEffectsView();
    if (tab === 'ramp') renderRampView();
    if (tab === 'mine') renderMineView();
    if (tab === 'settings') renderSettingsView();
    if (app.tabs[tab]) app.tabs[tab].render($('view-' + tab));
    renderCTA();
    $('scroll').scrollTop = 0;
    if (tabScroll[tab]) requestAnimationFrame(() => { $('scroll').scrollTop = tabScroll[tab]; });
  }

  // ---------------------------------------------------------------- mises à jour

  function showUpdate(update) {
    S.update = update;
    if (!update) { show($('update-banner'), false); return; }
    const auto = canSelfUpdate();
    $('update-text').textContent = '⬆ RR FX ' + update.version + _T(' est disponible (tu as la ') + Host.VERSION + ').' + (auto ? _T(' Installe-la en un clic, puis redémarre Premiere.') : _T(' Télécharge le pack, puis lance le script d\'installation.'));
    $('update-download').textContent = auto ? _T('Installer la mise à jour') : _T('Télécharger');
    show($('update-banner'), true);
  }

  // Mise à jour en un clic : pack téléchargé, vérifié, version en place sauvegardée.
  const canSelfUpdate = () => !!(Store.nodeRequire && Store.fs && window.RRFXInstaller && Installer.extensionDir(location.href));
  const Installer = window.RRFXInstaller;
  function installUpdate() {
    const up = S.update;
    if (!up) return;
    if (!canSelfUpdate()) return Host.openURL(up.downloadUrl);
    return runTask(_T('Mise à jour ') + up.version, async () => {
      status.phase(_T('Téléchargement'));
      const bytes = await Installer.download(Store.nodeRequire('https'), up.downloadUrl, p => status.progress(Math.round(p * 100), 100, _T('Téléchargement')));
      status.phase(_T('Vérification du pack'));
      const files = Installer.filesOf(bytes, Store.zip && Store.zip.inflate, up.version);
      status.phase(_T('Installation'));
      const dir = Installer.extensionDir(location.href), backup = Store.path.join(Store.dir, 'Sauvegarde du panneau');
      const n = Installer.install(Store.fs, Store.path, dir, files, backup);
      log(_T('Mise à jour ') + up.version + _T(' installée (') + n + _T(' fichiers) dans ') + dir + _T('. Ancienne version gardée dans ') + backup, 'ok');
      show($('update-banner'), false);
      return { kind: 'ok', title: 'RR FX ' + up.version + _T(' installé'), detail: _T('Redémarre Premiere pour l\'utiliser. Ta bibliothèque et tes réglages sont gardés.') };
    });
  }

  async function checkUpdates(force) {
    const update = await Updates.checkForUpdate({ fetch: (u, o) => fetch(u, o), storage, currentVersion: Host.VERSION, force });
    showUpdate(update);
    if (force) {
      if (update) log(_T('Nouvelle version disponible : ') + update.version, 'ok');
      else log('RR FX ' + Host.VERSION + _T(' est à jour (ou GitHub est injoignable).'), 'info');
      status.finish(update ? 'ok' : 'idle', update ? _T('Mise à jour disponible') : _T('Prêt'), update ? 'RR FX ' + update.version : '');
    }
  }

  // ---------------------------------------------------------------- démarrage

  async function detectEffects(force) {
    const r = await Host.call('listEffects', {});
    if (!r.ok || !Array.isArray(r.names) || !r.names.length) {
      if (force) log(_T('Liste des effets Premiere indisponible') + (r.error ? ' : ' + r.error : ''), 'warn');
      return;
    }
    S.resolved = Core.resolveEffectNames(r.names, Core.mergeRegistry(settings().registry));
    const missing = Object.keys(S.resolved).filter(t => !S.resolved[t]);
    if (missing.length) log(_T('Effets Premiere introuvables : ') + missing.map(t => Core.REGISTRY[t].names[0]).join(', ') + _T(' (Réglages > Avancé)'), 'warn');
    else if (force) log(_T('Tous les effets Premiere utilisés sont trouvés.'), 'ok');
  }

  function bindHeader() {
    $('instagram').addEventListener('click', () => Host.openURL(INSTAGRAM_URL));
    app.services.openInstagram = () => Host.openURL(INSTAGRAM_URL);
    $('toggle-compact').addEventListener('click', toggleCompact);
    $('cta').addEventListener('click', () => { const a = ctaAction(); if (a.enabled && !S.busy) a.run(); });
    $('undo').addEventListener('click', undoLast);
    $('history').addEventListener('click', showHistory);
    $('cancel').addEventListener('click', requestCancel);
    $('status-close').addEventListener('click', () => status.reset());
    $('status-log').addEventListener('click', () => {
      switchTab('settings');
      const box = $('log');
      if (box) box.scrollIntoView();
    });
    $('update-download').addEventListener('click', () => S.update && installUpdate());
    $('update-page').addEventListener('click', () => S.update && Host.openURL(S.update.pageUrl));
    $('update-later').addEventListener('click', () => { if (S.update) Updates.dismissUpdate(storage, S.update.version); showUpdate(null); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    document.addEventListener('keydown', onKeyDown);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { updateTabFade(); if (S.curveEd) S.curveEd.draw(); if (S.rampEd) S.rampEd.draw(); }, 60); });
    $('tabs').addEventListener('scroll', updateTabFade, { passive: true });
  }

  // ---------------------------------------------------------------- modules (Musique, Textes…)

  const app = {
    S, Core, Lib, Pv, Store, Host, Audio, Media, Share,
    UI: window.RRFXUI, settings, persist, log, status, runTask, modal, promptName, confirmDialog,
    plural, clone, errorMessage, pushHistory, renderCTA, switchTab, fps, registry, uid,
    tabs: {}, actions: {}, services: {}, whenReady: []
  };
  window.RRFXApp = app;
  // Pour les autres onglets (Ressources…) : ajouter un overlay ou des effets à la bibliothèque.
  app.services.addOverlay = file => { addOverlayList([file]); if (S.tab !== 'effects') switchTab('effects'); };
  app.services.addItems = list => addItems(list);
  app.services.runAction = runAction;
  app.services.actionAvailable = id => !!actionFn(id);
  app.services.showHistory = () => showHistory();
  app.settingsExtras = [];
  /* Outils ajoutés aux onglets par d'autres modules : { id, title, nav, tool: [libellé du bouton
     du haut, action], render: () => contenu de la section }. */
  app.extras = { speech: [], music: [], titles: [], formats: [] };
  app.renderExtras = (tab, view, use) => app.extras[tab].forEach(e => {
    const el = window.RRFXUI.section(e.title, e.render(use || ((k, fn) => fn)), null, e.shut);
    el.dataset.sec = e.id;
    view.appendChild(el);
  });
  app.afterSave = [];
  // Sections repliées, gardées d'une session à l'autre.
  // Repliée ou non : le choix de l'utilisateur, sinon l'état par défaut de la section.
  window.RRFXUI.folded.get = (title, dflt) => { const f = S.lib && settings().folded; return f && title in f ? !!f[title] : !!dflt; };
  window.RRFXUI.folded.set = (title, v) => { const f = settings().folded || (settings().folded = {}); f[title] = !!v; persist(); };
  app.services.addOverlays = list => addOverlayList(list);
  app.services.grabFrames = () => grabRealFrames();
  app.services.grabClean = grabClean;
  app.itemTypes = ITEM_TYPES;
  app.services.pickFiles = pickFiles;
  app.importers = importers;
  app.services.defaultParams = e => defaultParams(e);
  app.services.entryByKey = k => entryByKey(k);
  app.services.entries = () => entries();
  // Ouvre un effet dans l'onglet Effets (recherche rapide).
  app.services.openEffect = key => { const e = entryByKey(key); if (!e) return; S.cat = 'all'; S.cur = e; S.params = defaultParams(e); switchTab('effects'); };
  app.services.ensureSound = ensureSound;
  app.actions.applyEffect = () => applyEffect();
  // Lumetri Color sous son nom local (cherché une fois) ; lut : .cube chargée en LUT d'entrée.
  let lumetriLocal;
  app.services.lumetriFx = async lut => {
    if (lumetriLocal === undefined) {
      const r = await Host.call('listEffects', { filter: 'lumetri' });
      lumetriLocal = (r.ok && r.names.find(n => /lumetri/i.test(n) && !/preset|préréglage/i.test(n))) || null;
    }
    return [{ type: 'lumetri', names: (lumetriLocal ? [lumetriLocal] : []).concat(window.RRFXAssets.LUMETRI_NAMES), props: [], lut: lut || undefined }];
  };
  /* Calque de réglage « name » portant fx, sur le clip visé ou toute la séquence (scope) : pose,
     ↶ Annuler (history) et avertissements au journal. → { res } (res.kind : ok ou warn), ou
     { fail } : le résultat de tâche à rendre tel quel. */
  app.services.adjustmentLayer = async (name, fx, o) => {
    const scope = (o && o.scope) || 'clip';
    const r = await Host.call('resolve', { placement: scope === 'sequence' ? 'sequence' : 'full', sides: ['post'], frames: 1, target: 'adjustment' });
    if (!r.ok) return { fail: { kind: 'error', title: _T('Aucun clip visé'), detail: r.error + (scope === 'clip' ? _T(' (ou choisis « Toute la séquence »)') : '') } };
    const res = await Host.call('apply', { target: 'adjustment', name, targets: r.targets.map(t => Object.assign({}, t, { name, fx })), adjNodeId: settings().adjNodeId, refreshAdj: true });
    if (!res.ok) return { fail: { kind: 'error', title: _T('Calque non posé'), detail: res.error } };
    if (res.created && res.created.length) pushHistory({ date: Date.now(), label: (o && o.history) || name.replace(/^RR FX · /, ''), entries: res.created });
    (res.warnings || []).forEach(w => log(w, 'warn'));
    res.kind = res.warnings && res.warnings.length ? 'warn' : 'ok';
    return { res };
  };
  app.fileURL = fileURL;
  function loadFeatures() {
    (window.RRFXFeatures || []).forEach(feature => {
      try { feature(app); } catch (e) { log(_T('Module du panneau indisponible : ') + errorMessage(e), 'error'); }
    });
  }

  async function boot() {
    try {
      S.lib = Store.load();
    } catch (e) {
      S.lib = { version: 1, favorites: [], items: [], history: [], settings: {} };
      log(_T('Bibliothèque illisible : ') + errorMessage(e), 'error');
    }
    S.lib.settings = Object.assign(clone(DEFAULT_SETTINGS), S.lib.settings);
    S.lib.settings.ramp = Object.assign(clone(DEFAULT_SETTINGS.ramp), S.lib.settings.ramp);
    if (!PLACEMENTS.some(p => p.v === S.lib.settings.placement)) S.lib.settings.placement = 'cut';
    // 1.3 : tout se pose sur un calque de réglage (sauf CLIP FX, imposé par l'effet).
    S.lib.settings.target = 'adjustment';
    if (!Array.isArray(S.lib.settings.overlays)) S.lib.settings.overlays = [];
    // Overlays ajoutés en mode démo (fichier lu par le navigateur, blob:) : perdus au rechargement.
    S.lib.settings.overlays = S.lib.settings.overlays.filter(o => !/^blob:/.test(o.url || ''));
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
    log('RR FX ' + Host.VERSION + _T(' · plugin par @robin.rahoual sur Instagram') + (S.demo ? _T(' · mode démo') : ''), 'info');
    if (!init.demo && !init.loaded) {
      status.finish('error', _T('Script Premiere non chargé'), _T('Redémarre Premiere. Si ça persiste, réinstalle RR FX.'));
      log(_T('Version du script chargé : « ') + (init.version || 'aucune') + _T(' », attendue ') + Host.VERSION, 'error');
    }
    const c = await Host.call('compat', {});
    if (c.ok) {
      S.compat = c;
      if (c.missing.length) {
        status.finish('error', _T('Plugin à mettre à jour'), _T('Cette version de Premiere ne fournit plus : ') + c.missing.join(', ') + '.');
        log(_T('Fonctions Premiere manquantes : ') + c.missing.join(', '), 'error');
      }
      if (c.optional.length) log(_T('Fonctions optionnelles absentes : ') + c.optional.join(', '), 'warn');
      if (c.app) log('Premiere ' + c.app, 'info');
    }
    await detectEffects(false);
    registerKeys();
    setMenu();
    await refreshContext();
    if (S.tab === 'settings') renderSettingsView();
    setInterval(() => { if (!document.hidden) refreshContext(); }, 2000);
    if (settings().checkUpdates && !S.demo) checkUpdates(false).catch(() => {});
    (app.whenReady || []).forEach(fn => { try { fn(); } catch (e) { log(errorMessage(e), 'warn'); } });
  }

  window.addEventListener('error', e => log(_T('Erreur du panneau : ') + e.message, 'error'));
  window.addEventListener('unhandledrejection', e => log(_T('Erreur du panneau : ') + errorMessage(e.reason), 'error'));
  document.addEventListener('DOMContentLoaded', () => {
    boot().catch(e => {
      try { status.finish('error', _T('Initialisation incomplète'), errorMessage(e)); } catch (ignored) { /* panneau indisponible */ }
      log(_T('Initialisation incomplète du panneau : ') + errorMessage(e), 'error');
    });
  });
})();
