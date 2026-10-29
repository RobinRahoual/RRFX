    // ============================================================ Musique : rushs, decoupe sur le rythme, synchronisation, multicam, apercu

    // ------------------------------------------------------------ public: musique, rushs

    // La musique : le clip son selectionne, sinon le plus long clip son de la sequence.
    function musicInfo(o) {
        var s = activeSeq(), f = tpf(s), sel = s.getSelection(), vids = selectedVideo(s), best = null, list, i, it, d, bd = -1, tr = 0, sp = 1;
        // Le son lie a un clip video selectionne (son de la camera) n'est pas la musique.
        function linkedToSelection(a) {
            for (var k = 0; k < vids.length; k++) {
                if (Math.abs(tk(vids[k].item.start) - tk(a.start)) < f / 2 && Math.abs(tk(vids[k].item.end) - tk(a.end)) < f / 2) return true;
            }
            return false;
        }
        // o.notSelected : la selection, c'est la voix (musique sous la voix) : jamais la musique.
        var picked = {};
        if (sel) for (i = 0; i < sel.length; i++) picked[sel[i].nodeId] = true;
        if (sel && !(o && o.notSelected)) for (i = 0; i < sel.length; i++) if (sel[i].mediaType === 'Audio' && !linkedToSelection(sel[i])) { best = sel[i]; break; }
        // Sinon : le plus long son qui n'accompagne aucune image (la musique n'a pas de video).
        function withVideo(a) {
            for (var t = 0; t < s.videoTracks.numTracks; t++) {
                var v = clipsOf(s, t);
                for (var k = 0; k < v.length; k++) {
                    if (Math.abs(tk(v[k].start) - tk(a.start)) < f / 2 && Math.abs(tk(v[k].end) - tk(a.end)) < f / 2) return true;
                }
            }
            return false;
        }
        list = audioClipsOf(s);
        for (var pass = 0; pass < 2 && !best && !it; pass++) {
            for (i = 0; i < list.length; i++) {
                // Le son pose par RR FX (camera de reference) n'est jamais la musique.
                if (/^RR FX \u00b7 /.test(list[i].item.name) || linkedToSelection(list[i].item) || (o && o.notSelected && picked[list[i].item.nodeId]) || (pass === 0 && withVideo(list[i].item))) continue;
                d = tk(list[i].item.end) - tk(list[i].item.start);
                if (d > bd) { bd = d; it = list[i].item; tr = list[i].track; }
            }
        }
        if (best) for (i = 0; i < list.length; i++) if (list[i].item.nodeId === best.nodeId) tr = list[i].track;
        best = best || it;
        if (!best) return fail('Aucun son dans la s\u00e9quence : pose ta musique sur une piste audio.');
        try { sp = best.getSpeed(); } catch (e) {}
        return ok({
            name: best.name, path: best.projectItem ? mediaPathOf(best.projectItem) : '', track: tr,
            start: secs(tk(best.start)), end: secs(tk(best.end)), inPoint: secs(tk(best.inPoint)), speed: sp || 1
        });
    }

    // Rushs selectionnes dans le panneau Projet, avec leur plage utile (points d'entree/sortie).
    function projectRushes(o) {
        var sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null, out = [], i, pi, a, b, isSeq;
        if (!sel || !sel.length) return fail('S\u00e9lectionne des rushs dans le panneau Projet.');
        for (i = 0; i < sel.length; i++) {
            pi = sel[i];
            isSeq = false;
            try { isSeq = !!(pi.isSequence && pi.isSequence()); } catch (e) {}
            if (pi.type !== 1 || isSeq || isAdjustment(pi)) continue;
            a = 0; b = 0;
            try { a = tk(pi.getInPoint(1)); b = tk(pi.getOutPoint(1)); } catch (e2) {}
            if (!(b > a)) b = mediaEndOf(pi);
            out.push({ nodeId: pi.nodeId, name: pi.name, path: mediaPathOf(pi), inT: secs(a), outT: secs(b) });
        }
        if (!out.length) return fail('Aucun rush vid\u00e9o dans la s\u00e9lection du panneau Projet.');
        return ok({ rushes: out });
    }

    // Pose des extraits de rushs (video seule) : items [{ nodeId, seqStart, seqEnd, srcIn }] en secondes.
    // Son d'un rush sur une piste audio libre (synchro multicam : son de la camera de reference).
    function placeRushAudio(s, master, a, b, inT, label, created, warnings) {
        var src, ai, tr, it;
        try {
            src = audioSourceOf(master);
            ai = pickAudioTrack(s, a, b, warnings);
            tr = s.audioTracks[ai];
            try { src.setInPoint(inT / TICKS, 4); src.setOutPoint((inT + b - a) / TICKS, 4); } catch (e) {}
            tr.overwriteClip(src, mkTime(a));
            try { src.clearInPoint(); src.clearOutPoint(); } catch (e2) {}
            it = findAudioAt(s, ai, a);
            if (!it) throw new Error('son non pos\u00e9');
            fixSpan(it, a, b);
            try { it.name = label; } catch (e3) {}
            created.push({ kind: 'aud', track: ai, start: a, name: label });
        } catch (err) {
            warnings.push(master.name + ' : son de r\u00e9f\u00e9rence non pos\u00e9 (' + err.toString() + ')');
        }
    }

    function placeRushes(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, x, pi, sub, a, b, lo = Infinity, hi = -Infinity, ti, it, label = o.label || 'RR FX \u00b7 Montage', cache = {};
        for (i = 0; i < o.items.length; i++) {
            lo = Math.min(lo, snap(o.items[i].seqStart * TICKS, f));
            hi = Math.max(hi, snap(o.items[i].seqEnd * TICKS, f));
        }
        if (!(hi > lo)) return fail('Rien \u00e0 poser.');
        ti = o.track != null && o.track < s.videoTracks.numTracks && trackClear(s, o.track, lo, hi) ? o.track : pickTrack(s, o.minTrack || 0, lo, hi, warnings);
        for (i = 0; i < o.items.length; i++) {
            x = o.items[i];
            try {
                pi = null;
                if (!cache[x.nodeId]) {
                    pi = walk(app.project.rootItem, function (c) { return c.nodeId === x.nodeId; });
                    if (!pi) throw new Error('rush introuvable dans le projet');
                    cache[x.nodeId] = videoSourceOf(pi);
                }
                sub = cache[x.nodeId];
                a = snap(x.seqStart * TICKS, f);
                b = snap(x.seqEnd * TICKS, f);
                if (b <= a) continue;
                it = placeOn(s, ti, sub, a, x.srcIn * TICKS, x.srcIn * TICKS + (b - a));
                fixSpan(it, a, b);
                try { it.name = label; } catch (e) {}
                created.push({ kind: 'adj', track: ti, start: a, name: label });
                if (x.audio) placeRushAudio(s, pi || walk(app.project.rootItem, function (c) { return c.nodeId === x.nodeId; }), a, b, x.srcIn * TICKS, label, created, warnings);
            } catch (err) {
                warnings.push((x.name || 'Rush') + ' : ' + err.toString());
            }
        }
        return ok({ created: created, track: ti, warnings: warnings });
    }

    // ------------------------------------------------------------ public: decoupe sur le rythme

    function cutAtTimes(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), qs = qeSeq(), cuts = 0, i, j, k, c, a, b, t, audio = audioClipsOf(s), plan = [];
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c)) continue;
            a = tk(c.start); b = tk(c.end);
            var tracks = [], times = [];
            for (k = 0; k < audio.length; k++) {
                if (Math.abs(tk(audio[k].item.start) - a) < f / 2 && Math.abs(tk(audio[k].item.end) - b) < f / 2) tracks.push(audio[k].track);
            }
            for (j = 0; j < o.times.length; j++) {
                t = snap(o.times[j] * TICKS, f);
                if (t > a + f / 2 && t < b - f / 2) times.push(t);
            }
            plan.push({ track: sel[i].track, audio: tracks, times: times });
        }
        if (!plan.length) return fail('S\u00e9lectionne dans la timeline les clips \u00e0 d\u00e9couper.');
        for (i = 0; i < plan.length; i++) {
            for (j = 0; j < plan[i].times.length; j++) {
                t = timecodeOf(s, plan[i].times[j]);
                qs.getVideoTrackAt(plan[i].track).razor(t);
                for (k = 0; k < plan[i].audio.length; k++) qs.getAudioTrackAt(plan[i].audio[k]).razor(t);
                cuts++;
            }
        }
        return ok({ cuts: cuts, clips: plan.length });
    }

    // ------------------------------------------------------------ public: synchronisation

    function syncInfo(o) {
        var s = activeSeq(), sel = selectedVideo(s), clips = [], i, c, sp, m = parse(musicInfo({})), r;
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c) || !c.projectItem) continue;
            sp = 1;
            try { sp = c.getSpeed(); } catch (e) {}
            clips.push({
                track: sel[i].track, name: c.name, path: mediaPathOf(c.projectItem),
                start: secs(tk(c.start)), end: secs(tk(c.end)), inPoint: secs(tk(c.inPoint)), outPoint: secs(tk(c.outPoint)), speed: sp || 1
            });
        }
        r = clips.length ? null : parse(projectRushes({}));
        return ok({ music: m.ok ? m : null, musicError: m.ok ? '' : m.error, clips: clips, rushes: r && r.ok ? r.rushes : [] });
    }

    function trackClearExcept(s, ti, a, b, self) {
        var list = clipsOf(s, ti), i;
        for (i = 0; i < list.length; i++) {
            if (list[i].nodeId === self.nodeId) continue;
            if (tk(list[i].start) < b && a < tk(list[i].end)) return false;
        }
        return true;
    }

    // Decale un element ; verifie le resultat (la facon d'appeler move() varie selon les versions).
    function shift(it, delta) {
        var before = tk(it.start), target = before + delta;
        try { it.move(mkTime(delta)); } catch (e) {}
        if (Math.abs(tk(it.start) - target) <= 1) return true;
        if (Math.abs(tk(it.start) - before) <= 1) {
            try { it.move(delta / TICKS); } catch (e2) {}
            if (Math.abs(tk(it.start) - target) <= 1) return true;
        }
        return false;
    }

    // moves : [{ track, start (s), name, delta (s) }] - clips de la timeline, avec leur son lie.
    function moveClips(o) {
        var s = activeSeq(), f = tpf(s), moved = 0, warnings = [], i, k, mv, it, a, b, d, audio, linked;
        for (i = 0; i < o.moves.length; i++) {
            mv = o.moves[i];
            it = findClip(s, mv.track, snap(mv.start * TICKS, f), mv.name);
            if (!it) { warnings.push(mv.name + ' : introuvable'); continue; }
            d = snap(mv.delta * TICKS, f);
            if (!d) { moved++; continue; }
            a = tk(it.start); b = tk(it.end);
            if (a + d < 0) { warnings.push(mv.name + ' : il faudrait le placer avant le d\u00e9but de la s\u00e9quence'); continue; }
            if (!trackClearExcept(s, mv.track, a + d, b + d, it)) { warnings.push(mv.name + ' : la place est occup\u00e9e sur V' + (mv.track + 1)); continue; }
            audio = audioClipsOf(s);
            linked = [];
            for (k = 0; k < audio.length; k++) {
                if (Math.abs(tk(audio[k].item.start) - a) < f / 2 && Math.abs(tk(audio[k].item.end) - b) < f / 2) linked.push(audio[k].item);
            }
            if (!shift(it, d)) { warnings.push(mv.name + ' : Premiere a refus\u00e9 le d\u00e9placement'); continue; }
            for (k = 0; k < linked.length; k++) {
                if (Math.abs(tk(linked[k].start) - (a + d)) > 1 && !shift(linked[k], d)) warnings.push(mv.name + ' : son li\u00e9 non d\u00e9plac\u00e9');
            }
            moved++;
        }
        return ok({ moved: moved, warnings: warnings });
    }

    // ------------------------------------------------------------ public: montage multicam
    // Les cameras synchronisees sont empilees (une piste par camera). A chaque temps,
    // une seule reste active : les autres plans sont desactives (rien n'est supprime).

    function setDisabled(it, v) {
        try { it.disabled = v; } catch (e) { return false; }
        return it.disabled === v;
    }

    // Reactive les plans desactives par RR FX (nom d'origine suivi de " . RR FX off ").
    function multicamEnable(s, tracks, a, b) {
        var n = 0, i, j, list, it, tag = ' \u00b7 RR FX off';
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            if (tracks && !inList(tracks, i)) continue;
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!(tk(it.start) < b && a < tk(it.end))) continue;
                if (String(it.name).substr(String(it.name).length - tag.length) !== tag) continue;
                setDisabled(it, false);
                try { it.name = String(it.name).substr(0, String(it.name).length - tag.length); } catch (e) {}
                n++;
            }
        }
        return n;
    }

    function inList(list, v) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i] === v) return true;
        return false;
    }

    // Plans d'une piste (hors calques RR FX) avec leurs bornes, lues une fois.
    function spans(s, ti) {
        var list = clipsOf(s, ti), out = [], i;
        for (i = 0; i < list.length; i++) if (!isLayer(list[i])) out.push({ it: list[i], a: tk(list[i].start), b: tk(list[i].end) });
        return out;
    }

    function covers(list, t) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i].a <= t && t < list[i].b) return true;
        return false;
    }

    // Un plan coupe en t (t strictement a l'interieur, pas deja sur une coupe).
    function inside(list, t, f) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i].a < t - f / 2 && t + f / 2 < list[i].b) return true;
        return false;
    }

    function multicamSwitch(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), qs, cams = [], lo = Infinity, hi = -Infinity, i, j, k, c, t, bounds, lists = [], probe;
        var seg = [], pick, prev = -1, seed = (o.seed || 1) % 2147483647, mid, cover, switches = 0, tag = ' \u00b7 RR FX off', a, b, offN = 0, p, x;
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c)) continue;
            if (!inList(cams, sel[i].track)) cams.push(sel[i].track);
            lo = Math.min(lo, tk(c.start)); hi = Math.max(hi, tk(c.end));
        }
        cams.sort(function (x1, y1) { return x1 - y1; });
        if (cams.length < 2) return fail('S\u00e9lectionne les plans de deux cam\u00e9ras ou plus, synchronis\u00e9es et empil\u00e9es (une piste par cam\u00e9ra).');
        bounds = [lo];
        for (j = 0; j < o.times.length; j++) {
            t = snap(o.times[j] * TICKS, f);
            if (t > bounds[bounds.length - 1] + f / 2 && t < hi - f / 2) bounds.push(t);
        }
        bounds.push(hi);
        if (bounds.length < 3) return fail('Aucun temps dans la zone s\u00e9lectionn\u00e9e.');
        // Avant de couper quoi que ce soit : ce Premiere sait-il desactiver un plan par script ?
        probe = sel[0].item;
        if (!setDisabled(probe, !probe.disabled)) return fail('Cette version de Premiere ne permet pas de d\u00e9sactiver un plan par script.');
        setDisabled(probe, !probe.disabled);
        multicamEnable(s, cams, lo, hi);
        // Coupe chaque camera a chaque temps (le son n'est pas touche).
        qs = qeSeq();
        for (k = 0; k < cams.length; k++) {
            x = spans(s, cams[k]);
            for (j = 1; j < bounds.length - 1; j++) {
                if (inside(x, bounds[j], f)) qs.getVideoTrackAt(cams[k]).razor(timecodeOf(s, bounds[j]));
            }
        }
        for (k = 0; k < cams.length; k++) lists.push({ track: cams[k], items: spans(s, cams[k]), next: 0 });
        for (j = 0; j < bounds.length - 1; j++) {
            a = bounds[j]; b = bounds[j + 1]; mid = (a + b) / 2;
            cover = [];
            for (k = 0; k < lists.length; k++) if (covers(lists[k].items, mid)) cover.push(cams[k]);
            if (!cover.length) { seg.push(-1); continue; }
            if (o.order === 'random') {
                seed = (seed * 48271) % 2147483647;
                pick = cover[seed % cover.length];
                if (pick === prev && cover.length > 1) pick = cover[(seed + 1) % cover.length];
            } else {
                pick = cams[j % cams.length];
                if (!inList(cover, pick)) pick = cover[j % cover.length];
            }
            if (pick !== prev) switches++;
            prev = pick;
            seg.push(pick);
            // Les listes sont triees : chaque piste avance son curseur au lieu de tout relire.
            for (k = 0; k < lists.length; k++) {
                p = lists[k];
                while (p.next < p.items.length && p.items[p.next].b <= a + f / 2) p.next++;
                if (p.track === pick) continue;
                for (i = p.next; i < p.items.length && p.items[i].a < b - f / 2; i++) {
                    x = p.items[i];
                    if (x.a >= a - f / 2 && x.b <= b + f / 2) {
                        setDisabled(x.it, true);
                        try { x.it.name = x.it.name + tag; } catch (e) {}
                        offN++;
                    }
                }
            }
        }
        return ok({ segments: bounds.length - 1, switches: switches, cams: cams.length, disabled: offN, plan: seg, entry: { kind: 'mc', tracks: cams, a: lo, b: hi } });
    }

    // ------------------------------------------------------------ public: apercu sur la vraie image

    function grabFrames(o) {
        var s = activeSeq(), f = tpf(s), ph = snap(tk(s.getPlayerPosition()), f), ref = refClip(s), track = ref ? ref.track : 0, cut = nearestEdit(s, track, ph), q = qeSeq(), files = [], times, i;
        if (cut === null) cut = ph;
        if (!q || !q.exportFramePNG) return fail('Cette version de Premiere ne permet pas d\'exporter une image par script.');
        times = [Math.max(0, cut - f), cut];
        for (i = 0; i < times.length; i++) {
            files.push(o.folder + '/' + o.prefix + i);
            q.exportFramePNG(timecodeOf(s, times[i]), files[i]);
        }
        return ok({ files: files, cut: secs(cut) });
    }

    api.musicInfo = guard(musicInfo);
    api.projectRushes = guard(projectRushes);
    api.placeRushes = guard(placeRushes);
    api.cutAtTimes = guard(cutAtTimes);
    api.multicamSwitch = guard(multicamSwitch);
    api.syncInfo = guard(syncInfo);
    api.moveClips = guard(moveClips);
    api.grabFrames = guard(grabFrames);

