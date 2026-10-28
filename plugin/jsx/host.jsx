/* CutFX — Premiere Pro side (ExtendScript, ES3).
   Every public function takes a JSON string and returns a JSON string:
   { ok: true, ... } or { ok: false, error: "..." }.
   Times travel as ticks (numbers); 254016000000 ticks = 1 second. */

var CutFX = (function () {
    var TICKS = 254016000000;
    var VERSION = '1.1.0';
    var adjCache = null;

    // ------------------------------------------------------------ JSON

    function quote(s) {
        return '"' + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
            if (c === '"') return '\\"';
            if (c === '\\') return '\\\\';
            if (c === '\n') return '\\n';
            if (c === '\r') return '\\r';
            if (c === '\t') return '\\t';
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
    }

    function str(v) {
        var t = typeof v, i, a, k;
        if (v === null || v === undefined) return 'null';
        if (t === 'number') return isFinite(v) ? String(v) : 'null';
        if (t === 'boolean') return v ? 'true' : 'false';
        if (t === 'string') return quote(v);
        if (v instanceof Array) {
            a = [];
            for (i = 0; i < v.length; i++) a.push(str(v[i]));
            return '[' + a.join(',') + ']';
        }
        if (t === 'object') {
            a = [];
            for (k in v) {
                if (!v.hasOwnProperty(k)) continue;
                if (typeof v[k] === 'function' || v[k] === undefined) continue;
                a.push(quote(k) + ':' + str(v[k]));
            }
            return '{' + a.join(',') + '}';
        }
        return 'null';
    }

    function parse(s) {
        if (!s) return {};
        return eval('(' + s + ')');
    }

    function ok(o) {
        o = o || {};
        o.ok = true;
        return str(o);
    }

    function fail(msg, extra) {
        var o = extra || {};
        o.ok = false;
        o.error = msg;
        return str(o);
    }

    function guard(fn) {
        return function (json) {
            try {
                return fn(parse(json));
            } catch (e) {
                return fail('Erreur script : ' + e.toString() + (e.line ? ' (ligne ' + e.line + ')' : ''));
            }
        };
    }

    // ------------------------------------------------------------ time helpers

    function tk(t) { return Number(t.ticks); }

    function mkTime(ticks) {
        var t = new Time();
        t.ticks = String(Math.round(ticks));
        return t;
    }

    function tpf(s) { return Number(s.timebase); }

    function snap(ticks, f) { return Math.round(ticks / f) * f; }

    function activeSeq() {
        var s = app.project.activeSequence;
        if (!s) throw new Error('Aucune séquence active');
        return s;
    }

    function timecodeOf(s, ticks) {
        var st = s.getSettings();
        return mkTime(ticks).getFormatted(st.videoFrameRate, st.videoDisplayFormat);
    }

    // ------------------------------------------------------------ timeline helpers

    function clipsOf(s, trackIndex) {
        var out = [], tr = s.videoTracks[trackIndex], i;
        if (!tr) return out;
        for (i = 0; i < tr.clips.numItems; i++) out.push(tr.clips[i]);
        out.sort(function (a, b) { return tk(a.start) - tk(b.start); });
        return out;
    }

    function findItemAt(s, trackIndex, startTicks) {
        var f = tpf(s), list = clipsOf(s, trackIndex), i;
        for (i = 0; i < list.length; i++) if (Math.abs(tk(list[i].start) - startTicks) < f / 2) return list[i];
        return null;
    }

    function clipContaining(s, trackIndex, ticks) {
        var list = clipsOf(s, trackIndex), i;
        for (i = 0; i < list.length; i++) if (tk(list[i].start) <= ticks && ticks < tk(list[i].end)) return list[i];
        return null;
    }

    function clipEndingAt(s, trackIndex, ticks) {
        var f = tpf(s), list = clipsOf(s, trackIndex), i;
        for (i = 0; i < list.length; i++) if (Math.abs(tk(list[i].end) - ticks) < f / 2) return list[i];
        return null;
    }

    function trackIndexOf(s, item) {
        var i, j, tr;
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            tr = s.videoTracks[i];
            for (j = 0; j < tr.clips.numItems; j++) if (tr.clips[j].nodeId === item.nodeId) return i;
        }
        return -1;
    }

    function selectedVideo(s) {
        var sel = s.getSelection(), out = [], i, it, ti;
        if (!sel) return out;
        for (i = 0; i < sel.length; i++) {
            it = sel[i];
            if (it.mediaType !== 'Video') continue;
            ti = trackIndexOf(s, it);
            if (ti >= 0) out.push({ item: it, track: ti });
        }
        out.sort(function (a, b) { return (a.track - b.track) || (tk(a.item.start) - tk(b.item.start)); });
        return out;
    }

    // The clip the user means: the selection, otherwise the topmost clip under the playhead.
    function refClip(s) {
        var sel = selectedVideo(s), ph = tk(s.getPlayerPosition()), i, c;
        if (sel.length) return sel[0];
        for (i = s.videoTracks.numTracks - 1; i >= 0; i--) {
            c = clipContaining(s, i, ph);
            if (c) return { item: c, track: i };
        }
        return null;
    }

    function nearestEdit(s, trackIndex, ticks) {
        var list = clipsOf(s, trackIndex), best = null, bd = Infinity, i, e, j, d;
        for (i = 0; i < list.length; i++) {
            e = [tk(list[i].start), tk(list[i].end)];
            for (j = 0; j < 2; j++) {
                d = Math.abs(e[j] - ticks);
                if (d < bd) { bd = d; best = e[j]; }
            }
        }
        return best;
    }

    function trackClear(s, trackIndex, a, b) {
        var list = clipsOf(s, trackIndex), i, tr = s.videoTracks[trackIndex];
        try { if (tr.isLocked && tr.isLocked()) return false; } catch (e) {}
        for (i = 0; i < list.length; i++) if (tk(list[i].start) < b && a < tk(list[i].end)) return false;
        return true;
    }

    function qeSeq() {
        app.enableQE();
        return qe.project.getActiveSequence();
    }

    function qeStart(q) {
        try { if (q.start && q.start.ticks !== undefined) return Number(q.start.ticks); } catch (e) {}
        try { return Number(q.start.secs) * TICKS; } catch (e2) {}
        return NaN;
    }

    function qeItemFor(s, trackIndex, startTicks) {
        var qt = qeSeq().getVideoTrackAt(trackIndex), f = tpf(s), i, q;
        for (i = 0; i < qt.numItems; i++) {
            q = qt.getItemAt(i);
            if (!q || q.type === 'Empty') continue;
            if (Math.abs(qeStart(q) - startTicks) < f / 2) return q;
        }
        return null;
    }

    function pickTrack(s, minIndex, a, b, warnings) {
        var i, before;
        for (i = Math.max(0, minIndex); i < s.videoTracks.numTracks; i++) if (trackClear(s, i, a, b)) return i;
        before = s.videoTracks.numTracks;
        try { qeSeq().addTracks(1, before, 0); } catch (e) {}
        if (s.videoTracks.numTracks > before) {
            warnings.push('Piste vidéo V' + (before + 1) + ' ajoutée');
            return before;
        }
        throw new Error('Aucune piste libre au-dessus du clip. Ajoutez une piste vidéo.');
    }

    // ------------------------------------------------------------ adjustment layer

    var ADJ_NAME = /adjustment layer|calque de r[ée]glage|calque d.effets|einstellungsebene|capa de ajuste|livello di regolazione/i;

    function walk(item, fn) {
        var i, c;
        if (!item || !item.children) return null;
        for (i = 0; i < item.children.numItems; i++) {
            c = item.children[i];
            if (fn(c)) return c;
            if (c.type === 2) {
                var r = walk(c, fn);
                if (r) return r;
            }
        }
        return null;
    }

    function isAdjustment(pi) {
        try { if (pi.isAdjustmentLayer && pi.isAdjustmentLayer()) return true; } catch (e) {}
        return pi.type === 1 && ADJ_NAME.test(pi.name);
    }

    function findAdjustment(nodeId) {
        if (adjCache) {
            try { if (adjCache.nodeId && (!nodeId || adjCache.nodeId === nodeId)) return adjCache; } catch (e) { adjCache = null; }
        }
        var root = app.project.rootItem, found = null;
        if (nodeId) found = walk(root, function (c) { return c.nodeId === nodeId; });
        if (!found) found = walk(root, isAdjustment);
        adjCache = found;
        return found;
    }

    function placeAdjustment(s, adj, minTrack, a, b, name, warnings) {
        var dur = b - a, insDur = dur, ti, tr, it;
        try { adj.setInPoint(0, 4); adj.setOutPoint(dur / TICKS, 4); } catch (e) {}
        try { insDur = tk(adj.getOutPoint(1)) - tk(adj.getInPoint(1)); } catch (e2) {}
        if (!(insDur > 0)) insDur = dur;
        ti = pickTrack(s, minTrack, a, a + Math.max(dur, insDur), warnings);
        tr = s.videoTracks[ti];
        var before = {}, list = clipsOf(s, ti), i;
        for (i = 0; i < list.length; i++) before[list[i].nodeId] = true;
        tr.overwriteClip(adj, mkTime(a));
        it = findItemAt(s, ti, a);
        if (!it) {
            // Ce Premiere attend des secondes : on retire ce qui a été posé ailleurs, puis on recommence.
            list = clipsOf(s, ti);
            for (i = 0; i < list.length; i++) if (!before[list[i].nodeId]) list[i].remove(false, false);
            tr.overwriteClip(adj, a / TICKS);
            it = findItemAt(s, ti, a);
        }
        try { adj.clearInPoint(); adj.clearOutPoint(); } catch (e3) {}
        if (!it) throw new Error('Impossible de poser le calque de réglage');
        if (Math.abs(tk(it.end) - b) > 1) it.end = mkTime(b);
        try { it.name = name; } catch (e4) {}
        return { item: it, track: ti };
    }

    // ------------------------------------------------------------ effects & keyframes

    function componentByMatch(item, matchName) {
        var i, c;
        for (i = 0; i < item.components.numItems; i++) {
            c = item.components[i];
            if (c.matchName === matchName) return c;
        }
        return null;
    }

    function addEffect(s, track, start, fx, warnings) {
        var item = findItemAt(s, track, start), before, q, eff = null, i, c;
        if (fx.intrinsic) return componentByMatch(item, fx.intrinsic === 'motion' ? 'AE.ADBE Motion' : 'AE.ADBE Opacity');
        before = item.components.numItems;
        q = qeItemFor(s, track, start);
        if (!q) throw new Error('Clip introuvable dans la timeline');
        for (i = 0; i < fx.names.length && !eff; i++) {
            try { eff = qe.project.getVideoEffectByName(fx.names[i]); } catch (e) { eff = null; }
        }
        if (!eff) {
            warnings.push('Effet introuvable : "' + fx.names[0] + '" (voir Réglages > Correspondance des effets)');
            return null;
        }
        q.addVideoEffect(eff);
        item = findItemAt(s, track, start);
        if (item.components.numItems <= before) {
            warnings.push('Premiere a refusé l\'effet "' + fx.names[0] + '"');
            return null;
        }
        c = item.components[item.components.numItems - 1];
        if (fx.matchName && c.matchName !== fx.matchName) warnings.push('"' + fx.names[0] + '" : effet ajouté = ' + c.matchName);
        return c;
    }

    // Keyframe times are in the clip's own time: its in point + offset from its start.
    function clipTime(item, seqTicks) {
        return mkTime(tk(item.inPoint) + (seqTicks - tk(item.start)));
    }

    function isPixelPoint(p) {
        try {
            var v = p.getValue();
            if (v && v.length >= 2) return Math.abs(v[0]) > 2 || Math.abs(v[1]) > 2;
        } catch (e) {}
        return false;
    }

    function convert(v, spec, pixels, s) {
        if (!spec.point || spec.raw || !pixels || !(v instanceof Array)) return v;
        return [v[0] * s.frameSizeHorizontal, v[1] * s.frameSizeVertical];
    }

    // The parameter at the expected index, or, if its name does not look right
    // (another Premiere version, another language), the one whose name does.
    function looksLike(name, match) {
        if (!new RegExp(match[0], 'i').test(name)) return false;
        return !(match[1] && new RegExp(match[1], 'i').test(name));
    }

    function paramFor(comp, sp, fx, warnings) {
        var p = comp.properties[sp.index], i, q;
        if (!sp.match || sp.raw) return p;
        try {
            if (p && looksLike(p.displayName, sp.match)) return p;
            for (i = 0; i < comp.properties.numItems; i++) {
                q = comp.properties[i];
                if (q && looksLike(q.displayName, sp.match)) {
                    warnings.push(fx.names[0] + ' : « ' + q.displayName + ' » utilisé (#' + i + ' au lieu de #' + sp.index + ')');
                    return q;
                }
            }
        } catch (e) {}
        return p;
    }

    function setProps(s, item, comp, fx, start, f, warnings) {
        var i, j, sp, p, pixels, t, last, n = 0;
        for (i = 0; i < fx.props.length; i++) {
            sp = fx.props[i];
            p = paramFor(comp, sp, fx, warnings);
            if (!p) { warnings.push(fx.names[0] + ' : paramètre #' + sp.index + ' absent'); continue; }
            try {
                pixels = sp.point && !sp.raw ? isPixelPoint(p) : false;
                if (sp.keys || sp.values) {
                    // keys : [[image, valeur], …] ; values : une valeur par image.
                    var keys = sp.keys, k;
                    if (!keys) {
                        keys = [];
                        for (j = 0; j < sp.values.length; j++) keys.push([j, sp.values[j]]);
                    }
                    if (!p.isTimeVarying()) p.setTimeVarying(true);
                    last = keys.length - 1;
                    for (j = 0; j <= last; j++) {
                        k = keys[j];
                        t = clipTime(item, start + k[0] * f);
                        p.addKey(t);
                        p.setValueAtKey(t, convert(k[1], sp, pixels, s), j === last);
                    }
                } else {
                    if (p.isTimeVarying()) p.setTimeVarying(false);
                    p.setValue(convert(sp['static'], sp, pixels, s), true);
                }
                n++;
            } catch (e) {
                warnings.push(fx.names[0] + ' #' + sp.index + ' : ' + e.toString());
            }
        }
        return n;
    }

    // ------------------------------------------------------------ public: context

    function appVersion() {
        try { return String(app.version); } catch (e) { return ''; }
    }

    function markerTimes(s) {
        var out = [], ms, m, guard = 0;
        try { ms = s.markers; m = ms ? ms.getFirstMarker() : null; } catch (e) { return out; }
        while (m && guard++ < 10000) {
            out.push(tk(m.start));
            try { m = ms.getNextMarker(m); } catch (e2) { m = null; }
        }
        return out;
    }

    // What this Premiere offers. Required = without it nothing works.
    function compat(o) {
        var missing = [], optional = [], s = app.project ? app.project.activeSequence : null;
        try { app.enableQE(); } catch (e) {}
        if (typeof qe === 'undefined' || !qe.project) missing.push('QE (qe.project)');
        else {
            if (!qe.project.getVideoEffectByName) missing.push('qe.project.getVideoEffectByName');
            if (!qe.project.getVideoEffectList) optional.push('qe.project.getVideoEffectList');
        }
        if (typeof Time === 'undefined') missing.push('Time');
        if (s) {
            if (!s.getSelection) missing.push('Sequence.getSelection');
            if (!s.unlinkSelection) optional.push('Sequence.unlinkSelection');
            if (!s.markers) optional.push('Sequence.markers');
        }
        if (!app.getCurrentProjectViewSelection) optional.push('app.getCurrentProjectViewSelection');
        return ok({ version: VERSION, app: appVersion(), missing: missing, optional: optional });
    }

    function getContext(o) {
        var s = app.project.activeSequence;
        if (!s) return ok({ hasSequence: false, version: VERSION, app: appVersion() });
        var sel = selectedVideo(s), names = [], i, adj = null;
        for (i = 0; i < sel.length && i < 3; i++) names.push(sel[i].item.name);
        if (o && o.adj) {
            var a = findAdjustment(o.adjNodeId);
            if (a) adj = { name: a.name, nodeId: a.nodeId };
        }
        return ok({
            hasSequence: true, version: VERSION, app: appVersion(), name: s.name, fps: TICKS / tpf(s),
            frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
            playhead: tk(s.getPlayerPosition()) / TICKS,
            selection: sel.length, selectionNames: names, adj: adj, markers: markerTimes(s).length
        });
    }

    // ------------------------------------------------------------ public: resolve targets

    function resolve(o) {
        var s = activeSeq(), f = tpf(s), N = Math.max(1, Math.round(o.frames || 8)), ph = snap(tk(s.getPlayerPosition()), f);
        var targets = [], warnings = [], direct = o.target === 'clip', sides = o.sides || ['pre', 'post'];
        var i, j, ref, track, cut, c, list, a, b;

        function add(side, start, end, clip, refTrack, clipTrack) {
            start = Math.max(0, start);
            var frames = Math.round((end - start) / f);
            if (frames < 1) return;
            targets.push({
                side: side, start: start, end: start + frames * f, frames: frames, track: refTrack,
                clipTrack: clipTrack, clipStart: clip ? tk(clip.start) : null, clipName: clip ? clip.name : ''
            });
        }

        function atCut(cutTicks, tr, outgoing, incoming) {
            for (j = 0; j < sides.length; j++) {
                if (sides[j] === 'pre') {
                    if (direct && !outgoing) { warnings.push('Pas de clip avant la coupe'); continue; }
                    a = cutTicks - N * f;
                    if (direct) a = Math.max(a, tk(outgoing.start));
                    if (a < 0) warnings.push('PRE raccourci (début de séquence)');
                    add('pre', a, cutTicks, outgoing, tr, tr);
                } else if (sides[j] === 'post') {
                    if (direct && !incoming) { warnings.push('Pas de clip après la coupe'); continue; }
                    b = cutTicks + N * f;
                    if (direct) b = Math.min(b, tk(incoming.end));
                    add('post', cutTicks, b, incoming, tr, tr);
                }
            }
        }

        if (o.placement === 'cut' || o.placement === 'playhead') {
            ref = refClip(s);
            track = ref ? ref.track : 0;
            cut = ph;
            if (o.placement === 'cut') {
                cut = nearestEdit(s, track, ph);
                if (cut === null) cut = ph;
            }
            atCut(cut, track,
                o.placement === 'cut' ? clipEndingAt(s, track, cut) : clipContaining(s, track, cut - f),
                clipContaining(s, track, cut));
        } else if (o.placement === 'markers') {
            ref = refClip(s);
            track = ref ? ref.track : 0;
            list = selectedVideo(s);
            var times = markerTimes(s), lo = -Infinity, hi = Infinity, seen = {}, tm;
            if (!times.length) return fail('Aucun marqueur dans la séquence. Posez-en sur les temps forts (touche M pendant la lecture).');
            if (list.length) {
                lo = Infinity; hi = -Infinity;
                for (i = 0; i < list.length; i++) { lo = Math.min(lo, tk(list[i].item.start)); hi = Math.max(hi, tk(list[i].item.end)); }
            }
            times.sort(function (x, y) { return x - y; });
            for (i = 0; i < times.length; i++) {
                tm = snap(times[i], f);
                if (tm < lo || tm > hi || seen[tm]) continue;
                seen[tm] = true;
                atCut(tm, track, clipContaining(s, track, tm - f), clipContaining(s, track, tm));
            }
            if (!targets.length) return fail('Aucun marqueur dans les clips sélectionnés.', { warnings: warnings });
        } else if (o.placement === 'cuts') {
            list = selectedVideo(s);
            for (i = 1; i < list.length; i++) {
                if (list[i].track !== list[i - 1].track) continue;
                if (Math.abs(tk(list[i].item.start) - tk(list[i - 1].item.end)) <= f) {
                    atCut(tk(list[i].item.start), list[i].track, list[i - 1].item, list[i].item);
                }
            }
            if (!targets.length) return fail('Sélectionnez au moins deux clips qui se suivent sur la même piste.');
        } else {
            list = selectedVideo(s);
            if (!list.length) {
                ref = refClip(s);
                if (ref) list = [ref];
            }
            if (!list.length) return fail('Sélectionnez un clip dans la timeline.');
            for (i = 0; i < list.length; i++) {
                c = list[i].item;
                if (o.placement === 'clipStart') add('post', tk(c.start), Math.min(tk(c.start) + N * f, tk(c.end)), c, list[i].track, list[i].track);
                else if (o.placement === 'clipEnd') add('pre', Math.max(tk(c.end) - N * f, tk(c.start)), tk(c.end), c, list[i].track, list[i].track);
                else add(sides[0] || 'post', tk(c.start), tk(c.end), c, list[i].track, list[i].track);
            }
        }
        if (!targets.length) return fail('Rien à faire ici : placez la tête de lecture près d\'une coupe ou sélectionnez un clip.', { warnings: warnings });
        return ok({ fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical, targets: targets, warnings: warnings });
    }

    // ------------------------------------------------------------ public: apply

    function apply(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, j, t, adj = null, placed, track, start, comp, n = 0;
        if (o.target !== 'clip') {
            // Début d'un lot : on revérifie que le calque de réglage est toujours dans le projet.
            if (o.refreshAdj) adjCache = null;
            adj = findAdjustment(o.adjNodeId);
            if (!adj) return fail('Aucun calque de réglage dans le projet. Créez-en un (Fichier > Nouveau > Calque de réglage) ou choisissez la cible "Clip".');
        }
        for (i = 0; i < o.targets.length; i++) {
            t = o.targets[i];
            var label = (t.name || o.name) + ' ' + t.side.toUpperCase(), entry, item;
            if (o.target === 'clip') {
                if (t.clipStart === null || t.clipStart === undefined) { warnings.push('Pas de clip pour ' + t.side.toUpperCase()); continue; }
                track = t.clipTrack;
                start = t.clipStart;
                item = findItemAt(s, track, start);
                if (!item) { warnings.push('Clip introuvable'); continue; }
                entry = { kind: 'clip', track: track, start: start, name: item.name, added: [] };
            } else {
                try {
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                } catch (e1) {
                    // Calque de réglage supprimé du projet depuis : on le recherche une fois.
                    adjCache = null;
                    adj = findAdjustment(o.adjNodeId);
                    if (!adj) return fail('Le calque de réglage a disparu du projet. Crée-en un : Fichier > Nouveau > Calque de réglage.', { created: created, warnings: warnings });
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                }
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            }
            created.push(entry);
            // Une erreur sur un effet ne fait pas perdre ce qui est déjà posé (l'annulation le retrouve).
            for (j = 0; j < t.fx.length; j++) {
                try {
                    comp = addEffect(s, track, start, t.fx[j], warnings);
                    if (!comp) continue;
                    if (entry.added && !t.fx[j].intrinsic) entry.added.push(comp.matchName);
                    item = findItemAt(s, track, start);
                    n += setProps(s, item, comp, t.fx[j], t.start, f, warnings);
                } catch (err) {
                    warnings.push(t.fx[j].names[0] + ' : ' + err.toString());
                }
            }
        }
        return ok({ created: created, props: n, warnings: warnings });
    }

    // Removes what CutFX added, and only that: an adjustment layer must still
    // carry its CutFX name, and a clip's effects are removed from the end only
    // while they are the ones that were added.
    function removeAddedEffects(it, added) {
        var k = it.components.numItems - 1, j, c, n = 0;
        for (j = added.length - 1; j >= 0 && k >= 0; j--, k--) {
            c = it.components[k];
            if (!c || c.matchName !== added[j] || typeof c.remove !== 'function') return n;
        }
        for (j = added.length - 1; j >= 0; j--) {
            it.components[it.components.numItems - 1].remove();
            n++;
        }
        return n;
    }

    function undo(o) {
        var s = activeSeq(), removed = 0, skipped = 0, effects = 0, i, e, it, r;
        // Newest first: effects stacked on the same clip come off in reverse order.
        for (i = o.entries.length - 1; i >= 0; i--) {
            e = o.entries[i];
            it = findItemAt(s, e.track, e.start);
            if (e.kind === 'adj') {
                if (it && it.name === e.name) {
                    it.remove(false, false);
                    removed++;
                } else skipped++;
            } else {
                r = it && e.added && e.added.length ? removeAddedEffects(it, e.added) : 0;
                if (r) effects += r; else skipped++;
            }
        }
        return ok({ removed: removed, effects: effects, skipped: skipped });
    }

    // ------------------------------------------------------------ public: capture & diagnose

    function plainValue(v) {
        var i, out;
        if (typeof v === 'number' || typeof v === 'boolean') return { ok: true, v: v };
        if (v instanceof Array || (v && typeof v.length === 'number' && typeof v !== 'string')) {
            out = [];
            for (i = 0; i < v.length; i++) {
                if (typeof v[i] !== 'number') return { ok: false };
                out.push(v[i]);
            }
            return { ok: true, v: out };
        }
        return { ok: false };
    }

    function capture(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), it, S, E, comps, out = [], k0 = null, k1 = null, skipped = 0;
        var ci, pi, c, mn, intrinsic, entry, p, pe, keys, j, kt, v, D = 0, origin = 'post';
        if (!sel.length) return fail('Sélectionnez dans la timeline le clip ou calque de réglage qui porte vos effets.');
        it = sel[0].item;
        S = tk(it.start);
        E = tk(it.end);
        comps = it.components;
        for (ci = 0; ci < comps.numItems; ci++) {
            c = comps[ci];
            mn = c.matchName;
            intrinsic = mn === 'AE.ADBE Motion' ? 'motion' : (mn === 'AE.ADBE Opacity' ? 'opacity' : null);
            if (/time ?remap/i.test(mn)) continue;
            if (intrinsic && !o.includeIntrinsic) continue;
            entry = { ci: ci, matchName: mn, displayName: c.displayName, intrinsic: intrinsic, props: [] };
            for (pi = 0; pi < c.properties.numItems; pi++) {
                p = c.properties[pi];
                pe = { index: pi, name: p.displayName };
                try {
                    if (p.isTimeVarying()) {
                        keys = p.getKeys();
                        if (keys && keys.length) {
                            pe.animated = true;
                            for (j = 0; j < keys.length; j++) {
                                kt = tk(keys[j]) - tk(it.inPoint) + S;
                                if (k0 === null || kt < k0) k0 = kt;
                                if (k1 === null || kt > k1) k1 = kt;
                            }
                        }
                    }
                } catch (e) {}
                if (!pe.animated) {
                    try {
                        v = plainValue(p.getValue());
                        if (!v.ok) { skipped++; continue; }
                        pe['static'] = v.v;
                    } catch (e2) { skipped++; continue; }
                }
                entry.props.push(pe);
            }
            if (entry.props.length) out.push(entry);
        }
        if (k0 !== null) {
            k0 = snap(k0, f);
            k1 = snap(k1, f);
            D = Math.round((k1 - k0) / f) + 1;
            origin = (E - k1) < (k0 - S) ? 'pre' : 'post';
            for (ci = 0; ci < out.length; ci++) {
                for (pi = 0; pi < out[ci].props.length; pi++) {
                    pe = out[ci].props[pi];
                    if (!pe.animated) continue;
                    p = comps[out[ci].ci].properties[pe.index];
                    pe.values = [];
                    for (j = 0; j < D; j++) {
                        v = plainValue(p.getValueAtTime(clipTime(it, k0 + j * f)));
                        if (!v.ok) { pe.values = null; break; }
                        pe.values.push(v.v);
                    }
                    delete pe.animated;
                    // Une valeur illisible : le paramètre entier est ignoré plutôt que mal rejoué.
                    if (!pe.values) { out[ci].props.splice(pi, 1); pi--; skipped++; }
                }
            }
        }
        for (ci = out.length - 1; ci >= 0; ci--) {
            delete out[ci].ci;
            if (!out[ci].props.length) out.splice(ci, 1);
        }
        if (!out.length) return fail('Aucun effet lisible sur ce clip.');
        return ok({
            name: it.name, frames: D, fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
            clipFrames: Math.round((E - S) / f), origin: origin, components: out, skipped: skipped
        });
    }

    function diagnose(o) {
        var s = activeSeq(), sel = selectedVideo(s), lines = [], it, i, j, c, p, v;
        if (!sel.length) return fail('Sélectionnez un clip dans la timeline.');
        it = sel[0].item;
        lines.push('Clip : ' + it.name + '  (V' + (sel[0].track + 1) + ')');
        for (i = 0; i < it.components.numItems; i++) {
            c = it.components[i];
            lines.push('');
            lines.push('[' + i + '] ' + c.displayName + '   matchName: ' + c.matchName);
            for (j = 0; j < c.properties.numItems; j++) {
                p = c.properties[j];
                try { v = p.getValue(); v = (v && v.length !== undefined && typeof v !== 'string') ? '[' + v.join(', ') + ']' : String(v); } catch (e) { v = '?'; }
                if (v.length > 60) v = v.substr(0, 60) + '…';
                lines.push('    #' + j + '  ' + p.displayName + ' = ' + v);
            }
        }
        return ok({ text: lines.join('\n') });
    }

    function listEffects(o) {
        var names = [], list, i, re = o && o.filter ? new RegExp(o.filter, 'i') : null;
        app.enableQE();
        list = qe.project.getVideoEffectList();
        for (i = 0; i < list.length; i++) if (!re || re.test(list[i])) names.push(String(list[i]));
        return ok({ names: names });
    }

    function adjustmentInfo(o) {
        adjCache = null;
        var a = findAdjustment(o.nodeId);
        return ok({ found: !!a, name: a ? a.name : '', nodeId: a ? a.nodeId : '' });
    }

    function adjustmentFromSelection(o) {
        var sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null;
        if (!sel || !sel.length) return fail('Sélectionnez votre calque de réglage dans le panneau Projet.');
        adjCache = sel[0];
        return ok({ name: sel[0].name, nodeId: sel[0].nodeId });
    }

    // ------------------------------------------------------------ public: speed ramps
    // Premiere does not expose Time Remapping to scripts, so a ramp is built from
    // constant-speed pieces: the zone is razored, each piece gets its speed and its
    // source range so that the sequence timing (the cut) never moves.

    function rampResolve(o) {
        var s = activeSeq(), f = tpf(s), N = Math.max(2, Math.round(o.frames || 12)), ph = snap(tk(s.getPlayerPosition()), f);
        var ref = refClip(s), track = ref ? ref.track : 0, clip = null, cut, a, b, anchor = 'start';
        if (o.placement === 'pre' || o.placement === 'post') {
            cut = nearestEdit(s, track, ph);
            if (cut === null) return fail('Aucune coupe trouvée sur la piste V' + (track + 1));
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
            if (!clip) return fail('Placez la tête de lecture sur un clip.');
            a = Math.max(tk(clip.start), ph - Math.floor(N / 2) * f);
            b = Math.min(tk(clip.end), a + N * f);
        } else {
            if (!ref) return fail('Sélectionnez un clip.');
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

    function rampApply(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], item, S, E, I, s0 = 1, R0 = o.regionStart, R1, K = o.pieces.length;
        var bnd = [R0], L = [], total = 0, k, srcStart, srcEnd, beforeIn, afterOut, mediaEnd = null, cuts = [], qt, q, it, calib = null, got, srcK, plan = [];
        item = findItemAt(s, o.track, o.clipStart);
        if (!item) return fail('Clip introuvable : il a bougé depuis l\'aperçu. Réessayez.');
        S = tk(item.start); E = tk(item.end); I = tk(item.inPoint);
        try { s0 = item.getSpeed(); } catch (e) {}
        if (!(s0 > 0)) s0 = 1;
        try { if (item.isSpeedReversed && item.isSpeedReversed()) return fail('Les clips inversés ne sont pas pris en charge.'); } catch (e2) {}

        for (k = 0; k < K; k++) {
            bnd.push(bnd[k] + o.pieces[k].frames * f);
            L.push(Math.round(o.pieces[k].speed / 100 * o.pieces[k].frames * f));
            total += L[k];
        }
        R1 = bnd[K];
        srcStart = o.anchor === 'end' ? I + (R1 - S) * s0 - total : I + (R0 - S) * s0;
        srcEnd = srcStart + total;
        beforeIn = srcStart - (R0 - S) * s0;
        afterOut = srcEnd + (E - R1) * s0;
        if (beforeIn < -f / 2) {
            return fail('Pas assez de média avant : il manque ' + Math.ceil(-beforeIn / f) + ' images. Choisissez l\'ancre "Début de zone" ou réduisez la vitesse.');
        }
        try { mediaEnd = tk(item.projectItem.getOutPoint(1)); } catch (e3) {}
        if (mediaEnd && afterOut > mediaEnd + f / 2) {
            return fail('Pas assez de média après : il manque ' + Math.ceil((afterOut - mediaEnd) / f) + ' images. Choisissez l\'ancre "Fin de zone", réduisez la vitesse, ou retirez le point de sortie du média source.');
        }

        // Video only: the clip's audio would no longer line up.
        try {
            var sel = s.getSelection(), i;
            for (i = 0; i < sel.length; i++) sel[i].setSelected(false, false);
            item.setSelected(true, true);
            if (s.unlinkSelection) { s.unlinkSelection(); warnings.push('Audio dissocié de la vidéo (laissé intact)'); }
        } catch (e4) {}

        if (R0 > S + f / 2) cuts.push(R0);
        for (k = 1; k < K; k++) cuts.push(bnd[k]);
        if (R1 < E - f / 2) cuts.push(R1);
        qt = qeSeq().getVideoTrackAt(o.track);
        for (k = 0; k < cuts.length; k++) qt.razor(timecodeOf(s, cuts[k]));

        for (k = 0; k < K; k++) {
            if (!findItemAt(s, o.track, bnd[k])) return fail('La découpe a échoué (morceau ' + (k + 1) + '). Annulez avec Ctrl+Z / Cmd+Z.');
        }

        srcK = srcStart;
        for (k = 0; k < K; k++) {
            plan.push({ a: bnd[k], b: bnd[k + 1], inT: srcK, outT: srcK + L[k], speed: o.pieces[k].speed / 100 });
            srcK += L[k];
        }

        for (k = 0; k < K; k++) {
            q = qeItemFor(s, o.track, plan[k].a);
            if (!q) return fail('Morceau ' + (k + 1) + ' introuvable pour QE.');
            if (calib === null) {
                q.setSpeed(plan[k].speed, '', false, false, false);
                got = findItemAt(s, o.track, plan[k].a).getSpeed();
                if (Math.abs(got - plan[k].speed) < 0.01) calib = 1;
                else {
                    q.setSpeed(plan[k].speed * 100, '', false, false, false);
                    got = findItemAt(s, o.track, plan[k].a).getSpeed();
                    if (Math.abs(got - plan[k].speed) < 0.01) calib = 100;
                    else return fail('Premiere n\'a pas accepté le changement de vitesse (lu : ' + got + ').');
                }
            } else {
                q.setSpeed(plan[k].speed * calib, '', false, false, false);
            }
            if (o.interp && o.interp !== 'keep') {
                try {
                    if (q.setTimeInterpolationType) q.setTimeInterpolationType(o.interp === 'flow' ? 2 : 1);
                } catch (e5) { if (k === 0) warnings.push('Interpolation temporelle à régler à la main (Clip > Options vidéo)'); }
            }
        }

        if (R0 > S + f / 2) plan.push({ a: S, b: R0, inT: beforeIn, outT: srcStart });
        if (R1 < E - f / 2) plan.push({ a: R1, b: E, inT: srcEnd, outT: afterOut });

        // Two passes: a piece may only reach its slot once its neighbour has moved.
        var pass, bad = [];
        for (pass = 0; pass < 2; pass++) {
            for (k = 0; k < plan.length; k++) {
                it = findItemAt(s, o.track, plan[k].a) || clipContaining(s, o.track, plan[k].a + f / 2);
                if (!it) continue;
                try { setSource(it, plan[k].inT, plan[k].outT); } catch (e6) {}
                fixSpan(it, plan[k].a, plan[k].b);
            }
        }
        for (k = 0; k < plan.length; k++) {
            it = findItemAt(s, o.track, plan[k].a);
            if (!it || Math.abs(tk(it.end) - plan[k].b) > f / 2) bad.push(k + 1);
        }
        if (bad.length) warnings.push('Morceaux à vérifier : ' + bad.join(', '));
        return ok({ pieces: K, sourceFrames: total / f, warnings: warnings, mode: calib === 100 ? 'percent' : 'factor' });
    }

    return {
        version: VERSION,
        compat: guard(compat),
        getContext: guard(getContext),
        resolve: guard(resolve),
        apply: guard(apply),
        undo: guard(undo),
        capture: guard(capture),
        diagnose: guard(diagnose),
        listEffects: guard(listEffects),
        adjustmentInfo: guard(adjustmentInfo),
        adjustmentFromSelection: guard(adjustmentFromSelection),
        rampResolve: guard(rampResolve),
        rampApply: guard(rampApply)
    };
})();
