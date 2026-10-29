    // ============================================================ Test de compatibilite

    // ------------------------------------------------------------ public: test de compatibilite

    // Essaie, sur une copie jetable de la sequence active, chaque fonction de Premiere peu
    // documentee dont RR FX se sert, puis supprime la copie. o.lutPath : petite LUT de test ;
    // o.folder, o.prefix : image exportee (le panneau verifie qu'elle arrive).
    function selfTest(o) {
        var P = app.project, orig = activeSeq(), results = [], ns = null, before, i, adj, placed, comp, it, t0, t1, f, err, w0, h0, st, frame = '', list, n;
        function add(id, label, okv, detail) { results.push({ id: id, label: label, ok: !!okv, detail: detail || '' }); return okv; }
        function attempt(id, label, fn) {
            try { var d = fn(); return add(id, label, d !== false, typeof d === 'string' ? d : ''); } catch (e) { return add(id, label, false, e.toString()); }
        }
        f = tpf(orig);
        // 1. Copie de la sequence (Formats, et terrain de test).
        if (!attempt('clone', 'Copier une s\u00e9quence', function () {
            before = P.sequences.numSequences;
            orig.clone();
            if (P.sequences.numSequences <= before) return false;
            ns = P.sequences[P.sequences.numSequences - 1];
            try { ns.name = 'RR FX \u00b7 Test (\u00e0 supprimer)'; } catch (e) {}
            if (P.openSequence) P.openSequence(ns.sequenceID);
            if (P.activeSequence !== ns) P.activeSequence = ns;
            return activeSeq() === ns ? '' : false;
        })) return ok({ results: results, frame: '' });
        var s = activeSeq();
        t0 = 0; t1 = snap(2 * TICKS, f);
        adjCache = null;
        adj = findAdjustment(o.adjNodeId);
        add('adj', 'Calque de r\u00e9glage dans le projet', !!adj, adj ? adj.name : 'Fichier > Nouveau > Calque de r\u00e9glage');
        if (adj) {
            attempt('place', 'Poser un calque de r\u00e9glage', function () { placed = placeAdjustment(s, adj, 1, t0, t1, 'RR FX \u00b7 Test', []); return 'V' + (placed.track + 1); });
            if (placed) {
                attempt('lumetri', 'Ajouter Lumetri Color (QE)', function () { comp = addEffect(s, placed.track, t0, { names: o.fxNames && o.fxNames.length ? o.fxNames : ['Lumetri Color'] }, []); return comp ? comp.displayName : false; });
                if (comp && o.lutPath) attempt('lut', 'Charger une LUT dans Lumetri (LUT d\'entr\u00e9e)', function () { err = setInputLut(comp, o.lutPath); if (err) throw new Error(err); return ''; });
                attempt('insert', 'Ins\u00e9rer une piste au milieu (QE)', function () {
                    n = s.videoTracks.numTracks;
                    qeSeq().addTracks(1, placed.track, 0);
                    if (s.videoTracks.numTracks <= n) return false;
                    if (findItemAt(s, placed.track + 1, t0)) { placed.track++; return ''; }
                    return 'piste ajout\u00e9e \u00e0 la fin seulement : les calques de conversion iront au-dessus de tout';
                });
                attempt('razor', 'Couper un clip (QE razor)', function () {
                    qeSeq().getVideoTrackAt(placed.track).razor(timecodeOf(s, snap(TICKS, f)));
                    return clipsOf(s, placed.track).length >= 2 ? '' : false;
                });
                attempt('disable', 'D\u00e9sactiver un plan (multicam)', function () {
                    it = findItemAt(s, placed.track, t0);
                    if (!setDisabled(it, true)) return false;
                    return setDisabled(it, false) ? '' : false;
                });
            }
        }
        attempt('markers', 'Poser et retirer un marqueur', function () {
            var m = s.markers.createMarker(0.5);
            if (!m) return false;
            s.markers.deleteMarker(m);
            return '';
        });
        attempt('frame', 'Exporter une image de la timeline', function () {
            if (!qeSeq().exportFramePNG) return false;
            frame = o.folder + '/' + o.prefix + 'frame';
            qeSeq().exportFramePNG(timecodeOf(s, 0), frame);
            return '';
        });
        attempt('settings', 'Changer la taille du cadre (Formats)', function () {
            st = s.getSettings(); w0 = st.videoFrameWidth; h0 = st.videoFrameHeight;
            st.videoFrameWidth = 1080; st.videoFrameHeight = 1920; s.setSettings(st);
            var good = Number(s.frameSizeHorizontal) === 1080 && Number(s.frameSizeVertical) === 1920;
            st = s.getSettings(); st.videoFrameWidth = w0; st.videoFrameHeight = h0; s.setSettings(st);
            return good ? '' : false;
        });
        attempt('reframe', 'Effet Recadrage automatique disponible', function () {
            list = qe.project.getVideoEffectList();
            for (i = 0; i < list.length; i++) if (/reframe|recadr|reencuadr|reinquadr|reenquadr/i.test(list[i])) return String(list[i]);
            return false;
        });
        attempt('mogrt', 'Importer un mod\u00e8le de texte (.mogrt)', function () { return s.importMGT ? '' : false; });
        // Nettoyage : la sequence d'origine revient, la copie est supprimee.
        attempt('cleanup', 'Supprimer la s\u00e9quence de test', function () {
            if (P.openSequence) P.openSequence(orig.sequenceID);
            if (P.activeSequence !== orig) P.activeSequence = orig;
            if (!P.deleteSequence) return '\u00e0 supprimer \u00e0 la main : \u00ab RR FX \u00b7 Test (\u00e0 supprimer) \u00bb';
            return P.deleteSequence(ns) === false ? '\u00e0 supprimer \u00e0 la main : \u00ab RR FX \u00b7 Test (\u00e0 supprimer) \u00bb' : '';
        });
        return ok({ results: results, frame: frame, app: appVersion(), version: VERSION });
    }

    api.selfTest = guard(selfTest);

