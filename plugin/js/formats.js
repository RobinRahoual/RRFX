/* RR FX : onglet Formats. Une copie de la séquence au format des réseaux (9:16 Reels, TikTok,
   Shorts ; 4:5 Instagram ; 1:1 ; 16:9 YouTube) en un clic : les rushs sont recadrés par l'effet
   Recadrage automatique de Premiere (qui suit le sujet), agrandis et centrés, ou posés entiers
   sur un fond flou (le même plan agrandi et flouté, idéal pour interviews et vidéos d'entreprise). La séquence
   d'origine n'est jamais touchée. L'aperçu montre les zones cachées par l'interface des apps. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const { Host, Pv } = app;
    const { h, actionGroup, row, section, fitCanvas, css } = app.UI;

    // safe : marges masquées par l'interface de l'app (haut, droite, bas, gauche ; en part du cadre).
    const FORMATS = [
      { id: '9x16', label: '9:16', sub: 'Reels · TikTok · Shorts', w: 1080, h: 1920, safe: [0.11, 0.13, 0.2, 0.05] },
      { id: '4x5', label: '4:5', sub: 'Instagram (fil)', w: 1080, h: 1350, safe: [0, 0, 0, 0] },
      { id: '1x1', label: '1:1', sub: 'Carré', w: 1080, h: 1080, safe: [0, 0, 0, 0] },
      { id: '16x9', label: '16:9', sub: 'YouTube · horizontal', w: 1920, h: 1080, safe: [0, 0, 0, 0] }
    ];
    const REFRAME = ['Recadrage automatique', 'Auto Reframe', 'Automatisch reframen', 'Reencuadre automático', 'Reinquadratura automatica', 'Reenquadramento automático'];

    const st = () => {
      const s = app.settings();
      // Complète sans remplacer l'objet : l'interface garde une référence dessus.
      if (!s.formats || typeof s.formats !== 'object') s.formats = {};
      const d = { id: '9x16', mode: 'reframe', safe: true };
      Object.keys(d).forEach(k => { if (!(k in s.formats)) s.formats[k] = d[k]; });
      return s.formats;
    };
    const fmt = () => FORMATS.find(f => f.id === st().id) || FORMATS[0];

    // Aperçu : le plan de test recadré au format, et les zones sûres de l'app.
    function drawPreview(cv) {
      const f = fmt(), H = 300, W = Math.round(H * f.w / f.h), { g, w, h: hh } = fitCanvas(cv, H);
      g.clearRect(0, 0, w, hh);
      const fw = Math.min(w, W * (hh / H)), fh = hh, x0 = (w - fw) / 2, img = Pv.shots().A;
      g.save();
      g.beginPath(); g.rect(x0, 0, fw, fh); g.clip();
      g.fillStyle = '#000'; g.fillRect(x0, 0, fw, fh);
      const k = Math.max(fw / img.width, fh / img.height);
      if (st().mode === 'blur') {
        g.filter = 'blur(' + Math.max(4, Math.round(fw / 24)) + 'px) brightness(0.85)';
        g.drawImage(img, x0 + (fw - img.width * k) / 2, (fh - img.height * k) / 2, img.width * k, img.height * k);
        g.filter = 'none';
        const kf = Math.min(fw / img.width, fh / img.height);
        g.drawImage(img, x0 + (fw - img.width * kf) / 2, (fh - img.height * kf) / 2, img.width * kf, img.height * kf);
      } else g.drawImage(img, x0 + (fw - img.width * k) / 2, (fh - img.height * k) / 2, img.width * k, img.height * k);
      if (st().safe && f.safe.some(Boolean)) {
        const [t, r, b, l] = f.safe;
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(x0, 0, fw, fh * t); g.fillRect(x0, fh * (1 - b), fw, fh * b);
        g.fillRect(x0 + fw * (1 - r), fh * t, fw * r, fh * (1 - t - b)); g.fillRect(x0, fh * t, fw * l, fh * (1 - t - b));
        g.strokeStyle = 'rgba(255,255,255,0.75)'; g.setLineDash([4, 3]); g.lineWidth = 1;
        g.strokeRect(x0 + fw * l + 0.5, fh * t + 0.5, fw * (1 - l - r) - 1, fh * (1 - t - b) - 1);
        g.setLineDash([]);
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '600 10px ' + css('--font'); g.textAlign = 'center';
        g.fillText('Zone sûre', x0 + fw * (l + (1 - l - r) / 2), fh * t + 14);
      }
      g.restore();
      g.strokeStyle = css('--border'); g.strokeRect(x0 + 0.5, 0.5, fw - 1, fh - 1);
    }

    let view = null;
    function render(v) {
      if (v) view = v;
      if (!view || !view.isConnected) return;
      view.innerHTML = '';
      const s = st(), f = fmt();
      const cards = h('div', { class: 'fmt-cards' }, FORMATS.map(x => {
        const k = 30 / Math.max(x.w, x.h), ratio = h('span', { class: 'fmt-ratio', style: { width: Math.round(x.w * k) + 'px', height: Math.round(x.h * k) + 'px' } });
        const c = h('button', { class: 'fmt-card' + (x.id === s.id ? ' on' : ''), title: x.w + ' × ' + x.h }, h('span', { class: 'fmt-box' }, ratio), h('b', null, x.label), h('span', { class: 'fmt-sub' }, x.sub));
        c.addEventListener('click', () => { s.id = x.id; app.persist(); render(); app.renderCTA(); });
        return c;
      }));
      // Sommaire collant : le format, puis les outils de l'onglet (extraits, vérification…).
      const nav = h('div', { class: 'sec-nav', role: 'navigation', 'aria-label': 'Sections de l\'onglet Formats' });
      [['format', 'Format']].concat(app.extras.formats.map(e => [e.id, e.nav])).forEach(([k, label]) => {
        const b = h('button', { class: 'action' }, label);
        b.addEventListener('click', () => {
          const el = view.querySelector('[data-sec="' + k + '"]');
          if (!el) return;
          if (el.classList.contains('folded')) el.querySelector('.section-title').click();
          const sc = document.getElementById('scroll');
          sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - nav.offsetHeight - 4;
        });
        nav.appendChild(b);
      });
      view.appendChild(nav);
      const cv = h('canvas', { class: 'fmt-preview' });
      const formatSec = section('Format', [cards, h('div', { class: 'fmt-stage' }, cv), h('div', { class: 'note' }, f.w + ' × ' + f.h + (f.safe.some(Boolean) ? ' · le cadre pointillé évite les boutons et légendes de l\'app.' : ''))]);
      formatSec.dataset.sec = 'format';
      view.appendChild(formatSec);
      view.appendChild(section('Cadrage', [
        row('Rushs', actionGroup([{ v: 'reframe', label: 'Recadrage auto', title: 'Effet Recadrage automatique de Premiere : suit le sujet dans chaque plan' }, { v: 'face', label: 'Suivre le visage', title: 'RR FX trouve le visage dans chaque plan et le garde au centre du cadre' }, { v: 'fill', label: 'Remplir, centré' }, { v: 'blur', label: 'Fond flou', title: 'Le plan entier, net, sur le même plan agrandi et flouté' }], s.mode, v => { s.mode = v; app.persist(); render(); })),
        row('Aperçu', actionGroup([{ v: true, label: 'Zones sûres' }, { v: false, label: 'Image seule' }], s.safe, v => { s.safe = v; app.persist(); drawPreview(cv); })),
        h('div', { class: 'note' }, s.mode === 'reframe'
          ? 'Premiere analyse chaque plan en arrière-plan (barre de progression dans le panneau Effets) : le sujet reste dans le cadre. Réglable ensuite dans Options d\'effet > Recadrage automatique.'
          : s.mode === 'face' ? 'RR FX cherche le visage dans chaque rush (quelques images par plan) et anime la position pour qu\'il reste au centre du nouveau cadre, sans jamais montrer de bord. Idéal face cam, interview, podcast.'
          : s.mode === 'blur' ? 'Rien n\'est coupé : chaque plan est posé entier au centre, sur une copie de lui-même agrandie et floutée (effet Flou gaussien). Le classique des interviews, conférences et vidéos d\'entreprise en vertical.'
          : 'Chaque rush est agrandi pour remplir le cadre et centré. Recadre ensuite avec Trajectoire > Position si besoin.'),
        h('div', { class: 'note' }, 'RR FX crée une copie de ta séquence et l\'ouvre : l\'originale ne bouge pas. Les titres et calques gardent leur place : vérifie-les dans le nouveau cadre.')
      ]));
      app.renderExtras('formats', view);
      requestAnimationFrame(() => drawPreview(cv));
    }

    function makeCopy() {
      return app.runTask('Format ' + fmt().label, copyNow);
    }

    // Copie de la séquence active au format choisi (aussi pour les extraits). → résultat de tâche.
    function copyNow() {
      const f = fmt(), s = st();
      return (async () => {
        app.status.phase('Copie de la séquence');
        let names = REFRAME;
        if (s.mode === 'reframe') {
          const r = await Host.call('listEffects', { filter: 'reframe|recadr|reencuadr|reinquadr|reenquadr' });
          if (r.ok && r.names.length) names = r.names.concat(REFRAME);
        }
        let blur = ['Gaussian Blur', 'Flou gaussien'];
        if (s.mode === 'blur') {
          const r = await Host.call('listEffects', { filter: 'gaussian|gaussien|gau.' });
          if (r.ok && r.names.length) blur = r.names.concat(blur);
        }
        // Suivre le visage : analyse de la séquence d'origine avant d'en faire la copie.
        let faces = null;
        if (s.mode === 'face') {
          app.status.phase('Recherche du visage dans les plans');
          const fk = await app.services.faceKeysForSequence();
          faces = fk.faces;
          if (fk.found < fk.total) app.log('Visage introuvable dans ' + (fk.total - fk.found) + ' plan(s) : ils sont simplement centrés.', 'warn');
          app.status.phase('Copie de la séquence');
        }
        const res = await Host.call('formatCopy', { width: f.w, height: f.h, label: f.label, mode: s.mode, reframe: s.mode === 'reframe' ? names : [], blur, blurAmount: 60, faces });
        if (!res.ok) return { kind: 'error', title: 'Copie impossible', detail: res.error };
        (res.warnings || []).forEach(w => app.log(w, 'warn'));
        const how = res.reframed ? app.plural(res.reframed, 'plan recadré', 'plans recadrés') + ' automatiquement' : '';
        const fill = res.filled ? app.plural(res.filled, 'plan agrandi', 'plans agrandis') + ' et centré' + (res.filled > 1 ? 's' : '') : '';
        const faced = res.faced ? app.plural(res.faced, 'plan qui suit le visage', 'plans qui suivent le visage') : '';
        const blurred = res.blurred ? app.plural(res.blurred, 'plan posé', 'plans posés') + ' sur fond flou' : '';
        return {
          kind: res.warnings && res.warnings.length ? 'warn' : 'ok',
          title: '« ' + res.name + ' » créée (' + f.label + ')',
          detail: [how, faced || fill, blurred].filter(Boolean).join(', ') + '. ' + (res.reframed ? 'Premiere analyse les plans en arrière-plan. ' : '') + 'Vérifie les titres dans le nouveau cadre.'
        };
      })();
    }
    app.formats = { copyNow, fmt, settings: st, FORMATS };

    app.actions.formatCopy = makeCopy;
    app.tabs.formats = {
      render,
      cta: () => ({ label: 'Créer la copie ' + fmt().label + ' · ' + fmt().sub.split(' · ')[0], run: makeCopy, enabled: true }),
      leave: () => {}
    };
  });
})(typeof self !== 'undefined' ? self : this);
