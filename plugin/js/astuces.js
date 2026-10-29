/* RR FX : l'astuce du jour. Une fois par jour, une ligne discrète sous l'état présente un outil
   que tu n'as encore jamais utilisé, avec « Voir » pour y aller. Désactivable dans Réglages. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils;
    const { h, checkbox, section } = app.UI;

    // Un outil, ce qui montre qu'il a servi (nom de la tâche), et où le trouver.
    const TIPS = () => [
      { id: 'texte', text: _T('Monte une interview en barrant des phrases dans le texte du .srt.'), tasks: ['Montage par le texte'], go: ['speech', '[data-sec=texte]'] },
      { id: 'silences', text: _T('Coupe tous les silences d\'une interview en un clic.'), tasks: ['Couper les silences'], go: ['speech', '[data-sec=silences]'] },
      { id: 'raccords', text: _T('J-cut et L-cut en un clic sur toutes tes coupes : le raccord des documentaires.'), tasks: ['J-cut', 'L-cut'], go: ['speech', '[data-sec=raccords]'] },
      { id: 'correcteur', text: _T('Le correcteur de sous-titres recoupe les lignes trop longues et ralentit les sous-titres trop rapides.'), tasks: [], key: 'correcteur', go: ['speech', '[data-sec=correcteur]'] },
      { id: 'express', text: _T('Express monte un Reel, une interview ou un aftermovie entier en un clic.'), tasks: [], key: 'express', go: ['express', null] },
      { id: 'extraits', text: _T('RR FX trouve les meilleurs passages d\'une longue vidéo pour tes Reels.'), tasks: ['Recherche des meilleurs passages'], go: ['formats', '[data-sec=extraits]'] },
      { id: 'verif', text: _T('Vérifie ta séquence avant export : médias hors ligne, images noires, son trop fort, plans trop sombres.'), tasks: ['Vérification avant export'], go: ['formats', '[data-sec=verif]'] },
      { id: 'rythme', text: _T('Le rythme du montage montre les plans trop longs, là où l\'attention décroche.'), tasks: ['Rythme du montage'], go: ['formats', '[data-sec=rythme]'] },
      { id: 'export', text: _T('Exporte toutes tes versions d\'un coup dans Media Encoder, avec des noms propres.'), tasks: ['Export en lot'], go: ['formats', '[data-sec=export]'] },
      { id: 'duree', text: _T('Ta musique est trop longue ? RR FX la raccourcit sur un temps fort pour qu\'elle finisse avec la vidéo.'), tasks: ['Musique à la durée de la vidéo'], go: ['music', '[data-sec=duree]'] },
      { id: 'risers', text: _T('Un riser qui monte jusqu\'à chaque drop de la musique, posé tout seul.'), tasks: ['Risers avant les drops'], go: ['music', '[data-sec=risers]'] },
      { id: 'raccord', text: _T('Mets tes plans dans les couleurs d\'une image que tu aimes (un film, un Reel…).'), tasks: ['Raccord'], go: ['color', '[data-panel=fix]'] },
      { id: 'proxies', text: _T('Rushs 4K trop lourds ? Des proxies en un clic, attachés tout seuls.'), tasks: ['Proxies'], go: ['assets', '[data-sec=proxies]'] },
      { id: 'archive', text: _T('Archive un projet terminé avec seulement les médias utilisés.'), tasks: ['Archiver le projet'], go: ['assets', '[data-sec=archive]'] },
      { id: 'macros', text: _T('Une macro enchaîne tes actions préférées sur un seul bouton (ou une touche de Stream Deck).'), tasks: [], key: 'macros', go: ['settings', '[data-sec=macros]'] },
      { id: 'palette', text: _T('Ctrl+K (ou /) : cherche n\'importe quel outil, effet ou look au clavier.'), tasks: [], key: 'palette', go: null }
    ];
    // Tests et captures d'écran (accueil désactivé) : pas d'astuce surprise.
    const quiet = () => { try { return root.localStorage.getItem('rrfx-nowelcome') === '1'; } catch (e) { return false; } };
    const st = () => {
      const s = app.settings();
      if (!s.tips || typeof s.tips !== 'object') s.tips = {};
      const d = { on: true, day: '', shown: [] };
      Object.keys(d).forEach(k => { if (!(k in s.tips)) s.tips[k] = JSON.parse(JSON.stringify(d[k])); });
      return s.tips;
    };
    // Un outil a servi : sa tâche a tourné (temps gagné), ou il laisse une trace dans les réglages.
    function used(t) {
      const s = app.settings(), tools = (s.saved && s.saved.tools) || [];
      if (t.tasks.some(n => tools.indexOf(_T(n)) >= 0 || tools.indexOf(n) >= 0)) return true;
      if (t.key === 'macros') return Array.isArray(s.macros) && s.macros.length > 0;
      if (t.key === 'palette') return !!s.paletteUsed;
      if (t.key === 'express') return !!s.expressRan;
      if (t.key === 'correcteur') return !!s.subsChecked;
      return false;
    }
    function pick() {
      const x = st(), all = TIPS().filter(t => !used(t));
      if (!all.length) return null;
      // Une astuce pas encore montrée, sinon on recommence le tour.
      const fresh = all.filter(t => x.shown.indexOf(t.id) < 0);
      return (fresh.length ? fresh : all)[0];
    }

    function show(t) {
      const old = document.querySelector('.tip-bar');
      if (old) old.remove();
      const status = document.getElementById('status');
      if (!t || !status) return;
      const go = t.go ? h('button', { class: 'action quiet' }, _T('Voir')) : null;
      if (go) go.addEventListener('click', () => { bar.remove(); if (app.services.reveal) app.services.reveal(t.go[0], t.go[1]); else app.switchTab(t.go[0]); });
      const close = h('button', { class: 'action quiet icon', title: _T('Fermer l\'astuce') }, '✕');
      close.addEventListener('click', () => bar.remove());
      const bar = h('div', { class: 'tip-bar', role: 'note' }, h('span', { class: 'tip-icon' }, '💡'), h('span', { class: 'tip-text' }, t.text), go, close);
      status.insertAdjacentElement('afterend', bar);
    }

    app.whenReady.push(() => setTimeout(() => {
      const x = st(), today = O.dayKey(new Date());
      if (!x.on || x.day === today || document.querySelector('.modal') || quiet()) return;
      const t = pick();
      if (!t) return;
      x.day = today;
      if (x.shown.indexOf(t.id) < 0) x.shown.push(t.id); else x.shown = [t.id];
      app.persist();
      show(t);
    }, 2500));

    app.settingsExtras.push(() => {
      const x = st();
      const now = h('button', { class: 'action quiet' }, _T('Voir une astuce'));
      now.addEventListener('click', () => { const t = pick() || TIPS()[Math.floor(Math.random() * TIPS().length)]; show(t); });
      const sec = section(_T('Astuce du jour'), [
        checkbox(_T('Une astuce par jour au démarrage (un outil que tu n\'as pas encore utilisé)'), x.on, v => { x.on = v; app.persist(); }),
        h('div', { class: 'row-buttons' }, now)
      ], null, true);
      sec.dataset.sec = 'astuces';
      return sec;
    });
    app.tips = { pick, show, used, all: TIPS };
  });
})(typeof self !== 'undefined' ? self : this);
