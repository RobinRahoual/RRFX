/* RR FX : suivi du visage pour les zooms « visage ». Pour chaque plan visé, quelques images
   propres de la timeline (sans looks ni titres) sont exportées, le visage y est cherché
   (faces.js), puis la position des yeux est suivie et lissée sur toute la durée du plan. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const F = root.RRFXFaces, TICKS = 254016000000;
    const FOLLOW = { smooth: { smooth: 0.6 }, tight: { smooth: 0.15 }, fixed: { fixed: true } };
    const pause = () => new Promise(res => setTimeout(res, 0));

    /* targets : zones de resolve (start, end en ticks, frames). follow : smooth | tight | fixed.
       → { faces: [[[x, y], …] | null] (une valeur par image de chaque zone) } */
    async function trackFaces(targets, follow) {
      const plan = F.sampling(targets.map(t => ({ a: t.start / TICKS, b: t.end / TICKS })), { every: 0.5, max: 20, budget: 100 });
      const times = [].concat(...plan.map(p => p.times));
      const frames = await app.services.grabClean(times, 3, 320, p => app.status.progress(Math.round(p * times.length), times.length, 'Images des plans'));
      const faces = [];
      let k = 0;
      for (let i = 0; i < targets.length; i++) {
        let prev = null;
        const samples = [];
        for (const at of plan[i].at) {
          app.status.progress(k, times.length, 'Recherche du visage');
          const eyes = F.eyesIn(frames[k++], prev);
          if (eyes) prev = eyes;
          samples.push({ at, eyes });
          await pause(); // le panneau reste réactif pendant l'analyse
        }
        faces.push(F.track(samples, targets[i].frames, FOLLOW[follow] || FOLLOW.smooth));
      }
      return { faces };
    }

    app.services.trackFaces = trackFaces;
  });
})(typeof self !== 'undefined' ? self : this);
