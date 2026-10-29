/* RR FX : le temps.
   - Temps passé par projet : une minute compte quand quelque chose bouge dans Premiere (lecture,
     montage, changement de séquence) ; tableau à exporter en CSV pour facturer.
   - Temps gagné : chaque opération RR FX ajoute le temps qu'elle aurait pris à la main (estimation
     prudente : 20 s par élément posé). Une carte à partager en story le montre. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, { Host, Store } = app;
    const { h, checkbox, row, section } = app.UI;
    const dur = m => O.duration(m, _T('h'));

    const track = () => {
      const s = app.settings();
      if (!s.timeTrack || typeof s.timeTrack !== 'object') s.timeTrack = {};
      const d = { on: true, rate: 0, projects: {} };
      Object.keys(d).forEach(k => { if (!(k in s.timeTrack)) s.timeTrack[k] = d[k]; });
      return s.timeTrack;
    };
    const saved = () => {
      const s = app.settings();
      if (!s.saved || typeof s.saved !== 'object') s.saved = {};
      if (!('total' in s.saved)) s.saved.total = 0;
      if (!s.saved.months || typeof s.saved.months !== 'object') s.saved.months = {};
      return s.saved;
    };

    // ---------------------------------------------------------------- temps passé

    let state = null, pending = 0, timer = 0;
    async function ping() {
      const t = track();
      if (!t.on) return;
      let r;
      try { r = await Host.call('activityPing', {}); } catch (e) { return; }
      if (!r || !r.ok || !(r.path || r.project)) return;
      const res = O.activity(state, r.sig, Date.now());
      state = res.state;
      if (!res.add) return;
      const key = r.path || r.project, today = O.dayKey(new Date());
      const p = t.projects[key] || (t.projects[key] = { name: String(r.project || '').replace(/\.prproj$/i, ''), path: r.path, minutes: 0, days: {} });
      p.minutes += res.add;
      p.days[today] = (p.days[today] || 0) + res.add;
      p.lastDay = today;
      // Enregistré toutes les 5 minutes comptées (pas à chaque minute).
      pending += res.add;
      if (pending >= 5) { pending = 0; app.persist(); }
    }
    app.whenReady.push(() => { clearInterval(timer); timer = setInterval(ping, 60000); ping(); });
    root.addEventListener && root.addEventListener('beforeunload', () => { if (pending) app.persist(); });

    function exportCsv() {
      const t = track(), csv = O.timeCsv(t.projects, t.rate);
      const out = Store.saveBinary([new TextEncoder().encode('﻿' + csv)], _T('temps-par-projet') + '.csv', 'csv', _T('Exporter le temps passé'));
      if (out) app.status.finish('ok', _T('Temps passé exporté'), out);
    }

    function timeSection() {
      const t = track(), box = h('div');
      const list = Object.keys(t.projects).map(k => Object.assign({ key: k }, t.projects[k])).sort((p, q) => (q.lastDay || '').localeCompare(p.lastDay || '') || q.minutes - p.minutes);
      box.appendChild(checkbox(_T('Compter le temps passé sur chaque projet'), t.on, v => { t.on = v; app.persist(); app.switchTab('settings'); }));
      if (!t.on) return section(_T('Temps passé par projet'), [box], null, true);
      if (!list.length) box.appendChild(h('div', { class: 'note' }, _T('Une minute compte quand quelque chose bouge dans Premiere (lecture, montage, changement de séquence). Pratique pour facturer au temps passé. Rien ne quitte ton ordinateur.')));
      const rate = Number(t.rate) || 0;
      list.slice(0, 12).forEach(p => {
        const del = h('button', { class: 'action quiet icon', title: _T('Remettre ce projet à zéro') }, '✕');
        del.addEventListener('click', async () => {
          if (!(await app.confirmDialog(_T('Remettre à zéro « ') + p.name + _T(' » ?'), _T('Le temps compté sur ce projet sera effacé.'), _T('Remettre à zéro')))) return;
          delete t.projects[p.key]; app.persist(); app.switchTab('settings');
        });
        const today = p.days && p.days[O.dayKey(new Date())];
        box.appendChild(h('div', { class: 'time-item' },
          h('span', { class: 'time-name', title: p.path || '' }, p.name || _T('Projet sans nom')),
          h('span', { class: 'time-val' }, dur(p.minutes) + (rate ? ' · ' + Math.round(p.minutes / 60 * rate) + ' €' : '')),
          today ? h('span', { class: 'note' }, _T('aujourd\'hui ') + dur(today)) : null,
          del));
      });
      const rateIn = h('input', { class: 'textfield', type: 'number', min: 0, step: 5, value: rate || '', placeholder: _T('ex. 45'), 'aria-label': _T('Tarif horaire') });
      rateIn.addEventListener('change', () => { t.rate = Math.max(0, +rateIn.value || 0); app.persist(); app.switchTab('settings'); });
      box.appendChild(row(_T('Tarif (€ / h)'), rateIn));
      const csv = h('button', { class: 'action', disabled: !list.length }, _T('Exporter en CSV…'));
      csv.addEventListener('click', exportCsv);
      box.appendChild(h('div', { class: 'row-buttons' }, csv));
      const sec = section(_T('Temps passé par projet'), [box], null, !list.length);
      sec.dataset.sec = 'temps';
      return sec;
    }

    // ---------------------------------------------------------------- temps gagné

    app.taskHooks.push((label, result, added) => {
      if (!result || (result.kind !== 'ok' && result.kind !== 'warn')) return;
      const n = result.saved !== undefined ? result.saved : added;
      const min = n ? O.savedMinutes(n) : 0.5, s = saved(), m = O.monthKey(new Date());
      s.total += min;
      s.months[m] = (s.months[m] || 0) + min;
      app.persist();
    });

    function card() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0, W = 1080, H = 1920;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0f1b3d'); bg.addColorStop(0.55, '#2a1458'); bg.addColorStop(1, '#ff4f6d');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.fillStyle = '#ffffff';
      const font = (w, px) => w + ' ' + px + 'px "Helvetica Neue", Arial, sans-serif';
      g.font = font(600, 64); g.fillText(_T('RR FX m\'a fait gagner'), W / 2, 700);
      g.font = font(800, month >= 600 ? 190 : 230); g.fillText(dur(month || s.total), W / 2, 960);
      g.font = font(500, 60); g.fillText(month ? _T('de montage ce mois-ci') : _T('de montage'), W / 2, 1070);
      g.globalAlpha = 0.85; g.font = font(500, 44);
      g.fillText(_T('Au total : ') + dur(s.total), W / 2, 1190);
      g.globalAlpha = 1; g.font = font(700, 52); g.fillText('@robin.rahoual', W / 2, 1640);
      g.globalAlpha = 0.8; g.font = font(500, 40); g.fillText(_T('RR FX · plugin gratuit pour Premiere Pro'), W / 2, 1710);
      const bin = atob(cv.toDataURL('image/png').split(',')[1]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const out = Store.saveBinary([bytes], _T('temps-gagne-RRFX') + '.png', 'png', _T('Enregistrer la carte'));
      if (out) app.status.finish('ok', _T('Carte enregistrée'), _T('Partage-la en story et identifie @robin.rahoual. ') + out);
    }
    function caption() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0;
      return _T('RR FX m\'a fait gagner ') + dur(month || s.total) + (month ? _T(' de montage ce mois-ci') : _T(' de montage')) + _T(' 🔥 Plugin gratuit pour Premiere Pro par @robin.rahoual');
    }

    function savedSection() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0;
      const share = h('button', { class: 'action go' }, _T('Créer la carte à partager'));
      share.addEventListener('click', card);
      const copy = h('button', { class: 'action quiet' }, _T('Copier le texte'));
      copy.addEventListener('click', () => {
        const txt = caption(), done = ok => app.status.finish(ok ? 'ok' : 'warn', ok ? _T('Texte copié') : _T('Copie impossible'), txt);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done(true), () => done(false));
        else done(false);
      });
      const sec = section(_T('Temps gagné avec RR FX'), [
        h('div', { class: 'saved-box' },
          h('div', { class: 'saved-big' }, dur(month)), h('div', { class: 'note' }, _T('ce mois-ci · ') + dur(s.total) + _T(' au total'))),
        h('div', { class: 'note' }, _T('Estimation prudente : ce qu\'auraient pris à la main les coupes, calques, sous-titres et réglages posés par RR FX.')),
        h('div', { class: 'row-buttons' }, share, copy)
      ]);
      sec.dataset.sec = 'gagne';
      return sec;
    }

    app.settingsExtras.push(savedSection, timeSection);
    app.timeSaved = { total: () => saved().total, month: () => saved().months[O.monthKey(new Date())] || 0, caption };
  });
})(typeof self !== 'undefined' ? self : this);
