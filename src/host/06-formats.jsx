    // ============================================================ Formats 9:16, 4:5, 1:1

    // ------------------------------------------------------------ public: formats (9:16, 4:5, 1:1)

    // Copie de la sequence active au format o.width x o.height (1080 x 1920 pour Reels, TikTok,
    // Shorts). Chaque rush recoit l'effet Recadrage automatique de Premiere (o.reframe : noms de
    // l'effet), qui suit le sujet ; sinon (o.mode 'fill' ou effet absent) il est agrandi pour
    // remplir le cadre, centre. Les calques de reglage et les titres ne bougent pas.
    // Echelle de Trajectoire multipliee par k (si elle n'est pas animee).
    function scaleBy(item, k) {
        var sc = componentByMatch(item, 'AE.ADBE Motion').properties[1];
        if (sc.isTimeVarying && sc.isTimeVarying()) return false;
        sc.setValue(Number(sc.getValue()) * k, true);
        return true;
    }

    function faceFor(list, track, start, f) {
        var i;
        for (i = 0; list && i < list.length; i++) if (list[i].track === track && Math.abs(list[i].start - start) < f / 2) return list[i];
        return null;
    }

    // Position de Trajectoire qui garde le visage au centre du nouveau cadre. sw, sh : taille de
    // l'image agrandie (1 = le cadre). face.keys : [[s depuis le debut du plan, x, y]] (0 a 1).
    function followFace(s, it, face, sw, sh) {
        var p, pixels, i, k, t, x, y, last, mx = Math.max(0, (sw - 1) / 2), my = Math.max(0, (sh - 1) / 2);
        if (!face || !face.keys || !face.keys.length) return false;
        p = componentByMatch(it, 'AE.ADBE Motion').properties[0];
        pixels = isPixelPoint(p);
        if (p.isTimeVarying()) p.setTimeVarying(false);
        p.setTimeVarying(true);
        last = face.keys.length - 1;
        for (i = 0; i <= last; i++) {
            k = face.keys[i];
            x = Math.min(0.5 + mx, Math.max(0.5 - mx, 0.5 - (k[1] - 0.5) * sw));
            y = Math.min(0.5 + my, Math.max(0.5 - my, 0.5 - (k[2] - 0.5) * sh));
            t = clipTime(it, tk(it.start) + Math.round(k[0] * TICKS));
            p.addKey(t);
            p.setValueAtKey(t, convert([x, y], { point: true }, pixels, s), i === last);
        }
        return true;
    }

    function formatCopy(o) {
        var s = activeSeq(), P = app.project, W = Math.round(o.width), H = Math.round(o.height), warnings = [], ns, st, before, k, i, j, list, it, comp, sc, over, kind;
        var reframed = 0, filled = 0, blurred = 0, faced = 0, top, oldW = Number(s.frameSizeHorizontal) || 1920, oldH = Number(s.frameSizeVertical) || 1080, id;
        if (!s.clone || !P.sequences) return fail('Cette version de Premiere ne permet pas de dupliquer une s\u00e9quence par script.');
        before = P.sequences.numSequences;
        s.clone();
        if (P.sequences.numSequences <= before) return fail('Premiere n\'a pas pu dupliquer la s\u00e9quence.');
        ns = P.sequences[P.sequences.numSequences - 1];
        try { ns.name = o.name || (s.name + ' (' + o.label + ')'); } catch (e0) {}
        st = ns.getSettings();
        st.videoFrameWidth = W;
        st.videoFrameHeight = H;
        ns.setSettings(st);
        if (Number(ns.frameSizeHorizontal) !== W || Number(ns.frameSizeVertical) !== H) warnings.push('Taille du cadre \u00e0 v\u00e9rifier : S\u00e9quence > Param\u00e8tres de la s\u00e9quence');
        // La copie devient la sequence active : QE agit sur elle.
        try { id = ns.sequenceID; if (P.openSequence) P.openSequence(id); } catch (e1) {}
        if (P.activeSequence !== ns) try { P.activeSequence = ns; } catch (e2) {}
        s = activeSeq();
        k = Math.max(W / oldW, H / oldH);
        over = overlayIds();
        // De haut en bas : le fond flou ajoute des pistes au-dessus de celle qu'il traite.
        for (i = s.videoTracks.numTracks - 1; i >= 0; i--) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                kind = convKind(it, over);
                if (kind !== 'rush' && kind !== 'over') continue;
                if (isGraphic(it)) continue;
                comp = null;
                // Fond flou : le plan entier net au-dessus, le meme plan agrandi et flou dessous.
                if (kind === 'rush' && o.mode === 'blur') {
                    try {
                        top = placeCopy(s, it, i, tk(it.start), tk(it.end), it.name, {}, blurred ? [] : warnings);
                        scaleBy(top.item, Math.min(W / oldW, H / oldH));
                        scaleBy(findItemAt(s, i, tk(it.start)), k);
                        comp = addEffect(s, i, tk(it.start), { names: o.blur && o.blur.length ? o.blur : ['Gaussian Blur', 'Flou gaussien'] }, blurred ? [] : warnings);
                        if (comp) {
                            try { comp.properties[0].setValue(o.blurAmount || 60, true); } catch (e4) {}
                            try { comp.properties[2].setValue(true, true); } catch (e5) {}
                        }
                        blurred++;
                    } catch (e6) { warnings.push(it.name + ' : ' + e6.toString()); }
                    continue;
                }
                // Suivi du visage : plan agrandi pour remplir, puis cadre qui suit le visage.
                if (kind === 'rush' && o.mode === 'face') {
                    try {
                        scaleBy(findItemAt(s, i, tk(it.start)), k);
                        filled++;
                        if (followFace(s, findItemAt(s, i, tk(it.start)), faceFor(o.faces, i, tk(it.start), tpf(s)), k * oldW / W, k * oldH / H)) faced++;
                    } catch (e7) { warnings.push(it.name + ' : ' + e7.toString()); }
                    continue;
                }
                if (kind === 'rush' && o.mode !== 'fill' && o.reframe && o.reframe.length) {
                    comp = addEffect(s, i, tk(it.start), { names: o.reframe }, reframed || filled ? [] : warnings);
                    if (comp) { reframed++; continue; }
                }
                // Remplissage centre : echelle de Trajectoire multipliee par k.
                comp = componentByMatch(findItemAt(s, i, tk(it.start)), 'AE.ADBE Motion');
                try {
                    sc = comp.properties[1];
                    if (!sc.isTimeVarying || !sc.isTimeVarying()) { sc.setValue(Number(sc.getValue()) * k, true); filled++; }
                } catch (e3) {}
            }
        }
        return ok({ name: s.name, reframed: reframed, filled: filled, blurred: blurred, faced: faced, width: W, height: H, warnings: warnings });
    }

    api.formatCopy = guard(formatCopy);

