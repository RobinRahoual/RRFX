    // ============================================================ Raccords J/L-cut, coupes, credits, export en lot, archive

    // ------------------------------------------------------------ 2.6 : raccords, coupes, export, archive

    // Debut / fin d'un element deplace de delta ticks (le point d'entree / de sortie suit).
    function trimStart(it, delta) {
        var s0 = tk(it.start), in0 = tk(it.inPoint), sp = 1;
        try { sp = it.getSpeed() || 1; } catch (e) {}
        it.start = mkTime(s0 + delta);
        if (Math.abs(tk(it.inPoint) - in0) < 1 && Math.abs(delta) >= 1) { try { it.inPoint = mkTime(in0 + delta * sp); } catch (e2) {} }
        return Math.abs(tk(it.start) - (s0 + delta)) <= 1;
    }
    function trimEnd(it, delta) {
        var e0 = tk(it.end), out0 = tk(it.outPoint), sp = 1;
        try { sp = it.getSpeed() || 1; } catch (e) {}
        it.end = mkTime(e0 + delta);
        if (Math.abs(tk(it.outPoint) - out0) < 1 && Math.abs(delta) >= 1) { try { it.outPoint = mkTime(out0 + delta * sp); } catch (e2) {} }
        return Math.abs(tk(it.end) - (e0 + delta)) <= 1;
    }
    // Images disponibles avant le point d'entree / apres le point de sortie (poignees).
    function headRoom(it) { return Math.max(0, tk(it.inPoint)); }
    function tailRoom(it) {
        var end = it.projectItem ? mediaEndOf(it.projectItem) : null;
        return end === null ? 0 : Math.max(0, end - tk(it.outPoint));
    }

    function audioAtStart(s, ticks, f) {
        var i, j, l;
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            l = audioItems(s, i);
            for (j = 0; j < l.length; j++) if (Math.abs(tk(l[j].start) - ticks) < f / 2) return { it: l[j], track: i };
        }
        return null;
    }
    function audioAtEnd(s, ticks, track, f) {
        var l = audioItems(s, track), j;
        for (j = 0; j < l.length; j++) if (Math.abs(tk(l[j].end) - ticks) < f / 2) return l[j];
        return null;
    }

    // Coupes entre deux plans selectionnes qui se suivent sur la meme piste video.
    function selectedCuts(s) {
        var sel = selectedVideo(s), f = tpf(s), byTrack = {}, out = [], i, k, l;
        for (i = 0; i < sel.length; i++) {
            if (isLayer(sel[i].item)) continue;
            (byTrack[sel[i].track] = byTrack[sel[i].track] || []).push(sel[i].item);
        }
        for (k in byTrack) {
            if (!byTrack.hasOwnProperty(k)) continue;
            l = byTrack[k];
            l.sort(function (a, b) { return tk(a.start) - tk(b.start); });
            for (i = 1; i < l.length; i++) if (Math.abs(tk(l[i].start) - tk(l[i - 1].end)) < f / 2) out.push({ track: Number(k), a: l[i - 1], b: l[i], t: tk(l[i].start) });
        }
        out.sort(function (p, q) { return p.t - q.t; });
        return out;
    }

    // J-cut (le son du plan suivant arrive avant son image) ou L-cut (le son du plan precedent
    // continue sur le suivant), de o.frames images, sur chaque coupe de la selection.
    function splitEdits(o) {
        var s = activeSeq(), f = tpf(s), cuts = selectedCuts(s), want = Math.max(1, Math.round(o.frames || 12)) * f, created = [], done = 0, passed = 0, i, c, nA, pA, d;
        if (!cuts.length) return fail('S\u00e9lectionne au moins deux plans qui se suivent dans la timeline (avec leur son).');
        for (i = 0; i < cuts.length; i++) {
            c = cuts[i];
            nA = audioAtStart(s, c.t, f);
            pA = nA ? audioAtEnd(s, c.t, nA.track, f) : null;
            if (!nA || !pA) { passed++; continue; }
            if (o.mode === 'l') {
                d = Math.min(want, tailRoom(pA), tk(nA.it.end) - tk(nA.it.start) - f);
                d = Math.floor(d / f) * f;
                if (d < f) { passed++; continue; }
                created.push({ kind: 'atrim', track: nA.track, start: c.t + d, s0: c.t, e0: tk(nA.it.end), name: nA.it.name });
                trimStart(nA.it, d);
                created.push({ kind: 'atrim', track: nA.track, start: tk(pA.start), s0: tk(pA.start), e0: c.t, name: pA.name });
                trimEnd(pA, d);
            } else {
                d = Math.min(want, headRoom(nA.it), tk(pA.end) - tk(pA.start) - f);
                d = Math.floor(d / f) * f;
                if (d < f) { passed++; continue; }
                created.push({ kind: 'atrim', track: nA.track, start: tk(pA.start), s0: tk(pA.start), e0: c.t, name: pA.name });
                trimEnd(pA, -d);
                created.push({ kind: 'atrim', track: nA.track, start: c.t - d, s0: c.t, e0: tk(nA.it.end), name: nA.it.name });
                trimStart(nA.it, -d);
            }
            done++;
        }
        return ok({ cuts: cuts.length, done: done, passed: passed, created: created });
    }

    // Annuler un raccord : debut et fin d'origine.
    function undoTrim(s, e) {
        var it = findAudioAt(s, e.track, e.start);
        if (!it) return false;
        var ds = e.s0 - tk(it.start), de = e.e0 - tk(it.end);
        if (ds) trimStart(it, ds);
        if (de) trimEnd(it, de);
        return true;
    }

    // Coupes de la selection, avec ce qu'il faut pour ecouter les deux cotes.
    function cutList(o) {
        var s = activeSeq(), f = tpf(s), cuts = selectedCuts(s), out = [], i, c, sp1 = 1, sp2 = 1;
        if (!cuts.length) return fail('S\u00e9lectionne au moins deux plans qui se suivent dans la timeline.');
        for (i = 0; i < cuts.length; i++) {
            c = cuts[i];
            try { sp1 = c.a.getSpeed() || 1; sp2 = c.b.getSpeed() || 1; } catch (e) {}
            out.push({
                t: secs(c.t), track: c.track,
                a: { path: c.a.projectItem ? mediaPathOf(c.a.projectItem) : '', out: secs(tk(c.a.outPoint)), speed: sp1, room: secs(tailRoom(c.a)), len: secs(tk(c.a.end) - tk(c.a.start)) },
                b: { path: c.b.projectItem ? mediaPathOf(c.b.projectItem) : '', inP: secs(tk(c.b.inPoint)), speed: sp2, room: secs(headRoom(c.b)), len: secs(tk(c.b.end) - tk(c.b.start)) }
            });
        }
        return ok({ cuts: out, fps: TICKS / f });
    }

    // Deplace une coupe (montage par roulement) : le plan d'avant finit et celui d'apres commence
    // a o.to, sur toutes les pistes coupees au meme endroit (image et son lie).
    function rollAt(s, at, to) {
        var f = tpf(s), d = to - at, moved = 0, i, j, l, A, B, pairs = [];
        function scan(get, n) {
            for (i = 0; i < n; i++) {
                l = get(i);
                A = null; B = null;
                for (j = 0; j < l.length; j++) {
                    if (Math.abs(tk(l[j].end) - at) < f / 2) A = l[j];
                    if (Math.abs(tk(l[j].start) - at) < f / 2) B = l[j];
                }
                if (A && B) pairs.push([A, B]);
            }
        }
        scan(function (k) { return clipsOf(s, k); }, s.videoTracks.numTracks);
        scan(function (k) { return audioItems(s, k); }, s.audioTracks.numTracks);
        for (i = 0; i < pairs.length; i++) {
            A = pairs[i][0]; B = pairs[i][1];
            if (d > 0 && (tailRoom(A) < d || tk(B.end) - tk(B.start) <= d)) continue;
            if (d < 0 && (headRoom(B) < -d || tk(A.end) - tk(A.start) <= -d)) continue;
            // Dans l'ordre qui ne fait jamais chevaucher les deux plans.
            if (d > 0) { trimStart(B, d); trimEnd(A, d); } else { trimEnd(A, d); trimStart(B, d); }
            moved++;
        }
        return moved;
    }
    function rollEdits(o) {
        var s = activeSeq(), f = tpf(s), created = [], done = 0, i, m, at, to;
        for (i = 0; i < (o.moves || []).length; i++) {
            m = o.moves[i];
            at = snap(m.t * TICKS, f); to = snap(m.to * TICKS, f);
            if (Math.abs(to - at) < f) continue;
            if (rollAt(s, at, to)) { done++; created.push({ kind: 'roll', at: to, back: at, name: 'Coupe' }); }
        }
        return ok({ moved: done, created: created });
    }

    // Musiques et sons de la sequence, regroupes par fichier (credits, droits).
    function audioCredits(o) {
        var s = activeSeq(), list = audioClipsOf(s), by = {}, out = [], i, it, p, k, e;
        for (i = 0; i < list.length; i++) {
            it = list[i].item;
            p = it.projectItem ? mediaPathOf(it.projectItem) : '';
            k = p || it.name;
            e = by[k];
            if (!e) { e = by[k] = { name: it.projectItem ? it.projectItem.name : it.name, path: p, uses: 0, seconds: 0, first: Infinity, tracks: {} }; out.push(e); }
            e.uses++;
            e.seconds += secs(tk(it.end) - tk(it.start));
            e.first = Math.min(e.first, secs(tk(it.start)));
            e.tracks['A' + (list[i].track + 1)] = true;
        }
        for (i = 0; i < out.length; i++) {
            var t = [], q;
            for (q in out[i].tracks) if (out[i].tracks.hasOwnProperty(q)) t.push(q);
            out[i].tracks = t.join(' ');
        }
        out.sort(function (a, b) { return a.first - b.first; });
        return ok({ items: out, sequence: s.name });
    }

    // Preglages d'export (Media Encoder) fournis avec Premiere.
    function exportPresets(o) {
        var out = [], base = String(app.path || ''), roots = [base + '/MediaIO/systempresets', base + '/Contents/MediaIO/systempresets'], i;
        function walk(d, depth) {
            var files, j;
            try { files = d.getFiles(); } catch (e) { return; }
            for (j = 0; j < files.length && out.length < 300; j++) {
                if (files[j] instanceof Folder) { if (depth < 3) walk(files[j], depth + 1); }
                else if (/\.epr$/i.test(files[j].name)) out.push({ path: files[j].fsName, name: decodeURI(files[j].name).replace(/\.epr$/i, '') });
            }
        }
        for (i = 0; i < roots.length; i++) {
            try { var d = new Folder(roots[i]); if (d.exists) walk(d, 0); } catch (e) {}
        }
        return ok({ presets: out });
    }

    // Sequences cochees envoyees a Media Encoder, un fichier chacune (o.items : [{ id, file }]).
    function exportQueue(o) {
        var E = app.encoder, queued = [], failed = [], i, s, it, ext, job, dir;
        if (!E || !E.encodeSequence) return fail('Media Encoder est introuvable : installe-le avec ton abonnement Creative Cloud.');
        if (!o.preset) return fail('Choisis un pr\u00e9r\u00e9glage d\'export.');
        dir = new Folder(o.dir);
        if (!dir.exists) dir.create();
        try { if (E.launchEncoder) E.launchEncoder(); } catch (e0) {}
        for (i = 0; i < (o.items || []).length; i++) {
            it = o.items[i];
            s = seqById(it.id);
            if (!s) { failed.push(it.file + ' : s\u00e9quence introuvable'); continue; }
            ext = '';
            try { ext = s.getExportFileExtension ? s.getExportFileExtension(o.preset) : ''; } catch (e1) {}
            if (ext && ext.charAt(0) !== '.') ext = '.' + ext;
            try { job = E.encodeSequence(s, dir.fsName + '/' + it.file + (ext || '.mp4'), o.preset, E.ENCODE_ENTIRE !== undefined ? E.ENCODE_ENTIRE : 0, 1); } catch (e2) { job = null; }
            if (job === null || job === undefined || job === 0 || job === '0') failed.push(it.file); else queued.push({ file: it.file + (ext || '.mp4'), job: String(job) });
        }
        if (queued.length) { try { E.startBatch(); } catch (e3) {} }
        return ok({ queued: queued, failed: failed });
    }

    // Medias poses dans au moins une sequence (archive) : chemins uniques et projet.
    function usedMedia(o) {
        var u = usedItems(), out = [], seen = {}, missing = 0;
        walkItems(app.project.rootItem, function (x) {
            var p = '';
            if (x.type !== 1 || isSeqItem(x)) return true;
            if (!u.ids[x.nodeId] && !u.names[x.name]) return true;
            try { p = x.getMediaPath(); } catch (e) {}
            if (!p) return true;
            if (seen[norm(p)]) return true;
            seen[norm(p)] = true;
            try { if (x.isOffline && x.isOffline()) missing++; } catch (e2) {}
            out.push({ name: x.name, path: p });
            return true;
        });
        return ok({ files: out, project: app.project.path || '', projectName: app.project.name || '', offline: missing });
    }

    api.splitEdits = guard(splitEdits);
    api.cutList = guard(cutList);
    api.rollEdits = guard(rollEdits);
    api.audioCredits = guard(audioCredits);
    api.exportPresets = guard(exportPresets);
    api.exportQueue = guard(exportQueue);
    api.usedMedia = guard(usedMedia);

