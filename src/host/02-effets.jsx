    // ============================================================ Contexte, cibles, application des effets, capture, marqueurs, tout effacer

    // ------------------------------------------------------------ public: context

    function appVersion() {
        try { return String(app.version); } catch (e) { return ''; }
    }

    function markerTimes(s) {
        var out = [], ms, m, guard = 0;
        try { ms = s.markers; m = ms ? ms.getFirstMarker() : null; } catch (e) { return out; }
        while (m && guard++ < 10000) {
            out.push(tk(m.start));
            try { m = ms.getNextMarker(m); } catch (e2) { m = null; }
        }
        return out;
    }

    // What this Premiere offers. Required = without it nothing works.
    function compat(o) {
        var missing = [], optional = [], s = app.project ? app.project.activeSequence : null;
        try { app.enableQE(); } catch (e) {}
        if (typeof qe === 'undefined' || !qe.project) missing.push('QE (qe.project)');
        else {
            if (!qe.project.getVideoEffectByName) missing.push('qe.project.getVideoEffectByName');
            if (!qe.project.getVideoEffectList) optional.push('qe.project.getVideoEffectList');
        }
        if (typeof Time === 'undefined') missing.push('Time');
        if (s) {
            if (!s.getSelection) missing.push('Sequence.getSelection');
            if (!s.unlinkSelection) optional.push('Sequence.unlinkSelection');
            if (!s.markers) optional.push('Sequence.markers');
        }
        if (!app.getCurrentProjectViewSelection) optional.push('app.getCurrentProjectViewSelection');
        if (s && !s.importMGT) optional.push('Sequence.importMGT');
        // Outils de Premiere pilotes par RR FX (onglet Montage > Premiere).
        if (s && !s.createCaptionTrack) optional.push('Sequence.createCaptionTrack');
        if (s && !s.performSceneEditDetectionOnSelection) optional.push('Sequence.performSceneEditDetectionOnSelection');
        try { if (qe && qe.project && !qe.project.getVideoTransitionByName) optional.push('qe.project.getVideoTransitionByName'); } catch (e3) {}
        try { if (qe && qe.project && !qeSeq().exportFramePNG) optional.push('QE exportFramePNG'); } catch (e2) {}
        var appPath = '';
        try { appPath = String(app.path || ''); } catch (e3) {}
        return ok({ version: VERSION, app: appVersion(), appPath: appPath, missing: missing, optional: optional });
    }

    function getContext(o) {
        var s = app.project.activeSequence;
        if (!s) return ok({ hasSequence: false, version: VERSION, app: appVersion(), projectPath: String(app.project.path || '') });
        var sel = selectedVideo(s), names = [], i, adj = null;
        for (i = 0; i < sel.length && i < 3; i++) names.push(sel[i].item.name);
        if (o && o.adj) {
            var a = findAdjustment(o.adjNodeId);
            if (a) adj = { name: a.name, nodeId: a.nodeId };
        }
        return ok({
            hasSequence: true, version: VERSION, app: appVersion(), name: s.name, seqId: s.sequenceID, fps: TICKS / tpf(s), project: String(app.project.name || '').replace(/\.prproj$/i, ''), projectPath: String(app.project.path || ''),
            frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
            playhead: tk(s.getPlayerPosition()) / TICKS,
            selection: sel.length, selectionNames: names, adj: adj, markers: markerTimes(s).length
        });
    }

    // ------------------------------------------------------------ public: resolve targets

    function resolve(o) {
        var s = activeSeq(), f = tpf(s), N = Math.max(1, Math.round(o.frames || 8)), ph = snap(o.at != null ? Number(o.at) : tk(s.getPlayerPosition()), f);
        var targets = [], warnings = [], direct = o.target === 'clip' || o.target === 'copy', sides = o.sides || ['pre', 'post'];
        var i, j, ref, track, cut, c, list, a, b;

        function add(side, start, end, clip, refTrack, clipTrack) {
            start = Math.max(0, start);
            var frames = Math.round((end - start) / f);
            if (frames < 1) return;
            targets.push({
                side: side, start: start, end: start + frames * f, frames: frames, track: refTrack,
                clipTrack: clipTrack, clipStart: clip ? tk(clip.start) : null, clipName: clip ? clip.name : ''
            });
        }

        function atCut(cutTicks, tr, outgoing, incoming) {
            for (j = 0; j < sides.length; j++) {
                if (sides[j] === 'pre') {
                    if (direct && !outgoing) { warnings.push('Pas de clip avant la coupe'); continue; }
                    a = cutTicks - N * f;
                    if (direct) a = Math.max(a, tk(outgoing.start));
                    if (a < 0) warnings.push('PRE raccourci (d\u00e9but de s\u00e9quence)');
                    add('pre', a, cutTicks, outgoing, tr, tr);
                } else if (sides[j] === 'post') {
                    if (direct && !incoming) { warnings.push('Pas de clip apr\u00e8s la coupe'); continue; }
                    b = cutTicks + N * f;
                    if (direct) b = Math.min(b, tk(incoming.end));
                    add('post', cutTicks, b, incoming, tr, tr);
                }
            }
        }

        if (o.placement === 'cut' || o.placement === 'playhead') {
            ref = refClip(s);
            track = ref ? ref.track : 0;
            cut = ph;
            if (o.placement === 'cut') {
                cut = nearestEdit(s, track, ph);
                if (cut === null) cut = ph;
            }
            atCut(cut, track,
                o.placement === 'cut' ? clipEndingAt(s, track, cut) : clipContaining(s, track, cut - f),
                clipContaining(s, track, cut));
            // Effet lache sur une piste : le calque va sur cette piste (o.track) si elle est libre.
            if (o.track != null) for (i = 0; i < targets.length; i++) targets[i].track = Number(o.track) - 1;
        } else if (o.placement === 'sequence') {
            // Toute la sequence : une zone du debut a la fin du dernier plan (looks...).
            hi = 0;
            for (i = 0; i < s.videoTracks.numTracks; i++) { list = clipsOf(s, i); if (list.length) hi = Math.max(hi, tk(list[list.length - 1].end)); }
            if (!(hi > 0)) return fail('La s\u00e9quence est vide.');
            add('post', 0, hi, null, 0, 0);
        } else if (o.placement === 'markers') {
            ref = refClip(s);
            track = ref ? ref.track : 0;
            list = selectedVideo(s);
            // o.times (secondes) : temps forts detectes par le panneau, a la place des marqueurs.
            var times = [], lo = -Infinity, hi = Infinity, seen = {}, tm;
            if (o.times) { for (i = 0; i < o.times.length; i++) times.push(o.times[i] * TICKS); } else times = markerTimes(s);
            if (!times.length) return fail(o.times ? 'Aucun temps fort d\u00e9tect\u00e9.' : 'Aucun marqueur dans la s\u00e9quence. Posez-en sur les temps forts (touche M pendant la lecture).');
            if (list.length) {
                lo = Infinity; hi = -Infinity;
                for (i = 0; i < list.length; i++) { lo = Math.min(lo, tk(list[i].item.start)); hi = Math.max(hi, tk(list[i].item.end)); }
            }
            times.sort(function (x, y) { return x - y; });
            for (i = 0; i < times.length; i++) {
                tm = snap(times[i], f);
                if (tm < lo || tm > hi || seen[tm]) continue;
                seen[tm] = true;
                atCut(tm, track, clipContaining(s, track, tm - f), clipContaining(s, track, tm));
            }
            if (!targets.length) return fail('Aucun marqueur dans les clips s\u00e9lectionn\u00e9s.', { warnings: warnings });
        } else if (o.placement === 'cuts') {
            // o.scope 'sequence' : toutes les coupes du montage, sans selection.
            list = o.scope === 'sequence' ? allVideo(s) : selectedVideo(s);
            for (i = 1; i < list.length; i++) {
                if (list[i].track !== list[i - 1].track) continue;
                if (Math.abs(tk(list[i].item.start) - tk(list[i - 1].item.end)) <= f) {
                    atCut(tk(list[i].item.start), list[i].track, list[i - 1].item, list[i].item);
                }
            }
            if (!targets.length) return fail(o.scope === 'sequence' ? 'Aucune coupe entre deux plans dans la s\u00e9quence.' : 'S\u00e9lectionnez au moins deux clips qui se suivent sur la m\u00eame piste.');
        } else {
            list = o.scope === 'sequence' ? allVideo(s) : selectedVideo(s);
            // o.strict : seulement les clips selectionnes (pas celui sous la tete de lecture).
            if (!list.length && o.scope !== 'sequence' && !o.strict) {
                ref = refClip(s);
                if (ref) list = [ref];
            }
            if (!list.length) return fail(o.scope === 'sequence' ? 'Aucun plan dans la s\u00e9quence.' : 'S\u00e9lectionnez un clip dans la timeline.');
            for (i = 0; i < list.length; i++) {
                c = list[i].item;
                if (o.placement === 'clipStart') add('post', tk(c.start), Math.min(tk(c.start) + N * f, tk(c.end)), c, list[i].track, list[i].track);
                else if (o.placement === 'clipEnd') add('pre', Math.max(tk(c.end) - N * f, tk(c.start)), tk(c.end), c, list[i].track, list[i].track);
                else add(sides[0] || 'post', tk(c.start), tk(c.end), c, list[i].track, list[i].track);
            }
        }
        if (!targets.length) return fail('Rien \u00e0 faire ici : placez la t\u00eate de lecture pr\u00e8s d\'une coupe ou s\u00e9lectionnez un clip.', { warnings: warnings });
        return ok({ fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical, targets: targets, warnings: warnings });
    }

    // ------------------------------------------------------------ public: apply

    function apply(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, j, t, adj = null, placed, track, start, comp, n = 0, lutSet = 0;
        if (o.target === 'overlay' && !o.overlay) return fail('Overlay manquant');
        if (o.target === 'adjustment' || !o.target) {
            // Debut d'un lot : on reverifie que le calque de reglage est toujours dans le projet.
            if (o.refreshAdj) adjCache = null;
            adj = findAdjustment(o.adjNodeId);
            if (!adj) return fail(NO_ADJ);
        }
        for (i = 0; i < o.targets.length; i++) {
            t = o.targets[i];
            var label = (t.name || o.name) + ' ' + t.side.toUpperCase(), entry, item;
            if (o.target === 'overlay' && !t.name) t.name = o.name;
            if (o.target === 'clip') {
                if (t.clipStart === null || t.clipStart === undefined) { warnings.push('Pas de clip pour ' + t.side.toUpperCase()); continue; }
                start = t.clipStart;
                placed = findClipAt(s, t.clipTrack, start, t.clipName);
                if (!placed) { warnings.push('Clip introuvable'); continue; }
                track = placed.track;
                item = placed.item;
                entry = { kind: 'clip', track: track, start: start, name: item.name, added: [] };
            } else if (o.target === 'overlay') {
                placed = placeOverlay(s, o.overlay, t, i, warnings);
                if (!placed) continue;
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            } else if (o.target === 'copy') {
                if (t.clipStart === null || t.clipStart === undefined) { warnings.push('Pas de plan pour ' + t.side.toUpperCase()); continue; }
                // Piste ou le plan est vraiment : une copie precedente a pu inserer une piste dessous.
                placed = findClipAt(s, t.clipTrack, t.clipStart, t.clipName);
                if (!placed) { warnings.push('Plan introuvable'); continue; }
                try {
                    placed = placeCopy(s, placed.item, placed.track, t.start, t.end, label, o, warnings);
                } catch (eC) { warnings.push(label + ' : ' + eC.toString()); continue; }
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            } else {
                try {
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                } catch (e1) {
                    // Calque de reglage supprime du projet depuis : on le recherche une fois.
                    adjCache = null;
                    adj = findAdjustment(o.adjNodeId);
                    if (!adj) return fail(NO_ADJ, { created: created, warnings: warnings });
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                }
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            }
            created.push(entry);
            // Une erreur sur un effet ne fait pas perdre ce qui est deja pose (l'annulation le retrouve).
            for (j = 0; j < t.fx.length; j++) {
                try {
                    comp = addEffect(s, track, start, t.fx[j], warnings);
                    if (!comp) continue;
                    if (entry.added && !t.fx[j].intrinsic) entry.added.push(comp.matchName);
                    // Trajectoire / Opacite du clip : leur etat d'avant est garde pour l'annulation.
                    if (entry.added && t.fx[j].intrinsic) keepComp(entry, comp);
                    item = findItemAt(s, track, start);
                    n += setProps(s, item, comp, t.fx[j], t.start, f, warnings);
                    // Look ou conversion : la LUT .cube va dans la " LUT d'entree " de Lumetri.
                    if (t.fx[j].lut) {
                        var lutErr = setInputLut(comp, t.fx[j].lut);
                        if (lutErr) warnings.push(lutErr); else lutSet++;
                    }
                } catch (err) {
                    warnings.push(t.fx[j].names[0] + ' : ' + err.toString());
                }
            }
        }
        return ok({ created: created, props: n, lutSet: lutSet, warnings: warnings });
    }

    // Removes what RR FX added, and only that: an adjustment layer must still
    // carry its RR FX name, and a clip's effects are removed from the end only
    // while they are the ones that were added.
    function removeAddedEffects(it, added) {
        var k = it.components.numItems - 1, j, c, n = 0;
        for (j = added.length - 1; j >= 0 && k >= 0; j--, k--) {
            c = it.components[k];
            if (!c || c.matchName !== added[j] || typeof c.remove !== 'function') return n;
        }
        for (j = added.length - 1; j >= 0; j--) {
            it.components[it.components.numItems - 1].remove();
            n++;
        }
        return n;
    }

    // Etat d'un effet (valeurs fixes et images cles) pour le remettre a l'annulation ; null si
    // une valeur animee est illisible.
    function snapComp(c) {
        var out = [], i, p, keys, j, v, ks;
        for (i = 0; i < c.properties.numItems; i++) {
            p = c.properties[i];
            try {
                if (p.isTimeVarying()) {
                    keys = p.getKeys();
                    ks = [];
                    for (j = 0; keys && j < keys.length; j++) {
                        v = plainValue(p.getValueAtKey(keys[j]));
                        if (!v.ok) return null;
                        ks.push([tk(keys[j]), v.v]);
                    }
                    out.push({ i: i, keys: ks });
                } else {
                    v = plainValue(p.getValue());
                    if (v.ok) out.push({ i: i, v: v.v });
                }
            } catch (e) { return null; }
        }
        return out;
    }

    function restoreComp(c, snap) {
        var i, j, sp, p, t, last;
        for (i = 0; i < snap.length; i++) {
            sp = snap[i];
            p = c.properties[sp.i];
            if (!p) continue;
            if (p.isTimeVarying()) p.setTimeVarying(false);
            if (sp.keys) {
                if (!sp.keys.length) continue;
                p.setTimeVarying(true);
                last = sp.keys.length - 1;
                for (j = 0; j <= last; j++) {
                    t = mkTime(sp.keys[j][0]);
                    p.addKey(t);
                    p.setValueAtKey(t, sp.keys[j][1], j === last);
                }
            } else p.setValue(sp.v, true);
        }
    }

    // Entree d'historique d'un clip : etat d'un effet intrinseque avant modification (une fois),
    // ou `lost` s'il ne peut pas etre remis.
    function keepComp(entry, comp) {
        var i, snap;
        entry.restore = entry.restore || [];
        for (i = 0; i < entry.restore.length; i++) if (entry.restore[i].mn === comp.matchName) return;
        snap = snapComp(comp);
        if (snap) entry.restore.push({ mn: comp.matchName, props: snap }); else entry.lost = (entry.lost || 0) + 1;
    }

    function undo(o) {
        var s = useSeq(o.seq), removed = 0, skipped = 0, effects = 0, i, k, e, it, r, n, c;
        // Newest first: effects stacked on the same clip come off in reverse order.
        for (i = o.entries.length - 1; i >= 0; i--) {
            e = o.entries[i];
            if (e.kind === 'aud') {
                it = findAudioAt(s, e.track, e.start);
                if (it && it.name === e.name) { it.remove(false, false); removed++; } else skipped++;
                continue;
            }
            if (e.kind === 'atrim') {
                // J-cut / L-cut : le son revient a son debut et sa fin d'origine.
                if (undoTrim(s, e)) removed++; else skipped++;
                continue;
            }
            if (e.kind === 'trans') {
                // Transition de Premiere posee sur une coupe.
                if (removeTransitionAt(s, e)) removed++; else skipped++;
                continue;
            }
            if (e.kind === 'roll') {
                // Coupe recalee : remise a sa place d'origine.
                if (rollAt(s, e.at, e.back)) removed++; else skipped++;
                continue;
            }
            if (e.kind === 'move') {
                // Rangement du projet : l'element revient dans son chutier d'origine.
                it = itemByNodeId(e.id);
                r = e.from === 'root' ? app.project.rootItem : itemByNodeId(e.from);
                if (it && r) { try { it.moveBin(r); removed++; } catch (e2) { skipped++; } } else skipped++;
                continue;
            }
            if (e.kind === 'rename') {
                // Renommage en serie : l'ancien nom revient.
                it = itemByNodeId(e.id);
                if (it) { try { it.name = e.old; removed++; } catch (e1) { skipped++; } } else skipped++;
                continue;
            }
            if (e.kind === 'mc') {
                removed += multicamEnable(s, e.tracks, e.a, e.b) ? 1 : 0;
                continue;
            }
            if (e.kind === 'afx') {
                // Effet audio ajoute (debruitage de la voix) : retire s'il est toujours le dernier.
                it = findAudioAt(s, e.track, e.start);
                r = it ? removeAddedEffects(it, e.added || []) : 0;
                if (r) effects += r; else skipped++;
                continue;
            }
            if (e.kind === 'level') {
                // Volume remis comme avant (musique baissee sous la voix, niveau de la voix).
                it = findAudioAt(s, e.track, e.start);
                r = it ? levelParam(it) : null;
                if (r) { if (r.isTimeVarying()) r.setTimeVarying(false); r.setValue(e.value, true); removed++; } else skipped++;
                continue;
            }
            it = e.kind === 'adj' ? findNamed(s, e.track, e.start, e.name) : findItemAt(s, e.track, e.start);
            // Clip : une piste a pu etre inseree dessous depuis, on le cherche ailleurs par son nom.
            if (!it && e.kind !== 'adj' && e.name) it = findNamed(s, e.track, e.start, e.name);
            if (e.kind === 'adj') {
                if (it && it.name === e.name) {
                    it.remove(false, false);
                    removed++;
                } else skipped++;
            } else if (!it) skipped++;
            else {
                r = e.added && e.added.length ? removeAddedEffects(it, e.added) : 0;
                if (e.added && e.added.length && !r) skipped++;
                // Trajectoire / Opacite remises comme avant.
                n = 0;
                for (k = 0; e.restore && k < e.restore.length; k++) {
                    c = componentByMatch(it, e.restore[k].mn);
                    try { if (c) { restoreComp(c, e.restore[k].props); n++; } else skipped++; } catch (eR) { skipped++; }
                }
                effects += r + n;
                // Effets remplaces ou images cles effacees qui ne peuvent pas etre remis : pas annule.
                if (e.lost) skipped++;
                else if (!r && !n && !(e.added && e.added.length) && !(e.restore && e.restore.length)) skipped++;
            }
        }
        return ok({ removed: removed, effects: effects, skipped: skipped });
    }

    // ------------------------------------------------------------ public: capture & diagnose

    function plainValue(v) {
        var i, out;
        if (typeof v === 'number' || typeof v === 'boolean') return { ok: true, v: v };
        if (v instanceof Array || (v && typeof v.length === 'number' && typeof v !== 'string')) {
            out = [];
            for (i = 0; i < v.length; i++) {
                if (typeof v[i] !== 'number') return { ok: false };
                out.push(v[i]);
            }
            return { ok: true, v: out };
        }
        return { ok: false };
    }

    function capture(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), it, S, E, comps, out = [], k0 = null, k1 = null, skipped = 0;
        var ci, pi, c, mn, intrinsic, entry, p, pe, keys, j, kt, v, D = 0, origin = 'post';
        if (!sel.length) return fail('S\u00e9lectionnez dans la timeline le clip ou calque de r\u00e9glage qui porte vos effets.');
        it = sel[0].item;
        S = tk(it.start);
        E = tk(it.end);
        comps = it.components;
        for (ci = 0; ci < comps.numItems; ci++) {
            c = comps[ci];
            mn = c.matchName;
            intrinsic = mn === 'AE.ADBE Motion' ? 'motion' : (mn === 'AE.ADBE Opacity' ? 'opacity' : null);
            if (/time ?remap/i.test(mn)) continue;
            if (intrinsic && !o.includeIntrinsic) continue;
            entry = { ci: ci, matchName: mn, displayName: c.displayName, intrinsic: intrinsic, props: [] };
            for (pi = 0; pi < c.properties.numItems; pi++) {
                p = c.properties[pi];
                pe = { index: pi, name: p.displayName };
                try {
                    if (p.isTimeVarying()) {
                        keys = p.getKeys();
                        if (keys && keys.length) {
                            pe.animated = true;
                            for (j = 0; j < keys.length; j++) {
                                kt = seqTimeOf(it, tk(keys[j]));
                                if (k0 === null || kt < k0) k0 = kt;
                                if (k1 === null || kt > k1) k1 = kt;
                            }
                        }
                    }
                } catch (e) {}
                if (!pe.animated) {
                    try {
                        v = plainValue(p.getValue());
                        if (!v.ok) { skipped++; continue; }
                        pe['static'] = v.v;
                    } catch (e2) { skipped++; continue; }
                }
                entry.props.push(pe);
            }
            if (entry.props.length) out.push(entry);
        }
        if (k0 !== null) {
            k0 = snap(k0, f);
            k1 = snap(k1, f);
            D = Math.round((k1 - k0) / f) + 1;
            origin = (E - k1) < (k0 - S) ? 'pre' : 'post';
            for (ci = 0; ci < out.length; ci++) {
                for (pi = 0; pi < out[ci].props.length; pi++) {
                    pe = out[ci].props[pi];
                    if (!pe.animated) continue;
                    p = comps[out[ci].ci].properties[pe.index];
                    pe.values = [];
                    for (j = 0; j < D; j++) {
                        v = plainValue(p.getValueAtTime(clipTime(it, k0 + j * f)));
                        if (!v.ok) { pe.values = null; break; }
                        pe.values.push(v.v);
                    }
                    delete pe.animated;
                    // Une valeur illisible : le parametre entier est ignore plutot que mal rejoue.
                    if (!pe.values) { out[ci].props.splice(pi, 1); pi--; skipped++; }
                }
            }
        }
        for (ci = out.length - 1; ci >= 0; ci--) {
            delete out[ci].ci;
            if (!out[ci].props.length) out.splice(ci, 1);
        }
        if (!out.length) return fail('Aucun effet lisible sur ce clip.');
        return ok({
            name: it.name, frames: D, fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
            clipFrames: Math.round((E - S) / f), origin: origin, components: out, skipped: skipped
        });
    }

    function diagnose(o) {
        var s = activeSeq(), sel = selectedVideo(s), lines = [], it, i, j, c, p, v;
        if (!sel.length) return fail('S\u00e9lectionnez un clip dans la timeline.');
        it = sel[0].item;
        lines.push('Clip : ' + it.name + '  (V' + (sel[0].track + 1) + ')');
        for (i = 0; i < it.components.numItems; i++) {
            c = it.components[i];
            lines.push('');
            lines.push('[' + i + '] ' + c.displayName + '   matchName: ' + c.matchName);
            for (j = 0; j < c.properties.numItems; j++) {
                p = c.properties[j];
                try { v = p.getValue(); v = (v && v.length !== undefined && typeof v !== 'string') ? '[' + v.join(', ') + ']' : String(v); } catch (e) { v = '?'; }
                if (v.length > 60) v = v.substr(0, 60) + '\u2026';
                lines.push('    #' + j + '  ' + p.displayName + ' = ' + v);
            }
        }
        return ok({ text: lines.join('\n') });
    }

    function listEffects(o) {
        var names = [], list, i, re = o && o.filter ? new RegExp(o.filter, 'i') : null;
        app.enableQE();
        list = qe.project.getVideoEffectList();
        for (i = 0; i < list.length; i++) if (!re || re.test(list[i])) names.push(String(list[i]));
        return ok({ names: names });
    }

    // Projet modele contenant un calque de reglage (chemin vide : aucun).
    // o.auto : modele fabrique par RR FX (le fichier n'existe pas forcement encore).
    function setAdjTemplate(o) {
        adjTemplate = String((o && o.path) || '');
        adjAuto = !!(o && o.auto);
        if (adjTemplate && !adjAuto && !(new File(adjTemplate)).exists) return fail('Projet mod\u00e8le introuvable : ' + adjTemplate);
        return ok({ path: adjTemplate, exists: !!adjTemplate && (new File(adjTemplate)).exists });
    }

    // Effet glisse depuis le panneau : Premiere a pose le fichier porteur (o.tag dans son nom) a
    // l'endroit lache. On note ou, on le retire (et son element du projet), le panneau pose l'effet la.
    function takeDrop(o) {
        var s = activeSeq(), i, j, list, it, pi, name, hit = null, bin;
        for (i = 0; i < s.videoTracks.numTracks && !hit; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                pi = it.projectItem;
                name = String((pi && pi.name) || it.name || '');
                if (name.split(o.tag).length > 1) { hit = { item: it, track: i, pi: pi }; break; }
            }
        }
        // L'element du projet part dans un chutier jetable, supprime avec lui.
        function drop(item) {
            try {
                bin = app.project.rootItem.createBin('RR FX \u00b7 glisser');
                item.moveBin(bin);
                bin.deleteBin();
            } catch (e) {}
        }
        if (!hit) {
            // Lache ailleurs (panneau Projet) : au dernier essai, on retire le fichier importe.
            pi = o.last ? walk(app.project.rootItem, function (c) { return String(c.name || '').split(o.tag).length > 1; }) : null;
            if (pi) drop(pi);
            return ok({ found: false, inProject: !!pi });
        }
        var at = tk(hit.item.start), len = tk(hit.item.end) - at;
        hit.item.remove(false, false);
        if (hit.pi) drop(hit.pi);
        return ok({ found: true, at: at, track: hit.track, length: len });
    }

    function adjustmentInfo(o) {
        adjCache = null;
        var a = findAdjustment(o.nodeId);
        return ok({ found: !!a, name: a ? a.name : '', nodeId: a ? a.nodeId : '' });
    }

    function adjustmentFromSelection(o) {
        var sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null;
        if (!sel || !sel.length) return fail('S\u00e9lectionnez votre calque de r\u00e9glage dans le panneau Projet.');
        adjCache = sel[0];
        return ok({ name: sel[0].name, nodeId: sel[0].nodeId });
    }


    // ------------------------------------------------------------ outils communs (v1.3)

    function secs(ticks) { return ticks / TICKS; }

    function mediaPathOf(pi) {
        try { return String(pi.getMediaPath()); } catch (e) { return ''; }
    }

    function samePath(a, b) {
        return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
    }

    // Chutier par son nom, a la racine ; " assets/VIDEOS " : chutiers imbriques (crees si besoin).
    function namedBin(name) {
        var parts = String(name).split('/'), bin = app.project.rootItem, i, j, c, next;
        for (j = 0; j < parts.length; j++) {
            next = null;
            for (i = 0; i < bin.children.numItems; i++) {
                c = bin.children[i];
                if (c.type === 2 && c.name === parts[j]) { next = c; break; }
            }
            bin = next || bin.createBin(parts[j]);
        }
        return bin;
    }

    // Element du projet pour un fichier (importe si besoin). stills : sequence d'images
    // numerotees, dont `path` est la premiere image.
    // Un fichier du dossier assets du projet (.../assets/VIDEOS/...) va dans le chutier du meme
    // nom (assets/VIDEOS) : le panneau Projet suit le rangement du disque.
    function assetsBinOf(path) {
        var parts = String(path).split(/[\\\/]/), i;
        // Le dernier dossier " assets " suivi d'une categorie puis d'au moins un nom de fichier.
        for (i = parts.length - 3; i >= 0; i--) if (/^assets$/i.test(parts[i]) && parts[i + 1]) return 'assets/' + parts[i + 1];
        return '';
    }

    function itemForPath(path, binName, stills) {
        var found = walk(app.project.rootItem, function (c) { return c.type === 1 && samePath(mediaPathOf(c), path); }), bin, before = {}, i;
        if (found) return found;
        if (binName === 'RR FX Ressources' && assetsBinOf(path)) binName = assetsBinOf(path);
        bin = namedBin(binName);
        for (i = 0; i < bin.children.numItems; i++) before[bin.children[i].nodeId] = true;
        app.project.importFiles([path], true, bin, !!stills);
        found = walk(app.project.rootItem, function (c) { return c.type === 1 && samePath(mediaPathOf(c), path); });
        // Une sequence d'images ne garde pas toujours le chemin de sa premiere image : on prend
        // l'element que l'import vient d'ajouter au chutier.
        if (!found) {
            for (i = bin.children.numItems - 1; i >= 0 && !found; i--) {
                if (bin.children[i].type === 1 && !before[bin.children[i].nodeId]) found = bin.children[i];
            }
        }
        return found;
    }

    function audioClipsOf(s) {
        var out = [], i, j, tr;
        if (!s.audioTracks) return out;
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            tr = s.audioTracks[i];
            for (j = 0; j < tr.clips.numItems; j++) out.push({ item: tr.clips[j], track: i });
        }
        return out;
    }

    // Limites des clips selectionnes (hors calques), ou null.
    function selectionRange(s) {
        var sel = selectedVideo(s), lo = Infinity, hi = -Infinity, i;
        for (i = 0; i < sel.length; i++) {
            if (isLayer(sel[i].item)) continue;
            lo = Math.min(lo, tk(sel[i].item.start));
            hi = Math.max(hi, tk(sel[i].item.end));
        }
        return lo < hi ? { a: lo, b: hi } : null;
    }

    // ------------------------------------------------------------ public: marqueurs

    function markerList(o) {
        var s = activeSeq(), out = [], ms, m, guard = 0;
        try { ms = s.markers; m = ms ? ms.getFirstMarker() : null; } catch (e) { m = null; }
        while (m && guard++ < 10000) {
            out.push({ t: secs(tk(m.start)), name: String(m.name || '') });
            try { m = ms.getNextMarker(m); } catch (e2) { m = null; }
        }
        out.sort(function (x, y) { return x.t - y.t; });
        return ok({ markers: out, playhead: secs(tk(s.getPlayerPosition())), range: (function (r) { return r ? { a: secs(r.a), b: secs(r.b) } : null; })(selectionRange(s)) });
    }

    function removeMarkers(s, prefix, a, b) {
        var ms = s.markers, m, list = [], i, t, guard = 0;
        if (!ms) return 0;
        m = ms.getFirstMarker();
        while (m && guard++ < 10000) {
            t = tk(m.start);
            if (String(m.name || '').substr(0, prefix.length) === prefix && t >= a && t <= b) list.push(m);
            m = ms.getNextMarker(m);
        }
        for (i = 0; i < list.length; i++) ms.deleteMarker(list[i]);
        return list.length;
    }

    // Pose des marqueurs aux temps donnes (secondes de sequence), nommes " RR FX . ... ".
    function addMarkers(o) {
        var s = activeSeq(), f = tpf(s), ms = s.markers, i, t, m, n = 0, removed = 0, seen = {};
        if (!ms || !ms.createMarker) return fail('Cette version de Premiere ne permet pas de poser des marqueurs par script.');
        if (o.replace) removed = removeMarkers(s, 'RR FX', o.from != null ? o.from * TICKS - f : -Infinity, o.to != null ? o.to * TICKS + f : Infinity);
        for (i = 0; i < o.times.length; i++) {
            t = snap(o.times[i] * TICKS, f);
            if (seen[t]) continue;
            seen[t] = true;
            m = ms.createMarker(t / TICKS);
            try { m.name = o.name || 'RR FX \u00b7 temps fort'; } catch (e) {}
            try { if (m.setColorByIndex) m.setColorByIndex(o.color == null ? 3 : o.color); } catch (e2) {}
            n++;
        }
        return ok({ added: n, removed: removed });
    }

    // ------------------------------------------------------------ public: tout effacer

    function clearAll(o) {
        var s = activeSeq(), range = o.scope === 'selection' ? selectionRange(s) : null, removed = 0, markers = 0, i, j, list, it;
        if (o.scope === 'selection' && !range) return fail('S\u00e9lectionne les clips de la zone \u00e0 nettoyer.');
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!/^RR FX \u00b7 /.test(it.name)) continue;
                if (range && !(tk(it.start) < range.b && range.a < tk(it.end))) continue;
                it.remove(false, false);
                removed++;
            }
        }
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            list = [];
            for (j = 0; j < s.audioTracks[i].clips.numItems; j++) list.push(s.audioTracks[i].clips[j]);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!/^RR FX \u00b7 /.test(it.name)) continue;
                if (range && !(tk(it.start) < range.b && range.a < tk(it.end))) continue;
                it.remove(false, false);
                removed++;
            }
        }
        if (o.markers) markers = removeMarkers(s, 'RR FX', range ? range.a : -Infinity, range ? range.b : Infinity);
        // Montage multicam : les plans desactives par RR FX sont reactives.
        if (o.multicam) removed += multicamEnable(s, null, range ? range.a : -Infinity, range ? range.b : Infinity);
        return ok({ removed: removed, markers: markers });
    }

    api.compat = guard(compat);
    api.setAdjTemplate = guard(setAdjTemplate);
    api.takeDrop = guard(takeDrop);
    api.markerList = guard(markerList);
    api.addMarkers = guard(addMarkers);
    api.clearAll = guard(clearAll);
    api.getContext = guard(getContext);
    api.resolve = guard(resolve);
    api.apply = guard(apply);
    api.undo = guard(undo);
    api.capture = guard(capture);
    api.diagnose = guard(diagnose);
    api.listEffects = guard(listEffects);
    api.adjustmentInfo = guard(adjustmentInfo);
    api.adjustmentFromSelection = guard(adjustmentFromSelection);

