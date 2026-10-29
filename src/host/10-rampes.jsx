    // ============================================================ Speed ramps

    // ------------------------------------------------------------ public: speed ramps
    // Premiere does not expose Time Remapping to scripts, so a ramp is built from
    // constant-speed pieces: the zone is razored, each piece gets its speed and its
    // source range so that the sequence timing (the cut) never moves.

    function rampResolve(o) {
        var s = activeSeq(), f = tpf(s), N = Math.max(2, Math.round(o.frames || 12)), ph = snap(tk(s.getPlayerPosition()), f);
        var ref = refClip(s), track = ref ? ref.track : 0, clip = null, cut, a, b, anchor = 'start';
        if (o.placement === 'pre' || o.placement === 'post') {
            cut = nearestEdit(s, track, ph);
            if (cut === null) return fail('Aucune coupe trouv\u00e9e sur la piste V' + (track + 1));
            if (o.placement === 'pre') {
                clip = clipEndingAt(s, track, cut);
                if (!clip) return fail('Pas de clip qui se termine sur cette coupe.');
                a = Math.max(tk(clip.start), cut - N * f); b = cut; anchor = 'end';
            } else {
                clip = clipContaining(s, track, cut);
                if (!clip) return fail('Pas de clip qui commence sur cette coupe.');
                a = cut; b = Math.min(tk(clip.end), cut + N * f);
            }
        } else if (o.placement === 'playhead') {
            clip = ref ? (selectedVideo(s).length ? ref.item : clipContaining(s, track, ph)) : null;
            if (!clip) return fail('Placez la t\u00eate de lecture sur un clip.');
            a = Math.max(tk(clip.start), ph - Math.floor(N / 2) * f);
            b = Math.min(tk(clip.end), a + N * f);
        } else {
            if (!ref) return fail('S\u00e9lectionnez un clip.');
            clip = ref.item;
            a = tk(clip.start); b = tk(clip.end);
        }
        var speed = 1;
        try { speed = clip.getSpeed(); } catch (e) {}
        return ok({
            fps: TICKS / f, track: track, clipStart: tk(clip.start), clipEnd: tk(clip.end), clipName: clip.name,
            regionStart: a, regionEnd: b, frames: Math.round((b - a) / f), speed: speed, anchor: anchor
        });
    }

    function setSource(it, inT, outT) {
        if (inT < tk(it.outPoint)) {
            it.inPoint = mkTime(inT);
            it.outPoint = mkTime(outT);
        } else {
            it.outPoint = mkTime(outT);
            it.inPoint = mkTime(inT);
        }
    }

    function fixSpan(it, a, b) {
        if (Math.abs(tk(it.start) - a) > 1) { try { it.start = mkTime(a); } catch (e) {} }
        if (Math.abs(tk(it.end) - b) > 1) { try { it.end = mkTime(b); } catch (e2) {} }
    }

    // La rampe est posee sur une copie du passage, en morceaux de vitesse constante
    // (Premiere ne laisse pas les scripts piloter le remappage temporel). Le clip
    // d'origine, son son et la coupe ne bougent pas ; chaque morceau s'appelle
    // " RR FX . Rampe " et l'annulation du panneau les retire.
    function rampApply(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], item, S, I, s0 = 1, R0 = o.regionStart, R1, K = o.pieces.length;
        var bnd = [R0], L = [], total = 0, k, srcStart, end = null, src, ti, reach, it, plan = [], srcK, bad = [], label = 'RR FX \u00b7 Rampe';
        item = findClip(s, o.track, o.clipStart, o.clipName);
        if (!item) return fail('Clip introuvable : il a boug\u00e9 depuis l\'analyse. R\u00e9essaie.');
        S = tk(item.start); I = tk(item.inPoint);
        try { s0 = item.getSpeed(); } catch (e) {}
        if (!(s0 > 0)) s0 = 1;
        try { if (item.isSpeedReversed && item.isSpeedReversed()) return fail('Les clips invers\u00e9s ne sont pas pris en charge.'); } catch (e2) {}

        for (k = 0; k < K; k++) {
            bnd.push(bnd[k] + o.pieces[k].frames * f);
            L.push(Math.round(o.pieces[k].speed / 100 * o.pieces[k].frames * f));
            total += L[k];
        }
        R1 = bnd[K];
        srcStart = o.anchor === 'end' ? I + (R1 - S) * s0 - total : I + (R0 - S) * s0;
        if (srcStart < -f / 2) {
            return fail('Pas assez de m\u00e9dia avant : il manque ' + Math.ceil(-srcStart / f) + ' images. Choisis l\'ancre \u00ab Garder l\'image de d\u00e9but \u00bb ou r\u00e9duis la vitesse.');
        }
        srcStart = Math.max(0, srcStart);
        try { end = mediaEndOf(item.projectItem); } catch (e3) {}
        if (end && srcStart + total > end + f / 2) {
            return fail('Pas assez de m\u00e9dia apr\u00e8s : il manque ' + Math.ceil((srcStart + total - end) / f) + ' images. Choisis l\'ancre \u00ab Garder l\'image de fin \u00bb ou r\u00e9duis la vitesse.');
        }

        src = videoSource(item);
        reach = R1;
        srcK = srcStart;
        for (k = 0; k < K; k++) {
            plan.push({ a: bnd[k], b: bnd[k + 1], inT: srcK, outT: srcK + L[k], speed: o.pieces[k].speed / 100 });
            reach = Math.max(reach, bnd[k] + L[k]);
            srcK += L[k];
        }
        ti = layerTrack(s, o.track, R0, reach, warnings);

        // Dans l'ordre : chaque morceau est pose a 100 % puis mis a sa vitesse, ce qui le
        // ramene exactement a sa place ; la place du suivant est encore libre.
        for (k = 0; k < K; k++) {
            placeOn(s, ti, src, plan[k].a, plan[k].inT, plan[k].outT);
            setSpeedAt(s, ti, plan[k].a, plan[k].speed);
            it = findItemAt(s, ti, plan[k].a);
            try { setSource(it, plan[k].inT, plan[k].outT); } catch (e4) {}
            fixSpan(it, plan[k].a, plan[k].b);
            try { it.name = label; } catch (e5) {}
            created.push({ kind: 'adj', track: ti, start: plan[k].a, name: label });
            if (o.interp && o.interp !== 'keep') {
                try {
                    var q = qeItemFor(s, ti, plan[k].a);
                    if (q && q.setTimeInterpolationType) q.setTimeInterpolationType(o.interp === 'flow' ? 2 : 1);
                    else if (k === 0) warnings.push('Interpolation temporelle \u00e0 r\u00e9gler \u00e0 la main (Clip > Options vid\u00e9o)');
                } catch (e6) { if (k === 0) warnings.push('Interpolation temporelle \u00e0 r\u00e9gler \u00e0 la main (Clip > Options vid\u00e9o)'); }
            }
        }
        for (k = 0; k < K; k++) {
            it = findItemAt(s, ti, plan[k].a);
            if (!it || Math.abs(tk(it.end) - plan[k].b) > f / 2) bad.push(k + 1);
            else if (o.copyLook !== false) copyLook(s, item, ti, plan[k].a, k === 0 ? warnings : []);
        }
        if (bad.length) warnings.push('Morceaux \u00e0 v\u00e9rifier : ' + bad.join(', '));
        return ok({ pieces: K, sourceFrames: total / f, track: ti, created: created, warnings: warnings });
    }

    api.rampResolve = guard(rampResolve);
    api.rampApply = guard(rampApply);

