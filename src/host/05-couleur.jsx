    // ============================================================ Lumetri, conversion LOG -> Rec.709

    // ------------------------------------------------------------ Lumetri : LUT d'entree

    // Premiere range la LUT d'entree personnalisee dans le champ texte sans nom deux crans apres
    // " Correction de base ", et ne l'utilise que si le menu " LUT d'entree " (quatre crans apres)
    // vaut 1. Le chemin doit finir par un separateur. Le second menu du meme nom n'est pas touche.
    var BASIC_NAME = /^(basic correction|correction de base|grundkorrektur|grundlegende korrektur|correcci\u00f3n b\u00e1sica|correzione di base|corre\u00e7\u00e3o b\u00e1sica)$/i;
    var INPUT_LUT = /^(input lut|lut d.entr\u00e9e|eingabe-lut|lut de entrada|lut di input|lut di ingresso)$/i;

    function inputLutSlot(comp) {
        var P = comp.properties, n = P.numItems, i, basic = -1;
        for (i = 0; i < n; i++) if (BASIC_NAME.test(String(P[i].displayName))) { basic = i; break; }
        if (basic < 0) for (i = 4; i < n; i++) if (INPUT_LUT.test(String(P[i].displayName))) { basic = i - 4; break; }
        if (basic < 0 || basic + 4 >= n) return -1;
        return basic;
    }

    // Renvoie '' si la LUT est chargee, sinon la raison.
    function setInputLut(comp, path) {
        var b = inputLutSlot(comp), P, clean, stored, back;
        if (b < 0) return 'LUT d\'entr\u00e9e introuvable dans Lumetri : choisis-la \u00e0 la main (Correction de base > LUT d\'entr\u00e9e > Parcourir\u2026)';
        P = comp.properties;
        clean = String(path).replace(/[\\\/]+$/, '');
        stored = clean + (/\\/.test(clean) ? '\\' : '/');
        try { P[b + 1].setValue(1, true); } catch (e0) {}
        try {
            P[b + 2].setValue(stored, true);
            P[b + 4].setValue(1, true);
            back = String(P[b + 2].getValue()).replace(/[\\\/]+$/, '');
            if (back !== clean || Number(P[b + 4].getValue()) !== 1) return 'Premiere n\'a pas gard\u00e9 la LUT d\'entr\u00e9e : choisis-la \u00e0 la main (Correction de base > LUT d\'entr\u00e9e > Parcourir\u2026)';
        } catch (e1) {
            return 'LUT d\'entr\u00e9e refus\u00e9e par Premiere (' + e1.toString() + ') : choisis-la \u00e0 la main';
        }
        return '';
    }

    // ------------------------------------------------------------ public: conversion LOG -> Rec.709

    // Calques d'etalonnage RR FX, dans l'ordre ou ils s'empilent au-dessus des rushs :
    // conversion LOG -> Rec.709, correction auto (expo, balance), raccord entre cameras. Les looks
    // viennent au-dessus de tout ca.
    var GRADES = {
        conversion: { level: 1, re: /^RR FX \u00b7 Conversion/ },
        auto: { level: 2, re: /^RR FX \u00b7 Auto/ },
        match: { level: 3, re: /^RR FX \u00b7 Raccord/ }
    };
    var LOOK_NAME = /^RR FX \u00b7 Look/, COPY_NAME = /^RR FX \u00b7 /;

    function gradeLevel(name) {
        var k;
        for (k in GRADES) if (GRADES.hasOwnProperty(k) && GRADES[k].re.test(name)) return GRADES[k].level;
        return 0;
    }

    function isGraphic(it) {
        try { if (it.isMGT && it.isMGT()) return true; } catch (e) {}
        try { return !!(it.getMGTComponent && it.getMGTComponent()); } catch (e2) { return false; }
    }

    // Elements du projet ranges par RR FX dans des chutiers d'habillage (overlays, ressources).
    function overlayIds() {
        var ids = {}, root = app.project.rootItem, i, c;
        for (i = 0; i < root.children.numItems; i++) {
            c = root.children[i];
            if (c.type === 2 && (c.name === 'RR FX Overlays' || c.name === 'RR FX Ressources')) walk(c, function (x) { ids[x.nodeId] = true; return false; });
        }
        return ids;
    }

    // 'rush' (image de la camera, copies RR FX du plan comprises), 'grade' (conversion, auto,
    // raccord), 'look', 'over' (titre, overlay, ressource) ou 'layer' (autre calque de reglage).
    function convKind(it, over) {
        var pi = null;
        if (isGraphic(it)) return 'over';
        try { pi = it.projectItem; } catch (e) {}
        if (!pi) return 'over';
        if (isAdjustment(pi)) return gradeLevel(it.name) ? 'grade' : LOOK_NAME.test(it.name) ? 'look' : 'layer';
        return over[pi.nodeId] ? 'over' : 'rush';
    }

    // Retire les calques d'un niveau deja poses sur [a, b] (deux conversions a la suite
    // bruleraient l'image). Un calque qui deborde est coupe : le reste de la timeline le garde.
    function cutLayers(s, a, b, re, warnings) {
        var n = 0, i, j, list, it, x, y, qt;
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j]; x = tk(it.start); y = tk(it.end);
                if (!re.test(it.name) || x >= b || a >= y) continue;
                try {
                    qt = qeSeq().getVideoTrackAt(i);
                    if (x < a) qt.razor(timecodeOf(s, a));
                    if (y > b) qt.razor(timecodeOf(s, b));
                } catch (e) {}
            }
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j]; x = tk(it.start); y = tk(it.end);
                if (!re.test(it.name) || x >= b || a >= y) continue;
                if (x < a || y > b) warnings.push('Ancien calque \u00ab ' + it.name + ' \u00bb retir\u00e9 en entier sur V' + (i + 1) + ' (Premiere n\'a pas pu le couper)');
                it.remove(false, false);
                n++;
            }
        }
        return n;
    }

    function mergeSpans(spans, f) {
        var out = [], i, c;
        spans.sort(function (x, y) { return x.a - y.a; });
        for (i = 0; i < spans.length; i++) {
            c = out.length ? out[out.length - 1] : null;
            if (c && spans[i].a <= c.b + f) { c.b = Math.max(c.b, spans[i].b); c.top = Math.max(c.top, spans[i].top); }
            else out.push({ a: spans[i].a, b: spans[i].b, top: spans[i].top });
        }
        return out;
    }

    // Pose des calques Lumetri d'etalonnage. o.layer : 'conversion', 'auto' ou 'match' ;
    // o.groups : [{ name, lutPath, spans: [{ a, b, top }] }] (ticks ; top = piste du plan).
    // Chaque calque va juste au-dessus des rushs de sa zone (et des calques d'etalonnage d'un
    // niveau inferieur) : une piste est inseree si besoin, pour rester sous les looks.
    function placeGrades(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], jobs = [], all = [], replaced = 0, lutSet = 0, below = 0;
        var G = GRADES[o.layer] || GRADES.conversion, over = overlayIds(), adj, i, j, k, g, m, list, it, top, ti, before, placed, comp, err, kind, a, b;
        adjCache = null;
        adj = findAdjustment(o.adjNodeId);
        if (!adj) return fail('Aucun calque de r\u00e9glage dans le projet. Cr\u00e9e-en un : Fichier > Nouveau > Calque de r\u00e9glage.');
        for (k = 0; k < o.groups.length; k++) {
            g = o.groups[k];
            m = mergeSpans(g.spans.slice(0), f);
            for (j = 0; j < m.length; j++) { jobs.push({ name: g.name, lutPath: g.lutPath, a: m[j].a, b: m[j].b, top: m[j].top }); all.push({ a: m[j].a, b: m[j].b, top: 0 }); }
        }
        if (!jobs.length) return fail('Aucun plan \u00e0 traiter.');
        all = mergeSpans(all, f);
        for (k = 0; k < all.length; k++) replaced += cutLayers(s, all[k].a, all[k].b, G.re, warnings);
        jobs.sort(function (x, y) { return x.a - y.a; });
        for (k = 0; k < jobs.length; k++) {
            a = jobs[k].a; b = jobs[k].b; top = jobs[k].top;
            // Au-dessus des copies RR FX du plan (rampes...) et des etalonnages d'un niveau inferieur.
            for (i = top + 1; i < s.videoTracks.numTracks; i++) {
                list = clipsOf(s, i);
                for (j = 0; j < list.length; j++) {
                    it = list[j];
                    if (tk(it.start) >= b || a >= tk(it.end)) continue;
                    kind = convKind(it, over);
                    if ((kind === 'rush' && COPY_NAME.test(it.name)) || (kind === 'grade' && gradeLevel(it.name) < G.level)) top = i;
                }
            }
            ti = top + 1;
            if (ti < s.videoTracks.numTracks && !trackClear(s, ti, a, b)) {
                // Piste occupee (look, titre...) : on glisse une piste neuve a cet endroit.
                before = s.videoTracks.numTracks;
                try { qeSeq().addTracks(1, ti, 0); } catch (e) {}
                if (s.videoTracks.numTracks > before && trackClear(s, ti, a, b)) {
                    warnings.push('Piste V' + (ti + 1) + ' ajout\u00e9e juste au-dessus des rushs');
                    for (j = 0; j < created.length; j++) if (created[j].track >= ti) created[j].track++;
                    for (j = k + 1; j < jobs.length; j++) if (jobs[j].top >= ti) jobs[j].top++;
                }
            }
            placed = placeAdjustment(s, adj, ti, a, b, jobs[k].name, warnings);
            created.push({ kind: 'adj', track: placed.track, start: a, name: jobs[k].name });
            comp = addEffect(s, placed.track, a, { names: o.fxNames && o.fxNames.length ? o.fxNames : ['Lumetri Color'] }, warnings);
            if (comp && jobs[k].lutPath) {
                err = setInputLut(comp, jobs[k].lutPath);
                if (err) warnings.push(err); else lutSet++;
            }
            // Looks, titres et overlays sous le calque : ils seraient corriges eux aussi.
            for (i = 0; i < placed.track; i++) {
                list = clipsOf(s, i);
                for (j = 0; j < list.length; j++) {
                    if (tk(list[j].start) >= b || a >= tk(list[j].end)) continue;
                    kind = convKind(list[j], over);
                    if (kind === 'look' || kind === 'over') below++;
                }
            }
        }
        if (below) warnings.push(below + ' look(s), titre(s) ou overlay(s) sous le calque : remonte-les au-dessus pour qu\'ils ne soient pas modifi\u00e9s.');
        return ok({ created: created, layers: created.length, replaced: replaced, lutSet: lutSet, warnings: warnings });
    }

    // Conversion LOG -> Rec.709 d'une seule camera. o.scope : 'sequence' (un calque du premier au
    // dernier rush) ou 'selection' (un calque par groupe de rushs choisis).
    function logConvert(o) {
        var s = activeSeq(), over = overlayIds(), spans = [], i, j, list, sel, a = Infinity, b = 0, top = 0;
        if (o.scope === 'selection') {
            sel = selectedVideo(s);
            // Plans desactives (angles caches du montage multicam) : rien a convertir a cet endroit.
            for (i = 0; i < sel.length; i++) if (convKind(sel[i].item, over) === 'rush' && !sel[i].item.disabled) spans.push({ a: tk(sel[i].item.start), b: tk(sel[i].item.end), top: sel[i].track });
            if (!spans.length) return fail('S\u00e9lectionne les rushs \u00e0 convertir dans la timeline.');
        } else {
            for (i = 0; i < s.videoTracks.numTracks; i++) {
                list = clipsOf(s, i);
                for (j = 0; j < list.length; j++) {
                    if (convKind(list[j], over) !== 'rush') continue;
                    a = Math.min(a, tk(list[j].start)); b = Math.max(b, tk(list[j].end)); top = Math.max(top, i);
                }
            }
            if (!(b > 0)) return fail('Aucun rush dans la s\u00e9quence.');
            spans.push({ a: a, b: b, top: top });
        }
        return placeGrades({ layer: 'conversion', groups: [{ name: o.name, lutPath: o.lutPath, spans: spans }], adjNodeId: o.adjNodeId, fxNames: o.fxNames });
    }

    // Les plans de la sequence pour le panneau (camera, analyse) : chemin du media, piste, bornes.
    // o.scope : 'sequence' ou 'selection'.
    function rushList(o) {
        var s = activeSeq(), over = overlayIds(), out = [], i, j, list, it, sel, ids = null;
        if (o.scope === 'selection') {
            sel = selectedVideo(s);
            ids = {};
            for (i = 0; i < sel.length; i++) ids[sel[i].item.nodeId] = true;
        }
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (ids && !ids[it.nodeId]) continue;
                if (convKind(it, over) !== 'rush' || it.disabled) continue;
                out.push({ track: i, start: tk(it.start), end: tk(it.end), name: it.name, path: mediaPathOf(it.projectItem), copy: COPY_NAME.test(it.name) });
            }
        }
        out.sort(function (x, y) { return (x.start - y.start) || (x.track - y.track); });
        if (!out.length) return fail(o.scope === 'selection' ? 'S\u00e9lectionne des rushs dans la timeline.' : 'Aucun rush dans la s\u00e9quence.');
        return ok({ clips: out, fps: TICKS / tpf(s) });
    }

    // Images \u00ab propres \u00bb de la timeline pour l'analyse : a chaque instant, les looks, titres,
    // overlays et calques au-dessus sont desactives (on garde les rushs et les etalonnages de
    // niveau < o.level). Premiere ecrit les images apres coup : le panneau attend les fichiers
    // puis appelle framesEnd pour tout reactiver.
    function framesBegin(o) {
        var s = activeSeq(), f = tpf(s), q = qeSeq(), over = overlayIds(), files = [], off = [], i, j, k, list, it, t, kind, lvl = o.level || 1;
        if (!q || !q.exportFramePNG) return fail('Cette version de Premiere ne permet pas d\'exporter une image par script.');
        var times = [];
        for (i = 0; i < o.times.length; i++) times.push(snap(o.times[i] * TICKS, f));
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (it.disabled) continue;
                kind = convKind(it, over);
                if (kind === 'rush' || (kind === 'grade' && gradeLevel(it.name) < lvl)) continue;
                for (k = 0; k < times.length; k++) {
                    t = times[k];
                    if (tk(it.start) <= t && t < tk(it.end)) {
                        if (setDisabled(it, true)) off.push({ track: i, start: tk(it.start) });
                        break;
                    }
                }
            }
        }
        for (i = 0; i < times.length; i++) {
            files.push(o.folder + '/' + o.prefix + i);
            q.exportFramePNG(timecodeOf(s, times[i]), files[i]);
        }
        return ok({ files: files, off: off });
    }

    function framesEnd(o) {
        var s = activeSeq(), n = 0, i, it;
        for (i = 0; i < o.off.length; i++) {
            it = findItemAt(s, o.off[i].track, o.off[i].start);
            if (it && setDisabled(it, false)) n++;
        }
        return ok({ restored: n });
    }

    // Tete de lecture a o.t (secondes).
    function setPlayhead(o) {
        var s = activeSeq();
        s.setPlayerPosition(String(snap(o.t * TICKS, tpf(s))));
        return ok({ t: secs(tk(s.getPlayerPosition())) });
    }

    api.logConvert = guard(logConvert);
    api.placeGrades = guard(placeGrades);
    api.rushList = guard(rushList);
    api.framesBegin = guard(framesBegin);
    api.framesEnd = guard(framesEnd);
    api.setPlayhead = guard(setPlayhead);

