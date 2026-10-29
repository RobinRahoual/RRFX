/* RR FX : le panneau : état, bloc d'état, fenêtres, historique, raccourcis, onglets, mises à jour,
   démarrage. Les onglets Effets, Rampe, Mes effets et Réglages sont dans leurs propres fichiers. */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const Core = window.RRFXCore, Lib = window.RRFXLibrary, Pv = window.RRFXPreview;
  const Store = window.RRFXStorage, Host = window.RRFXHost, Keys = window.RRFXShortcuts, Updates = window.RRFXUpdates;
  const Audio = window.RRFXAudio, Media = window.RRFXMedia, Share = window.RRFXShare;
  const { h, checkbox } = window.RRFXUI;
  const Ly = window.RRFXLayout;

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
    const started = Date.now(), placed = S.placed || 0;
    try {
      const result = (await task()) || { kind: 'ok', title: _T('Terminé') };
      status.finish(result.kind, result.title, result.detail);
      // Ce que la tâche a posé (historique), pour le temps gagné et autres suivis.
      const added = (S.placed || 0) - placed;
      (app.taskHooks || []).forEach(fn => { try { fn(label, result, added); } catch (e) { /* suivi : jamais bloquant */ } });
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

  // ---------------------------------------------------------------- historique / annulation

  function pushHistory(op) {
    const list = S.lib.history;
    // Séquence de l'opération : l'annuler plus tard la rouvre si besoin.
    if (S.ctx && S.ctx.seqId && !op.seq) { op.seq = S.ctx.seqId; op.seqName = S.ctx.name; }
    list.push(op);
    S.placed = (S.placed || 0) + (op.entries ? op.entries.length : 0);
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

  // ---------------------------------------------------------------- raccourcis clavier

  const SHORTCUT_ACTIONS = {
    apply: () => core.applyEffect(),
    ramp: () => core.applyRamp(),
    undo: () => undoLast(),
    history: () => showHistory(),
    palette: () => app.services.palette && app.services.palette(),
    capture: () => core.capture()
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
      { id: 'windows', label: _T('Fenêtres et espaces de travail…') },
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
      if (id === 'windows') return app.services.windows && app.services.windows();
      if (id === 'history') return showHistory();
      runAction(id);
    });
  }

  function ctaAction() {
    if (app.tabs[S.tab]) return app.tabs[S.tab].cta();
    if (S.tab === 'ramp') return { label: _T('Appliquer la rampe'), run: core.applyRamp, enabled: true };
    if (S.tab === 'mine' && S.mineView === 'community') return { label: _T('Publier un de mes effets…'), run: core.publishPicker, enabled: true };
    if (S.tab === 'mine') return { label: _T('Capturer la sélection'), run: core.capture, enabled: true };
    if (S.tab === 'effects' && core.chainOn()) return { label: _T('Appliquer l\'enchaînement · ') + plural(core.chainEntries().length, _T('effet')), run: core.applyEffect, enabled: true };
    return { label: S.cur ? _T('Appliquer · ') + S.cur.name : _T('Appliquer'), run: core.applyEffect, enabled: !!S.cur };
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

  // ---------------------------------------------------------------- onglets regroupés, fenêtres

  const layout = () => {
    const s = settings();
    if (!s.layout || typeof s.layout !== 'object') s.layout = {};
    const l = s.layout;
    if (!Array.isArray(l.hidden)) l.hidden = [];
    if (!Array.isArray(l.custom)) l.custom = [];
    if (!l.space) l.space = 'all';
    return l;
  };
  // Dernier onglet ouvert de chaque groupe (Montage, Bibliothèque) : on y revient.
  function groupTab(g) {
    const seen = (settings().groupTab || {})[g.id], v = Ly.visibleTabs(layout().hidden, g);
    return v.indexOf(seen) >= 0 ? seen : v[0];
  }
  function tabButton(t, sub) {
    const [label, title] = Ly.TABS[t];
    const b = h('button', { class: 'tab' + (t === 'express' ? ' tab-express' : '') + (sub ? ' sub' : ''), 'data-tab': t, title: _T(title) }, _T(label));
    b.addEventListener('click', () => switchTab(t));
    return b;
  }
  function renderTabs() {
    const bar = $('tabs'), sub = $('subtabs'), hidden = layout().hidden;
    bar.innerHTML = '';
    sub.innerHTML = '';
    Ly.GROUPS.forEach(g => {
      const tabs = Ly.visibleTabs(hidden, g);
      if (!tabs.length) return;
      // Réglages : la roue, en haut à droite, à côté de « Réduire ».
      if (g.id === 'settings') { $('brand-tabs').innerHTML = ''; $('brand-tabs').appendChild(tabButton('settings', false)); return; }
      if (g.tabs.length === 1) { bar.appendChild(tabButton(tabs[0], false)); return; }
      const b = h('button', { class: 'tab tab-group', 'data-group': g.id, title: _T(g.title) }, _T(g.label));
      b.addEventListener('click', () => switchTab(groupTab(g)));
      bar.appendChild(b);
      if (tabs.length > 1) tabs.forEach(t => sub.appendChild(tabButton(t, g.id)));
    });
    markTabs();
  }
  function markTabs() {
    const g = Ly.groupOf(S.tab);
    document.querySelectorAll('#tabs .tab, #subtabs .tab, #brand-tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab ? t.dataset.tab === S.tab : !!g && t.dataset.group === g.id));
    document.querySelectorAll('#subtabs .tab').forEach(t => t.classList.toggle('hidden', !g || g.tabs.indexOf(t.dataset.tab) < 0));
    show($('subtabs'), !!g && $('subtabs').querySelectorAll('.tab:not(.hidden)').length > 1);
  }
  // Fenêtres masquées : une feuille de style, valable même quand un onglet se redessine.
  function layoutChanged() {
    let css = $('layout-css');
    if (!css) { css = document.createElement('style'); css.id = 'layout-css'; document.head.appendChild(css); }
    css.textContent = Ly.css(layout().hidden);
    renderTabs();
    if (S.tab && !Ly.tabVisible(layout().hidden, S.tab)) switchTab(Ly.fallbackTab(layout().hidden, S.tab));
  }
  // Chaque section d'onglet reçoit son identifiant (pour le menu Fenêtres), même redessinée.
  function watchSections() {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; const v = document.querySelector('.view.on'); if (v) Ly.tagSections(v, S.tab, app.extras); });
    }).observe($('scroll'), { childList: true, subtree: true });
  }

  // Position de défilement de chaque onglet : on retrouve sa place en revenant.
  const tabScroll = {};
  function switchTab(tab) {
    // Un onglet masqué qu'on ouvre quand même (recherche rapide, action) se réaffiche.
    if (!Ly.tabVisible(layout().hidden, tab)) { layout().hidden = layout().hidden.filter(k => k !== Ly.tabKey(tab)); persist(); renderTabs(); }
    if (S.tab !== tab && app.tabs[S.tab] && app.tabs[S.tab].leave) app.tabs[S.tab].leave();
    if (S.tab !== tab) tabScroll[S.tab] = $('scroll').scrollTop;
    S.tab = tab;
    settings().tab = tab;
    persist();
    core.stopThumb();
    core.pauseOverlayVideos(null);
    if (S.player) { S.player.stop(); S.player = null; }
    if (S.rampPlayer) { S.rampPlayer.stop(); S.rampPlayer = null; }
    S.curveEd = null;
    S.rampEd = null;
    S.capturing = null;
    const grp = Ly.groupOf(tab);
    if (grp && grp.tabs.length > 1) (settings().groupTab || (settings().groupTab = {}))[grp.id] = tab;
    markTabs();
    const on = document.querySelector('#tabs .tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateTabFade();
    document.querySelectorAll('.view').forEach(v => { v.classList.toggle('on', v.id === 'view-' + tab); if (v.id !== 'view-' + tab) v.innerHTML = ''; });
    if (tab === 'effects') core.renderEffectsView();
    if (tab === 'ramp') core.renderRampView();
    if (tab === 'mine') core.renderMineView();
    if (tab === 'settings') core.renderSettingsView();
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
      // Signature : le pack vient bien de RR FX (rien n'est écrit sinon).
      const sig = up.signatureUrl ? new TextDecoder().decode(await Installer.download(Store.nodeRequire('https'), up.signatureUrl)) : '';
      Installer.verifySignature(Store.nodeRequire('crypto'), bytes, sig);
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
    $('open-windows').addEventListener('click', () => app.services.windows && app.services.windows());
    document.addEventListener('keydown', onKeyDown);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { updateTabFade(); if (S.curveEd) S.curveEd.draw(); if (S.rampEd) S.rampEd.draw(); }, 60); });
    $('tabs').addEventListener('scroll', updateTabFade, { passive: true });
  }

  // ---------------------------------------------------------------- modules (Musique, Textes…)

  const app = {
    S, Core, Lib, Pv, Store, Host, Audio, Media, Share,
    UI: window.RRFXUI, settings, persist, log, status, runTask, modal, promptName, confirmDialog,
    plural, clone, errorMessage, pushHistory, renderCTA, switchTab, layoutChanged, fps, registry, uid,
    tabs: {}, actions: {}, services: {}, whenReady: []
  };
  window.RRFXApp = app;
  // Pour les autres onglets (Ressources…) : ajouter un overlay ou des effets à la bibliothèque.
  app.services.addOverlay = file => { core.addOverlayList([file]); if (S.tab !== 'effects') switchTab('effects'); };
  app.services.addItems = list => core.addItems(list);
  app.services.runAction = runAction;
  // Même chose, en attendant la fin de l'action (macros) : → son résultat { kind, title, detail }.
  app.services.runActionAsync = id => { const fn = actionFn(id); return fn ? Promise.resolve(fn()) : Promise.reject(new Error(_T('Action indisponible'))); };
  app.taskHooks = [];
  app.services.actionAvailable = id => !!actionFn(id);
  app.services.showHistory = () => showHistory();
  app.settingsExtras = [];
  /* Outils ajoutés aux onglets par d'autres modules : { id, title, nav, tool: [libellé du bouton
     du haut, action], render: () => contenu de la section }. */
  app.extras = { speech: [], music: [], titles: [], formats: [], assets: [], native: [] };
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
  app.services.addOverlays = list => core.addOverlayList(list);
  app.services.grabFrames = () => core.grabRealFrames();
  app.services.grabClean = (...a) => core.grabClean(...a);
  app.services.pickFiles = (...a) => core.pickFiles(...a);
  app.services.defaultParams = e => core.defaultParams(e);
  app.services.entryByKey = k => core.entryByKey(k);
  app.services.entries = () => core.entries();
  // Ouvre un effet dans l'onglet Effets (recherche rapide).
  app.services.openEffect = key => { const e = core.entryByKey(key); if (!e) return; S.cat = 'all'; S.cur = e; S.params = core.defaultParams(e); switchTab('effects'); };
  app.services.ensureSound = id => core.ensureSound(id);
  app.actions.applyEffect = () => core.applyEffect();
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
  app.fileURL = p => core.fileURL(p);
  /* Ce que partagent les fichiers des onglets (effets.js, rampe.js, bibliotheque.js, reglages.js) :
     ils reçoivent « core » et y ajoutent ce qu'ils offrent aux autres. */
  const core = {
    $, status, BLENDS, CATS, PLACEMENTS, RAMP_PLACEMENTS, S, VARIATIONS, actionFn, app, catLabel, checkUpdates,
    clearAll, clone, confirmDialog, detectEffects, errorMessage, fps, hostPlacement, isFull, isMulti, log,
    modal, persist, plural, promptName, pushHistory, registry, renderCTA, renderShortcuts, runTask, settings,
    signalEnd, storage, switchTab, uid
  };
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
    (window.RRFXPanels || []).forEach(panel => panel(core));
    app.itemTypes = core.ITEM_TYPES;
    app.importers = core.importers;
    S.cur = core.entries()[0];
    S.params = core.defaultParams(S.cur);
    status.reset();
    renderUndo();
    loadFeatures();
    layoutChanged();
    watchSections();
    const known = ['effects', 'ramp', 'mine', 'settings'].concat(Object.keys(app.tabs)).indexOf(settings().tab) >= 0;
    switchTab(known && Ly.tabVisible(layout().hidden, settings().tab) ? settings().tab : Ly.fallbackTab(layout().hidden));

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
    if (S.tab === 'settings') core.renderSettingsView();
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
