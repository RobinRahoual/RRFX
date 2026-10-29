    // ============================================================ Parole (silences) et son (voix, musique)

    // ------------------------------------------------------------ public: parole (silences)

    // Plans du montage (hors calques, titres et habillages), avec leur piste.
    function allVideo(s) {
        var out = [], over = overlayIds(), i, j, list;
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) if (!isLayer(list[j]) && convKind(list[j], over) === 'rush') out.push({ item: list[j], track: i });
        }
        return out;
    }

    function audioItems(s, ti) {
        var out = [], tr = s.audioTracks[ti], i;
        if (!tr) return out;
        for (i = 0; i < tr.clips.numItems; i++) out.push(tr.clips[i]);
        out.sort(function (a, b) { return tk(a.start) - tk(b.start); });
        return out;
    }

    function clipInfo(c, kind, track) {
        var sp = 1;
        try { sp = c.getSpeed(); } catch (e) {}
        return { kind: kind, track: track, name: c.name, path: c.projectItem ? mediaPathOf(c.projectItem) : '', start: secs(tk(c.start)), end: secs(tk(c.end)), inPoint: secs(tk(c.inPoint)), speed: sp || 1 };
    }

    // Ce qui parle : les plans selectionnes (video et son lie, ou son seul), leurs pistes et limites.
    function speechTargets(s) {
        var f = tpf(s), sel = s.getSelection(), vids = selectedVideo(s), audio = audioClipsOf(s), out = { clips: [], v: [], a: [], lo: Infinity, hi: -Infinity };
        var linked = {}, seenV = {}, seenA = {}, i, k, c, a, b, info;
        function addA(ti) { if (!seenA[ti]) { seenA[ti] = true; out.a.push(ti); } }
        for (i = 0; i < vids.length; i++) {
            c = vids[i].item;
            if (isLayer(c) || isGraphic(c)) continue;
            a = tk(c.start); b = tk(c.end);
            if (!seenV[vids[i].track]) { seenV[vids[i].track] = true; out.v.push(vids[i].track); }
            info = clipInfo(c, 'video', vids[i].track);
            info.audio = [];
            for (k = 0; k < audio.length; k++) {
                if (Math.abs(tk(audio[k].item.start) - a) < f / 2 && Math.abs(tk(audio[k].item.end) - b) < f / 2) {
                    linked[audio[k].item.nodeId] = true;
                    addA(audio[k].track);
                    info.audio.push({ track: audio[k].track, start: secs(tk(audio[k].item.start)) });
                }
            }
            out.clips.push(info);
            out.lo = Math.min(out.lo, a); out.hi = Math.max(out.hi, b);
        }
        // Son seul (micro, podcast) : selectionne sans image liee.
        for (i = 0; sel && i < sel.length; i++) {
            if (sel[i].mediaType !== 'Audio' || linked[sel[i].nodeId]) continue;
            for (k = 0; k < audio.length; k++) {
                if (audio[k].item.nodeId !== sel[i].nodeId) continue;
                c = audio[k].item;
                addA(audio[k].track);
                info = clipInfo(c, 'audio', audio[k].track);
                info.audio = [{ track: audio[k].track, start: secs(tk(c.start)) }];
                out.clips.push(info);
                out.lo = Math.min(out.lo, tk(c.start)); out.hi = Math.max(out.hi, tk(c.end));
            }
        }
        return out;
    }

    function speechInfo(o) {
        var s = activeSeq(), t = speechTargets(s);
        return ok({ fps: TICKS / tpf(s), clips: t.clips, tracks: { video: t.v, audio: t.a } });
    }

    // Retire les silences (o.ranges, secondes de sequence) des plans selectionnes : coupe a la
    // lame sur leurs pistes (image et son), supprime les morceaux muets et recolle la suite.
    // o.copy : sur une copie de la sequence (l'original reste intact).
    function cutSilences(o) {
        var s = activeSeq(), P = app.project, t = speechTargets(s), f = tpf(s), ranges = [], merged = [], warnings = [], plan = [];
        var i, j, k, a, b, r, x, list, it, removed = 0, moved = 0, refused = 0, total = 0, before, ns, others = [];
        if (!t.clips.length) return fail('S\u00e9lectionne dans la timeline les plans o\u00f9 l\'on parle.');
        for (i = 0; i < (o.ranges || []).length; i++) {
            a = Math.max(snap(o.ranges[i].a * TICKS, f), t.lo);
            b = Math.min(snap(o.ranges[i].b * TICKS, f), t.hi);
            if (b - a >= f) ranges.push({ a: a, b: b });
        }
        ranges.sort(function (p, q) { return p.a - q.a; });
        for (i = 0; i < ranges.length; i++) {
            r = merged[merged.length - 1];
            if (r && ranges[i].a <= r.b) r.b = Math.max(r.b, ranges[i].b); else merged.push(ranges[i]);
        }
        ranges = merged;
        if (!ranges.length) return ok({ removed: 0, ranges: 0, seconds: 0, moved: 0, name: s.name, copy: false, warnings: [] });
        if (o.copy) {
            if (!s.clone || !P.sequences) return fail('Cette version de Premiere ne permet pas de dupliquer une s\u00e9quence par script : d\u00e9coche \u00ab Sur une copie \u00bb.');
            before = P.sequences.numSequences;
            s.clone();
            if (P.sequences.numSequences <= before) return fail('Premiere n\'a pas pu dupliquer la s\u00e9quence.');
            ns = P.sequences[P.sequences.numSequences - 1];
            try { ns.name = s.name + (o.suffix || ' (sans silences)'); } catch (e0) {}
            try { if (P.openSequence) P.openSequence(ns.sequenceID); } catch (e1) {}
            if (P.activeSequence !== ns) try { P.activeSequence = ns; } catch (e2) {}
            s = activeSeq();
        }
        var qs = qeSeq();
        // 1. Coupes aux bords de chaque silence, sur chaque piste concernee.
        for (i = 0; i < ranges.length; i++) {
            total += ranges[i].b - ranges[i].a;
            for (k = 0; k < 2; k++) {
                x = timecodeOf(s, k ? ranges[i].b : ranges[i].a);
                for (j = 0; j < t.v.length; j++) qs.getVideoTrackAt(t.v[j]).razor(x);
                for (j = 0; j < t.a.length; j++) qs.getAudioTrackAt(t.a[j]).razor(x);
            }
        }
        function inGap(p, q) {
            for (var m = 0; m < ranges.length; m++) if (p >= ranges[m].a - f / 2 && q <= ranges[m].b + f / 2) return true;
            return false;
        }
        function gapBefore(p) {
            var sum = 0, m;
            for (m = 0; m < ranges.length; m++) if (ranges[m].b <= p + f / 2) sum += ranges[m].b - ranges[m].a;
            return sum;
        }
        // 2. Morceaux muets retires, puis 3. la suite recollee (de gauche a droite, piste par piste).
        function collect(items) {
            for (var m = 0; m < items.length; m++) {
                it = items[m];
                a = tk(it.start);
                if (inGap(a, tk(it.end))) { try { it.remove(false, false); removed++; } catch (e3) { refused++; } continue; }
                b = gapBefore(a);
                if (b > 0) plan.push({ it: it, target: a - b });
            }
        }
        for (j = 0; j < t.v.length; j++) collect(clipsOf(s, t.v[j]));
        for (j = 0; j < t.a.length; j++) collect(audioItems(s, t.a[j]));
        for (i = 0; i < plan.length; i++) {
            // Le son lie a pu suivre son image : on ne le decale que s'il n'est pas deja en place.
            x = tk(plan[i].it.start);
            if (Math.abs(x - plan[i].target) <= 1) { moved++; continue; }
            if (shift(plan[i].it, plan[i].target - x)) moved++; else refused++;
        }
        if (refused) warnings.push(refused + ' morceau(x) que Premiere a refus\u00e9 de d\u00e9placer : v\u00e9rifie la fin de la s\u00e9quence');
        // Les autres pistes ne bougent pas : on le signale si elles ont du contenu apres la 1re coupe.
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            if (inList(t.v, i)) continue;
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) if (tk(list[j].end) > ranges[0].a) { others.push('V' + (i + 1)); break; }
        }
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            if (inList(t.a, i)) continue;
            list = audioItems(s, i);
            for (j = 0; j < list.length; j++) if (tk(list[j].end) > ranges[0].a) { others.push('A' + (i + 1)); break; }
        }
        if (others.length) warnings.push('Pistes non d\u00e9cal\u00e9es : ' + others.join(', ') + '. Coupe les silences avant d\'ajouter musique, plans de coupe et titres.');
        return ok({ removed: removed, ranges: ranges.length, seconds: total / TICKS, moved: moved, name: s.name, copy: !!o.copy, warnings: warnings });
    }

    // ------------------------------------------------------------ public: son (voix, musique)

    // Reglage " Niveau " du volume d'un element audio (0 a 1, 1 = +15 dB).
    var LEVEL = /^(level|niveau|pegel|nivel|livello)$/i;
    function levelParam(it) {
        var i, j, c, p;
        for (i = 0; i < it.components.numItems; i++) {
            c = it.components[i];
            if (!/^(volume|lautst.rke|volumen)$/i.test(c.displayName)) continue;
            for (j = 0; j < c.properties.numItems; j++) {
                p = c.properties[j];
                if (LEVEL.test(p.displayName)) return p;
            }
            if (c.properties.numItems > 1) return c.properties[1];
        }
        return null;
    }
    function dbOf(v) { return 20 * Math.log(Math.max(1e-9, v)) / Math.LN10 + 15; }
    function levelOf(db) { return Math.pow(10, (db - 15) / 20); }

    function audioAt(s, ti, sec) {
        var f = tpf(s), tr = s.audioTracks[ti], a = Math.round(sec * TICKS), j;
        if (!tr) return null;
        for (j = 0; j < tr.clips.numItems; j++) if (Math.abs(tk(tr.clips[j].start) - a) < f / 2) return tr.clips[j];
        return null;
    }

    // Musique qui baisse sous la voix : o.track, o.start (s, debut du clip de musique),
    // o.keys [[s de sequence, gain dB]]. La courbe de volume existante est remplacee.
    function duckMusic(o) {
        var s = activeSeq(), it = audioAt(s, o.track, o.start), p, base, baseDb, i, t, warnings = [], last;
        if (!it) return fail('Musique introuvable sur A' + (o.track + 1));
        p = levelParam(it);
        if (!p) return fail('R\u00e9glage de volume introuvable sur la musique');
        base = p.getValue();
        if (p.isTimeVarying()) {
            warnings.push('La courbe de volume de la musique a \u00e9t\u00e9 remplac\u00e9e');
            try { base = p.getValueAtTime(it.inPoint); } catch (e0) {}
            p.setTimeVarying(false);
        }
        if (!(base > 0)) base = levelOf(0);
        baseDb = dbOf(base);
        p.setTimeVarying(true);
        last = o.keys.length - 1;
        for (i = 0; i <= last; i++) {
            t = clipTime(it, Math.round(o.keys[i][0] * TICKS));
            p.addKey(t);
            p.setValueAtKey(t, levelOf(baseDb + o.keys[i][1]), i === last);
        }
        return ok({ keys: o.keys.length, created: [{ kind: 'level', track: o.track, start: tk(it.start), value: base, name: it.name }], warnings: warnings });
    }

    // Element audio QE pour ajouter un effet audio.
    function qeAudioFor(s, ti, a) {
        var qt = qeSeq().getAudioTrackAt(ti), f = tpf(s), i, q;
        for (i = 0; i < qt.numItems; i++) {
            q = qt.getItemAt(i);
            if (!q || q.type === 'Empty') continue;
            if (Math.abs(qeStart(q) - a) < f / 2) return q;
        }
        return null;
    }

    // Voix : o.clips [{ track, start (s), gain (dB) }] ; o.denoise : noms possibles de
    // l'effet de reduction du bruit (ajoute a chaque clip), ou rien.
    function voiceLevel(o) {
        var s = activeSeq(), created = [], warnings = [], done = 0, cleaned = 0, i, j, c, it, p, base, eff = null, q;
        if (o.denoise && o.denoise.length) {
            for (j = 0; j < o.denoise.length && !eff; j++) { try { eff = qe.project.getAudioEffectByName(o.denoise[j]); } catch (e0) { eff = null; } }
            if (!eff) warnings.push('Effet de r\u00e9duction du bruit introuvable : le niveau est r\u00e9gl\u00e9 sans d\u00e9bruitage');
        }
        for (i = 0; i < o.clips.length; i++) {
            c = o.clips[i];
            it = audioAt(s, c.track, c.start);
            if (!it) { warnings.push('Son introuvable sur A' + (c.track + 1)); continue; }
            p = levelParam(it);
            if (!p) { warnings.push(it.name + ' : r\u00e9glage de volume introuvable'); continue; }
            if (p.isTimeVarying()) { warnings.push(it.name + ' : volume anim\u00e9, laiss\u00e9 tel quel'); continue; }
            base = p.getValue();
            if (!(base > 0)) base = levelOf(0);
            p.setValue(levelOf(dbOf(base) + c.gain), true);
            created.push({ kind: 'level', track: c.track, start: tk(it.start), value: base, name: it.name });
            done++;
            if (eff) {
                q = qeAudioFor(s, c.track, tk(it.start));
                try { if (q) { q.addAudioEffect(eff); cleaned++; } } catch (e1) {}
            }
        }
        if (eff && cleaned < done) warnings.push('D\u00e9bruitage ajout\u00e9 sur ' + cleaned + ' clip(s) sur ' + done);
        return ok({ done: done, cleaned: cleaned, created: created, warnings: warnings });
    }

    api.speechInfo = guard(speechInfo);
    api.cutSilences = guard(cutSilences);
    api.duckMusic = guard(duckMusic);
    api.voiceLevel = guard(voiceLevel);

