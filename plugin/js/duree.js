/* RR FX : musique à la durée de la vidéo (onglet Musique). Un passage entre deux temps forts,
   de préférence des mesures entières, est retiré au milieu du morceau : la vraie fin de la
   musique tombe avec la fin de la vidéo, sans fondu ni coupe sèche. Une version de la séquence
   est gardée avant (au choix). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, { Host } = app;
    const { h, checkbox } = app.UI;
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const st = () => {
      const s = app.settings();
      if (!s.fitMusic || typeof s.fitMusic !== 'object') s.fitMusic = {};
      if (!('keep' in s.fitMusic)) s.fitMusic.keep = true;
      return s.fitMusic;
    };

    async function plan() {
      const p = await Host.call('fitMusic', { plan: true });
      if (!p.ok) throw new Error(p.error);
      return p;
    }

    function fit(refresh) {
      const x = st();
      return app.runTask(_T('Musique à la durée de la vidéo'), async () => {
        const p = await plan(), m = p.music, target = p.videoEnd;
        if (!(target > 1)) return { kind: 'error', title: _T('Pas d\'image'), detail: _T('Monte d\'abord tes plans : la musique se cale sur la fin de la vidéo.') };
        if (m.end <= target + 0.05) return { kind: 'warn', title: m.end < target - 0.05 ? _T('Musique plus courte que la vidéo') : _T('Déjà à la bonne durée'), detail: _T('Musique : ') + mmss(m.end - m.start) + _T(' · vidéo : ') + mmss(target) + (m.end < target - 0.05 ? _T('. RR FX ne peut que raccourcir : choisis un morceau plus long.') : '.') };
        app.status.phase(_T('Temps forts de la musique'));
        const md = app.musicData;
        let beats = [];
        try { await md.ensure(false); beats = await md.beatTimes(); } catch (e) { app.log(_T('Temps forts illisibles : coupe nette à la fin de la vidéo (') + app.errorMessage(e) + ')', 'warn'); }
        const f = O.fitPlan(beats, m.start, m.end, target);
        if (f.error) return { kind: 'warn', title: _T('Rien à couper'), detail: _T('La musique finit déjà avec la vidéo.') };
        if (x.keep && app.versions) {
          const v = await app.versions.snapshot(_T('avant musique'));
          if (v && !v.ok) app.log(_T('Version non gardée : ') + v.error, 'warn');
        }
        app.status.phase(_T('Coupe de la musique'));
        const r = await Host.call('fitMusic', { a: f.a, b: f.b, trim: f.trim });
        if (!r.ok) return { kind: 'error', title: _T('Musique non ajustée'), detail: r.error };
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        if (refresh) refresh();
        const removed = f.removed ? _T('Passage de ') + mmss(f.a) + _T(' à ') + mmss(f.b) + _T(' retiré, sur un temps fort') : _T('Pas de temps forts nets : coupe à la fin de la vidéo');
        return {
          kind: r.refused ? 'warn' : 'ok', saved: 15,
          title: _T('Musique ajustée · ') + mmss(m.end - m.start) + ' → ' + mmss(r.end - m.start),
          detail: removed + (f.trim ? _T(', fin coupée à ') + mmss(f.trim) : _T(' : la vraie fin du morceau tombe avec la vidéo')) + '.' + (x.keep ? _T(' Version d\'avant gardée (chutier Versions).') : _T(' Ctrl+Z dans Premiere pour revenir.'))
        };
      });
    }

    app.extras.music.push({
      id: 'duree', title: _T('Musique à la durée de la vidéo'), nav: _T('Durée'),
      render: () => {
        const x = st(), info = h('div', { class: 'note' });
        const look = h('button', { class: 'action' }, _T('Comparer les durées'));
        look.addEventListener('click', async () => {
          try {
            const p = await plan(), d = p.music.end - p.videoEnd;
            info.textContent = _T('Musique : ') + mmss(p.music.end - p.music.start) + _T(' · vidéo : ') + mmss(p.videoEnd) + (d > 0.05 ? _T(' · ') + mmss(d) + _T(' à retirer.') : d < -0.05 ? _T(' · musique trop courte.') : _T(' · déjà à la bonne durée.'));
          } catch (e) { info.textContent = app.errorMessage(e); }
        });
        const go = h('button', { class: 'action go' }, _T('Ajuster la musique'));
        go.addEventListener('click', () => fit(() => look.click()));
        return [
          h('div', { class: 'note' }, _T('Ta musique est plus longue que ta vidéo ? RR FX retire un passage au milieu, entre deux temps forts (des mesures entières si possible) : le morceau garde son intro et sa vraie fin, qui tombe avec la dernière image.')),
          checkbox(_T('Garder une version de la séquence avant'), x.keep, v => { x.keep = v; app.persist(); }),
          h('div', { class: 'row-buttons' }, go, look), info
        ];
      }
    });
    app.actions.fitMusic = () => fit();
  });
})(typeof self !== 'undefined' ? self : this);
