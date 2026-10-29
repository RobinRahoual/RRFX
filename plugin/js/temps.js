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
      if (!s.saved.by || typeof s.saved.by !== 'object') s.saved.by = {};
      if (!('ops' in s.saved)) s.saved.ops = 0;
      if (!Array.isArray(s.saved.tools)) s.saved.tools = [];
      if (!Array.isArray(s.saved.badges)) s.saved.badges = [];
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

    function exportCsv(byDay) {
      const t = track(), csv = O.timeCsv(t.projects, t.rate, byDay);
      // BOM UTF-8 : Excel lit les accents correctement.
      const out = Store.saveBinary([new TextEncoder().encode('\ufeff' + csv)], (byDay ? _T('temps-par-jour') : _T('temps-par-projet')) + '.csv', 'csv', _T('Exporter le temps passé'));
      if (out) app.status.finish('ok', _T('Temps passé exporté'), out);
    }

    function timeSection() {
      const t = track(), box = h('div');
      const list = Object.keys(t.projects).map(k => Object.assign({ key: k }, t.projects[k])).sort((p, q) => (q.lastDay || '').localeCompare(p.lastDay || '') || q.minutes - p.minutes);
      box.appendChild(checkbox(_T('Compter le temps passé sur chaque projet'), t.on, v => { t.on = v; app.persist(); app.switchTab('settings'); }));
      if (!t.on) return section(_T('Temps passé par projet'), [box], null, true);
      if (!list.length) box.appendChild(h('div', { class: 'note' }, _T('Une minute compte quand quelque chose bouge dans Premiere (lecture, montage, changement de séquence). Pratique pour facturer au temps passé. Rien ne quitte ton ordinateur.')));
      const rate = Number(t.rate) || 0, day = O.dayKey(new Date());
      const todayAll = list.reduce((n, p) => n + ((p.days && p.days[day]) || 0), 0), todayN = list.filter(p => p.days && p.days[day]).length;
      if (todayAll) box.appendChild(h('div', { class: 'saved-box' }, h('div', { class: 'saved-big' }, dur(todayAll)), h('div', { class: 'note' }, _T('aujourd\'hui · ') + app.plural(todayN, _T('projet')) + (rate ? ' · ' + Math.round(todayAll / 60 * rate) + ' €' : ''))));
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
      csv.addEventListener('click', () => exportCsv(false));
      const csvDay = h('button', { class: 'action quiet', disabled: !list.length }, _T('Jour par jour (CSV)…'));
      csvDay.addEventListener('click', () => exportCsv(true));
      box.appendChild(h('div', { class: 'row-buttons' }, csv, csvDay));
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
      // Par outil (le nom de la tâche), pour montrer ce qui fait gagner le plus.
      const k = String(label || '').slice(0, 60);
      if (k) s.by[k] = (s.by[k] || 0) + min;
      s.ops++;
      if (k && s.tools.indexOf(k) < 0 && s.tools.length < 200) s.tools.push(k);
      // Badges débloqués par cette opération : annoncés une fois.
      const fresh = O.badges({ minutes: s.total, ops: s.ops, tools: s.tools.length }).filter(b => b.done && s.badges.indexOf(b.id) < 0);
      fresh.forEach(b => s.badges.push(b.id));
      app.persist();
      if (fresh.length) setTimeout(() => toast(fresh[fresh.length - 1]), 400);
    });

    // ---------------------------------------------------------------- badges

    const BADGE_NAME = () => ({
      h1: _T('1 h gagnée'), h5: _T('5 h gagnées'), h10: _T('10 h gagnées'), h24: _T('Une journée gagnée'), h100: _T('100 h gagnées'),
      ops10: _T('10 opérations'), ops100: _T('100 opérations'), ops1000: _T('1 000 opérations'),
      tools5: _T('5 outils différents'), tools15: _T('15 outils différents')
    });
    function toast(b) {
      try { if (root.localStorage.getItem('rrfx-nowelcome') === '1') return; } catch (e) { /* stockage indisponible */ }
      const old = document.querySelector('.rr-toast');
      if (old) old.remove();
      const share = h('button', { class: 'action quiet' }, _T('Partager'));
      share.addEventListener('click', () => { el.remove(); badgeCard(b); });
      const close = h('button', { class: 'action quiet icon', title: _T('Fermer') }, '✕');
      close.addEventListener('click', () => el.remove());
      const el = h('div', { class: 'rr-toast', role: 'status' }, h('span', { class: 'rr-toast-icon' }, b.icon), h('span', null, _T('Badge débloqué : ') + BADGE_NAME()[b.id]), share, close);
      document.body.appendChild(el);
      setTimeout(() => { if (el.isConnected) el.remove(); }, 9000);
    }
    function badgeCard(b) {
      shareCard(b.icon + ' ' + BADGE_NAME()[b.id], _T('Badge RR FX débloqué'), _T('Au total : ') + dur(saved().total) + _T(' gagnées'), _T('badge-RRFX-') + b.id);
    }

    function card() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0;
      shareCard(dur(month || s.total), _T('RR FX m\'a fait gagner'), (month ? _T('de montage ce mois-ci') : _T('de montage')) + '\n' + _T('Au total : ') + dur(s.total), _T('temps-gagne-RRFX'));
    }
    /* Image 1080 × 1920 à partager en story : big au centre, top au-dessus, bottom dessous. */
    function shareCard(big, top, bottom, fileName) {
      const W = 1080, H = 1920;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0f1b3d'); bg.addColorStop(0.55, '#2a1458'); bg.addColorStop(1, '#ff4f6d');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.fillStyle = '#ffffff';
      const font = (w, px) => w + ' ' + px + 'px "Helvetica Neue", Arial, sans-serif';
      g.font = font(600, 64); g.fillText(top, W / 2, 700);
      // Le grand texte rétrécit pour tenir dans la largeur.
      let px = 230;
      g.font = font(800, px);
      while (px > 70 && g.measureText(big).width > W - 120) { px -= 10; g.font = font(800, px); }
      g.fillText(big, W / 2, 960);
      String(bottom || '').split('\n').forEach((l, i) => { g.globalAlpha = i ? 0.85 : 1; g.font = font(500, i ? 44 : 60); g.fillText(l, W / 2, 1070 + i * 120); });
      g.globalAlpha = 1; g.font = font(700, 52); g.fillText('@robin.rahoual', W / 2, 1640);
      g.globalAlpha = 0.8; g.font = font(500, 40); g.fillText(_T('RR FX · plugin gratuit pour Premiere Pro'), W / 2, 1710);
      const bin = atob(cv.toDataURL('image/png').split(',')[1]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const out = Store.saveBinary([bytes], fileName + '.png', 'png', _T('Enregistrer la carte'));
      if (out) app.status.finish('ok', _T('Carte enregistrée'), _T('Partage-la en story et identifie @robin.rahoual. ') + out);
    }
    function caption() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0;
      return _T('RR FX m\'a fait gagner ') + dur(month || s.total) + (month ? _T(' de montage ce mois-ci') : _T(' de montage')) + _T(' 🔥 Plugin gratuit pour Premiere Pro par @robin.rahoual');
    }

    function badgeGrid(s) {
      const N = BADGE_NAME(), grid = h('div', { class: 'badge-grid' });
      O.badges({ minutes: s.total, ops: s.ops, tools: s.tools.length }).forEach(b => {
        const el = h('button', { class: 'badge' + (b.done ? ' on' : ''), title: b.done ? _T('Partager ce badge') : Math.round(b.progress * 100) + ' %', disabled: !b.done }, h('span', { class: 'badge-icon' }, b.icon), h('span', { class: 'badge-name' }, N[b.id]), b.done ? null : h('span', { class: 'badge-bar' }, h('span', { style: 'width:' + Math.round(b.progress * 100) + '%' })));
        if (b.done) el.addEventListener('click', () => badgeCard(b));
        grid.appendChild(el);
      });
      return grid;
    }

    function savedSection() {
      const s = saved(), month = s.months[O.monthKey(new Date())] || 0;
      const top = Object.keys(s.by).map(k => [k, s.by[k]]).filter(e => e[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
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
        top.length ? h('div', { class: 'note' }, _T('Ce qui t\'a fait gagner le plus : ') + top.map(([k, v]) => k + ' (' + dur(v) + ')').join(', ') + '.') : null,
        badgeGrid(s),
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
