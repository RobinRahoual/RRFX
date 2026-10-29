    // ============================================================ Outils de Premiere : transitions, changements de plan, sous-titres

    // Noms des transitions de Premiere, dans les langues de Premiere (cherches dans l'ordre).
    var VIDEO_TRANSITIONS = {
        dissolve: ['Cross Dissolve', 'Fondu encha\u00een\u00e9', 'Weiche Blende', 'Disoluci\u00f3n cruzada', 'Dissolvenza incrociata', 'Dissolv\u00eancia cruzada'],
        black: ['Dip to Black', 'Fondu au noir', 'Schwarzblende', 'Pasar a negro', 'Dissolvenza su nero', 'Mergulho para preto'],
        white: ['Dip to White', 'Fondu au blanc', 'Wei\u00dfblende', 'Pasar a blanco', 'Dissolvenza su bianco', 'Mergulho para branco'],
        film: ['Film Dissolve', 'Fondu encha\u00een\u00e9 (film)', 'Film-\u00dcberblendung', 'Disoluci\u00f3n de pel\u00edcula', 'Dissolvenza pellicola'],
        morph: ['Morph Cut', 'Fondu morphologique', 'Morph-Schnitt', 'Corte con morfismo', 'Taglio morph'],
        additive: ['Additive Dissolve', 'Fondu encha\u00een\u00e9 additif', 'Additive Blende', 'Disoluci\u00f3n aditiva', 'Dissolvenza additiva']
    };
    var AUDIO_TRANSITIONS = {
        power: ['Constant Power', 'Puissance constante', 'Konstante Leistung', 'Potencia constante', 'Potenza costante'],
        gain: ['Constant Gain', 'Gain constant', 'Konstante Verst\u00e4rkung', 'Ganancia constante', 'Guadagno costante'],
        exp: ['Exponential Fade', 'Fondu exponentiel', 'Exponentielle Blende', 'Fundido exponencial', 'Dissolvenza esponenziale']
    };

    // Une transition de Premiere par son nom (video ou son) ; repli : la liste de Premiere.
    function findTransition(names, audio) {
        var i, t = null, list, j, n, re;
        app.enableQE();
        for (i = 0; i < names.length && !t; i++) {
            try { t = audio ? qe.project.getAudioTransitionByName(names[i]) : qe.project.getVideoTransitionByName(names[i]); } catch (e) { t = null; }
        }
        if (t) return t;
        try { list = audio ? qe.project.getAudioTransitionList() : qe.project.getVideoTransitionList(); } catch (e1) { list = null; }
        if (!list) return null;
        re = new RegExp('^(' + names.join('|').replace(/[()]/g, '\\$&') + ')$', 'i');
        for (j = 0; j < list.length; j++) {
            n = typeof list[j] === 'string' ? list[j] : (list[j] && list[j].name) || '';
            if (re.test(n)) { try { return audio ? qe.project.getAudioTransitionByName(n) : qe.project.getVideoTransitionByName(n); } catch (e2) { return null; } }
        }
        return null;
    }

    // Les coupes ou poser une transition : deux plans colles sur une meme piste (calques exclus).
    function cutsOnTrack(items, f) {
        var out = [], i;
        for (i = 1; i < items.length; i++) {
            if (isLayer(items[i]) || isLayer(items[i - 1])) continue;
            if (Math.abs(tk(items[i].start) - tk(items[i - 1].end)) < f / 2) out.push(tk(items[i].start));
        }
        return out;
    }
    function videoCuts(s, scope, f) {
        var out = [], i, l, k, cuts;
        if (scope === 'selection') {
            l = selectedCuts(s);
            for (i = 0; i < l.length; i++) out.push({ track: l[i].track, t: l[i].t });
            return out;
        }
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            cuts = cutsOnTrack(clipsOf(s, i), f);
            for (k = 0; k < cuts.length; k++) out.push({ track: i, t: cuts[k] });
        }
        return out;
    }
    function audioCuts(s, times, f) {
        var out = [], i, j, k, cuts, near;
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            cuts = cutsOnTrack(audioItems(s, i), f);
            for (k = 0; k < cuts.length; k++) {
                // Coupes de la selection : le son des memes coupes seulement.
                near = !times;
                if (times) for (j = 0; j < times.length && !near; j++) if (Math.abs(times[j] - cuts[k]) < f / 2) near = true;
                if (near) out.push({ track: i, t: cuts[k] });
            }
        }
        return out;
    }

    function qeItemAt(qt, ticks, f) {
        var i, q;
        for (i = 0; i < qt.numItems; i++) {
            q = qt.getItemAt(i);
            if (q && q.type !== 'Empty' && Math.abs(qeStart(q) - ticks) < f / 2) return q;
        }
        return null;
    }

    /* Transitions de Premiere sur les coupes : o.video (cle de VIDEO_TRANSITIONS ou ''), o.audio
       (cle de AUDIO_TRANSITIONS ou ''), o.frames, o.scope ('sequence' ou 'selection'),
       o.align (0 : apres la coupe, 0.5 : centree, 1 : avant). */
    function nativeTransitions(o) {
        var s = activeSeq(), f = tpf(s), dur = timecodeOf(s, Math.max(1, o.frames || 12) * f), zero = timecodeOf(s, 0);
        var align = o.align === undefined ? 0.5 : o.align, created = [], warnings = [], vt = null, at = null, qs, cuts, i, q, n = 0, na = 0, times = null, ac;
        if (o.video) {
            vt = findTransition(VIDEO_TRANSITIONS[o.video] || [o.video], false);
            if (!vt) return fail('Transition introuvable dans Premiere : ' + (VIDEO_TRANSITIONS[o.video] || [o.video])[0] + '.');
        }
        if (o.audio) {
            at = findTransition(AUDIO_TRANSITIONS[o.audio] || [o.audio], true);
            if (!at) return fail('Transition audio introuvable dans Premiere : ' + (AUDIO_TRANSITIONS[o.audio] || [o.audio])[0] + '.');
        }
        qs = qeSeq();
        cuts = videoCuts(s, o.scope, f);
        if (o.scope === 'selection' && !cuts.length) return fail('S\u00e9lectionne au moins deux plans qui se suivent.');
        if (vt) for (i = 0; i < cuts.length; i++) {
            q = qeItemAt(qs.getVideoTrackAt(cuts[i].track), cuts[i].t, f);
            if (!q || typeof q.addTransition !== 'function') { warnings.push('Coupe ' + (i + 1) + ' passee'); continue; }
            try { q.addTransition(vt, true, dur, zero, align, false, true); created.push({ kind: 'trans', video: true, track: cuts[i].track, start: cuts[i].t }); n++; } catch (e) { warnings.push('Coupe ' + (i + 1) + ' : ' + e); }
        }
        if (at) {
            if (o.scope === 'selection') { times = []; for (i = 0; i < cuts.length; i++) times.push(cuts[i].t); }
            ac = audioCuts(s, times, f);
            for (i = 0; i < ac.length; i++) {
                q = qeItemAt(qs.getAudioTrackAt(ac[i].track), ac[i].t, f);
                if (!q || typeof q.addTransition !== 'function') continue;
                try { q.addTransition(at, true, dur, zero, align, false, false); created.push({ kind: 'trans', video: false, track: ac[i].track, start: ac[i].t }); na++; } catch (e3) { warnings.push('Son ' + (i + 1) + ' : ' + e3); }
            }
        }
        if (!n && !na) return fail(cuts.length ? 'Premiere a refus\u00e9 les transitions.' : 'Aucune coupe : il faut deux plans coll\u00e9s sur une m\u00eame piste.');
        return ok({ video: n, audio: na, cuts: cuts.length, created: created, warnings: warnings });
    }

    // Annulation : la transition posee sur la coupe est retiree (si Premiere sait le faire).
    function removeTransitionAt(s, e) {
        var tr = e.video ? s.videoTracks[e.track] : s.audioTracks[e.track], f = tpf(s), l, i, t;
        if (!tr || !tr.transitions) return false;
        l = tr.transitions;
        for (i = 0; i < l.numItems; i++) {
            t = l[i];
            if (tk(t.start) - f <= e.start && e.start <= tk(t.end) + f) {
                try { t.remove(false, false); return true; } catch (er) { return false; }
            }
        }
        return false;
    }

    /* Detection des changements de plan de Premiere sur la selection : des coupes ou des
       marqueurs a chaque changement de plan (un rendu, une video telechargee, un ancien montage). */
    function sceneEdits(o) {
        var s = activeSeq(), sel = s.getSelection(), before, after, n;
        if (typeof s.performSceneEditDetectionOnSelection !== 'function') return fail('Ta version de Premiere ne propose pas la d\u00e9tection des changements de plan (Premiere 2020 ou plus).');
        if (!sel || !sel.length) return fail('S\u00e9lectionne le ou les plans \u00e0 analyser dans la timeline.');
        var count = function () { var c = 0, k; for (k = 0; k < s.videoTracks.numTracks; k++) c += s.videoTracks[k].clips.numItems; return c; };
        before = o.action === 'markers' ? s.markers.numMarkers : count();
        if (!s.performSceneEditDetectionOnSelection(o.action === 'markers' ? 'CreateMarkers' : 'ApplyCuts', !!o.audio, { low: 'LowSensitivity', high: 'HighSensitivity' }[o.sensitivity] || 'MediumSensitivity')) return fail('Premiere n\'a pas pu analyser la s\u00e9lection.');
        after = o.action === 'markers' ? s.markers.numMarkers : count();
        n = Math.max(0, after - before);
        return ok({ found: n, action: o.action === 'markers' ? 'markers' : 'cuts' });
    }

    /* Sous-titres de Premiere : le .srt (deja corrige, traduit, recale par RR FX) devient une
       piste de sous-titres native, modifiable dans le panneau Texte de Premiere. */
    function nativeCaptions(o) {
        var s = activeSeq(), bin, item = null, i, before = {};
        if (typeof s.createCaptionTrack !== 'function') return fail('Ta version de Premiere ne cr\u00e9e pas de piste de sous-titres par script (Premiere 2022 ou plus) : choisis \u00ab Textes anim\u00e9s RR FX \u00bb.');
        bin = binPath('RR FX/Sous-titres');
        for (i = 0; i < bin.children.numItems; i++) before[bin.children[i].nodeId] = true;
        if (!app.project.importFiles([o.path], true, bin, false)) return fail('Premiere a refus\u00e9 le fichier .srt.');
        for (i = 0; i < bin.children.numItems && !item; i++) if (!before[bin.children[i].nodeId]) item = bin.children[i];
        if (!item) return fail('Fichier .srt introuvable apr\u00e8s import.');
        // Sans format : piste " Sous-titres ", le format par defaut de Premiere.
        if (!s.createCaptionTrack(item, o.start || 0)) return fail('Premiere a refus\u00e9 la piste de sous-titres.');
        return ok({ name: item.name });
    }

    api.nativeTransitions = guard(nativeTransitions);
    api.sceneEdits = guard(sceneEdits);
    api.nativeCaptions = guard(nativeCaptions);

