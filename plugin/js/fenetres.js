/* RR FX : les onglets regroupés et le menu Fenêtres, comme dans Premiere.
   - Groupes d'onglets : Montage (Effets, Rampe, Musique), Bibliothèque (Ressources, Mes effets) ;
     les autres groupes n'ont qu'un onglet.
   - Fenêtres : chaque onglet et chaque outil (section) s'affiche ou se masque. Un outil masqué
     reste disponible : la recherche rapide, un raccourci ou une macro le réaffichent.
   - Espaces de travail : Tout, Essentiel, Interview et YouTube, Réseaux sociaux, Clip et
     événement, ou les tiens.
   La partie « quoi est masqué » est pure et testée sous Node ; l'affichage passe par une feuille
   de style (les sections masquées restent dans la page, rien ne casse si un onglet se redessine). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RRFXLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  // Onglets : libellé, info-bulle.
  const TABS = {
    express: ['⚡ Express', 'Ton montage en un clic : clip, Reels, entreprise, événement, YouTube'],
    effects: ['Effets', 'Transitions et effets sur les coupes, marqueurs et temps forts'],
    ramp: ['Rampe', 'Rampes de vitesse'],
    music: ['Musique', 'Temps forts, montage auto, synchro, multicam'],
    native: ['Premiere', 'Les outils de Premiere en un clic : transitions et fondus audio sur toutes les coupes, changements de plan, sous-titres'],
    speech: ['Parole', 'YouTube, interviews, vidéos d\'entreprise : silences, jump cuts, sous-titres, bandeaux'],
    color: ['Couleur', 'Conversion LOG, expo auto, raccord, looks façon Lightroom'],
    titles: ['Textes', 'Titres et paroles animés'],
    formats: ['Formats', 'Copie 9:16, 4:5, 1:1, vérification, export, versions'],
    assets: ['Ressources', 'Tes dossiers d\'effets, sons, LUTs, polices ; rangement du projet'],
    mine: ['Mes effets', 'Effets perso, packs de style, communauté'],
    settings: ['⚙', 'Réglages']
  };
  const GROUPS = [
    { id: 'express', tabs: ['express'] },
    { id: 'montage', label: 'Montage', title: 'Effets, rampes de vitesse, musique et outils de Premiere', tabs: ['effects', 'ramp', 'music', 'native'] },
    { id: 'speech', tabs: ['speech'] },
    { id: 'color', tabs: ['color'] },
    { id: 'titles', tabs: ['titles'] },
    { id: 'formats', tabs: ['formats'] },
    { id: 'library', label: '📚', name: 'Bibliothèque', title: 'Bibliothèque : tes ressources, tes effets et ceux de la communauté', tabs: ['assets', 'mine'] },
    { id: 'settings', tabs: ['settings'] }
  ];
  // Les outils de chaque onglet qui se masquent (les ajouts des modules s'y ajoutent : app.extras).
  // [identifiant, titre de la section tel qu'affiché en français].
  const SECTIONS = {
    music: [['musique', 'Musique'], ['tempsforts', 'Temps forts'], ['montageauto', 'Montage auto sur le rythme'], ['synchro', 'Synchroniser le son et l\'image'], ['volume', 'Volume et intensité']],
    speech: [['silences', 'Couper les silences'], ['euh', '« Euh » et répétitions'], ['visage', 'Zoom visage'], ['soustitres', 'Sous-titres'], ['bandeau', 'Bandeau nom et fonction'], ['voix', 'Son de la voix'], ['musique', 'Musique sous la voix'], ['chapitres', 'Chapitres YouTube']],
    color: [['looks', 'Looks'], ['basic', 'Réglages de base'], ['curve', 'Courbe des tonalités'], ['mixer', 'Mélangeur de couleurs'], ['grading', 'Étalonnage des couleurs'], ['calib', 'Calibrage'], ['out', 'Appliquer et exporter'], ['log', 'Conversion LOG → Rec.709'], ['fix', 'Expo, balance et raccord'], ['luts', 'Mes LUTs'], ['gradient', 'Dégradés de couleur']],
    titles: [['modele', 'Modèle de texte'], ['texte', 'Texte et paroles'], ['placement', 'Placement'], ['style', 'Style du texte'], ['animation', 'Animation'], ['couleurs', 'Mes couleurs']],
    formats: [['format', 'Format'], ['cadrage', 'Cadrage']],
    assets: [['lien', 'Importer depuis un lien'], ['dossiers', 'Dossiers liés'], ['parcourir', 'Parcourir']]
  };
  // Onglets dont les sections ne se masquent pas (une seule fenêtre de travail).
  const WHOLE = ['express', 'effects', 'ramp', 'mine', 'settings'];

  /* Espaces de travail : les onglets affichés, et pour certains onglets les seuls outils
     affichés (les autres sont masqués). */
  const SPACES = [
    { id: 'all', label: 'Tout', desc: 'Tous les onglets et tous les outils.' },
    { id: 'essential', label: 'Essentiel', desc: 'Les outils dont on se sert tous les jours, rien d\'autre.',
      tabs: ['express', 'effects', 'music', 'native', 'speech', 'color', 'titles', 'formats', 'assets', 'settings'],
      sections: {
        music: ['musique', 'tempsforts', 'montageauto', 'duree'],
        speech: ['silences', 'euh', 'visage', 'soustitres', 'bandeau', 'voix', 'texte'],
        color: ['looks', 'basic', 'out', 'log', 'fix', 'luts'],
        formats: ['format', 'cadrage', 'verif', 'export'],
        assets: ['lien', 'dossiers', 'parcourir', 'rangement']
      } },
    { id: 'interview', label: 'Interview et YouTube', desc: 'Parole, sous-titres, son de la voix, versions et export.',
      tabs: ['express', 'effects', 'native', 'speech', 'color', 'titles', 'formats', 'assets', 'settings'],
      sections: {
        color: ['looks', 'basic', 'out', 'log', 'fix', 'luts'],
        formats: ['format', 'cadrage', 'extraits', 'verif', 'versions', 'rythme', 'export']
      } },
    { id: 'social', label: 'Réseaux sociaux', desc: 'Reels, TikTok, Shorts : rythme, sous-titres, 9:16, extraits.',
      tabs: ['express', 'effects', 'music', 'native', 'speech', 'color', 'titles', 'formats', 'assets', 'settings'],
      sections: {
        speech: ['silences', 'euh', 'visage', 'soustitres', 'correcteur', 'traduire', 'broll', 'texte'],
        color: ['looks', 'basic', 'out', 'luts', 'gradient'],
        formats: ['format', 'cadrage', 'extraits', 'verif', 'rythme', 'export']
      } },
    { id: 'clip', label: 'Clip et événement', desc: 'Musique, effets, rampes, couleur : clips, aftermovies, mariages.',
      tabs: ['express', 'effects', 'ramp', 'music', 'native', 'color', 'titles', 'formats', 'assets', 'mine', 'settings'],
      sections: { formats: ['format', 'cadrage', 'verif', 'export', 'versions'] } }
  ];

  const tabKey = t => 'tab:' + t;
  const secKey = (t, s) => t + ':' + s;
  const groupOf = tab => GROUPS.find(g => g.tabs.indexOf(tab) >= 0) || null;

  // Les sections d'un onglet : les fixes, puis celles ajoutées par les modules (extras).
  function sectionsOf(tab, extras) {
    return (SECTIONS[tab] || []).concat((extras && extras[tab] || []).map(e => [e.id, e.title, true]));
  }

  // Ce qu'un espace de travail masque (clés « tab:x » et « onglet:section »).
  function hiddenFor(spaceId, extras) {
    const sp = SPACES.find(s => s.id === spaceId);
    if (!sp || !sp.tabs) return [];
    const out = [];
    Object.keys(TABS).forEach(t => { if (sp.tabs.indexOf(t) < 0 && t !== 'settings') out.push(tabKey(t)); });
    Object.keys(sp.sections || {}).forEach(t => sectionsOf(t, extras).forEach(([id]) => { if (sp.sections[t].indexOf(id) < 0) out.push(secKey(t, id)); }));
    return out;
  }

  const isHidden = (hidden, key) => (hidden || []).indexOf(key) >= 0;
  // Réglages ne se masque jamais : on doit toujours pouvoir revenir en arrière.
  const tabVisible = (hidden, t) => t === 'settings' || !isHidden(hidden, tabKey(t));
  const visibleTabs = (hidden, group) => group.tabs.filter(t => tabVisible(hidden, t));
  // Onglet à ouvrir quand celui demandé est masqué : un voisin du même groupe, sinon le premier visible.
  function fallbackTab(hidden, tab) {
    const own = groupOf(tab), near = own ? visibleTabs(hidden, own) : [];
    if (near.length) return near[0];
    for (const g of GROUPS) { const v = visibleTabs(hidden, g); if (v.length) return v[0]; }
    return 'settings';
  }

  // Feuille de style qui masque les fenêtres choisies (sections, panneaux, boutons du sommaire).
  function css(hidden) {
    return (hidden || []).filter(k => !/^tab:/.test(k)).map(k => {
      const [t, s] = k.split(':'), v = '#view-' + t + ' ';
      return [v + '.section[data-sec="' + s + '"]', v + '.lr-panel[data-panel="' + s + '"]', v + '.sec-nav [data-target="' + s + '"]'].join(', ') + ' { display: none !important; }';
    }).join('\n');
  }

  // Texte affiché d'un titre de section, sans le chevron (▸ ▾).
  const titleText = el => { const d = el.querySelector(':scope > .section-title .detail, :scope > .lr-head .lr-title'); return d ? d.textContent.replace(/^[▸▾]\s*/, '').trim() : ''; };

  /* Donne son identifiant à chaque section d'onglet qui n'en a pas, d'après son titre (dans la
     langue du panneau). → les sections restées sans identifiant (pour le test d'interface). */
  function tagSections(view, tab, extras) {
    const list = sectionsOf(tab, extras), left = [];
    view.querySelectorAll(':scope > .section').forEach(el => {
      if (el.dataset.sec || !el.querySelector(':scope > .section-title')) return;
      const t = titleText(el), hit = list.find(([, title, done]) => !done && t.indexOf(_T(title)) === 0);
      if (hit) el.dataset.sec = hit[0]; else left.push(t);
    });
    return left;
  }

  return { TABS, GROUPS, SECTIONS, WHOLE, SPACES, tabKey, secKey, groupOf, sectionsOf, hiddenFor, isHidden, tabVisible, visibleTabs, fallbackTab, css, tagSections };
});

// ------------------------------------------------------------------ menu Fenêtres (panneau)
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const Ly = root.RRFXLayout;

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { h, checkbox } = app.UI;
    const st = () => {
      const s = app.settings();
      if (!s.layout || typeof s.layout !== 'object') s.layout = {};
      if (!Array.isArray(s.layout.hidden)) s.layout.hidden = [];
      if (!Array.isArray(s.layout.custom)) s.layout.custom = [];
      if (!s.layout.space) s.layout.space = 'all';
      return s.layout;
    };
    const tabLabel = t => t === 'settings' ? _T('Réglages') : _T(Ly.TABS[t][0]);

    function setHidden(list, space) {
      const x = st();
      x.hidden = list.slice();
      if (space) x.space = space;
      app.persist();
      app.layoutChanged();
    }
    function toggle(key, show) {
      const x = st(), i = x.hidden.indexOf(key);
      if (show && i >= 0) x.hidden.splice(i, 1);
      if (!show && i < 0) x.hidden.push(key);
      x.space = 'custom';
      app.persist();
      app.layoutChanged();
    }
    // Réaffiche une fenêtre masquée (recherche rapide, raccourci, macro qui y mène).
    app.services.showWindow = (tab, sec) => {
      const x = st(), keys = [Ly.tabKey(tab)].concat(sec ? [Ly.secKey(tab, sec)] : []);
      if (!keys.some(k => x.hidden.indexOf(k) >= 0)) return false;
      x.hidden = x.hidden.filter(k => keys.indexOf(k) < 0);
      app.persist();
      app.layoutChanged();
      return true;
    };

    function applySpace(id) {
      const c = st().custom.find(q => 'c:' + q.name === id);
      setHidden(c ? c.hidden : Ly.hiddenFor(id, app.extras), id);
    }

    function openWindows() {
      const x = st(), body = h('div', { class: 'win-menu' });
      const draw = () => {
        body.innerHTML = '';
        // Espaces de travail.
        const spaces = h('div', { class: 'win-spaces' });
        Ly.SPACES.map(s => ({ id: s.id, label: _T(s.label), desc: _T(s.desc) }))
          .concat(x.custom.map(c => ({ id: 'c:' + c.name, label: c.name, desc: _T('Ton espace de travail') })))
          .forEach(s => {
            const b = h('button', { class: 'action' + (x.space === s.id ? ' selected' : ''), title: s.desc }, s.label);
            b.addEventListener('click', () => { applySpace(s.id); draw(); });
            spaces.appendChild(b);
          });
        const save = h('button', { class: 'action quiet' }, _T('＋ Enregistrer cet espace…'));
        save.addEventListener('click', async () => {
          const name = await app.promptName(_T('Nom de l\'espace de travail'), _T('Mon espace'));
          if (!name) return;
          const list = x.custom.filter(c => c.name !== name);
          list.push({ name, hidden: x.hidden.slice() });
          x.custom = list;
          x.space = 'c:' + name;
          app.persist();
          openWindows();
        });
        const del = x.space.indexOf('c:') === 0 ? h('button', { class: 'action quiet danger' }, _T('Supprimer cet espace')) : null;
        if (del) del.addEventListener('click', () => { x.custom = x.custom.filter(c => 'c:' + c.name !== x.space); x.space = 'custom'; app.persist(); draw(); });
        body.append(h('div', { class: 'win-title' }, _T('Espace de travail')), spaces, h('div', { class: 'row-buttons' }, save, del));
        // Onglets et outils.
        body.appendChild(h('div', { class: 'win-title' }, _T('Onglets et outils affichés')));
        Ly.GROUPS.forEach(g => g.tabs.forEach(t => {
          if (t === 'settings') return;
          const shown = Ly.tabVisible(x.hidden, t), secs = Ly.WHOLE.indexOf(t) >= 0 ? [] : Ly.sectionsOf(t, app.extras);
          const head = h('div', { class: 'win-tab' + (shown ? '' : ' off') },
            checkbox((g.label ? _T(g.name || g.label) + ' › ' : '') + tabLabel(t), shown, v => { toggle(Ly.tabKey(t), v); draw(); }));
          const box = h('div', { class: 'win-secs' + (shown ? '' : ' hidden') });
          secs.forEach(([id, title]) => box.appendChild(checkbox(_T(title), !Ly.isHidden(x.hidden, Ly.secKey(t, id)), v => toggle(Ly.secKey(t, id), v))));
          body.appendChild(h('div', { class: 'win-group' }, head, secs.length ? box : null));
        }));
        body.appendChild(h('div', { class: 'note' }, _T('Un outil masqué reste disponible : la recherche rapide (Ctrl+K), son raccourci ou une macro le réaffichent. Réglages ne se masque pas.')));
      };
      draw();
      return app.modal(_T('Fenêtres'), body, [{ label: _T('Tout afficher'), value: 'all' }, { label: _T('Fermer'), value: 'close', primary: true }])
        .then(v => { if (v === 'all') applySpace('all'); });
    }
    app.services.windows = openWindows;
    app.services.applySpace = applySpace;
    app.actions.windows = openWindows;
  });
})(typeof self !== 'undefined' ? self : this);
