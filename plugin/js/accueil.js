/* RR FX : accueil et recherche rapide.
   - Accueil : à la première ouverture (et à chaque nouvelle version majeure), ce que le
     panneau sait faire et par où commencer.
   - Recherche rapide (Ctrl+K, « / » ou 🔍) : toutes les actions, onglets, effets, looks et
     styles de clip au même endroit, au clavier. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { h } = app.UI;
    const D = root.RRFXDevelop, R = root.RRFXRecipes;
    const MAJOR = String((root.RRFXHost && root.RRFXHost.VERSION) || '2').split('.')[0];

    // ---------------------------------------------------------------- accueil

    function welcome(force) {
      const s = app.settings();
      let skip = false;
      try { skip = localStorage.getItem('rrfx-nowelcome') === '1'; } catch (e) { skip = false; }
      if (!force && (skip || s.welcomed === MAJOR)) return;
      s.welcomed = MAJOR;
      app.persist();
      const card = (icon, title, text) => h('div', { class: 'wl-card' }, h('span', { class: 'wl-icon' }, icon), h('div', null, h('b', null, title), h('div', { class: 'note' }, text)));
      const body = h('div', { class: 'wl' },
        h('div', { class: 'wl-lead' }, 'Le couteau suisse gratuit du montage dans Premiere : transitions, silences, sous-titres, couleur, formats, pour toutes tes vidéos.'),
        card('⚡', 'Express : ton montage en un clic', 'Choisis un style (Reels, interview, aftermovie, YouTube, clip…) : RR FX enchaîne coupe des silences, montage sur le rythme, couleur, transitions, sons, textes et format.'),
        card('🎙', 'Parole : vidéos qui parlent', 'Silences coupés, zoom un plan sur deux, sous-titres .srt animés, bandeau nom et fonction.'),
        card('✨', 'Effets et transitions', 'Plus de 30 transitions et mouvements (push, zoom lent, Ken Burns, punch-in…) sur une coupe, toutes les coupes ou les temps forts.'),
        card('🎨', 'Couleur et formats', 'LOG → Rec.709, expo auto, raccord entre caméras, looks ; copies 9:16, 4:5, 1:1 recadrées ou sur fond flou.'),
        card('🔍', 'Tout au clavier', 'Ctrl+K (ou /) cherche une action, un effet, un look ou un style.'),
        h('div', { class: 'note' }, 'Une seule chose à faire par projet : Fichier > Nouveau > Calque de réglage. Réglages > Test de compatibilité vérifie ton Premiere en un clic.'));
      app.modal('Bienvenue dans RR FX ' + MAJOR + '.0', body, [
        { label: 'Tester mon Premiere', value: 'test' },
        { label: 'C\'est parti', value: 'go', primary: true }
      ]).then(v => {
        if (v === 'test') { app.switchTab('settings'); if (app.diagnostic) app.diagnostic.run(); } else if (v === 'go') app.switchTab('express');
      });
    }
    app.whenReady.push(() => setTimeout(() => welcome(false), 400));
    app.services.welcome = () => welcome(true);

    // ---------------------------------------------------------------- recherche rapide

    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const TABS = [['express', '⚡ Express'], ['effects', 'Effets'], ['ramp', 'Rampe'], ['color', 'Couleur'], ['music', 'Musique'], ['titles', 'Textes'], ['speech', 'Parole'], ['formats', 'Formats'], ['assets', 'Ressources'], ['mine', 'Mes effets'], ['settings', 'Réglages']];

    function commands() {
      const A = app.actions, out = [];
      const act = (label, kind, run, hint) => out.push({ label, kind, run, hint: hint || '' });
      act('Lancer le montage express', 'Action', () => A.express && A.express(), 'Express');
      act('Appliquer l\'effet choisi', 'Action', () => A.applyEffect && A.applyEffect(), 'A');
      act('Poser les marqueurs des temps forts', 'Action', () => A.beats && A.beats(), 'B');
      act('Monter les rushs sélectionnés sur le rythme', 'Action', () => A.autoEdit && A.autoEdit());
      act('Synchroniser la sélection sur la musique', 'Action', () => A.sync && A.sync(), 'S');
      act('Convertir le LOG en Rec.709', 'Action', () => A.convert && A.convert(), 'L');
      act('Expo et balance des blancs auto', 'Action', () => A.autoFix && A.autoFix());
      act('Appliquer le look en cours', 'Action', () => A.applyLook && A.applyLook());
      act('Poser les paroles', 'Action', () => A.titles && A.titles());
      act('Couper les silences', 'Action', () => A.cutSilences && A.cutSilences());
      act('Zoom un plan sur deux (jump cuts)', 'Action', () => A.punchIn && A.punchIn());
      act('Poser les sous-titres (.srt)', 'Action', () => A.captions && A.captions());
      act('Poser un bandeau nom et fonction', 'Action', () => A.lowerThird && A.lowerThird());
      act('Créer la copie 9:16', 'Action', () => A.formatCopy && A.formatCopy());
      act('Tester mon Premiere (compatibilité)', 'Action', () => { app.switchTab('settings'); if (app.diagnostic) app.diagnostic.run(); });
      act('Afficher l\'accueil', 'Aide', () => welcome(true));
      TABS.forEach(([id, label]) => act('Aller à ' + label, 'Onglet', () => app.switchTab(id)));
      (app.services.entries ? app.services.entries() : []).forEach(e => act(e.name, e.kind === 'overlay' ? 'Overlay' : 'Effet', () => app.services.openEffect(e.key)));
      if (D) D.LOOKS.forEach(l => act('Look ' + l.name, 'Look', () => app.services.openLook && app.services.openLook({ name: l.name, data: { params: l.p } })));
      if (R) R.RECIPES.forEach(r => act('Style ' + r.name, 'Express', () => { app.settings().express = Object.assign(app.settings().express || {}, { recipe: r.id }); app.persist(); app.switchTab('express'); }));
      return out;
    }

    function search(list, q) {
      const words = norm(q).split(/\s+/).filter(Boolean);
      if (!words.length) return list.filter(c => c.kind === 'Action' || c.kind === 'Onglet').slice(0, 30);
      return list.map(c => {
        const text = norm(c.label + ' ' + c.kind);
        if (!words.every(w => text.includes(w))) return null;
        const start = norm(c.label).startsWith(words[0]) ? 0 : 1;
        return { c, score: start * 10 + (c.kind === 'Action' ? 0 : 1) + norm(c.label).length / 100 };
      }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 40).map(x => x.c);
    }

    let open = null;
    function palette() {
      if (open) return;
      const all = commands();
      const input = h('input', { class: 'textfield pal-input', placeholder: 'Rechercher une action, un effet, un look…', 'aria-label': 'Recherche rapide' });
      const list = h('div', { class: 'pal-list', role: 'listbox' });
      let shown = [], idx = 0;
      const close = () => { if (open) { open.remove(); open = null; document.removeEventListener('keydown', key, true); } };
      const run = c => { close(); if (c) setTimeout(() => c.run(), 0); };
      const draw = () => {
        shown = search(all, input.value);
        idx = Math.min(idx, Math.max(0, shown.length - 1));
        list.innerHTML = '';
        if (!shown.length) list.appendChild(h('div', { class: 'note pal-empty' }, 'Rien trouvé.'));
        shown.forEach((c, i) => {
          const el = h('div', { class: 'pal-item' + (i === idx ? ' on' : ''), role: 'option' }, h('span', { class: 'pal-label' }, c.label), h('span', { class: 'pal-kind' }, c.hint && c.kind === 'Action' ? c.hint : c.kind));
          el.addEventListener('mousemove', () => { if (idx !== i) { idx = i; draw(); } });
          el.addEventListener('click', () => run(c));
          list.appendChild(el);
        });
        const on = list.querySelector('.pal-item.on');
        if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
      };
      const key = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(shown[idx]); }
      };
      input.addEventListener('input', () => { idx = 0; draw(); });
      open = h('div', { class: 'modal-back pal-back' }, h('div', { class: 'modal pal' }, input, list));
      open.addEventListener('mousedown', e => { if (e.target === open) close(); });
      document.body.appendChild(open);
      document.addEventListener('keydown', key, true);
      draw();
      input.focus();
    }

    document.addEventListener('keydown', e => {
      const tag = String((e.target && e.target.tagName) || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
      if (((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
        if (document.querySelector('#modal-root .modal')) return;
        e.preventDefault();
        palette();
      }
    });
    const btn = document.getElementById('open-palette');
    if (btn) btn.addEventListener('click', palette);
    app.services.palette = palette;
  });
})(typeof self !== 'undefined' ? self : this);
