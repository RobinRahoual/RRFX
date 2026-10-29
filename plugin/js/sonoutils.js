/* RR FX : outils son.
   - Onglet Musique : un riser qui monte jusqu'à chaque drop (avec un impact dessus en option),
     et une queue de réverb pour finir la musique en douceur au lieu d'une coupe sèche.
   - Onglet Parole : respirations et petits clics de bouche baissés dans la voix (images clés de
     volume, modifiables et annulables), sans rien couper. */
(function (root) {
  'use strict';

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const SP = root.RRFXSonPlus, Sons = root.RRFXSons, { Host, Store } = app;
    const { h, hotText, actionGroup, picker, row, checkbox } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.sonPlus || typeof s.sonPlus !== 'object') s.sonPlus = {};
      const d = { riser: 'riser', impact: true, riserVol: -4, tailWhere: 'end', tailLen: 3, tailSize: 0.85, breaths: true, clicks: true, depth: 12 };
      Object.keys(d).forEach(k => { if (!(k in s.sonPlus)) s.sonPlus[k] = d[k]; });
      return s.sonPlus;
    };
    const fmt = t => { const m = Math.floor(t / 60); return m + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };

    // ---------------------------------------------------------------- risers

    async function findDrops() {
      const md = app.musicData;
      await md.ensure(false);
      const M = md.M, z = await md.zone();
      let beats = null;
      try { beats = (await md.beatTimes()).map(t => md.seqToFile(M.info, t) - M.t0); } catch (e) { beats = null; }
      return SP.drops(M.loud.values, M.loud.rate, { beats })
        .map(d => ({ t: md.fileToSeq(M.info, d.t + M.t0), strength: d.strength }))
        .filter(d => d.t >= z.from && d.t <= z.to);
    }

    function risers() {
      const x = st();
      return app.runTask('Risers avant les drops', async () => {
        app.status.phase('Écoute de la musique');
        const drops = await findDrops();
        if (!drops.length) return { kind: 'warn', title: 'Aucun drop trouvé', detail: 'Pas de passage calme suivi d\'un passage fort dans la musique (ou dans la zone des temps forts).' };
        const snd = Sons.byId(x.riser), created = [];
        app.status.phase('Pose des sons');
        const r = await Host.call('placeAsset', { kind: 'audio', path: app.services.ensureSound(snd.id), name: snd.name, times: drops.map(d => Math.max(0, d.t - snd.peak)), gain: x.riserVol });
        if (!r.ok) return { kind: 'error', title: 'Risers non posés', detail: r.error };
        created.push(...r.created);
        if (x.impact) {
          const imp = await Host.call('placeAsset', { kind: 'audio', path: app.services.ensureSound('impact'), name: 'Impact', times: drops.map(d => d.t), gain: x.riserVol });
          if (imp.ok) created.push(...imp.created); else app.log('Impacts : ' + imp.error, 'warn');
        }
        if (created.length) app.pushHistory({ date: Date.now(), label: 'Risers × ' + drops.length, entries: created });
        (r.warnings || []).forEach(w => app.log(w, 'warn'));
        return { kind: 'ok', title: app.plural(drops.length, 'riser posé', 'risers posés'), detail: 'Drops à ' + drops.map(d => fmt(d.t)).join(', ') + ' · le son monte jusqu\'au drop' + (x.impact ? ', impact dessus' : '') + ', sur une piste audio libre.' };
      }, true);
    }

    // ---------------------------------------------------------------- réverb de fin

    function reverbTail() {
      const x = st();
      return app.runTask('Réverb de fin', async () => {
        const md = app.musicData;
        app.status.phase('Écoute de la musique');
        await md.ensure(false);
        const M = md.M, info = M.info;
        let cut = info.end;
        if (x.tailWhere === 'playhead') {
          const m = await Host.call('markerList', {});
          cut = m.ok ? m.playhead : cut;
          if (!info.manual && (cut <= info.start + 0.5 || cut > info.end + 0.05)) return { kind: 'error', title: 'Tête de lecture hors de la musique', detail: 'Place la tête de lecture sur la musique, là où elle doit s\'arrêter.' };
        }
        // Jamais au-delà de la fin du fichier (clip plus long que sa musique, fichier choisi à la main).
        let fileT = info.manual ? cut - info.start : md.seqToFile(info, cut);
        if (M.manual && M.duration && fileT > M.duration) { fileT = M.duration; cut = info.manual ? info.start + fileT : md.fileToSeq(info, fileT); }
        app.status.phase('Fabrication de la réverb');
        const a = await app.services.readAudio(M.manual || info.path, Math.max(0, fileT - 1.5), fileT);
        if (!a.samples.length) return { kind: 'error', title: 'Fin de musique illisible', detail: 'Aucun son lu juste avant ' + fmt(cut) + '.' };
        const tail = SP.resample(SP.reverbTail(a.samples, a.sampleRate, { length: x.tailLen, size: x.tailSize }), a.sampleRate, 48000);
        const w = Sons.wav(tail, 48000);
        let file = 'RRFX Réverb de fin.wav';
        if (Store.fs) {
          const dir = Store.path.join(Store.dir, 'Sons');
          Store.fs.mkdirSync(dir, { recursive: true });
          file = Store.path.join(dir, 'RRFX Réverb de fin ' + Date.now().toString(36) + '.wav');
          Store.fs.writeFileSync(file, Buffer.from(w.buffer, w.byteOffset, w.byteLength));
        }
        const r = await Host.call('placeAsset', { kind: 'audio', path: file, name: 'Réverb de fin', times: [cut] });
        if (!r.ok) return { kind: 'error', title: 'Réverb non posée', detail: r.error };
        app.pushHistory({ date: Date.now(), label: 'Réverb de fin', entries: r.created });
        return { kind: 'ok', title: 'Réverb de fin posée à ' + fmt(cut), detail: x.tailLen + ' s de résonance à partir de la coupe, sur une piste audio libre.' + (x.tailWhere === 'playhead' ? ' Coupe la musique à la tête de lecture : la réverb prend le relais.' : '') };
      }, true);
    }

    // ---------------------------------------------------------------- respirations et clics

    async function scanVoice() {
      const x = st(), clips = await app.speech.clips(), out = [];
      for (let i = 0; i < clips.length; i++) {
        if (app.S.cancel) break;
        const c = clips[i];
        app.status.progress(i, clips.length, 'Écoute de ' + c.name);
        const a = await app.speech.readClip(c);
        if (!a) continue;
        const ranges = [];
        let nb = 0, nc = 0;
        if (x.breaths) { const b = SP.breaths(a.samples, a.sr).ranges; nb = b.length; ranges.push(...b); }
        if (x.clicks) { const k = SP.clicks(a.samples, a.sr); nc = k.length; k.forEach(t => ranges.push({ a: t - 0.006, b: t + 0.014 })); }
        const seq = ranges.map(r => ({ a: a.toSeq(r.a), b: a.toSeq(r.b) })).filter(r => r.a >= c.start && r.b <= c.end);
        out.push({ clip: c, ranges: seq, breaths: nb, clicks: nc });
      }
      return out;
    }

    function cleanVoice() {
      const x = st();
      return app.runTask('Respirations et clics', async () => {
        if (!x.breaths && !x.clicks) return { kind: 'warn', title: 'Rien à chercher', detail: 'Coche les respirations, les clics, ou les deux.' };
        app.status.phase('Écoute de la voix');
        const found = await scanVoice();
        const nb = found.reduce((s, f) => s + f.breaths, 0), nc = found.reduce((s, f) => s + f.clicks, 0);
        if (!found.some(f => f.ranges.length)) return { kind: 'warn', title: 'Rien à baisser', detail: 'Aucune respiration ni clic net trouvé dans les plans sélectionnés.' };
        app.status.phase('Volume de la voix');
        const created = [], warnings = [];
        for (const f of found) {
          if (!f.ranges.length) continue;
          const r = await Host.call('gainKeys', { track: f.clip.track, start: f.clip.start, keys: SP.duckKeys(f.ranges, x.depth, 0.03), label: f.clip.name });
          if (r.ok) { created.push(...r.created); warnings.push(...(r.warnings || [])); } else warnings.push(r.error);
        }
        warnings.forEach(w => app.log(w, 'warn'));
        if (created.length) app.pushHistory({ date: Date.now(), label: 'Respirations et clics', entries: created });
        const what = [x.breaths ? app.plural(nb, 'respiration') : '', x.clicks ? app.plural(nc, 'clic') : ''].filter(Boolean).join(' et ');
        return { kind: warnings.length ? 'warn' : 'ok', title: what + ' baissé' + (nb + nc > 1 ? 's' : ''), detail: '-' + x.depth + ' dB par images clés de volume sur ' + app.plural(created.length, 'plan') + ' : rien n\'est coupé, tout reste modifiable. ↶ Annuler remet le volume d\'avant.' };
      }, true);
    }

    // ---------------------------------------------------------------- sections

    app.extras.music.push({
      id: 'risers', title: 'Risers avant les drops', nav: 'Risers',
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, 'Poser les risers');
        go.addEventListener('click', risers);
        const scan = h('button', { class: 'action' }, 'Trouver les drops');
        const out = h('div', { class: 'note' });
        scan.addEventListener('click', () => app.runTask('Drops', async () => {
          const d = await findDrops();
          out.textContent = d.length ? 'Drops à ' + d.map(q => fmt(q.t)).join(', ') + '.' : 'Aucun drop net dans cette musique.';
          return { kind: d.length ? 'ok' : 'warn', title: app.plural(d.length, 'drop trouvé', 'drops trouvés'), detail: out.textContent };
        }));
        return [
          h('div', { class: 'note' }, 'Un son qui monte et arrive pile sur chaque drop de la musique (passage calme puis fort d\'un coup), calé sur le temps fort le plus proche.'),
          row('Son', picker([{ v: 'riser', label: 'Riser (2,4 s)' }, { v: 'riser-long', label: 'Riser long (4 s)' }], x.riser, v => { x.riser = v; app.persist(); })),
          checkbox('Impact sur le drop', x.impact, v => { x.impact = v; app.persist(); }),
          row('Volume', hotText({ value: x.riserVol, min: -24, max: 6, step: 1, unit: 'dB', onChange: v => { x.riserVol = v; app.persist(); } })),
          h('div', { class: 'row-buttons' }, go, scan), out
        ];
      }
    });
    app.extras.music.push({
      id: 'tail', title: 'Réverb de fin', nav: 'Réverb',
      render: () => {
        const x = st(), go = h('button', { class: 'action go' }, 'Poser la réverb de fin');
        go.addEventListener('click', reverbTail);
        return [
          h('div', { class: 'note' }, 'La dernière note résonne au lieu de s\'arrêter net : RR FX fabrique la queue de réverb de ta musique et la pose juste après la coupe.'),
          row('Où', actionGroup([{ v: 'end', label: 'Fin de la musique' }, { v: 'playhead', label: 'Tête de lecture' }], x.tailWhere, v => { x.tailWhere = v; app.persist(); })),
          row('Durée', hotText({ value: x.tailLen, min: 1, max: 8, step: 0.5, unit: 's', onChange: v => { x.tailLen = v; app.persist(); } })),
          row('Salle', actionGroup([{ v: 0.6, label: 'Petite' }, { v: 0.85, label: 'Grande' }, { v: 0.97, label: 'Cathédrale' }], x.tailSize, v => { x.tailSize = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });
    app.extras.speech.push({
      id: 'souffle', title: 'Respirations et clics', nav: 'Souffle', tool: ['Atténuer respirations et clics', cleanVoice],
      render: use => {
        const x = st(), go = h('button', { class: 'action go' }, 'Atténuer');
        go.addEventListener('click', use('souffle', cleanVoice));
        return [
          h('div', { class: 'note' }, 'Les respirations entre deux phrases et les petits clics de bouche sont baissés dans les plans sélectionnés, sans rien couper (images clés de volume).'),
          h('div', { class: 'row-buttons wrap' },
            checkbox('Respirations', x.breaths, v => { x.breaths = v; app.persist(); }),
            checkbox('Clics de bouche', x.clicks, v => { x.clicks = v; app.persist(); })),
          row('Baisser de', actionGroup([{ v: 6, label: '-6 dB' }, { v: 12, label: '-12 dB' }, { v: 20, label: '-20 dB' }, { v: 60, label: 'Muet' }], x.depth, v => { x.depth = v; app.persist(); })),
          h('div', { class: 'row-buttons' }, go)
        ];
      }
    });
    app.actions.risers = risers;
    app.actions.reverbTail = reverbTail;
    app.actions.breaths = cleanVoice;
  });
})(typeof self !== 'undefined' ? self : this);
