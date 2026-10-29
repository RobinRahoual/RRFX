    // ============================================================ Sequences : volume, extraits, verification, plans de coupe, modeles

    // ------------------------------------------------------------ 2.4

    // Volume d'un son anime par images cles o.keys [[temps sequence (s), dB par rapport au niveau
    // actuel]] : respirations et clics baisses, bruitages... Annulable (niveau d'avant remis).
    function gainKeys(o) {
        var s = activeSeq(), it = audioAt(s, o.track, o.start), p, base, baseDb, i, t, warnings = [], last, a, b;
        if (!it) return fail('Son introuvable sur A' + (o.track + 1) + (o.label ? ' (' + o.label + ')' : ''));
        p = levelParam(it);
        if (!p) return fail(it.name + ' : r\u00e9glage de volume introuvable');
        base = p.getValue();
        if (p.isTimeVarying()) {
            warnings.push(it.name + ' : la courbe de volume a \u00e9t\u00e9 remplac\u00e9e');
            try { base = p.getValueAtTime(it.inPoint); } catch (e0) {}
            p.setTimeVarying(false);
        }
        if (!(base > 0)) base = levelOf(0);
        baseDb = dbOf(base);
        a = tk(it.start) / TICKS; b = tk(it.end) / TICKS;
        p.setTimeVarying(true);
        last = o.keys.length - 1;
        for (i = 0; i <= last; i++) {
            if (o.keys[i][0] < a || o.keys[i][0] > b) continue;
            t = clipTime(it, Math.round(o.keys[i][0] * TICKS));
            p.addKey(t);
            p.setValueAtKey(t, levelOf(baseDb + o.keys[i][1]), i === last);
        }
        return ok({ keys: o.keys.length, created: [{ kind: 'level', track: o.track, start: tk(it.start), value: base, name: it.name }], warnings: warnings });
    }

    // Toutes les sequences du projet (pour les traiter en lot).
    function listSequences(o) {
        var P = app.project, out = [], i, sq, a = P.activeSequence, end;
        for (i = 0; i < P.sequences.numSequences; i++) {
            sq = P.sequences[i];
            end = 0;
            try { end = tk(sq.end) / TICKS; } catch (e) {}
            out.push({ id: sq.sequenceID, name: sq.name, w: Number(sq.frameSizeHorizontal) || 0, h: Number(sq.frameSizeVertical) || 0, end: end });
        }
        return ok({ sequences: out, active: a ? a.sequenceID : '' });
    }

    function openSequence(o) {
        var s = useSeq(o.id);
        return ok({ id: s.sequenceID, name: s.name });
    }

    // Extrait [o.a, o.b] (s) dans une copie de la sequence, recolle au debut : toutes les pistes.
    function extractCopy(o) {
        var s = activeSeq(), P = app.project, f = tpf(s), A = snap(o.a * TICKS, f), B = snap(o.b * TICKS, f), ns, before, qs, i, j, k, list, it, x, warnings = [], refused = 0, kept = 0;
        if (!(B - A >= f)) return fail('Extrait trop court');
        if (!s.clone || !P.sequences) return fail('Cette version de Premiere ne permet pas de dupliquer une s\u00e9quence par script.');
        before = P.sequences.numSequences;
        s.clone();
        if (P.sequences.numSequences <= before) return fail('Premiere n\'a pas pu dupliquer la s\u00e9quence.');
        ns = P.sequences[P.sequences.numSequences - 1];
        try { ns.name = o.name || (s.name + ' \u00b7 Extrait'); } catch (e0) {}
        try { if (P.openSequence) P.openSequence(ns.sequenceID); } catch (e1) {}
        if (P.activeSequence !== ns) try { P.activeSequence = ns; } catch (e2) {}
        s = activeSeq();
        qs = qeSeq();
        // Coupes aux deux bords, sur toutes les pistes.
        for (k = 0; k < 2; k++) {
            x = timecodeOf(s, k ? B : A);
            for (j = 0; j < s.videoTracks.numTracks; j++) { try { qs.getVideoTrackAt(j).razor(x); } catch (e3) {} }
            for (j = 0; j < s.audioTracks.numTracks; j++) { try { qs.getAudioTrackAt(j).razor(x); } catch (e4) {} }
        }
        function clean(items) {
            for (var m = 0; m < items.length; m++) {
                it = items[m];
                if (tk(it.end) <= A + f / 2 || tk(it.start) >= B - f / 2) { try { it.remove(false, false); } catch (e5) { refused++; } } else kept++;
            }
        }
        for (j = 0; j < s.videoTracks.numTracks; j++) clean(clipsOf(s, j));
        for (j = 0; j < s.audioTracks.numTracks; j++) clean(audioItems(s, j));
        // Tout recule de A (de gauche a droite : rien ne se chevauche).
        if (A > 0) {
            for (j = 0; j < s.videoTracks.numTracks; j++) {
                list = clipsOf(s, j);
                for (i = 0; i < list.length; i++) if (Math.abs(tk(list[i].start) - (tk(list[i].start) - A)) > 1 && tk(list[i].start) >= A - f / 2) { if (!shift(list[i], -A)) refused++; }
            }
            for (j = 0; j < s.audioTracks.numTracks; j++) {
                list = audioItems(s, j);
                // Le son lie a pu suivre son image.
                for (i = 0; i < list.length; i++) if (tk(list[i].start) >= A - f / 2) { if (!shift(list[i], -A)) refused++; }
            }
        }
        if (refused) warnings.push(refused + ' morceau(x) que Premiere a refus\u00e9 de couper ou d\u00e9placer : v\u00e9rifie l\'extrait');
        return ok({ name: s.name, id: s.sequenceID, seconds: (B - A) / TICKS, kept: kept, warnings: warnings });
    }

    // Verification avant export : medias hors ligne, images noires, clips desactives, pistes
    // coupees, volume pousse, textes RR FX hors zone sure. -> { issues: [{ level, t, where, text }] }
    function preflight(o) {
        var s = activeSeq(), f = tpf(s), issues = [], i, j, list, it, spans = [], end = 0, a, b, p, v, comp, pos, W, H, vertical, lo, hi, cur, tr, fps = TICKS / f;
        W = Number(s.frameSizeHorizontal) || 1920; H = Number(s.frameSizeVertical) || 1080; vertical = H > W;
        function add(level, t, where, text) { issues.push({ level: level, t: t / TICKS, where: where, text: text }); }
        function offline(item) { try { return item.projectItem && item.projectItem.isOffline && item.projectItem.isOffline(); } catch (e) { return false; } }
        function disabled(item) { try { return item.disabled === true; } catch (e) { return false; } }
        function isAdj(item) { try { return !!item.projectItem && isAdjustment(item.projectItem); } catch (e) { return false; } }
        for (j = 0; j < s.videoTracks.numTracks; j++) {
            tr = s.videoTracks[j];
            list = clipsOf(s, j);
            try { if (tr.isMuted && tr.isMuted() && list.length) add('warn', tk(list[0].start), 'V' + (j + 1), 'Piste vid\u00e9o masqu\u00e9e (\u0153il ferm\u00e9) : ses clips ne seront pas export\u00e9s'); } catch (e0) {}
            for (i = 0; i < list.length; i++) {
                it = list[i]; a = tk(it.start); b = tk(it.end);
                end = Math.max(end, b);
                if (offline(it)) add('error', a, 'V' + (j + 1), 'M\u00e9dia hors ligne : ' + it.name);
                if (disabled(it)) add('warn', a, 'V' + (j + 1), 'Clip d\u00e9sactiv\u00e9 : ' + it.name);
                if (!isAdj(it) && !/^RR FX/.test(String(it.name))) spans.push([a, b]);
                // Textes poses par RR FX : position dans la zone sure.
                if (/^RR FX \u00b7 (Texte|Sous-titres|Bandeau)/.test(String(it.name)) || it.getMGTComponent) {
                    try {
                        comp = componentByMatch(it, 'AE.ADBE Motion');
                        pos = comp ? comp.properties[0].getValue() : null;
                        if (pos && pos.length === 2 && it.getMGTComponent && it.getMGTComponent()) {
                            lo = vertical ? [0.06, 0.11] : [0.05, 0.05]; hi = vertical ? [0.87, 0.8] : [0.95, 0.95];
                            if (pos[0] < lo[0] || pos[0] > hi[0] || pos[1] < lo[1] || pos[1] > hi[1]) add('warn', a, 'V' + (j + 1), 'Texte hors zone s\u00fbre : ' + it.name);
                        }
                    } catch (e1) {}
                }
            }
        }
        for (j = 0; j < s.audioTracks.numTracks; j++) {
            tr = s.audioTracks[j];
            list = audioItems(s, j);
            try { if (tr.isMuted && tr.isMuted() && list.length) add('warn', tk(list[0].start), 'A' + (j + 1), 'Piste audio coup\u00e9e (M) : elle ne sera pas export\u00e9e'); } catch (e2) {}
            for (i = 0; i < list.length; i++) {
                it = list[i]; a = tk(it.start);
                end = Math.max(end, tk(it.end));
                if (offline(it)) add('error', a, 'A' + (j + 1), 'Son hors ligne : ' + it.name);
                if (disabled(it)) add('warn', a, 'A' + (j + 1), 'Son d\u00e9sactiv\u00e9 : ' + it.name);
                p = levelParam(it);
                try { v = p && !p.isTimeVarying() ? dbOf(p.getValue()) : null; } catch (e3) { v = null; }
                if (v !== null && v > 6.05) add('warn', a, 'A' + (j + 1), 'Volume pouss\u00e9 \u00e0 +' + Math.round(v) + ' dB : risque de saturation (' + it.name + ')');
            }
        }
        // Images noires : aucun plan entre 0 et la fin de la sequence.
        spans.sort(function (p1, p2) { return p1[0] - p2[0]; });
        cur = 0;
        for (i = 0; i < spans.length; i++) {
            if (spans[i][0] - cur >= f) add('error', cur, 'V', 'Image noire : ' + (Math.round((spans[i][0] - cur) / f)) + ' image(s) sans plan');
            cur = Math.max(cur, spans[i][1]);
        }
        if (spans.length && end - cur >= f) add('warn', cur, 'V', 'Fin sans image : ' + (Math.round((end - cur) / f)) + ' image(s) noires (son ou texte seuls)');
        issues.sort(function (p1, p2) { return p1.t - p2.t; });
        return ok({ issues: issues, duration: end / TICKS, fps: fps, w: W, h: H });
    }

    // Images fixes posees les unes apres les autres sur une meme piste libre :
    // o.items [{ path, t (s), dur (s) }], o.minTrack. Compte a rebours, barre de progression...
    function placeStills(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, it, pi, a, lo = Infinity, hi = 0, ti, d;
        for (i = 0; i < o.items.length; i++) {
            a = snap(o.items[i].t * TICKS, f);
            lo = Math.min(lo, a);
            hi = Math.max(hi, a + Math.max(1, Math.round(o.items[i].dur * TICKS / f)) * f);
        }
        if (!o.items.length) return fail('Rien \u00e0 poser');
        ti = pickTrack(s, Math.max(o.minTrack || 1, topTrackAt(s, lo) + 1), lo, hi, warnings);
        for (i = 0; i < o.items.length; i++) {
            pi = itemForPath(o.items[i].path, 'RR FX Ressources', false);
            if (!pi) { warnings.push('Image non import\u00e9e : ' + o.items[i].path); continue; }
            a = snap(o.items[i].t * TICKS, f);
            d = Math.max(1, Math.round(o.items[i].dur * TICKS / f)) * f;
            try {
                it = placeOn(s, ti, pi, a, 0, d);
                fixSpan(it, a, a + d);
                try { it.name = o.name || pi.name; } catch (e1) {}
                created.push({ kind: 'adj', track: ti, start: a, name: it.name });
            } catch (e) { warnings.push(String(o.items[i].path).replace(/^.*[\\\/]/, '') + ' : ' + e.toString()); }
        }
        if (!created.length) return fail(warnings[0] || 'Rien n\'a \u00e9t\u00e9 pos\u00e9.', { warnings: warnings });
        return ok({ created: created, track: ti, end: hi / TICKS, warnings: warnings });
    }

    // Nouvelle sequence pour un modele de projet : depuis les rushs selectionnes dans le panneau
    // Projet (sinon vide, aux reglages de la sequence active), au format o.width x o.height, avec
    // un calque de reglage sur toute la duree si o.adj. -> { name, id, clips, adjPlaced }
    function newFromTemplate(o) {
        var P = app.project, W = Math.round(o.width), H = Math.round(o.height), warnings = [], sel = [], i, ns = null, st, before, s, adj, dur, it, j, list, clips = 0, adjPlaced = false;
        // Rushs video selectionnes dans le panneau Projet.
        try {
            list = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null;
            for (i = 0; list && i < list.length; i++) { it = list[i]; if (it.type === 1 && !(it.isSequence && it.isSequence()) && !isAdjustment(it)) sel.push(it); }
        } catch (e0) { sel = []; }
        before = P.sequences.numSequences;
        if (sel.length && P.createNewSequenceFromClips) {
            try { ns = P.createNewSequenceFromClips(o.name, sel, P.rootItem); } catch (e1) { ns = null; }
        }
        if (!ns) {
            s = P.activeSequence;
            if (!s || !s.clone) return fail('S\u00e9lectionne tes rushs dans le panneau Projet (ou ouvre une s\u00e9quence \u00e0 copier).');
            s.clone();
            if (P.sequences.numSequences <= before) return fail('Premiere n\'a pas pu cr\u00e9er la s\u00e9quence.');
            ns = P.sequences[P.sequences.numSequences - 1];
            try { ns.name = o.name; } catch (e2) {}
            try { if (P.openSequence) P.openSequence(ns.sequenceID); } catch (e3) {}
            if (P.activeSequence !== ns) try { P.activeSequence = ns; } catch (e4) {}
            ns = activeSeq();
            // Copie videe : seulement ses reglages.
            for (j = 0; j < ns.videoTracks.numTracks; j++) { list = clipsOf(ns, j); for (i = 0; i < list.length; i++) { try { list[i].remove(false, false); } catch (e5) {} } }
            for (j = 0; j < ns.audioTracks.numTracks; j++) { list = audioItems(ns, j); for (i = 0; i < list.length; i++) { try { list[i].remove(false, false); } catch (e6) {} } }
        } else {
            try { if (P.openSequence) P.openSequence(ns.sequenceID); } catch (e7) {}
            if (P.activeSequence !== ns) try { P.activeSequence = ns; } catch (e8) {}
            ns = activeSeq();
        }
        if (W && H) {
            try {
                st = ns.getSettings();
                st.videoFrameWidth = W;
                st.videoFrameHeight = H;
                ns.setSettings(st);
            } catch (e9) {}
            if (Number(ns.frameSizeHorizontal) !== W || Number(ns.frameSizeVertical) !== H) warnings.push('Taille du cadre \u00e0 v\u00e9rifier : S\u00e9quence > Param\u00e8tres de la s\u00e9quence');
        }
        for (j = 0; j < ns.videoTracks.numTracks; j++) clips += clipsOf(ns, j).length;
        // Calque de reglage au-dessus de tout, sur toute la duree (ou 60 s si la sequence est vide).
        if (o.adj) {
            adj = findAdjustment(o.adjNodeId);
            if (!adj) warnings.push('Pas de calque de r\u00e9glage dans le projet (Fichier > Nouveau > Calque de r\u00e9glage)');
            else {
                dur = 0;
                for (j = 0; j < ns.videoTracks.numTracks; j++) { list = clipsOf(ns, j); for (i = 0; i < list.length; i++) dur = Math.max(dur, tk(list[i].end)); }
                if (!dur) dur = 60 * TICKS;
                try { placeAdjustment(ns, adj, topTrackAt(ns, 0) + 1, 0, dur, 'RR FX \u00b7 Look', warnings); adjPlaced = true; } catch (e10) { warnings.push('Calque de r\u00e9glage non pos\u00e9 : ' + e10.toString()); }
            }
        }
        return ok({ name: ns.name, id: ns.sequenceID, clips: clips, adjPlaced: adjPlaced, warnings: warnings });
    }

    api.gainKeys = guard(gainKeys);
    api.listSequences = guard(listSequences);
    api.openSequence = guard(openSequence);
    api.extractCopy = guard(extractCopy);
    api.preflight = guard(preflight);
    api.placeStills = guard(placeStills);
    api.newFromTemplate = guard(newFromTemplate);

