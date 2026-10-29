    // ============================================================ Projet : chutiers, rangement, versions, musique a la duree, proxies

    // ------------------------------------------------------------ 2.5 : projet, versions, musique, proxies

    // Tous les elements du projet (chutiers compris), avec leur chemin de chutier.
    function walkItems(bin, cb, where) {
        var i, c;
        for (i = 0; i < bin.children.numItems; i++) {
            c = bin.children[i];
            if (cb(c, where || '', bin) === false) return false;
            if (c.type === 2 && walkItems(c, cb, (where ? where + '/' : '') + c.name) === false) return false;
        }
        return true;
    }

    function itemByNodeId(id) {
        var found = null;
        walkItems(app.project.rootItem, function (c) { if (c.nodeId === id) { found = c; return false; } return true; });
        return found;
    }

    // Chutier " A/B/C " sous la racine, cree au besoin.
    function binPath(path) {
        var parts = String(path || '').split(/[\/\\]+/), cur = app.project.rootItem, i, j, next;
        for (i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            next = null;
            for (j = 0; j < cur.children.numItems; j++) if (cur.children[j].type === 2 && cur.children[j].name === parts[i]) { next = cur.children[j]; break; }
            cur = next || cur.createBin(parts[i]);
        }
        return cur;
    }

    function isSeqItem(pi) {
        try { return !!(pi.isSequence && pi.isSequence()); } catch (e) { return false; }
    }

    var norm = function (p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); };

    // Fichiers d'un dossier surveille importes dans un chutier (ceux deja dans le projet sont passes).
    function importToBin(o) {
        var known = {}, todo = [], i, bin, before = {}, created = [];
        walkItems(app.project.rootItem, function (c) { var p = ''; try { p = c.getMediaPath(); } catch (e) {} if (p) known[norm(p)] = true; return true; });
        for (i = 0; i < (o.paths || []).length; i++) if (!known[norm(o.paths[i])]) todo.push(o.paths[i]);
        if (!todo.length) return ok({ imported: [], skipped: (o.paths || []).length });
        bin = binPath(o.bin || 'Rushs');
        for (i = 0; i < bin.children.numItems; i++) before[bin.children[i].nodeId] = true;
        if (!app.project.importFiles(todo, true, bin, false)) return fail('Premiere a refus\u00e9 l\'import.');
        for (i = 0; i < bin.children.numItems; i++) if (!before[bin.children[i].nodeId]) created.push(bin.children[i].name);
        return ok({ imported: created, skipped: (o.paths || []).length - todo.length });
    }

    var KINDS = {
        video: /\.(mov|mp4|m4v|mxf|avi|mts|m2ts|mkv|webm|r3d|braw|crm|mpg|mpeg|3gp|wmv|insv|hevc|dv)$/i,
        audio: /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg|wma|bwf)$/i,
        image: /\.(png|jpg|jpeg|tif|tiff|psd|gif|bmp|heic|webp|exr|dpx|ai|eps|svg|dng)$/i
    };
    function kindOf(pi) {
        var p = '';
        if (isSeqItem(pi)) return 'sequence';
        try { p = pi.getMediaPath(); } catch (e) {}
        if (KINDS.video.test(p)) return 'video';
        if (KINDS.audio.test(p)) return 'audio';
        if (KINDS.image.test(p)) return 'image';
        if (/\.(mogrt|aegraphic)$/i.test(p) || /^Graphi/i.test(pi.name)) return 'graphic';
        return 'other';
    }

    // Elements poses dans au moins une sequence (et rushs dont une copie RR FX est posee).
    function usedItems() {
        var P = app.project, used = {}, names = {}, i, t, k, sq, tr, m;
        function take(c) {
            if (!c.projectItem) return;
            used[c.projectItem.nodeId] = true;
            m = /^RR FX \u00b7 (.+) \u00b7 (vid\u00e9o|son)$/.exec(c.projectItem.name);
            if (m) names[m[1]] = true;
        }
        for (i = 0; i < P.sequences.numSequences; i++) {
            sq = P.sequences[i];
            for (t = 0; t < sq.videoTracks.numTracks; t++) { tr = sq.videoTracks[t]; for (k = 0; k < tr.clips.numItems; k++) take(tr.clips[k]); }
            for (t = 0; t < sq.audioTracks.numTracks; t++) { tr = sq.audioTracks[t]; for (k = 0; k < tr.clips.numItems; k++) take(tr.clips[k]); }
        }
        return { ids: used, names: names };
    }

    // Rangement : elements en vrac a la racine ranges par type ; o.unused : medias jamais poses
    // ranges a part (rien n'est supprime). o.dry : le plan seulement. o.names : noms des chutiers.
    function tidyProject(o) {
        var R = app.project.rootItem, names = o.names || {}, plan = [], unused = [], u = null, i, c, k, moved = 0;
        var label = { video: names.video || 'Vid\u00e9os', audio: names.audio || 'Sons', image: names.image || 'Images', sequence: names.sequence || 'S\u00e9quences', graphic: names.graphic || 'Graphiques' };
        for (i = 0; i < R.children.numItems; i++) {
            c = R.children[i];
            if (c.type === 2 || isAdjustment(c)) continue;
            k = kindOf(c);
            if (label[k]) plan.push({ item: c, bin: label[k], kind: k, from: 'root' });
        }
        if (o.unused) {
            u = usedItems();
            walkItems(R, function (x, where, parent) {
                if (x.type !== 1 || isSeqItem(x) || isAdjustment(x) || /^RR FX/.test(where) || /^RR FX/.test(x.name)) return true;
                if (where === (names.unused || 'Non utilis\u00e9s')) return true;
                if (!u.ids[x.nodeId] && !u.names[x.name] && kindOf(x) !== 'other') unused.push({ item: x, from: parent === R ? 'root' : parent.nodeId });
                return true;
            });
        }
        var counts = {};
        for (i = 0; i < plan.length; i++) counts[plan[i].kind] = (counts[plan[i].kind] || 0) + 1;
        if (o.dry) {
            var list = [];
            for (i = 0; i < unused.length && i < 200; i++) list.push(unused[i].item.name);
            return ok({ counts: counts, loose: plan.length, unused: list, unusedCount: unused.length });
        }
        // Chaque deplacement est note (element, chutier d'origine) : Annuler remet tout en place.
        var created = [], parked = 0;
        for (i = 0; i < plan.length; i++) { try { plan[i].item.moveBin(binPath(plan[i].bin)); moved++; created.push({ kind: 'move', id: plan[i].item.nodeId, from: plan[i].from, name: plan[i].item.name }); } catch (e) {} }
        if (unused.length) {
            var ub = binPath(names.unused || 'Non utilis\u00e9s');
            for (i = 0; i < unused.length; i++) { try { unused[i].item.moveBin(ub); parked++; created.push({ kind: 'move', id: unused[i].item.nodeId, from: unused[i].from, name: unused[i].item.name }); } catch (e2) {} }
        }
        return ok({ counts: counts, moved: moved, parked: parked, created: created });
    }

    // Renommage en serie des elements selectionnes dans le panneau Projet (o.names : nouveaux noms,
    // dans l'ordre de o.ids) ; o.dry : renvoie la selection. Les anciens noms servent a annuler.
    function renameItems(o) {
        var sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null, out = [], i, pi;
        if (o.dry) {
            if (!sel || !sel.length) return fail('S\u00e9lectionne les \u00e9l\u00e9ments \u00e0 renommer dans le panneau Projet.');
            for (i = 0; i < sel.length; i++) if (sel[i].type !== 2) out.push({ id: sel[i].nodeId, name: sel[i].name });
            return ok({ items: out });
        }
        for (i = 0; i < (o.ids || []).length; i++) {
            pi = itemByNodeId(o.ids[i]);
            if (!pi) continue;
            out.push({ id: pi.nodeId, old: pi.name, name: o.names[i] });
            try { pi.name = o.names[i]; } catch (e) {}
        }
        return ok({ renamed: out });
    }

    // Version de la sequence active : copie figee rangee dans le chutier Versions ; on continue
    // sur la sequence d'origine.
    function versionSequence(o) {
        var s = activeSeq(), P = app.project, before, ns;
        if (!s.clone || !P.sequences) return fail('Cette version de Premiere ne permet pas de dupliquer une s\u00e9quence par script.');
        before = P.sequences.numSequences;
        s.clone();
        if (P.sequences.numSequences <= before) return fail('Premiere n\'a pas pu dupliquer la s\u00e9quence.');
        ns = P.sequences[P.sequences.numSequences - 1];
        try { ns.name = o.name || (s.name + ' v02'); } catch (e) {}
        if (P.activeSequence !== s) { try { P.openSequence(s.sequenceID); } catch (e1) {} }
        try { if (ns.projectItem) ns.projectItem.moveBin(binPath(o.bin || 'Versions')); } catch (e2) {}
        return ok({ id: ns.sequenceID, name: ns.name, of: s.name, ofId: s.sequenceID });
    }

    // Musique raccourcie : o.plan -> infos ; sinon retire [o.a, o.b] (s) de la musique, recolle la
    // suite, et coupe ce qui depasse o.trim. Seuls les morceaux de la musique bougent.
    function fitMusic(o) {
        var s = activeSeq(), f = tpf(s), mi = parse(musicInfo({})), vEnd = 0, j, k, list, qt, A, B, E, pieces, it, x, removed = 0, moved = 0, refused = 0, pid, mS, mE;
        if (!mi.ok) return str(mi);
        for (j = 0; j < s.videoTracks.numTracks; j++) {
            list = clipsOf(s, j);
            for (k = 0; k < list.length; k++) vEnd = Math.max(vEnd, tk(list[k].end));
        }
        if (o.plan) return ok({ music: { name: mi.name, track: mi.track, start: mi.start, end: mi.end, path: mi.path }, videoEnd: secs(vEnd) });
        mS = snap(mi.start * TICKS, f); mE = snap(mi.end * TICKS, f);
        list = audioItems(s, mi.track);
        for (k = 0; k < list.length; k++) if (Math.abs(tk(list[k].start) - mS) < f / 2) { pid = list[k].projectItem ? list[k].projectItem.nodeId : null; break; }
        function music() {
            var out = [], m, l = audioItems(s, mi.track);
            for (m = 0; m < l.length; m++) {
                if (tk(l[m].start) < mS - f / 2 || tk(l[m].end) > mE + f / 2) continue;
                if (pid && l[m].projectItem && l[m].projectItem.nodeId !== pid) continue;
                out.push(l[m]);
            }
            return out;
        }
        qt = qeSeq().getAudioTrackAt(mi.track);
        A = snap((o.a || 0) * TICKS, f); B = snap((o.b || 0) * TICKS, f);
        if (B - A >= f && A > mS && B < mE) {
            qt.razor(timecodeOf(s, A));
            qt.razor(timecodeOf(s, B));
            pieces = music();
            for (k = 0; k < pieces.length; k++) {
                it = pieces[k];
                if (tk(it.start) >= A - f / 2 && tk(it.end) <= B + f / 2) { try { it.remove(false, false); removed++; } catch (e) { refused++; } }
            }
            pieces = music();
            for (k = 0; k < pieces.length; k++) {
                it = pieces[k];
                x = tk(it.start);
                if (x >= B - f / 2) { if (shift(it, A - B)) moved++; else refused++; }
            }
            mE -= B - A;
        }
        if (o.trim) {
            E = snap(o.trim * TICKS, f);
            if (E > mS + f && E < mE - f / 2) {
                qt.razor(timecodeOf(s, E));
                pieces = music();
                for (k = 0; k < pieces.length; k++) if (tk(pieces[k].start) >= E - f / 2) { try { pieces[k].remove(false, false); removed++; } catch (e3) { refused++; } }
                mE = E;
            }
        }
        pieces = music();
        var lastStart = pieces.length ? secs(tk(pieces[pieces.length - 1].start)) : mi.start;
        return ok({ removed: removed, moved: moved, refused: refused, end: secs(mE), lastStart: lastStart, track: mi.track, name: mi.name, warnings: refused ? [refused + ' morceau(x) de musique que Premiere a refus\u00e9 de d\u00e9placer'] : [] });
    }

    // Activite dans Premiere (temps passe) : projet ouvert et signature de ce qui bouge.
    function activityPing(o) {
        var P = app.project, s = P.activeSequence, sig = '', n = 0, i;
        if (s) {
            try { sig = s.sequenceID + '|' + tk(s.getPlayerPosition()); } catch (e) { sig = s.sequenceID; }
            try { for (i = 0; i < s.videoTracks.numTracks; i++) n += s.videoTracks[i].clips.numItems; } catch (e1) {}
            try { for (i = 0; i < s.audioTracks.numTracks; i++) n += s.audioTracks[i].clips.numItems; } catch (e2) {}
            try { sig += '|' + tk(s.end); } catch (e3) {}
            sig += '|' + n;
        }
        return ok({ project: P.name || '', path: P.path || '', sig: sig });
    }

    // ------------------------------------------------------------ proxies (Media Encoder)

    var PROXY = { jobs: {}, bound: false };

    // Preglages de proxy fournis avec Premiere (Settings/IngestPresets/Proxy).
    function proxyPresets(o) {
        var out = [], roots = [], i, j, d, files, base = String(app.path || '');
        roots.push(base + '/Settings/IngestPresets/Proxy', base + '/Contents/Settings/IngestPresets/Proxy');
        for (i = 0; i < roots.length; i++) {
            try {
                d = new Folder(roots[i]);
                if (!d.exists) continue;
                files = d.getFiles('*.epr');
                for (j = 0; j < files.length; j++) out.push({ path: files[j].fsName, name: decodeURI(files[j].name).replace(/\.epr$/i, '') });
            } catch (e) {}
        }
        return ok({ presets: out });
    }

    function proxyAttach(id, file) {
        var pi = itemByNodeId(id);
        if (!pi) return false;
        try { if (pi.hasProxy && pi.hasProxy()) return true; } catch (e) {}
        try { pi.attachProxy(file, 0); return true; } catch (e2) { return false; }
    }

    // Proxies des rushs selectionnes (o.all : tous les rushs video du projet) dans o.dir avec le
    // preglage o.preset ; Media Encoder les fabrique, RR FX les attache a la fin de chaque job.
    function makeProxies(o) {
        var E = app.encoder, list = [], sel, i, pi, out, job, queued = [], skipped = 0, dir;
        if (!E || !E.encodeProjectItem) return fail('Media Encoder est introuvable : installe-le avec ton abonnement Creative Cloud.');
        if (!o.preset) return fail('Choisis un pr\u00e9r\u00e9glage de proxy.');
        if (o.all) walkItems(app.project.rootItem, function (c) { if (c.type === 1 && kindOf(c) === 'video') list.push(c); return true; });
        else {
            sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null;
            if (!sel || !sel.length) return fail('S\u00e9lectionne des rushs dans le panneau Projet.');
            for (i = 0; i < sel.length; i++) if (sel[i].type === 1 && kindOf(sel[i]) === 'video') list.push(sel[i]);
        }
        if (!list.length) return fail('Aucun rush vid\u00e9o \u00e0 traiter.');
        dir = new Folder(o.dir);
        if (!dir.exists) dir.create();
        // Extension du fichier selon le preglage (ProRes, DNx, CineForm : .mov ; sinon .mp4).
        var ext = /prores|dnx|cineform|gopro/i.test(String(o.preset)) ? '.mov' : '.mp4';
        if (!PROXY.bound && E.bind) {
            try {
                E.bind('onEncoderJobComplete', function (jobID, outputFile) {
                    var j = PROXY.jobs[jobID];
                    if (j) { j.done = proxyAttach(j.id, outputFile || j.file); j.finished = true; }
                });
                PROXY.bound = true;
            } catch (e0) {}
        }
        try { if (E.launchEncoder) E.launchEncoder(); } catch (e1) {}
        for (i = 0; i < list.length; i++) {
            pi = list[i];
            try { if ((pi.hasProxy && pi.hasProxy()) || (pi.canProxy && !pi.canProxy())) { skipped++; continue; } } catch (e2) {}
            out = dir.fsName + '/' + String(pi.name).replace(/\.[^.]+$/, '').replace(/[\\\/:*?"<>|]+/g, '_') + '_Proxy' + ext;
            // Media entier (pas seulement entre ses points d'entree et de sortie), job retire de la file a la fin.
            try { job = E.encodeProjectItem(pi, out, o.preset, E.ENCODE_ENTIRE !== undefined ? E.ENCODE_ENTIRE : 0, 1); } catch (e3) { job = null; }
            if (job === null || job === undefined || job === '0' || job === 0) { skipped++; continue; }
            PROXY.jobs[job] = { id: pi.nodeId, file: out, name: pi.name, done: false, finished: false };
            queued.push({ job: String(job), id: pi.nodeId, name: pi.name });
        }
        if (queued.length) { try { E.startBatch(); } catch (e4) {} }
        return ok({ queued: queued, skipped: skipped });
    }

    // Avancement : jobs termines et proxies attaches.
    function proxyStatus(o) {
        var k, j, total = 0, finished = 0, attached = 0;
        for (k in PROXY.jobs) {
            if (!PROXY.jobs.hasOwnProperty(k)) continue;
            j = PROXY.jobs[k];
            total++;
            if (j.finished) finished++;
            if (j.done) attached++;
        }
        var on = null;
        try { if (app.getEnableProxies) on = !!app.getEnableProxies(); } catch (e) {}
        return ok({ total: total, finished: finished, attached: attached, enabled: on });
    }

    // Proxies actives ou non dans les moniteurs (comme le bouton " Activer les proxies ").
    function setProxies(o) {
        if (!app.setEnableProxies) return fail('Cette version de Premiere ne permet pas d\'activer les proxies par script : bouton \u00ab Activer les proxies \u00bb du Moniteur.');
        app.setEnableProxies(o.on ? 1 : 0);
        var on = !!o.on;
        try { if (app.getEnableProxies) on = !!app.getEnableProxies(); } catch (e) {}
        return ok({ enabled: on });
    }

    // Version d'une sequence supprimee (jamais la sequence ouverte).
    function deleteSequence(o) {
        var P = app.project, s = seqById(o.id);
        if (!s) return fail('S\u00e9quence introuvable');
        if (P.activeSequence && P.activeSequence.sequenceID === o.id) return fail('C\'est la s\u00e9quence ouverte : ouvre-en une autre d\'abord.');
        if (!P.deleteSequence) return fail('Cette version de Premiere ne permet pas de supprimer une s\u00e9quence par script.');
        if (P.deleteSequence(s) === false) return fail('Premiere a refus\u00e9 de supprimer la s\u00e9quence.');
        return ok({ id: o.id });
    }

    api.importToBin = guard(importToBin);
    api.tidyProject = guard(tidyProject);
    api.renameItems = guard(renameItems);
    api.versionSequence = guard(versionSequence);
    api.fitMusic = guard(fitMusic);
    api.activityPing = guard(activityPing);
    api.proxyPresets = guard(proxyPresets);
    api.makeProxies = guard(makeProxies);
    api.proxyStatus = guard(proxyStatus);
    api.setProxies = guard(setProxies);
    api.deleteSequence = guard(deleteSequence);

