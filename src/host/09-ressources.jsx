    // ============================================================ Ressources (dossiers lies) et overlays

    // ------------------------------------------------------------ public: ressources (dossiers lies)

    // Piste video la plus haute qui a une image a l'instant t (-1 : aucune).
    function topTrackAt(s, t) {
        var i;
        for (i = s.videoTracks.numTracks - 1; i >= 0; i--) if (clipContaining(s, i, t)) return i;
        return -1;
    }

    // Pose une ressource du disque a chaque instant de o.times (s) : video (sans son, au-dessus
    // de tout), image (o.imageDur s), son (piste audio libre) ou modele de titre .mogrt.
    // Les elements gardent leur nom : " Tout effacer " ne les retire pas, ? Annuler oui.
    function placeAsset(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, k, a, pi = null, src, dur, ti, ai, it, tr, used = [];
        if (!o.times || !o.times.length) return fail('Aucun endroit o\u00f9 poser.');
        if (o.kind === 'mogrt' && !s.importMGT) return fail('Cette version de Premiere ne permet pas d\'importer un mod\u00e8le de titre par script.');
        if (o.kind !== 'mogrt') {
            pi = itemForPath(o.path, 'RR FX Ressources', false);
            if (!pi) return fail('Premiere n\'a pas import\u00e9 ce fichier (format pris en charge ?)');
        }
        if (o.kind === 'video') src = videoSourceOf(pi);
        for (i = 0; i < o.times.length; i++) {
            a = snap(o.times[i] * TICKS, f);
            try {
                if (o.kind === 'audio') {
                    dur = mediaEndOf(pi) || 2 * TICKS;
                    // Les sons d'un meme lot restent groupes sur les memes pistes.
                    ai = -1;
                    for (k = 0; k < used.length && ai < 0; k++) if (audioTrackClear(s, used[k], a, a + dur)) ai = used[k];
                    if (ai < 0) { ai = pickAudioTrack(s, a, a + dur, warnings); if (!inList(used, ai)) used.push(ai); }
                    tr = s.audioTracks[ai];
                    tr.overwriteClip(pi, mkTime(a));
                    it = findAudioAt(s, ai, a);
                    if (!it) { tr.overwriteClip(pi, a / TICKS); it = findAudioAt(s, ai, a); }
                    if (!it) throw new Error('son non pos\u00e9');
                    // o.gain (dB) : volume du son pose (bruitages plus discrets...).
                    if (o.gain) { try { var lp = levelParam(it), lb = lp.getValue(); lp.setValue(levelOf(dbOf(lb > 0 ? lb : levelOf(0)) + o.gain), true); } catch (eg) {} }
                    created.push({ kind: 'aud', track: ai, start: a, name: it.name });
                    continue;
                }
                if (o.kind === 'mogrt') {
                    ti = pickTrack(s, topTrackAt(s, a) + 1, a, a + 10 * TICKS, warnings);
                    it = s.importMGT(o.path, String(a), ti, 0);
                    if (!it || !it.start) it = findItemAt(s, ti, a);
                    if (!it) throw new Error('mod\u00e8le non pos\u00e9 (fichier .mogrt valide ?)');
                } else {
                    dur = o.kind === 'image' ? Math.max(1, Math.round((o.imageDur || 5) * TICKS / f)) * f : mediaEndOf(pi);
                    if (!(dur > 0)) throw new Error('dur\u00e9e du m\u00e9dia illisible');
                    // o.dur (s) : plan de coupe raccourci (debut du media).
                    if (o.kind === 'video' && o.dur) dur = Math.min(dur, Math.max(1, Math.round(o.dur * TICKS / f)) * f);
                    ti = pickTrack(s, topTrackAt(s, a) + 1, a, a + dur, warnings);
                    it = placeOn(s, ti, o.kind === 'video' ? src : pi, a, 0, dur);
                    fixSpan(it, a, a + dur);
                    try { it.name = pi.name; } catch (e) {}
                }
                created.push({ kind: 'adj', track: ti, start: a, name: it.name });
            } catch (err) {
                warnings.push(String(o.name || o.path) + ' \u00e0 ' + (Math.round(a / TICKS * 100) / 100) + ' s : ' + err.toString());
            }
        }
        if (!created.length) return fail(warnings[0] || 'Rien n\'a \u00e9t\u00e9 pos\u00e9.', { warnings: warnings });
        return ok({ created: created, warnings: warnings });
    }

    // Importe des fichiers du disque dans le chutier " RR FX Ressources " (sans rien poser).
    function importAssets(o) {
        var n = 0, failed = [], i;
        for (i = 0; i < o.paths.length; i++) {
            if (itemForPath(o.paths[i], 'RR FX Ressources', false)) n++;
            else failed.push(String(o.paths[i]).replace(/^.*[\\\/]/, ''));
        }
        return ok({ imported: n, failed: failed });
    }

    // ------------------------------------------------------------ overlays

    function placeOverlay(s, ov, t, n, warnings) {
        var f = tpf(s), pi = itemForPath(ov.path, 'RR FX Overlays', ov.kind === 'sequence'), src, dur, len = t.end - t.start, inT = 0, ti, it, r;
        if (!pi) { warnings.push('Overlay introuvable : ' + ov.path); return null; }
        // Sequence d'images d'un pack : cadence de la sequence, pas de son a proteger.
        if (ov.kind === 'sequence' && ov.fps) { try { pi.setOverrideFrameRate(ov.fps); } catch (e0) {} }
        if (ov.kind === 'image') {
            src = pi;
            ti = pickTrack(s, t.track + 1, t.start, t.start + Math.max(len, 30 * TICKS), warnings);
            it = placeOn(s, ti, src, t.start, 0, len);
        } else {
            dur = mediaEndOf(pi);
            if (dur && dur < len) { warnings.push('\u00ab ' + pi.name + ' \u00bb est plus court que l\'effet : raccourci'); len = Math.max(f, Math.floor(dur / f) * f); }
            r = Math.abs(Math.sin((n + 1) * 12.9898 + (ov.seed || 1) * 78.233) * 43758.5453) % 1;
            if (dur && ov.start === 'middle') inT = (dur - len) / 2;
            else if (dur && ov.start === 'random') inT = r * (dur - len);
            src = ov.kind === 'sequence' ? pi : videoSourceOf(pi);
            ti = pickTrack(s, t.track + 1, t.start, t.start + len, warnings);
            it = placeOn(s, ti, src, t.start, inT, inT + len);
        }
        fixSpan(it, t.start, t.start + len);
        try { it.name = (t.name || 'RR FX \u00b7 Overlay') + ' ' + t.side.toUpperCase(); } catch (e) {}
        return { item: findItemAt(s, ti, t.start), track: ti };
    }

    // Mode de fusion de l'Opacite du clip selectionne (pour l'apprendre une fois).
    function readBlend(o) {
        var s = activeSeq(), sel = selectedVideo(s), c;
        if (!sel.length) return fail('S\u00e9lectionne un clip dont tu as r\u00e9gl\u00e9 le mode de fusion.');
        c = componentByMatch(sel[0].item, 'AE.ADBE Opacity');
        if (!c || !c.properties[1]) return fail('Opacit\u00e9 introuvable sur ce clip.');
        return ok({ value: c.properties[1].getValue() });
    }

    api.placeAsset = guard(placeAsset);
    api.importAssets = guard(importAssets);
    api.readBlend = guard(readBlend);

