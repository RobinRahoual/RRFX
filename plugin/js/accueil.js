/* RR FX : accueil et recherche rapide.
   - Accueil : à la première ouverture (et à chaque nouvelle version majeure), ce que le
     panneau sait faire et par où commencer.
   - Recherche rapide (Ctrl+K, « / » ou 🔍) : toutes les actions, onglets, effets, looks et
     styles de clip au même endroit, au clavier. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

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
      // Toute première ouverture (jamais vu l'accueil) : la page Instagram s'ouvre en fermant l'accueil.
      const firstEver = !force && !s.welcomed && !s.instagramOpened;
      s.welcomed = MAJOR;
      app.persist();
      const card = (icon, title, text) => h('div', { class: 'wl-card' }, h('span', { class: 'wl-icon' }, icon), h('div', null, h('b', null, title), h('div', { class: 'note' }, text)));
      const body = h('div', { class: 'wl' },
        h('div', { class: 'wl-lead' }, _T('Le couteau suisse gratuit du montage dans Premiere : transitions, silences, sous-titres, couleur, formats, pour toutes tes vidéos.')),
        card('⚡', _T('Express : ton montage en un clic'), _T('Choisis un style (Reels, interview, aftermovie, YouTube, clip…) : RR FX enchaîne coupe des silences, montage sur le rythme, couleur, transitions, sons, textes et format.')),
        card('🎙', _T('Parole : vidéos qui parlent'), _T('Silences coupés, zoom visage qui suit les yeux, sous-titres .srt animés, bandeau nom et fonction.')),
        card('✨', _T('Effets et transitions'), _T('Plus de 30 transitions et mouvements (push, zoom lent, Ken Burns, punch-in…) sur une coupe, toutes les coupes ou les temps forts.')),
        card('🎨', _T('Couleur et formats'), _T('LOG → Rec.709, expo auto, raccord entre caméras, looks ; copies 9:16, 4:5, 1:1 recadrées ou sur fond flou.')),
        card('🔍', _T('Tout au clavier'), _T('Ctrl+K (ou /) cherche une action, un effet, un look ou un style.')),
        h('div', { class: 'note' }, _T('Une seule chose à faire par projet : Fichier > Nouveau > Calque de réglage. Réglages > Test de compatibilité vérifie ton Premiere en un clic.')),
        firstEver ? h('div', { class: 'note' }, _T('📸 Ma page Instagram @robin.rahoual s\'ouvre dans ton navigateur : astuces, nouveautés et coulisses de RR FX.')) : null);
      app.modal(_T('Bienvenue dans RR FX ') + MAJOR + '.0', body, [
        { label: _T('Tester mon Premiere'), value: 'test' },
        { label: _T('C\'est parti'), value: 'go', primary: true }
      ]).then(v => {
        if (firstEver) {
          s.instagramOpened = true;
          app.persist();
          if (app.services.openInstagram) app.services.openInstagram();
        }
        if (v === 'test') { app.switchTab('settings'); if (app.diagnostic) app.diagnostic.run(); } else if (v === 'go') app.switchTab('express');
      });
    }
    /* Premier lancement : la langue d'abord (texte bilingue, celle de l'ordinateur proposée).
       Si elle change, le panneau se recharge dans cette langue, puis l'accueil s'affiche. */
    const I18n = root.RRFXI18n;
    function chooseLanguage() {
      const sug = I18n.suggest();
      const body = h('div', { class: 'wl lang-choice' },
        h('div', { class: 'wl-lead' }, 'Choisis la langue de RR FX.'),
        h('div', { class: 'wl-lead' }, 'Choose the language of RR FX.'),
        h('div', { class: 'note' }, 'Modifiable à tout moment dans Réglages · You can change it anytime in Settings.'));
      return app.modal('Langue · Language', body, [
        { label: '🇫🇷 Français', value: 'fr', primary: sug === 'fr' },
        { label: '🇬🇧 English', value: 'en', primary: sug === 'en' }
      ]).then(v => v || sug);
    }
    app.whenReady.push(() => setTimeout(() => {
      let skip = false;
      try { skip = localStorage.getItem('rrfx-nowelcome') === '1'; } catch (e) { skip = false; }
      if (!I18n || I18n.chosen || skip) return welcome(false);
      chooseLanguage().then(l => {
        if (l !== I18n.lang) I18n.switchTo(l); else { I18n.setLang(l); welcome(false); }
      });
    }, 400));
    app.services.welcome = () => welcome(true);
    app.services.chooseLanguage = () => (I18n ? chooseLanguage() : Promise.resolve('fr'));

    // ---------------------------------------------------------------- recherche rapide

    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const TABS = [['express', '⚡ Express'], ['effects', _T('Effets')], ['ramp', _T('Rampe')], ['color', _T('Couleur')], ['music', _T('Musique')], ['titles', _T('Textes')], ['speech', _T('Parole')], ['formats', 'Formats'], ['assets', _T('Ressources')], ['mine', _T('Mes effets')], ['settings', _T('Réglages')]];

    /* Ouvre l'onglet et amène l'outil en vue (panneau ou section ouverts) : sel, ou la section
       dont le titre contient title ; focus : le champ reçoit le curseur. */
    function reveal(tab, sel, focus, title) {
      app.switchTab(tab);
      setTimeout(() => {
        const view = document.querySelector('.view.on');
        const el = sel ? view && view.querySelector(sel) : view && Array.from(view.querySelectorAll('.section')).find(x => { const t = x.querySelector('.section-title'); return t && t.textContent.indexOf(_T(title)) >= 0; });
        if (!el) return;
        const box = el.closest('.lr-panel, .section') || el;
        if (box.classList.contains('closed')) box.querySelector('.lr-head').click();
        if (box.classList.contains('folded')) box.querySelector('.section-title').click();
        const sc = document.getElementById('scroll'), nav = view.querySelector('.sec-nav');
        sc.scrollTop += box.getBoundingClientRect().top - sc.getBoundingClientRect().top - (nav ? nav.offsetHeight + 4 : 4);
        if (focus && el.focus) el.focus();
      }, 30);
    }

    function commands() {
      const A = app.actions, out = [];
      const act = (label, kind, run, hint) => out.push({ label, kind, run, hint: hint || '' });
      act(_T('Lancer le montage express'), 'Action', () => A.express && A.express(), 'Express');
      act(_T('Appliquer l\'effet choisi'), 'Action', () => A.applyEffect && A.applyEffect(), 'A');
      act(_T('Poser les marqueurs des temps forts'), 'Action', () => A.beats && A.beats(), 'B');
      act(_T('Monter les rushs sélectionnés sur le rythme'), 'Action', () => A.autoEdit && A.autoEdit());
      act(_T('Synchroniser la sélection sur la musique'), 'Action', () => A.sync && A.sync(), 'S');
      act(_T('Convertir le LOG en Rec.709'), 'Action', () => A.convert && A.convert(), 'L');
      act(_T('Expo et balance des blancs auto'), 'Action', () => A.autoFix && A.autoFix());
      act(_T('Appliquer le look en cours'), 'Action', () => A.applyLook && A.applyLook());
      act(_T('Poser les paroles'), 'Action', () => A.titles && A.titles());
      act(_T('Couper les silences'), 'Action', () => A.cutSilences && A.cutSilences());
      act(_T('Zoom visage (yeux suivis, un plan sur deux)'), 'Action', () => A.punchIn && A.punchIn());
      act(_T('Poser les sous-titres (.srt)'), 'Action', () => A.captions && A.captions());
      act(_T('Poser un bandeau nom et fonction'), 'Action', () => A.lowerThird && A.lowerThird());
      act(_T('Couper les « euh » et répétitions'), 'Action', () => A.cutFillers && A.cutFillers());
      act(_T('Égaliser le son de la voix (-14 LUFS)'), 'Action', () => A.levelVoice && A.levelVoice());
      act(_T('Baisser la musique sous la voix'), 'Action', () => A.duckMusic && A.duckMusic());
      act(_T('Importer une vidéo ou un son depuis un lien'), 'Action', () => reveal('assets', 'input.link-input', true));
      act(_T('Importer des presets, LUTs, couleurs…'), 'Action', () => { app.switchTab('mine'); const b = Array.from(document.querySelectorAll('#view-mine .action')).find(x => x.textContent === _T('Importer…')); if (b) b.click(); });
      act(_T('Mes LUTs'), 'Action', () => reveal('color', '[data-panel=luts]'));
      act(_T('Dégradé de couleur'), 'Action', () => reveal('color', '[data-panel=gradient]'));
      act(_T('Style de texte et Mes couleurs'), 'Action', () => reveal('titles', null, false, 'Style du texte'));
      act(_T('Historique des opérations RR FX'), 'Action', () => app.services.showHistory());
      act('Langue · Language (Français / English)', 'Action', () => reveal('settings', '[data-sec=lang]'));
      act(_T('Montage par le texte (.srt)'), 'Action', () => reveal('speech', '[data-sec=texte]'));
      act(_T('Musique à la durée de la vidéo'), 'Action', () => reveal('music', '[data-sec=duree]'));
      act(_T('Versions de la séquence'), 'Action', () => reveal('formats', '[data-sec=versions]'));
      act(_T('Dossiers surveillés (import automatique)'), 'Action', () => reveal('assets', '[data-sec=surveilles]'));
      act(_T('Ranger le projet'), 'Action', () => reveal('assets', '[data-sec=rangement]'));
      act(_T('Renommer en série'), 'Action', () => reveal('assets', '[data-sec=renommer]'));
      act(_T('Créer les proxies'), 'Action', () => reveal('assets', '[data-sec=proxies]'));
      act(_T('Macros'), 'Action', () => reveal('settings', '[data-sec=macros]'));
      act(_T('Temps gagné avec RR FX'), 'Action', () => reveal('settings', '[data-sec=gagne]'));
      act(_T('Temps passé par projet'), 'Action', () => reveal('settings', '[data-sec=temps]'));
      (app.macros ? app.macros.list() : []).forEach(m => act('▶ ' + m.name, 'Macro', () => app.macros.run(m.id)));
      act(_T('Risers avant les drops'), 'Action', () => reveal('music', '[data-sec=risers]'));
      act(_T('Réverb de fin de musique'), 'Action', () => reveal('music', '[data-sec=tail]'));
      act(_T('Atténuer respirations et clics de bouche'), 'Action', () => reveal('speech', '[data-sec=souffle]'));
      act(_T('Traduire les sous-titres'), 'Action', () => reveal('speech', '[data-sec=traduire]'));
      act(_T('Plans de coupe sur les mots clés (b-roll)'), 'Action', () => reveal('speech', '[data-sec=broll]'));
      act(_T('Barre de progression et compte à rebours'), 'Action', () => reveal('titles', '[data-sec=barre]'));
      act(_T('Extraits pour les réseaux (Reels, Shorts)'), 'Action', () => reveal('formats', '[data-sec=extraits]'));
      act(_T('Vérifier avant export'), 'Action', () => reveal('formats', '[data-sec=verif]'));
      act(_T('Appliquer sur plusieurs séquences'), 'Action', () => reveal('formats', '[data-sec=lot]'));
      act(_T('Nouveau projet depuis un modèle'), 'Action', () => reveal('formats', '[data-sec=modeles]'));
      act(_T('Télécommande (Stream Deck, Companion)'), 'Action', () => reveal('settings', null, false, _T('Télécommande')));
      act(_T('Synchro entre ordinateurs'), 'Action', () => reveal('settings', null, false, 'Synchro entre ordinateurs'));
      act(_T('Créer les chapitres YouTube'), 'Action', () => { app.switchTab('speech'); if (A.chapters) A.chapters(); });
      act(_T('Créer la copie 9:16'), 'Action', () => A.formatCopy && A.formatCopy());
      act(_T('Tester mon Premiere (compatibilité)'), 'Action', () => { app.switchTab('settings'); if (app.diagnostic) app.diagnostic.run(); });
      act(_T('Afficher l\'accueil'), _T('Aide'), () => welcome(true));
      TABS.forEach(([id, label]) => act(_T('Aller à ') + label, _T('Onglet'), () => app.switchTab(id)));
      (app.services.entries ? app.services.entries() : []).forEach(e => act(e.name, e.kind === 'overlay' ? 'Overlay' : _T('Effet'), () => app.services.openEffect(e.key)));
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
      const input = h('input', { class: 'textfield pal-input', placeholder: _T('Rechercher une action, un effet, un look…'), 'aria-label': _T('Recherche rapide') });
      const list = h('div', { class: 'pal-list', role: 'listbox' });
      let shown = [], idx = 0;
      const close = () => { if (open) { open.remove(); open = null; document.removeEventListener('keydown', key, true); } };
      const run = c => { close(); if (c) setTimeout(() => c.run(), 0); };
      const draw = () => {
        shown = search(all, input.value);
        idx = Math.min(idx, Math.max(0, shown.length - 1));
        list.innerHTML = '';
        if (!shown.length) list.appendChild(h('div', { class: 'note pal-empty' }, _T('Rien trouvé.')));
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
