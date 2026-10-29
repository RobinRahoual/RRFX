/* RR FX : suivi pour les zooms « visage » et « objet », et pour la copie 9:16 qui suit le
   visage. Pour chaque plan visé, quelques images propres de la timeline (sans looks ni titres)
   sont exportées ; le visage y est cherché (faces.js), ou l'objet que tu as entouré y est
   retrouvé (tracker.js), puis la position est suivie et lissée sur toute la durée du plan. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const F = root.RRFXFaces, Tr = root.RRFXTracker, { h } = app.UI, TICKS = 254016000000;
    const FOLLOW = { smooth: { smooth: 0.6 }, tight: { smooth: 0.15 }, fixed: { fixed: true } };
    const pause = () => new Promise(res => setTimeout(res, 0));

    /* Détection YuNet (yunet.js) dans un Worker : le panneau reste fluide pendant l'analyse. Le
       Worker est fabriqué à partir du code du moteur (rien à charger) ; s'il ne démarre pas, le
       calcul se fait ici, et si YuNet échoue, la détection classique (Viola-Jones) prend le relais. */
    const Y = root.RRFXYuNet, YM = root.RRFXYuNetModel;
    let worker = null, seq = 0, yunetOk = !!(Y && YM);
    const waiting = new Map();
    function yunetWorker() {
      if (worker !== null) return worker;
      worker = false;
      try {
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !yunetOk) return worker;
        const src = 'const Y = (' + Y.factory.toString() + ')();\nlet model = null;\n' +
          'onmessage = e => { const d = e.data; if (d.model) { model = d.model; return; }\n' +
          '  try { postMessage({ id: d.id, faces: Y.detect(model, d.data, d.w, d.h) }); } catch (err) { postMessage({ id: d.id, error: String((err && err.message) || err) }); } };';
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = e => { const p = waiting.get(e.data.id); if (!p) return; waiting.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.faces); };
        w.onerror = e => { waiting.forEach(p => p.reject(new Error((e && e.message) || 'Worker'))); waiting.clear(); worker = false; };
        w.postMessage({ model: YM });
        worker = w;
      } catch (e) { worker = false; }
      return worker;
    }
    function yunetFaces(img) {
      const w = yunetWorker();
      if (!w) return Promise.resolve(Y.detect(YM, img.data, img.width, img.height));
      return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        // Pas de réponse en 10 s : le Worker est bloqué, on calcule ici.
        setTimeout(() => { if (waiting.delete(id)) { worker = false; resolve(Y.detect(YM, img.data, img.width, img.height)); } }, 10000);
        w.postMessage({ id, data: img.data, w: img.width, h: img.height });
      });
    }
    async function findEyes(img, prev) {
      if (yunetOk) {
        try { return F.pickFace(await yunetFaces(img), img.width, img.height, prev); } catch (e) {
          yunetOk = false;
          app.log(_T('Détection précise des visages indisponible (') + app.errorMessage(e) + _T(') : détection classique.'), 'warn');
        }
      }
      return F.eyesIn(img, prev);
    }
    app.services.findEyes = findEyes;

    // Yeux trouvés dans les images d'un plan (le visage précédent guide la recherche).
    async function eyesAlong(frames, from, count, onStep) {
      let prev = null;
      const out = [];
      for (let j = 0; j < count; j++) {
        if (onStep) onStep();
        const eyes = await findEyes(frames[from + j], prev);
        if (eyes) prev = eyes;
        out.push(eyes);
        await pause(); // le panneau reste réactif pendant l'analyse
      }
      return out;
    }

    /* targets : zones de resolve (start, end en ticks, frames). follow : smooth | tight | fixed.
       → { faces: [[[x, y], …] | null] (une valeur par image de chaque zone) } */
    async function trackFaces(targets, follow) {
      const plan = F.sampling(targets.map(t => ({ a: t.start / TICKS, b: t.end / TICKS })), { every: 0.6, max: 16, budget: 80 });
      const times = [].concat(...plan.map(p => p.times));
      const frames = await app.services.grabClean(times, 3, 320, p => app.status.progress(Math.round(p * times.length), times.length, _T('Images des plans')));
      const faces = [];
      let k = 0, done = 0;
      for (let i = 0; i < targets.length; i++) {
        const eyes = await eyesAlong(frames, k, plan[i].at.length, () => app.status.progress(done++, times.length, _T('Recherche du visage')));
        k += plan[i].at.length;
        faces.push(F.track(plan[i].at.map((at, j) => ({ at, eyes: eyes[j] })), targets[i].frames, FOLLOW[follow] || FOLLOW.smooth));
      }
      return { faces };
    }

    // ---------------------------------------------------------------- objet entouré

    // Fenêtre : la première image du plan, on y trace un rectangle autour de l'objet.
    function pickBox(img) {
      const cv = h('canvas', { width: img.width, height: img.height, class: 'trk-canvas' }), g = cv.getContext('2d');
      let box = { x: 0.35, y: 0.3, w: 0.3, h: 0.4 }, drag = null;
      const draw = () => {
        g.putImageData(img, 0, 0);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, 0, img.width, img.height);
        const x = box.x * img.width, y = box.y * img.height, w = box.w * img.width, hh = box.h * img.height;
        g.putImageData(img, 0, 0, x, y, w, hh);
        g.strokeStyle = '#2680eb'; g.lineWidth = 2; g.strokeRect(x, y, w, hh);
      };
      const at = e => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
      const up = () => { drag = null; };
      cv.addEventListener('mousedown', e => { drag = at(e); });
      cv.addEventListener('mousemove', e => {
        if (!drag) return;
        const p = at(e);
        box = { x: Math.min(drag[0], p[0]), y: Math.min(drag[1], p[1]), w: Math.max(0.03, Math.abs(p[0] - drag[0])), h: Math.max(0.03, Math.abs(p[1] - drag[1])) };
        draw();
      });
      window.addEventListener('mouseup', up);
      draw();
      return app.modal(_T('Entoure l\'objet à suivre'), h('div', null, cv, h('div', { class: 'note' }, _T('Trace un rectangle autour du produit, du logo ou de la personne : RR FX le suit dans tout le plan.'))), [
        { label: _T('Annuler'), value: null },
        { label: _T('Suivre cet objet'), primary: true, value: () => box }
      ]).then(v => { window.removeEventListener('mouseup', up); return v; });
    }

    /* Comme trackFaces, pour l'objet entouré sur la première image du premier plan. */
    async function trackObject(targets, follow) {
      const plan = F.sampling(targets.map(t => ({ a: t.start / TICKS, b: t.end / TICKS })), { every: 0.3, max: 40, budget: 90 });
      const times = [].concat(...plan.map(p => p.times));
      const frames = await app.services.grabClean(times, 3, 320, p => app.status.progress(Math.round(p * times.length), times.length, _T('Images des plans')));
      const box = await pickBox(frames[0]);
      if (!box) throw new Error(_T('Aucun objet choisi.'));
      const gray = frames.map(f => ({ g: F.luma(f.data, f.width, f.height), w: f.width, h: f.height }));
      const faces = [];
      let k = 0, lost = 0;
      for (let i = 0; i < targets.length; i++) {
        app.status.progress(i, targets.length, _T('Suivi de l\'objet'));
        const n = plan[i].at.length, pts = Tr.track(gray.slice(k, k + n), box);
        k += n;
        lost += pts.filter(p => p.score < 0.5).length;
        faces.push(F.track(plan[i].at.map((at, j) => ({ at, eyes: pts[j].score >= 0.5 ? pts[j] : null })), targets[i].frames, FOLLOW[follow] || FOLLOW.smooth));
        await pause();
      }
      if (lost) app.log(_T('Objet perdu de vue sur ') + lost + _T(' image(s) : la dernière position connue est gardée.'), 'warn');
      return { faces };
    }

    // ---------------------------------------------------------------- copie 9:16 qui suit le visage

    /* Visage de chaque rush de la séquence → [{ track, start (ticks), keys: [[s, x, y]] }] pour
       formatCopy (mode face). */
    async function faceKeysForSequence() {
      const list = await app.Host.call('rushList', { scope: 'sequence' });
      if (!list.ok) throw new Error(list.error);
      const clips = list.clips.filter(c => !c.copy);
      if (!clips.length) throw new Error(_T('Aucun rush dans la séquence.'));
      const fps = list.fps || app.fps();
      const plan = F.sampling(clips.map(c => ({ a: c.start / TICKS, b: c.end / TICKS })), { every: 0.6, max: 14, budget: 80 });
      const times = [].concat(...plan.map(p => p.times));
      const frames = await app.services.grabClean(times, 3, 320, p => app.status.progress(Math.round(p * times.length), times.length, _T('Images des plans')));
      const out = [];
      let k = 0, found = 0, done = 0;
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i], N = Math.max(2, Math.round((c.end - c.start) / TICKS * fps));
        const eyes = await eyesAlong(frames, k, plan[i].at.length, () => app.status.progress(done++, times.length, _T('Recherche du visage')));
        k += plan[i].at.length;
        const series = F.track(plan[i].at.map((at, j) => ({ at, eyes: eyes[j] })), N, FOLLOW.smooth);
        if (!series) continue;
        found++;
        // Une clé toutes les demi-secondes environ (Premiere relie en ligne droite).
        const every = Math.max(1, Math.round(fps / 2)), keys = [];
        for (let f = 0; f < N; f += every) keys.push([f / fps, series[f][0], series[f][1]]);
        if ((N - 1) % every) keys.push([(N - 1) / fps, series[N - 1][0], series[N - 1][1]]);
        out.push({ track: c.track, start: c.start, keys });
      }
      return { faces: out, found, total: clips.length };
    }

    app.services.trackFaces = trackFaces;
    app.services.trackObject = trackObject;
    app.services.faceKeysForSequence = faceKeysForSequence;
  });
})(typeof self !== 'undefined' ? self : this);
