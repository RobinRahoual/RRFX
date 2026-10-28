/* RR FX : test de compatibilité (onglet Réglages). En un clic, RR FX essaie sur une copie
   jetable de ta séquence chaque fonction de Premiere dont il se sert (LUT dans Lumetri,
   insertion de piste, export d'image, copie de séquence…), puis la supprime. Le rapport se
   copie pour le partager. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Store, Host } = app;
    const { h, section } = app.UI;
    // Ce que chaque fonction permet, pour dire à l'utilisateur ce qui marchera ou pas.
    const USE = {
      clone: 'Formats 9:16', adj: 'tous les effets', place: 'tous les effets', lumetri: 'looks, conversion LOG', lut: 'LUT chargée toute seule',
      insert: 'conversion sous les looks', razor: 'montage, découpe', disable: 'multicam', markers: 'temps forts', frame: 'aperçu réel, expo auto, raccord',
      settings: 'Formats 9:16', reframe: 'recadrage auto (Formats)', mogrt: 'paroles animées', cleanup: 'ménage du test'
    };

    let last = null;

    function report(r) {
      const lines = ['RR FX ' + (r.version || '') + ' · Premiere ' + (r.app || '?') + ' · ' + (navigator.platform || '')];
      r.results.forEach(x => lines.push((x.ok ? '✓ ' : '✕ ') + x.label + (x.detail ? ' (' + x.detail + ')' : '')));
      return lines.join('\n');
    }

    function run(refresh) {
      return app.runTask('Test de compatibilité', async () => {
        const dir = Store.cacheDir();
        let lut = '';
        if (Store.fs && dir) {
          // Petite LUT neutre pour vérifier que Lumetri accepte une LUT d'entrée.
          lut = Store.path.join(dir, 'rrfx-test.cube');
          const lines = ['LUT_3D_SIZE 2'];
          for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(r + ' ' + g + ' ' + b);
          Store.fs.writeFileSync(lut, lines.join('\n') + '\n');
          Store.listFiles(dir, /^rrfx-test-/, 20, 0).forEach(f => { try { Store.fs.unlinkSync(f); } catch (e) { /* déjà supprimé */ } });
        }
        app.status.phase('Essais sur une copie de ta séquence');
        const fx = await app.services.lumetriFx();
        const r = await Host.call('selfTest', { lutPath: lut, folder: dir ? dir.replace(/\\/g, '/') : '', prefix: 'rrfx-test-', fxNames: fx[0].names, adjNodeId: app.settings().adjNodeId });
        if (!r.ok) return { kind: 'error', title: 'Test impossible', detail: r.error };
        // L'image exportée arrive après coup : on l'attend un peu.
        const frame = r.results.find(x => x.id === 'frame');
        if (frame && frame.ok && r.frame && Store.fs) {
          let seen = false;
          for (let i = 0; i < 30 && !seen; i++) {
            seen = [r.frame, r.frame + '.png'].some(f => Store.fs.existsSync(f) && Store.fs.statSync(f).size > 0);
            if (!seen) await new Promise(res => setTimeout(res, 200));
          }
          if (!seen) Object.assign(frame, { ok: false, detail: 'Premiere n\'a pas écrit l\'image' });
        }
        last = r;
        app.settings().selfTest = { date: Date.now(), results: r.results, app: r.app, version: r.version };
        app.persist();
        if (refresh) refresh(); else if (app.S.tab === 'settings') app.switchTab('settings');
        const bad = r.results.filter(x => !x.ok);
        app.log(report(r), bad.length ? 'warn' : 'ok');
        return bad.length
          ? { kind: 'warn', title: app.plural(bad.length, 'fonction à revoir', 'fonctions à revoir') + ' sur ' + r.results.length, detail: bad.map(x => x.label + ' → ' + (USE[x.id] || '')).join(' · ') + '. « Copier le rapport » et envoie-le à @robin.rahoual.' }
          : { kind: 'ok', title: 'Tout fonctionne avec ton Premiere', detail: r.results.length + ' fonctions vérifiées. La séquence de test a été supprimée.' };
      });
    }

    function section_() {
      const box = h('div');
      const refresh = () => {
        box.innerHTML = '';
        const saved = last || app.settings().selfTest;
        if (saved && saved.results) {
          box.appendChild(h('div', { class: 'note' }, 'Dernier test : ' + new Date(saved.date || Date.now()).toLocaleString('fr-FR') + ' · Premiere ' + (saved.app || '?')));
          saved.results.forEach(x => box.appendChild(h('div', { class: 'xp-check ' + (x.ok ? 'ok' : 'ko') }, h('span', { class: 'xp-dot' }, x.ok ? '✓' : '✕'),
            h('div', null, h('div', null, x.label), h('div', { class: 'note' }, (USE[x.id] ? 'Sert pour : ' + USE[x.id] : '') + (x.detail ? ' · ' + x.detail : ''))))));
        }
        const go = h('button', { class: 'action selected' }, saved ? 'Refaire le test' : 'Tester mon Premiere');
        go.addEventListener('click', () => run(refresh));
        const copy = h('button', { class: 'action', disabled: !saved }, 'Copier le rapport');
        copy.addEventListener('click', () => {
          const txt = report(Object.assign({ version: '', app: '' }, saved));
          (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(new Error('presse-papiers indisponible')))
            .then(() => app.status.finish('ok', 'Rapport copié', 'Colle-le dans un message.'), e => app.status.finish('warn', 'Copie impossible', app.errorMessage(e)));
        });
        box.appendChild(h('div', { class: 'row-buttons' }, go, copy));
      };
      refresh();
      return section('Test de compatibilité', [h('div', { class: 'note' }, 'Vérifie en un clic que ton Premiere accepte tout ce que RR FX fait : essais sur une copie de ta séquence, supprimée ensuite. Ton montage n\'est pas touché.'), box]);
    }

    app.diagnostic = { section: section_, run };
  });
})(typeof self !== 'undefined' ? self : this);
