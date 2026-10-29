/* RR FX : onglet Réglages (les autres modules y ajoutent leurs sections).
   Découpé de main.js : l'état et les services communs arrivent par « core ». */
(function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (window.RRFXPanels = window.RRFXPanels || []).push(function (core) {
    const Core = window.RRFXCore, Host = window.RRFXHost, Keys = window.RRFXShortcuts, Store = window.RRFXStorage;
    const { actionGroup, checkbox, h, row, section } = window.RRFXUI;
    const { $, status, S, actionFn, app, checkUpdates, clearAll, detectEffects, errorMessage, persist, registry,
      renderGrid, renderShortcuts, settings, signalEnd } = core;

    // ---------------------------------------------------------------- onglet Réglages

    function renderSettingsView() {
      const view = $('view-settings');
      view.innerHTML = '';
      const st = settings();

      // Langue, en texte bilingue pour qu'on la trouve quelle que soit la langue. Le panneau se recharge.
      const I = window.RRFXI18n;
      if (I) {
        const langSec = section('Langue · Language', [
          actionGroup([{ v: 'fr', label: '🇫🇷 Français' }, { v: 'en', label: '🇬🇧 English' }], I.lang, v => { if (v === I.lang) return; I.switchTo(v); }),
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
      arrangeSettings(view);
    }

    // Réglages rangés par thème, avec un sommaire en haut (comme les onglets Parole et Formats).
    const SETTING_GROUPS = [
      ['Général', [['lang', 'Langue · Language'], ['signal', 'Signal de fin'], ['confirm', 'Confirmations'], ['updates', 'Mises à jour']]],
      ['Contrôle', [['shortcuts', 'Raccourcis clavier'], ['macros', 'Macros'], ['remote', 'Télécommande (Stream Deck, Companion…)']]],
      ['Temps', [['gagne', 'Temps gagné avec RR FX'], ['temps', 'Temps passé par projet'], ['astuces', 'Astuce du jour']]],
      ['Projet', [['layers', 'Calques'], ['cleanup', 'Nettoyage'], ['fx', 'Effets Premiere utilisés']]],
      ['Plus', [['sync', 'Synchro entre ordinateurs'], ['compat', 'Test de compatibilité'], ['advanced', 'Avancé'], ['library', 'Bibliothèque'], ['log', 'Journal']]]
    ];
    function arrangeSettings(view) {
      const all = Array.from(view.querySelectorAll(':scope > .section')), known = SETTING_GROUPS.flatMap(g => g[1]);
      all.forEach(el => {
        if (el.dataset.sec) return;
        const d = el.querySelector(':scope > .section-title .detail'), t = d ? d.textContent.replace(/^[▸▾]\s*/, '') : '';
        const hit = known.find(([, title]) => t.indexOf(_T(title)) === 0);
        if (hit) el.dataset.sec = hit[0];
      });
      const nav = h('div', { class: 'sec-nav', role: 'navigation', 'aria-label': _T('Thèmes des réglages') });
      SETTING_GROUPS.forEach(([label, list]) => {
        const head = h('div', { class: 'set-group' }, _T(label));
        view.appendChild(head);
        list.forEach(([id]) => { const el = view.querySelector(':scope > .section[data-sec="' + id + '"]'); if (el) view.appendChild(el); });
        const b = h('button', { class: 'action' }, _T(label));
        b.addEventListener('click', () => { const sc = $('scroll'); sc.scrollTop += head.getBoundingClientRect().top - sc.getBoundingClientRect().top - nav.offsetHeight - 4; });
        nav.appendChild(b);
      });
      // Une section qu'aucun thème ne connaît (module ajouté plus tard) reste visible, à la fin.
      all.filter(el => !known.some(([id]) => id === el.dataset.sec)).forEach(el => view.appendChild(el));
      view.insertBefore(nav, view.firstChild);
    }

    Object.assign(core, { renderSettingsView });
  });
})();
