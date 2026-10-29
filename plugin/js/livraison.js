/* RR FX : montage et livraison.
   - Rythme du montage (Formats) : la durée de chaque plan, les passages trop lents, des marqueurs
     sur les plans longs.
   - Export en lot (Formats) : les séquences cochées partent dans Media Encoder, un fichier
     chacune, nommé tout seul (« Client_Projet_9x16_v03 »).
   - Archiver le projet (Ressources) : un dossier avec seulement les médias utilisés, une copie
     du projet et un récapitulatif.
   - Crédits musique et sons (Musique) : les musiques et SFX de la séquence, à envoyer. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const O = root.RRFXOutils, { Host, Store } = app, TICKS = 254016000000;
    const { h, hotText, picker, row, checkbox } = app.UI;
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const seek = t => Host.call('setPlayhead', { t });
    const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

    const st = () => {
      const s = app.settings();
      if (!s.livraison || typeof s.livraison !== 'object') s.livraison = {};
      const d = { maxShot: 6, pattern: '{client}_{sequence}_{format}_v{vv}', client: '', version: 1, preset: '', dir: '', picked: [], archiveDir: '', batch: 'export' };
      Object.keys(d).forEach(k => { if (!(k in s.livraison)) s.livraison[k] = JSON.parse(JSON.stringify(d[k])); });
      return s.livraison;
    };

    // ---------------------------------------------------------------- rythme du montage

    let lastRhythm = null;
    async function analyseRhythm() {
      const x = st(), r = await Host.call('rushList', { scope: 'sequence', rhythm: true });
      if (!r.ok) throw new Error(r.error);
      // Les plans de la piste la plus basse qui en a (le montage principal), en secondes.
      const low = Math.min(...r.clips.map(c => c.track));
      const clips = r.clips.filter(c => c.track === low).map(c => ({ start: c.start / TICKS, end: c.end / TICKS, name: c.name }));
      lastRhythm = O.rhythm(clips, x.maxShot);
      return lastRhythm;
    }
    function rhythmTask(redraw) {
      return app.runTask(_T('Rythme du montage'), async () => {
        const r = await analyseRhythm();
        if (redraw) redraw();
        if (!r.count) return { kind: 'warn', title: _T('Aucun plan'), detail: _T('Monte d\'abord tes plans sur une piste vidéo.') };
        return { kind: r.long.length ? 'warn' : 'ok', title: app.plural(r.count, _T('plan')) + _T(' · moyenne ') + r.avg.toFixed(1).replace('.', ',') + ' s', detail: r.long.length ? app.plural(r.long.length, _T('plan de plus de '), _T('plans de plus de ')) + r.max.toFixed(0) + ' s : ' + r.long.slice(0, 4).map(l => mmss(l.start)).join(', ') + (r.long.length > 4 ? '…' : '') + '.' : _T('Aucun plan trop long : le rythme tient.') };
      });
    }
    function markLong() {
      return app.runTask(_T('Marqueurs des plans longs'), async () => {
        const r = lastRhythm || await analyseRhythm();
        if (!r.long.length) return { kind: 'ok', title: _T('Aucun plan trop long'), detail: _T('Rien à marquer.') };
        const m = await Host.call('addMarkers', { times: r.long.map(l => l.start), name: _T('RR FX · plan long'), color: 3 });
        if (!m.ok) return { kind: 'error', title: _T('Marqueurs non posés'), detail: m.error };
        return { kind: 'ok', title: app.plural(r.long.length, _T('plan long marqué'), _T('plans longs marqués')), detail: _T('Coupe-les, ou pose un plan de coupe (Parole > Plans de coupe) pour relancer le rythme.') };
      });
    }
    function drawRhythm(cv, r) {
      const W = cv.width = cv.clientWidth * 2 || 600, H = cv.height = 120, g = cv.getContext('2d');
      g.clearRect(0, 0, W, H);
      if (!r || !r.count) return;
      const maxLen = Math.max(r.max * 1.5, r.longest), span = r.shots[r.shots.length - 1].start + r.shots[r.shots.length - 1].len - r.shots[0].start;
      const css = getComputedStyle(document.body);
      r.shots.forEach(s => {
        const x = (s.start - r.shots[0].start) / span * W, w = Math.max(1, s.len / span * W - 1), hh = Math.min(1, s.len / maxLen) * (H - 6);
        g.fillStyle = s.len > r.max ? css.getPropertyValue('--warn') || '#e3a33b' : css.getPropertyValue('--accent') || '#4b9cf5';
        g.fillRect(x, H - hh, w, hh);
      });
      const y = H - Math.min(1, r.max / maxLen) * (H - 6);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    app.extras.formats.push({
      id: 'rythme', title: _T('Rythme du montage'), nav: _T('Rythme'),
      render: () => {
        const x = st(), cv = h('canvas', { class: 'rhythm-chart', 'aria-label': _T('Durée de chaque plan') }), info = h('div', { class: 'pf-list' });
        const redraw = () => {
          drawRhythm(cv, lastRhythm);
          info.innerHTML = '';
          if (!lastRhythm || !lastRhythm.count) return;
          const r = lastRhythm;
          info.appendChild(h('div', { class: 'note' }, app.plural(r.count, _T('plan')) + _T(' · moyenne ') + r.avg.toFixed(1).replace('.', ',') + _T(' s · médiane ') + r.median.toFixed(1).replace('.', ',') + _T(' s · le plus long ') + r.longest.toFixed(1).replace('.', ',') + ' s'));
          r.long.slice(0, 20).forEach(l => {
            const b = h('button', { class: 'pf-item warn' }, h('span', { class: 'pf-icon' }, '!'), h('span', { class: 'pf-time' }, mmss(l.start)), h('span', { class: 'pf-text' }, l.len.toFixed(1).replace('.', ',') + ' s · ' + (l.name || '')));
            b.addEventListener('click', () => seek(l.start));
            info.appendChild(b);
          });
        };
        const go = h('button', { class: 'action go' }, _T('Analyser le rythme'));
        go.addEventListener('click', () => rhythmTask(redraw));
        const mark = h('button', { class: 'action' }, _T('Marquer les plans longs'));
        mark.addEventListener('click', markLong);
        setTimeout(redraw, 0);
        return [
          h('div', { class: 'note' }, _T('La durée de chaque plan sur toute la vidéo : les barres orange sont les plans trop longs, là où l\'attention décroche. Pour les réseaux, vise 2 à 4 s par plan.')),
          row(_T('Plan long dès'), hotText({ value: x.maxShot, min: 1, max: 30, step: 0.5, unit: 's', onChange: v => { x.maxShot = v; app.persist(); if (lastRhythm) { lastRhythm = null; } } })),
          h('div', { class: 'row-buttons' }, go, mark), cv, info
        ];
      }
    });

    // ---------------------------------------------------------------- export en lot

    let seqs = null, presets = null;
    async function loadSeqs(redraw) {
      const [l, p] = await Promise.all([Host.call('listSequences', {}), presets ? Promise.resolve({ ok: true, presets }) : Host.call('exportPresets', {})]);
      seqs = l.ok ? l.sequences : [];
      presets = p.ok ? p.presets : [];
      const x = st();
      if (!x.preset && presets.length) x.preset = (presets.find(q => /match source.*high/i.test(q.name)) || presets.find(q => /h\.?264|youtube/i.test(q.name)) || presets[0]).path;
      if (redraw) redraw();
    }
    const projectName = () => (app.S.ctx && app.S.ctx.project) || '';
    function names() {
      const x = st();
      // Deux séquences du même nom ne s'écrasent pas : la seconde prend « _2 ».
      const seen = {};
      return (seqs || []).filter(q => x.picked.indexOf(q.id) >= 0).map(q => {
        let file = O.exportName(x.pattern, { client: x.client, projet: projectName(), sequence: q.name, w: q.w, h: q.h, version: x.version });
        const k = file.toLowerCase();
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] > 1) file += '_' + seen[k];
        return { id: q.id, file };
      });
    }
    function exportBatch(redraw) {
      const x = st();
      return app.runTask(_T('Export en lot'), async () => {
        const items = names();
        if (!items.length) return { kind: 'warn', title: _T('Aucune séquence cochée'), detail: _T('Coche les séquences à exporter.') };
        if (!x.preset) return { kind: 'error', title: _T('Préréglage manquant'), detail: _T('Choisis un préréglage d\'export (fichier .epr).') };
        const dir = x.dir || (Store.path ? Store.path.join(Store.dir || '', 'Exports') : '/RRFX/Exports');
        const r = await Host.call('exportQueue', { items, preset: x.preset, dir });
        if (!r.ok) return { kind: 'error', title: _T('Export non lancé'), detail: r.error };
        (r.failed || []).forEach(f => app.log(_T('Export refusé : ') + f, 'warn'));
        if (r.queued.length) { x.version = (Number(x.version) || 1) + 1; app.persist(); if (redraw) redraw(); }
        return { kind: r.failed && r.failed.length ? 'warn' : 'ok', title: app.plural(r.queued.length, _T('export en file'), _T('exports en file')) + _T(' dans Media Encoder'), detail: r.queued.slice(0, 3).map(q => q.file).join(', ') + (r.queued.length > 3 ? '…' : '') + _T(' · dossier : ') + dir + _T('. Le numéro de version passe à v') + String(x.version).padStart(2, '0') + _T(' pour le prochain export.') };
      });
    }
    /* Plusieurs séquences : les exporter (Media Encoder, noms propres) ou leur appliquer la même
       action (look, conversion LOG, copie au format, vérification, temps forts : formatsplus.js). */
    app.extras.formats.push({
      id: 'export', title: _T('Plusieurs séquences : export et lot'), nav: _T('Export'), shut: true,
      render: () => {
        const x = st(), box = h('div');
        const draw = () => {
          box.innerHTML = '';
          const exporting = x.batch === 'export' || !app.batch;
          const preview = h('div', { class: 'note' });
          const previewText = () => { const n = names(); return n.length ? '→ ' + n.slice(0, 3).map(q => q.file).join(', ') + (n.length > 3 ? '…' : '') : _T('{client} {projet} {sequence} {format} {date} {vv} dans le nom.'); };
          box.appendChild(h('div', { class: 'note' }, _T('Coche les séquences, puis exporte-les toutes dans Media Encoder avec des noms propres, ou applique-leur la même action, l\'une après l\'autre. Chaque opération reste annulable dans l\'historique 🕘.')));
          const actions = [{ v: 'export', label: _T('Les exporter dans Media Encoder') }].concat(app.batch ? app.batch.BATCH.map(b => ({ v: b.id, label: b.label })) : []);
          box.appendChild(row(_T('Action'), picker(actions, x.batch, v => { x.batch = v; app.persist(); draw(); })));
          if (!seqs) { box.appendChild(h('div', { class: 'note' }, _T('Clique sur « Lister les séquences ».'))); }
          else {
            const list = h('div', { class: 'seq-list' });
            seqs.forEach(q => list.appendChild(checkbox(q.name + ' · ' + q.w + '×' + q.h + ' · ' + mmss(q.end), x.picked.indexOf(q.id) >= 0, v => {
              const i = x.picked.indexOf(q.id);
              if (v && i < 0) x.picked.push(q.id); else if (!v && i >= 0) x.picked.splice(i, 1);
              app.persist(); preview.textContent = previewText();
            })));
            box.appendChild(list);
          }
          const load = h('button', { class: 'action' }, _T('Lister les séquences'));
          load.addEventListener('click', () => loadSeqs(draw));
          if (!exporting) {
            const run = h('button', { class: 'action go' }, _T('Lancer sur les séquences cochées'));
            run.addEventListener('click', () => app.batch.run((seqs || []).filter(q => x.picked.indexOf(q.id) >= 0), x.batch));
            box.appendChild(h('div', { class: 'row-buttons wrap' }, run, load));
            return;
          }
          if (seqs) {
            const opts = (presets || []).map(p => ({ v: p.path, label: p.name }));
            if (x.preset && !opts.some(o => o.v === x.preset)) opts.unshift({ v: x.preset, label: base(x.preset).replace(/\.epr$/i, '') });
            if (opts.length) box.appendChild(row(_T('Préréglage'), picker(opts, x.preset, v => { x.preset = v; app.persist(); })));
          }
          const client = h('input', { class: 'textfield', value: x.client, placeholder: _T('Client (facultatif)'), 'aria-label': _T('Client') });
          client.addEventListener('input', () => { x.client = client.value.trim(); app.persist(); preview.textContent = previewText(); });
          const pat = h('input', { class: 'textfield', value: x.pattern, 'aria-label': _T('Nom des fichiers') });
          pat.addEventListener('input', () => { x.pattern = pat.value; app.persist(); preview.textContent = previewText(); });
          const ver = hotText({ value: x.version, min: 1, max: 99, step: 1, unit: '', onChange: v => { x.version = v; app.persist(); preview.textContent = previewText(); } });
          box.appendChild(row(_T('Client'), client));
          box.appendChild(row(_T('Nom'), pat));
          box.appendChild(row(_T('Version'), ver));
          preview.textContent = previewText();
          box.appendChild(preview);
          const pick = h('button', { class: 'action quiet', disabled: !Store.fs }, _T('Autre préréglage (.epr)…'));
          pick.addEventListener('click', () => { const f = Store.pickFiles(_T('Préréglage d\'export'), ['epr']); if (f && f[0]) { x.preset = f[0]; app.persist(); draw(); } });
          const dir = h('button', { class: 'action quiet', disabled: !Store.fs }, x.dir ? '📂 ' + base(x.dir) : _T('Dossier des exports…'));
          dir.addEventListener('click', () => { const d = Store.pickFiles(_T('Dossier des exports'), [], true); if (d && d[0]) { x.dir = d[0]; app.persist(); draw(); } });
          const go = h('button', { class: 'action go' }, _T('Exporter les séquences cochées'));
          go.addEventListener('click', () => exportBatch(draw));
          box.appendChild(h('div', { class: 'row-buttons wrap' }, go, load, pick, dir));
        };
        draw();
        return [box];
      }
    });

    // ---------------------------------------------------------------- archiver le projet

    function archive() {
      const x = st();
      return app.runTask(_T('Archiver le projet'), async () => {
        if (!Store.fs) return { kind: 'warn', title: _T('Disponible dans Premiere'), detail: _T('L\'archive copie des fichiers sur le disque : rien à faire en mode démo.') };
        const u = await Host.call('usedMedia', {});
        if (!u.ok) return { kind: 'error', title: _T('Archive impossible'), detail: u.error };
        const fs = Store.fs, P = Store.path;
        const name = (u.projectName || 'Projet').replace(/\.prproj$/i, ''), stamp = O.dayKey(new Date());
        const dir = P.join(x.archiveDir, name + ' - ' + _T('archive') + ' ' + stamp), media = P.join(dir, _T('Médias'));
        fs.mkdirSync(media, { recursive: true });
        let bytes = 0, copied = 0, missing = [];
        const used = new Set();
        for (let i = 0; i < u.files.length; i++) {
          if (app.S.cancel) break;
          const f = u.files[i];
          app.status.progress(i, u.files.length, base(f.path));
          if (!fs.existsSync(f.path)) { missing.push(f.path); continue; }
          // Deux fichiers du même nom (deux cartes) : le second est renommé.
          let out = P.join(media, base(f.path)), n = 2;
          while (used.has(out.toLowerCase())) { const e = P.extname(base(f.path)); out = P.join(media, base(f.path).slice(0, -e.length || undefined) + ' (' + n++ + ')' + e); }
          used.add(out.toLowerCase());
          await new Promise((resolve, reject) => fs.copyFile(f.path, out, e => (e ? reject(e) : resolve())));
          bytes += fs.statSync(out).size;
          copied++;
        }
        if (u.project && fs.existsSync(u.project)) fs.copyFileSync(u.project, P.join(dir, base(u.project)));
        const recap = [_T('Archive RR FX de « ') + name + ' » · ' + new Date().toLocaleString(), '',
          app.plural(copied, _T('média copié'), _T('médias copiés')) + ' (' + (bytes / 1e9).toFixed(2).replace('.', ',') + _T(' Go)'),
          missing.length ? app.plural(missing.length, _T('média introuvable'), _T('médias introuvables')) + ' :' : '', ...missing, '',
          _T('Dans Premiere : ouvre le projet copié ; s\'il demande les médias, montre-lui le dossier « Médias » : il retrouve tous les autres.'), '',
          _T('Médias :'), ...u.files.map(f => '- ' + f.path)].filter((l, i, a) => l !== '' || a[i - 1] !== '');
        fs.writeFileSync(P.join(dir, _T('LISEZMOI - archive.txt')), recap.join('\r\n'), 'utf8');
        return { kind: missing.length ? 'warn' : 'ok', title: _T('Projet archivé · ') + app.plural(copied, _T('média'), _T('médias')), detail: (bytes / 1e9).toFixed(2).replace('.', ',') + _T(' Go dans ') + dir + (missing.length ? ' · ' + app.plural(missing.length, _T('introuvable'), _T('introuvables')) : '') + '.' };
      }, true);
    }
    app.extras.assets.push({
      id: 'archive', title: _T('Archiver le projet'), nav: _T('Archiver'), shut: true,
      render: () => {
        const x = st();
        const go = h('button', { class: 'action go', disabled: !x.archiveDir }, _T('Archiver'));
        go.addEventListener('click', archive);
        const pick = h('button', { class: 'action', disabled: !Store.fs }, x.archiveDir ? '📂 ' + base(x.archiveDir) : _T('Dossier de l\'archive…'));
        pick.addEventListener('click', () => { const d = Store.pickFiles(_T('Dossier de l\'archive'), [], true); if (d && d[0]) { x.archiveDir = d[0]; app.persist(); app.switchTab('assets'); } });
        const look = h('button', { class: 'action quiet' }, _T('Voir la taille'));
        const out = h('div', { class: 'note' });
        look.addEventListener('click', async () => {
          const u = await Host.call('usedMedia', {});
          if (!u.ok) { out.textContent = u.error; return; }
          let bytes = 0;
          if (Store.fs) u.files.forEach(f => { try { bytes += Store.fs.statSync(f.path).size; } catch (e) { /* hors ligne */ } });
          out.textContent = app.plural(u.files.length, _T('média utilisé'), _T('médias utilisés')) + (Store.fs ? ' · ' + (bytes / 1e9).toFixed(2).replace('.', ',') + _T(' Go') : '') + (u.offline ? ' · ' + u.offline + ' ' + _T('hors ligne') : '') + '.';
        });
        return [
          h('div', { class: 'note' }, _T('Pour livrer un projet ou libérer de la place : un dossier avec seulement les médias vraiment utilisés dans tes séquences, une copie du projet et un récapitulatif. Tes fichiers d\'origine ne bougent pas.')),
          h('div', { class: 'row-buttons wrap' }, go, pick, look), out
        ];
      }
    });

    // ---------------------------------------------------------------- crédits musique et sons

    let lastCredits = null;
    function creditsText(c) {
      return [_T('Musiques et sons · « ') + c.sequence + ' »', ''].concat(c.items.map(i => '- ' + i.name + ' · ' + mmss(i.first) + ' · ' + i.uses + ' ×' + ' · ' + i.seconds.toFixed(0) + ' s · ' + i.tracks + (i.path ? ' · ' + i.path : ''))).join('\n');
    }
    app.extras.music.push({
      id: 'credits', title: _T('Crédits musique et sons'), nav: _T('Crédits'), shut: true,
      render: () => {
        const box = h('div'), list = h('div', { class: 'pf-list' });
        const draw = () => {
          list.innerHTML = '';
          if (!lastCredits) return;
          if (!lastCredits.items.length) { list.appendChild(h('div', { class: 'note' }, _T('Aucun son dans la séquence.'))); return; }
          lastCredits.items.forEach(i => {
            const b = h('button', { class: 'pf-item', title: i.path || '' }, h('span', { class: 'pf-icon' }, '♪'), h('span', { class: 'pf-time' }, mmss(i.first) + ' · ' + i.tracks), h('span', { class: 'pf-text' }, i.name + ' · ' + i.uses + ' ×' + ', ' + i.seconds.toFixed(0) + ' s'));
            b.addEventListener('click', () => seek(i.first));
            list.appendChild(b);
          });
        };
        const go = h('button', { class: 'action' }, _T('Lister les sons'));
        go.addEventListener('click', () => app.runTask(_T('Crédits musique et sons'), async () => {
          const r = await Host.call('audioCredits', {});
          if (!r.ok) return { kind: 'error', title: _T('Liste impossible'), detail: r.error };
          lastCredits = r;
          draw();
          return { kind: 'ok', title: app.plural(r.items.length, _T('fichier son'), _T('fichiers son')), detail: _T('Copie la liste pour les crédits, ou vérifie les droits de chaque musique.') };
        }));
        const copy = h('button', { class: 'action quiet' }, _T('Copier la liste'));
        copy.addEventListener('click', () => {
          if (!lastCredits) return app.status.finish('warn', _T('Liste vide'), _T('Clique d\'abord sur « Lister les sons ».'));
          const txt = creditsText(lastCredits), done = ok => app.status.finish(ok ? 'ok' : 'warn', ok ? _T('Liste copiée') : _T('Copie impossible'), ok ? _T('Colle-la dans la description ou ton mail au client.') : txt.slice(0, 200));
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); else done(false);
        });
        draw();
        box.append(h('div', { class: 'note' }, _T('Toutes les musiques et tous les sons de la séquence, avec leur fichier, leur place et leur durée : pour les crédits, une demande de licence ou un client qui veut savoir d\'où vient la musique.')), h('div', { class: 'row-buttons' }, go, copy), list);
        return [box];
      }
    });

    app.actions.rhythm = () => rhythmTask();
    app.actions.exportBatch = () => exportBatch();
    app.actions.archive = () => archive();
  });
})(typeof self !== 'undefined' ? self : this);
