/* RR FX - Premiere Pro side (ExtendScript, ES3).
   Every public function takes a JSON string and returns a JSON string:
   { ok: true, ... } or { ok: false, error: "..." }.
   Times travel as ticks (numbers); 254016000000 ticks = 1 second. */

var RRFX = (function () {
    var TICKS = 254016000000;
    var VERSION = '2.6.0';
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
        if (!s) throw new Error('Aucune s\u00e9quence active');
        return s;
    }

    function seqById(id) {
        var P = app.project, i;
        for (i = 0; i < P.sequences.numSequences; i++) if (P.sequences[i].sequenceID === id) return P.sequences[i];
        return null;
    }

    // La sequence d'une operation (historique, lot) : ouverte si une autre l'est. id vide : l'active.
    function useSeq(id) {
        var a = app.project.activeSequence, s;
        if (!id || (a && a.sequenceID === id)) return activeSeq();
        s = seqById(id);
        if (!s) throw new Error('S\u00e9quence introuvable (supprim\u00e9e ou renomm\u00e9e ?)');
        try { app.project.openSequence(id); } catch (e) {}
        a = app.project.activeSequence;
        return a && a.sequenceID === id ? a : s;
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

    // Clips video selectionnes avec leur piste. Un seul passage sur la timeline (appele
    // toutes les 2 s par le panneau : doit rester rapide sur les longues sequences).
    function selectedVideo(s) {
        var sel = s.getSelection(), out = [], ids = {}, n = 0, i, j, tr, c;
        if (!sel || !sel.length) return out;
        for (i = 0; i < sel.length; i++) {
            if (sel[i].mediaType !== 'Video') continue;
            ids[sel[i].nodeId] = sel[i];
            n++;
        }
        for (i = 0; i < s.videoTracks.numTracks && n > 0; i++) {
            tr = s.videoTracks[i];
            for (j = 0; j < tr.clips.numItems && n > 0; j++) {
                c = tr.clips[j];
                if (ids[c.nodeId]) { out.push({ item: ids[c.nodeId], track: i }); ids[c.nodeId] = null; n--; }
            }
        }
        out.sort(function (a, b) { return (a.track - b.track) || (tk(a.item.start) - tk(b.item.start)); });
        return out;
    }

    // Calques poses par RR FX et calques de reglage : ce ne sont pas des " plans ".
    function isLayer(it) {
        if (/^RR FX \u00b7 /.test(it.name)) return true;
        try { return !!(it.projectItem && isAdjustment(it.projectItem)); } catch (e) { return false; }
    }

    // Le plan vise : la selection, sinon le plan le plus haut sous la tete de lecture.
    function refClip(s) {
        var sel = selectedVideo(s), ph = tk(s.getPlayerPosition()), i, c;
        for (i = 0; i < sel.length; i++) if (!isLayer(sel[i].item)) return sel[i];
        if (sel.length) return sel[0];
        for (i = s.videoTracks.numTracks - 1; i >= 0; i--) {
            c = clipContaining(s, i, ph);
            if (c && !isLayer(c)) return { item: c, track: i };
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
            warnings.push('Piste vid\u00e9o V' + (before + 1) + ' ajout\u00e9e');
            return before;
        }
        throw new Error('Aucune piste libre au-dessus du clip. Ajoutez une piste vid\u00e9o.');
    }

    // ------------------------------------------------------------ adjustment layer

    var ADJ_NAME = /adjustment layer|calque de r[\u00e9e]glage|calque d.effets|einstellungsebene|capa de ajuste|livello di regolazione/i;

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
            // Ce Premiere attend des secondes : on retire ce qui a ete pose ailleurs, puis on recommence.
            list = clipsOf(s, ti);
            for (i = 0; i < list.length; i++) if (!before[list[i].nodeId]) list[i].remove(false, false);
            tr.overwriteClip(adj, a / TICKS);
            it = findItemAt(s, ti, a);
        }
        try { adj.clearInPoint(); adj.clearOutPoint(); } catch (e3) {}
        if (!it) throw new Error('Impossible de poser le calque de r\u00e9glage');
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
        if (!item) throw new Error('\u00c9l\u00e9ment introuvable sur V' + (track + 1));
        if (fx.intrinsic) return componentByMatch(item, fx.intrinsic === 'motion' ? 'AE.ADBE Motion' : 'AE.ADBE Opacity');
        before = item.components.numItems;
        q = qeItemFor(s, track, start);
        if (!q) throw new Error('Clip introuvable dans la timeline');
        for (i = 0; i < fx.names.length && !eff; i++) {
            try { eff = qe.project.getVideoEffectByName(fx.names[i]); } catch (e) { eff = null; }
        }
        if (!eff) {
            warnings.push('Effet introuvable : "' + fx.names[0] + '" (voir R\u00e9glages > Correspondance des effets)');
            return null;
        }
        q.addVideoEffect(eff);
        item = findItemAt(s, track, start);
        if (!item || item.components.numItems <= before) {
            warnings.push('Premiere a refus\u00e9 l\'effet "' + fx.names[0] + '"');
            return null;
        }
        c = item.components[item.components.numItems - 1];
        if (fx.matchName && c.matchName !== fx.matchName) warnings.push('"' + fx.names[0] + '" : effet ajout\u00e9 = ' + c.matchName);
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
                    warnings.push(fx.names[0] + ' : \u00ab ' + q.displayName + ' \u00bb utilis\u00e9 (#' + i + ' au lieu de #' + sp.index + ')');
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
            if (!p) { warnings.push(fx.names[0] + ' : param\u00e8tre #' + sp.index + ' absent'); continue; }
            try {
                // Couleur [r, g, b] (0 a 255) : reglage de couleur, sans images cles.
                if (sp.color) { p.setColorValue(255, sp['static'][0], sp['static'][1], sp['static'][2], true); n++; continue; }
                pixels = sp.point && !sp.raw ? isPixelPoint(p) : false;
                if (sp.keys || sp.values) {
                    // keys : [[image, valeur], ...] ; values : une valeur par image.
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

    // ------------------------------------------------------------ copies du plan (calques video)
    // Les effets " sur le plan " et les rampes ne touchent jamais le clip d'origine :
    // RR FX pose une copie du passage sur une piste juste au-dessus et travaille dessus.
    // La copie vient d'un sous-clip VIDEO SEULE du rush : rien n'est pose sur les pistes
    // audio (la musique ne peut pas etre ecrasee).

    function rrfxBin() {
        var root = app.project.rootItem, i, c;
        for (i = 0; i < root.children.numItems; i++) {
            c = root.children[i];
            if (c.type === 2 && c.name === 'RR FX') return c;
        }
        return root.createBin('RR FX');
    }

    // Fin du media (le point de sortie marque par l'utilisateur est remis apres lecture).
    function mediaEndOf(pi) {
        var marked = null, end = null;
        try { marked = tk(pi.getOutPoint(1)); } catch (e) {}
        try { pi.clearOutPoint(); end = tk(pi.getOutPoint(1)); } catch (e2) { end = marked; }
        try { if (marked !== null && end !== null && Math.abs(marked - end) > 1) pi.setOutPoint(marked / TICKS, 4); } catch (e3) {}
        return end;
    }

    function videoSource(item) {
        return videoSourceOf(item.projectItem);
    }

    function videoSourceOf(master) {
        var name, sub, end, bin;
        if (!master) throw new Error('Ce clip n\'a pas de m\u00e9dia source (s\u00e9quence imbriqu\u00e9e ?)');
        name = 'RR FX \u00b7 ' + master.name + ' \u00b7 vid\u00e9o';
        sub = walk(app.project.rootItem, function (c) { return c.type === 1 && c.name === name; });
        if (sub) return sub;
        end = mediaEndOf(master);
        if (!(end > 0)) throw new Error('Dur\u00e9e du m\u00e9dia \u00ab ' + master.name + ' \u00bb illisible');
        sub = master.createSubClip(name, mkTime(0), mkTime(end), 0, 1, 0);
        if (!sub) sub = walk(app.project.rootItem, function (c) { return c.type === 1 && c.name === name; });
        if (!sub) throw new Error('Premiere n\'a pas cr\u00e9\u00e9 le sous-clip vid\u00e9o de \u00ab ' + master.name + ' \u00bb');
        bin = rrfxBin();
        try { sub.moveBin(bin); } catch (e) {}
        return sub;
    }

    // Sous-clip son seul d'un rush (pour poser le son de la camera de reference).
    function audioSourceOf(master) {
        var name = 'RR FX \u00b7 ' + master.name + ' \u00b7 son', sub, end, bin;
        sub = walk(app.project.rootItem, function (c) { return c.type === 1 && c.name === name; });
        if (sub) return sub;
        end = mediaEndOf(master);
        if (!(end > 0)) throw new Error('Dur\u00e9e du m\u00e9dia \u00ab ' + master.name + ' \u00bb illisible');
        sub = master.createSubClip(name, mkTime(0), mkTime(end), 0, 0, 1);
        if (!sub) sub = walk(app.project.rootItem, function (c) { return c.type === 1 && c.name === name; });
        if (!sub) throw new Error('Premiere n\'a pas cr\u00e9\u00e9 le sous-clip son de \u00ab ' + master.name + ' \u00bb');
        bin = rrfxBin();
        try { sub.moveBin(bin); } catch (e) {}
        return sub;
    }

    function audioTrackClear(s, i, a, b) {
        var tr = s.audioTracks[i], j, c;
        try { if (tr.isLocked && tr.isLocked()) return false; } catch (e) {}
        for (j = 0; j < tr.clips.numItems; j++) {
            c = tr.clips[j];
            if (tk(c.start) < b && a < tk(c.end)) return false;
        }
        return true;
    }

    // Premiere piste audio libre sur [a, b], ajoutee en dernier si besoin.
    function pickAudioTrack(s, a, b, warnings) {
        var i, before = s.audioTracks.numTracks;
        for (i = 0; i < before; i++) if (audioTrackClear(s, i, a, b)) return i;
        try { qeSeq().addTracks(0, 0, 1, 1, before); } catch (e) {}
        if (s.audioTracks.numTracks > before) {
            warnings.push('Piste audio A' + (before + 1) + ' ajout\u00e9e');
            return before;
        }
        throw new Error('Aucune piste audio libre : ajoute une piste audio.');
    }

    function findAudioAt(s, ti, a) {
        var tr = s.audioTracks[ti], j;
        if (!tr) return null;
        for (j = 0; j < tr.clips.numItems; j++) if (Math.abs(tk(tr.clips[j].start) - a) < 2) return tr.clips[j];
        return null;
    }

    // Piste juste au-dessus du clip (sous les calques de reglage), ajoutee si besoin.
    function layerTrack(s, srcTrack, a, b, warnings) {
        var idx = srcTrack + 1, before = s.videoTracks.numTracks;
        if (idx < before && trackClear(s, idx, a, b)) return idx;
        try { qeSeq().addTracks(1, idx, 0); } catch (e) {}
        if (s.videoTracks.numTracks > before && trackClear(s, idx, a, b)) {
            warnings.push('Piste vid\u00e9o ins\u00e9r\u00e9e au-dessus de V' + (srcTrack + 1));
            return idx;
        }
        warnings.push('Copie pos\u00e9e plus haut que V' + (idx + 1) + ' : v\u00e9rifie qu\'elle reste sous tes calques de r\u00e9glage');
        return pickTrack(s, idx, a, b, warnings);
    }

    // Pose `source` (in/out = inT/outT) a la position a de la piste ti.
    function placeOn(s, ti, source, a, inT, outT) {
        var tr = s.videoTracks[ti], before = {}, list = clipsOf(s, ti), i, it;
        try { source.setInPoint(inT / TICKS, 4); source.setOutPoint(outT / TICKS, 4); } catch (e) {}
        for (i = 0; i < list.length; i++) before[list[i].nodeId] = true;
        tr.overwriteClip(source, mkTime(a));
        it = findItemAt(s, ti, a);
        if (!it) {
            list = clipsOf(s, ti);
            for (i = 0; i < list.length; i++) if (!before[list[i].nodeId]) list[i].remove(false, false);
            tr.overwriteClip(source, a / TICKS);
            it = findItemAt(s, ti, a);
        }
        try { source.clearInPoint(); source.clearOutPoint(); } catch (e2) {}
        if (!it) throw new Error('Impossible de poser la copie sur V' + (ti + 1));
        if (Math.abs(tk(it.inPoint) - inT) > 1 || Math.abs(tk(it.outPoint) - outT) > 1) {
            try { setSource(it, inT, outT); } catch (e3) {}
        }
        return it;
    }

    // Vitesse d'un element via QE. Facteur (2 = 200 %) ou pourcentage selon la version de
    // Premiere : on verifie la premiere fois et on retient la bonne echelle.
    var speedScale = null;
    function setSpeedAt(s, ti, start, factor) {
        var q = qeItemFor(s, ti, start), got;
        if (!q) throw new Error('\u00c9l\u00e9ment introuvable pour changer sa vitesse');
        if (speedScale) { q.setSpeed(factor * speedScale, '', false, false, false); return; }
        q.setSpeed(factor, '', false, false, false);
        got = findItemAt(s, ti, start).getSpeed();
        if (Math.abs(got - factor) < 0.01) { speedScale = 1; return; }
        q.setSpeed(factor * 100, '', false, false, false);
        got = findItemAt(s, ti, start).getSpeed();
        if (Math.abs(got - factor) < 0.01) { speedScale = 100; return; }
        throw new Error('Premiere n\'a pas accept\u00e9 le changement de vitesse (lu : ' + got + ')');
    }

    function copyParam(p, q) {
        var keys, j, v;
        if (p.isTimeVarying()) {
            keys = p.getKeys();
            if (!keys || !keys.length) return true;
            if (!q.isTimeVarying()) q.setTimeVarying(true);
            for (j = 0; j < keys.length; j++) {
                v = plainValue(p.getValueAtKey(keys[j]));
                if (!v.ok) return false;
                q.addKey(keys[j]);
                q.setValueAtKey(keys[j], v.v, j === keys.length - 1);
            }
            return true;
        }
        v = plainValue(p.getValue());
        if (!v.ok) return false;
        if (q.isTimeVarying()) q.setTimeVarying(false);
        q.setValue(v.v, true);
        return true;
    }

    // Recopie le cadrage (Trajectoire, Opacite) et les effets du clip d'origine sur la copie.
    function copyLook(s, src, ti, start, warnings) {
        var comps = src.components, i, j, c, dc, skipped = 0, lost = [];
        for (i = 0; i < comps.numItems; i++) {
            c = comps[i];
            if (/time ?remap/i.test(c.matchName)) continue;
            if (c.matchName === 'AE.ADBE Motion' || c.matchName === 'AE.ADBE Opacity') dc = componentByMatch(findItemAt(s, ti, start), c.matchName);
            else dc = addEffect(s, ti, start, { names: [c.displayName], matchName: c.matchName }, warnings);
            if (!dc) { lost.push(c.displayName); continue; }
            for (j = 0; j < c.properties.numItems && j < dc.properties.numItems; j++) {
                try { if (!copyParam(c.properties[j], dc.properties[j])) skipped++; } catch (e) { skipped++; }
            }
        }
        if (lost.length) warnings.push('Effets du clip non recopi\u00e9s : ' + lost.join(', '));
        if (skipped) warnings.push(skipped + ' r\u00e9glage(s) du clip non recopi\u00e9(s) (courbes, LUT\u2026) : \u00e9talonne plut\u00f4t sur un calque de r\u00e9glage');
    }

    function placeCopy(s, srcItem, srcTrack, a, b, name, o, warnings) {
        var S0 = tk(srcItem.start), I0 = tk(srcItem.inPoint), s0 = 1, srcA, need, ti, it, src;
        try { s0 = srcItem.getSpeed(); } catch (e) {}
        if (!(s0 > 0)) s0 = 1;
        var reversed = false;
        try { reversed = !!(srcItem.isSpeedReversed && srcItem.isSpeedReversed()); } catch (e2) {}
        if (reversed) throw new Error('Les clips invers\u00e9s ne sont pas pris en charge');
        srcA = I0 + (a - S0) * s0;
        need = (b - a) * s0;
        src = videoSource(srcItem);
        ti = layerTrack(s, srcTrack, a, a + Math.max(b - a, need), warnings);
        placeOn(s, ti, src, a, srcA, srcA + need);
        if (Math.abs(s0 - 1) > 0.001) setSpeedAt(s, ti, a, s0);
        it = findItemAt(s, ti, a);
        fixSpan(it, a, b);
        try { it.name = name; } catch (e3) {}
        if (o.copyLook !== false) copyLook(s, srcItem, ti, a, warnings);
        return { item: findItemAt(s, ti, a), track: ti };
    }

    // Un element par sa position et son nom, sur sa piste ou ailleurs (une piste a pu etre inseree).
    function findNamed(s, track, start, name) {
        var it = findItemAt(s, track, start), i;
        if (it && (!name || it.name === name)) return it;
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            it = findItemAt(s, i, start);
            if (it && (!name || it.name === name)) return it;
        }
        return null;
    }

    function findClip(s, track, start, name) {
        return findNamed(s, track, start, name) || findItemAt(s, track, start);
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
        if (s && !s.importMGT) optional.push('Sequence.importMGT');
        try { if (qe && qe.project && !qeSeq().exportFramePNG) optional.push('QE exportFramePNG'); } catch (e2) {}
        var appPath = '';
        try { appPath = String(app.path || ''); } catch (e3) {}
        return ok({ version: VERSION, app: appVersion(), appPath: appPath, missing: missing, optional: optional });
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
            hasSequence: true, version: VERSION, app: appVersion(), name: s.name, seqId: s.sequenceID, fps: TICKS / tpf(s), project: String(app.project.name || '').replace(/\.prproj$/i, ''),
            frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical,
            playhead: tk(s.getPlayerPosition()) / TICKS,
            selection: sel.length, selectionNames: names, adj: adj, markers: markerTimes(s).length
        });
    }

    // ------------------------------------------------------------ public: resolve targets

    function resolve(o) {
        var s = activeSeq(), f = tpf(s), N = Math.max(1, Math.round(o.frames || 8)), ph = snap(tk(s.getPlayerPosition()), f);
        var targets = [], warnings = [], direct = o.target === 'clip' || o.target === 'copy', sides = o.sides || ['pre', 'post'];
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
                    if (a < 0) warnings.push('PRE raccourci (d\u00e9but de s\u00e9quence)');
                    add('pre', a, cutTicks, outgoing, tr, tr);
                } else if (sides[j] === 'post') {
                    if (direct && !incoming) { warnings.push('Pas de clip apr\u00e8s la coupe'); continue; }
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
        } else if (o.placement === 'sequence') {
            // Toute la sequence : une zone du debut a la fin du dernier plan (looks...).
            hi = 0;
            for (i = 0; i < s.videoTracks.numTracks; i++) { list = clipsOf(s, i); if (list.length) hi = Math.max(hi, tk(list[list.length - 1].end)); }
            if (!(hi > 0)) return fail('La s\u00e9quence est vide.');
            add('post', 0, hi, null, 0, 0);
        } else if (o.placement === 'markers') {
            ref = refClip(s);
            track = ref ? ref.track : 0;
            list = selectedVideo(s);
            // o.times (secondes) : temps forts detectes par le panneau, a la place des marqueurs.
            var times = [], lo = -Infinity, hi = Infinity, seen = {}, tm;
            if (o.times) { for (i = 0; i < o.times.length; i++) times.push(o.times[i] * TICKS); } else times = markerTimes(s);
            if (!times.length) return fail(o.times ? 'Aucun temps fort d\u00e9tect\u00e9.' : 'Aucun marqueur dans la s\u00e9quence. Posez-en sur les temps forts (touche M pendant la lecture).');
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
            if (!targets.length) return fail('Aucun marqueur dans les clips s\u00e9lectionn\u00e9s.', { warnings: warnings });
        } else if (o.placement === 'cuts') {
            // o.scope 'sequence' : toutes les coupes du montage, sans selection.
            list = o.scope === 'sequence' ? allVideo(s) : selectedVideo(s);
            for (i = 1; i < list.length; i++) {
                if (list[i].track !== list[i - 1].track) continue;
                if (Math.abs(tk(list[i].item.start) - tk(list[i - 1].item.end)) <= f) {
                    atCut(tk(list[i].item.start), list[i].track, list[i - 1].item, list[i].item);
                }
            }
            if (!targets.length) return fail(o.scope === 'sequence' ? 'Aucune coupe entre deux plans dans la s\u00e9quence.' : 'S\u00e9lectionnez au moins deux clips qui se suivent sur la m\u00eame piste.');
        } else {
            list = o.scope === 'sequence' ? allVideo(s) : selectedVideo(s);
            if (!list.length && o.scope !== 'sequence') {
                ref = refClip(s);
                if (ref) list = [ref];
            }
            if (!list.length) return fail(o.scope === 'sequence' ? 'Aucun plan dans la s\u00e9quence.' : 'S\u00e9lectionnez un clip dans la timeline.');
            for (i = 0; i < list.length; i++) {
                c = list[i].item;
                if (o.placement === 'clipStart') add('post', tk(c.start), Math.min(tk(c.start) + N * f, tk(c.end)), c, list[i].track, list[i].track);
                else if (o.placement === 'clipEnd') add('pre', Math.max(tk(c.end) - N * f, tk(c.start)), tk(c.end), c, list[i].track, list[i].track);
                else add(sides[0] || 'post', tk(c.start), tk(c.end), c, list[i].track, list[i].track);
            }
        }
        if (!targets.length) return fail('Rien \u00e0 faire ici : placez la t\u00eate de lecture pr\u00e8s d\'une coupe ou s\u00e9lectionnez un clip.', { warnings: warnings });
        return ok({ fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical, targets: targets, warnings: warnings });
    }

    // ------------------------------------------------------------ public: apply

    function apply(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, j, t, adj = null, placed, track, start, comp, n = 0, lutSet = 0;
        if (o.target === 'overlay' && !o.overlay) return fail('Overlay manquant');
        if (o.target === 'adjustment' || !o.target) {
            // Debut d'un lot : on reverifie que le calque de reglage est toujours dans le projet.
            if (o.refreshAdj) adjCache = null;
            adj = findAdjustment(o.adjNodeId);
            if (!adj) return fail('Aucun calque de r\u00e9glage dans le projet. Cr\u00e9e-en un : Fichier > Nouveau > Calque de r\u00e9glage.');
        }
        for (i = 0; i < o.targets.length; i++) {
            t = o.targets[i];
            var label = (t.name || o.name) + ' ' + t.side.toUpperCase(), entry, item;
            if (o.target === 'overlay' && !t.name) t.name = o.name;
            if (o.target === 'clip') {
                if (t.clipStart === null || t.clipStart === undefined) { warnings.push('Pas de clip pour ' + t.side.toUpperCase()); continue; }
                track = t.clipTrack;
                start = t.clipStart;
                item = findItemAt(s, track, start);
                if (!item) { warnings.push('Clip introuvable'); continue; }
                entry = { kind: 'clip', track: track, start: start, name: item.name, added: [] };
            } else if (o.target === 'overlay') {
                placed = placeOverlay(s, o.overlay, t, i, warnings);
                if (!placed) continue;
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            } else if (o.target === 'copy') {
                if (t.clipStart === null || t.clipStart === undefined) { warnings.push('Pas de plan pour ' + t.side.toUpperCase()); continue; }
                item = findClip(s, t.clipTrack, t.clipStart, t.clipName);
                if (!item) { warnings.push('Plan introuvable'); continue; }
                placed = placeCopy(s, item, t.clipTrack, t.start, t.end, label, o, warnings);
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            } else {
                try {
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                } catch (e1) {
                    // Calque de reglage supprime du projet depuis : on le recherche une fois.
                    adjCache = null;
                    adj = findAdjustment(o.adjNodeId);
                    if (!adj) return fail('Le calque de r\u00e9glage a disparu du projet. Cr\u00e9e-en un : Fichier > Nouveau > Calque de r\u00e9glage.', { created: created, warnings: warnings });
                    placed = placeAdjustment(s, adj, t.track + 1, t.start, t.end, label, warnings);
                }
                track = placed.track;
                start = t.start;
                entry = { kind: 'adj', track: track, start: start, name: label };
            }
            created.push(entry);
            // Une erreur sur un effet ne fait pas perdre ce qui est deja pose (l'annulation le retrouve).
            for (j = 0; j < t.fx.length; j++) {
                try {
                    comp = addEffect(s, track, start, t.fx[j], warnings);
                    if (!comp) continue;
                    if (entry.added && !t.fx[j].intrinsic) entry.added.push(comp.matchName);
                    item = findItemAt(s, track, start);
                    n += setProps(s, item, comp, t.fx[j], t.start, f, warnings);
                    // Look ou conversion : la LUT .cube va dans la " LUT d'entree " de Lumetri.
                    if (t.fx[j].lut) {
                        var lutErr = setInputLut(comp, t.fx[j].lut);
                        if (lutErr) warnings.push(lutErr); else lutSet++;
                    }
                } catch (err) {
                    warnings.push(t.fx[j].names[0] + ' : ' + err.toString());
                }
            }
        }
        return ok({ created: created, props: n, lutSet: lutSet, warnings: warnings });
    }

    // Removes what RR FX added, and only that: an adjustment layer must still
    // carry its RR FX name, and a clip's effects are removed from the end only
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
        var s = useSeq(o.seq), removed = 0, skipped = 0, effects = 0, i, e, it, r;
        // Newest first: effects stacked on the same clip come off in reverse order.
        for (i = o.entries.length - 1; i >= 0; i--) {
            e = o.entries[i];
            if (e.kind === 'aud') {
                it = findAudioAt(s, e.track, e.start);
                if (it && it.name === e.name) { it.remove(false, false); removed++; } else skipped++;
                continue;
            }
            if (e.kind === 'atrim') {
                // J-cut / L-cut : le son revient a son debut et sa fin d'origine.
                if (undoTrim(s, e)) removed++; else skipped++;
                continue;
            }
            if (e.kind === 'roll') {
                // Coupe recalee : remise a sa place d'origine.
                if (rollAt(s, e.at, e.back)) removed++; else skipped++;
                continue;
            }
            if (e.kind === 'move') {
                // Rangement du projet : l'element revient dans son chutier d'origine.
                it = itemByNodeId(e.id);
                r = e.from === 'root' ? app.project.rootItem : itemByNodeId(e.from);
                if (it && r) { try { it.moveBin(r); removed++; } catch (e2) { skipped++; } } else skipped++;
                continue;
            }
            if (e.kind === 'rename') {
                // Renommage en serie : l'ancien nom revient.
                it = itemByNodeId(e.id);
                if (it) { try { it.name = e.old; removed++; } catch (e1) { skipped++; } } else skipped++;
                continue;
            }
            if (e.kind === 'mc') {
                removed += multicamEnable(s, e.tracks, e.a, e.b) ? 1 : 0;
                continue;
            }
            if (e.kind === 'level') {
                // Volume remis comme avant (musique baissee sous la voix, niveau de la voix).
                it = findAudioAt(s, e.track, e.start);
                r = it ? levelParam(it) : null;
                if (r) { if (r.isTimeVarying()) r.setTimeVarying(false); r.setValue(e.value, true); removed++; } else skipped++;
                continue;
            }
            it = e.kind === 'adj' ? findNamed(s, e.track, e.start, e.name) : findItemAt(s, e.track, e.start);
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
        if (!sel.length) return fail('S\u00e9lectionnez dans la timeline le clip ou calque de r\u00e9glage qui porte vos effets.');
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
                    // Une valeur illisible : le parametre entier est ignore plutot que mal rejoue.
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
        if (!sel.length) return fail('S\u00e9lectionnez un clip dans la timeline.');
        it = sel[0].item;
        lines.push('Clip : ' + it.name + '  (V' + (sel[0].track + 1) + ')');
        for (i = 0; i < it.components.numItems; i++) {
            c = it.components[i];
            lines.push('');
            lines.push('[' + i + '] ' + c.displayName + '   matchName: ' + c.matchName);
            for (j = 0; j < c.properties.numItems; j++) {
                p = c.properties[j];
                try { v = p.getValue(); v = (v && v.length !== undefined && typeof v !== 'string') ? '[' + v.join(', ') + ']' : String(v); } catch (e) { v = '?'; }
                if (v.length > 60) v = v.substr(0, 60) + '\u2026';
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
        if (!sel || !sel.length) return fail('S\u00e9lectionnez votre calque de r\u00e9glage dans le panneau Projet.');
        adjCache = sel[0];
        return ok({ name: sel[0].name, nodeId: sel[0].nodeId });
    }


    // ------------------------------------------------------------ outils communs (v1.3)

    function secs(ticks) { return ticks / TICKS; }

    function mediaPathOf(pi) {
        try { return String(pi.getMediaPath()); } catch (e) { return ''; }
    }

    function samePath(a, b) {
        return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
    }

    function namedBin(name) {
        var root = app.project.rootItem, i, c;
        for (i = 0; i < root.children.numItems; i++) {
            c = root.children[i];
            if (c.type === 2 && c.name === name) return c;
        }
        return root.createBin(name);
    }

    // Element du projet pour un fichier (importe si besoin). stills : sequence d'images
    // numerotees, dont `path` est la premiere image.
    function itemForPath(path, binName, stills) {
        var found = walk(app.project.rootItem, function (c) { return c.type === 1 && samePath(mediaPathOf(c), path); }), bin, before = {}, i;
        if (found) return found;
        bin = namedBin(binName);
        for (i = 0; i < bin.children.numItems; i++) before[bin.children[i].nodeId] = true;
        app.project.importFiles([path], true, bin, !!stills);
        found = walk(app.project.rootItem, function (c) { return c.type === 1 && samePath(mediaPathOf(c), path); });
        // Une sequence d'images ne garde pas toujours le chemin de sa premiere image : on prend
        // l'element que l'import vient d'ajouter au chutier.
        if (!found) {
            for (i = bin.children.numItems - 1; i >= 0 && !found; i--) {
                if (bin.children[i].type === 1 && !before[bin.children[i].nodeId]) found = bin.children[i];
            }
        }
        return found;
    }

    function audioClipsOf(s) {
        var out = [], i, j, tr;
        if (!s.audioTracks) return out;
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            tr = s.audioTracks[i];
            for (j = 0; j < tr.clips.numItems; j++) out.push({ item: tr.clips[j], track: i });
        }
        return out;
    }

    // Limites des clips selectionnes (hors calques), ou null.
    function selectionRange(s) {
        var sel = selectedVideo(s), lo = Infinity, hi = -Infinity, i;
        for (i = 0; i < sel.length; i++) {
            if (isLayer(sel[i].item)) continue;
            lo = Math.min(lo, tk(sel[i].item.start));
            hi = Math.max(hi, tk(sel[i].item.end));
        }
        return lo < hi ? { a: lo, b: hi } : null;
    }

    // ------------------------------------------------------------ public: marqueurs

    function markerList(o) {
        var s = activeSeq(), out = [], ms, m, guard = 0;
        try { ms = s.markers; m = ms ? ms.getFirstMarker() : null; } catch (e) { m = null; }
        while (m && guard++ < 10000) {
            out.push({ t: secs(tk(m.start)), name: String(m.name || '') });
            try { m = ms.getNextMarker(m); } catch (e2) { m = null; }
        }
        out.sort(function (x, y) { return x.t - y.t; });
        return ok({ markers: out, playhead: secs(tk(s.getPlayerPosition())), range: (function (r) { return r ? { a: secs(r.a), b: secs(r.b) } : null; })(selectionRange(s)) });
    }

    function removeMarkers(s, prefix, a, b) {
        var ms = s.markers, m, list = [], i, t, guard = 0;
        if (!ms) return 0;
        m = ms.getFirstMarker();
        while (m && guard++ < 10000) {
            t = tk(m.start);
            if (String(m.name || '').substr(0, prefix.length) === prefix && t >= a && t <= b) list.push(m);
            m = ms.getNextMarker(m);
        }
        for (i = 0; i < list.length; i++) ms.deleteMarker(list[i]);
        return list.length;
    }

    // Pose des marqueurs aux temps donnes (secondes de sequence), nommes " RR FX . ... ".
    function addMarkers(o) {
        var s = activeSeq(), f = tpf(s), ms = s.markers, i, t, m, n = 0, removed = 0, seen = {};
        if (!ms || !ms.createMarker) return fail('Cette version de Premiere ne permet pas de poser des marqueurs par script.');
        if (o.replace) removed = removeMarkers(s, 'RR FX', o.from != null ? o.from * TICKS - f : -Infinity, o.to != null ? o.to * TICKS + f : Infinity);
        for (i = 0; i < o.times.length; i++) {
            t = snap(o.times[i] * TICKS, f);
            if (seen[t]) continue;
            seen[t] = true;
            m = ms.createMarker(t / TICKS);
            try { m.name = o.name || 'RR FX \u00b7 temps fort'; } catch (e) {}
            try { if (m.setColorByIndex) m.setColorByIndex(o.color == null ? 3 : o.color); } catch (e2) {}
            n++;
        }
        return ok({ added: n, removed: removed });
    }

    // ------------------------------------------------------------ public: tout effacer

    function clearAll(o) {
        var s = activeSeq(), range = o.scope === 'selection' ? selectionRange(s) : null, removed = 0, markers = 0, i, j, list, it;
        if (o.scope === 'selection' && !range) return fail('S\u00e9lectionne les clips de la zone \u00e0 nettoyer.');
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!/^RR FX \u00b7 /.test(it.name)) continue;
                if (range && !(tk(it.start) < range.b && range.a < tk(it.end))) continue;
                it.remove(false, false);
                removed++;
            }
        }
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            list = [];
            for (j = 0; j < s.audioTracks[i].clips.numItems; j++) list.push(s.audioTracks[i].clips[j]);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!/^RR FX \u00b7 /.test(it.name)) continue;
                if (range && !(tk(it.start) < range.b && range.a < tk(it.end))) continue;
                it.remove(false, false);
                removed++;
            }
        }
        if (o.markers) markers = removeMarkers(s, 'RR FX', range ? range.a : -Infinity, range ? range.b : Infinity);
        // Montage multicam : les plans desactives par RR FX sont reactives.
        if (o.multicam) removed += multicamEnable(s, null, range ? range.a : -Infinity, range ? range.b : Infinity);
        return ok({ removed: removed, markers: markers });
    }

    // ------------------------------------------------------------ public: musique, rushs

    // La musique : le clip son selectionne, sinon le plus long clip son de la sequence.
    function musicInfo(o) {
        var s = activeSeq(), f = tpf(s), sel = s.getSelection(), vids = selectedVideo(s), best = null, list, i, it, d, bd = -1, tr = 0, sp = 1;
        // Le son lie a un clip video selectionne (son de la camera) n'est pas la musique.
        function linkedToSelection(a) {
            for (var k = 0; k < vids.length; k++) {
                if (Math.abs(tk(vids[k].item.start) - tk(a.start)) < f / 2 && Math.abs(tk(vids[k].item.end) - tk(a.end)) < f / 2) return true;
            }
            return false;
        }
        // o.notSelected : la selection, c'est la voix (musique sous la voix) : jamais la musique.
        var picked = {};
        if (sel) for (i = 0; i < sel.length; i++) picked[sel[i].nodeId] = true;
        if (sel && !(o && o.notSelected)) for (i = 0; i < sel.length; i++) if (sel[i].mediaType === 'Audio' && !linkedToSelection(sel[i])) { best = sel[i]; break; }
        // Sinon : le plus long son qui n'accompagne aucune image (la musique n'a pas de video).
        function withVideo(a) {
            for (var t = 0; t < s.videoTracks.numTracks; t++) {
                var v = clipsOf(s, t);
                for (var k = 0; k < v.length; k++) {
                    if (Math.abs(tk(v[k].start) - tk(a.start)) < f / 2 && Math.abs(tk(v[k].end) - tk(a.end)) < f / 2) return true;
                }
            }
            return false;
        }
        list = audioClipsOf(s);
        for (var pass = 0; pass < 2 && !best && !it; pass++) {
            for (i = 0; i < list.length; i++) {
                // Le son pose par RR FX (camera de reference) n'est jamais la musique.
                if (/^RR FX \u00b7 /.test(list[i].item.name) || linkedToSelection(list[i].item) || (o && o.notSelected && picked[list[i].item.nodeId]) || (pass === 0 && withVideo(list[i].item))) continue;
                d = tk(list[i].item.end) - tk(list[i].item.start);
                if (d > bd) { bd = d; it = list[i].item; tr = list[i].track; }
            }
        }
        if (best) for (i = 0; i < list.length; i++) if (list[i].item.nodeId === best.nodeId) tr = list[i].track;
        best = best || it;
        if (!best) return fail('Aucun son dans la s\u00e9quence : pose ta musique sur une piste audio.');
        try { sp = best.getSpeed(); } catch (e) {}
        return ok({
            name: best.name, path: best.projectItem ? mediaPathOf(best.projectItem) : '', track: tr,
            start: secs(tk(best.start)), end: secs(tk(best.end)), inPoint: secs(tk(best.inPoint)), speed: sp || 1
        });
    }

    // Rushs selectionnes dans le panneau Projet, avec leur plage utile (points d'entree/sortie).
    function projectRushes(o) {
        var sel = app.getCurrentProjectViewSelection ? app.getCurrentProjectViewSelection() : null, out = [], i, pi, a, b, isSeq;
        if (!sel || !sel.length) return fail('S\u00e9lectionne des rushs dans le panneau Projet.');
        for (i = 0; i < sel.length; i++) {
            pi = sel[i];
            isSeq = false;
            try { isSeq = !!(pi.isSequence && pi.isSequence()); } catch (e) {}
            if (pi.type !== 1 || isSeq || isAdjustment(pi)) continue;
            a = 0; b = 0;
            try { a = tk(pi.getInPoint(1)); b = tk(pi.getOutPoint(1)); } catch (e2) {}
            if (!(b > a)) b = mediaEndOf(pi);
            out.push({ nodeId: pi.nodeId, name: pi.name, path: mediaPathOf(pi), inT: secs(a), outT: secs(b) });
        }
        if (!out.length) return fail('Aucun rush vid\u00e9o dans la s\u00e9lection du panneau Projet.');
        return ok({ rushes: out });
    }

    // Pose des extraits de rushs (video seule) : items [{ nodeId, seqStart, seqEnd, srcIn }] en secondes.
    // Son d'un rush sur une piste audio libre (synchro multicam : son de la camera de reference).
    function placeRushAudio(s, master, a, b, inT, label, created, warnings) {
        var src, ai, tr, it;
        try {
            src = audioSourceOf(master);
            ai = pickAudioTrack(s, a, b, warnings);
            tr = s.audioTracks[ai];
            try { src.setInPoint(inT / TICKS, 4); src.setOutPoint((inT + b - a) / TICKS, 4); } catch (e) {}
            tr.overwriteClip(src, mkTime(a));
            try { src.clearInPoint(); src.clearOutPoint(); } catch (e2) {}
            it = findAudioAt(s, ai, a);
            if (!it) throw new Error('son non pos\u00e9');
            fixSpan(it, a, b);
            try { it.name = label; } catch (e3) {}
            created.push({ kind: 'aud', track: ai, start: a, name: label });
        } catch (err) {
            warnings.push(master.name + ' : son de r\u00e9f\u00e9rence non pos\u00e9 (' + err.toString() + ')');
        }
    }

    function placeRushes(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], i, x, pi, sub, a, b, lo = Infinity, hi = -Infinity, ti, it, label = o.label || 'RR FX \u00b7 Montage', cache = {};
        for (i = 0; i < o.items.length; i++) {
            lo = Math.min(lo, snap(o.items[i].seqStart * TICKS, f));
            hi = Math.max(hi, snap(o.items[i].seqEnd * TICKS, f));
        }
        if (!(hi > lo)) return fail('Rien \u00e0 poser.');
        ti = o.track != null && o.track < s.videoTracks.numTracks && trackClear(s, o.track, lo, hi) ? o.track : pickTrack(s, o.minTrack || 0, lo, hi, warnings);
        for (i = 0; i < o.items.length; i++) {
            x = o.items[i];
            try {
                pi = null;
                if (!cache[x.nodeId]) {
                    pi = walk(app.project.rootItem, function (c) { return c.nodeId === x.nodeId; });
                    if (!pi) throw new Error('rush introuvable dans le projet');
                    cache[x.nodeId] = videoSourceOf(pi);
                }
                sub = cache[x.nodeId];
                a = snap(x.seqStart * TICKS, f);
                b = snap(x.seqEnd * TICKS, f);
                if (b <= a) continue;
                it = placeOn(s, ti, sub, a, x.srcIn * TICKS, x.srcIn * TICKS + (b - a));
                fixSpan(it, a, b);
                try { it.name = label; } catch (e) {}
                created.push({ kind: 'adj', track: ti, start: a, name: label });
                if (x.audio) placeRushAudio(s, pi || walk(app.project.rootItem, function (c) { return c.nodeId === x.nodeId; }), a, b, x.srcIn * TICKS, label, created, warnings);
            } catch (err) {
                warnings.push((x.name || 'Rush') + ' : ' + err.toString());
            }
        }
        return ok({ created: created, track: ti, warnings: warnings });
    }

    // ------------------------------------------------------------ public: decoupe sur le rythme

    function cutAtTimes(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), qs = qeSeq(), cuts = 0, i, j, k, c, a, b, t, audio = audioClipsOf(s), plan = [];
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c)) continue;
            a = tk(c.start); b = tk(c.end);
            var tracks = [], times = [];
            for (k = 0; k < audio.length; k++) {
                if (Math.abs(tk(audio[k].item.start) - a) < f / 2 && Math.abs(tk(audio[k].item.end) - b) < f / 2) tracks.push(audio[k].track);
            }
            for (j = 0; j < o.times.length; j++) {
                t = snap(o.times[j] * TICKS, f);
                if (t > a + f / 2 && t < b - f / 2) times.push(t);
            }
            plan.push({ track: sel[i].track, audio: tracks, times: times });
        }
        if (!plan.length) return fail('S\u00e9lectionne dans la timeline les clips \u00e0 d\u00e9couper.');
        for (i = 0; i < plan.length; i++) {
            for (j = 0; j < plan[i].times.length; j++) {
                t = timecodeOf(s, plan[i].times[j]);
                qs.getVideoTrackAt(plan[i].track).razor(t);
                for (k = 0; k < plan[i].audio.length; k++) qs.getAudioTrackAt(plan[i].audio[k]).razor(t);
                cuts++;
            }
        }
        return ok({ cuts: cuts, clips: plan.length });
    }

    // ------------------------------------------------------------ public: synchronisation

    function syncInfo(o) {
        var s = activeSeq(), sel = selectedVideo(s), clips = [], i, c, sp, m = parse(musicInfo({})), r;
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c) || !c.projectItem) continue;
            sp = 1;
            try { sp = c.getSpeed(); } catch (e) {}
            clips.push({
                track: sel[i].track, name: c.name, path: mediaPathOf(c.projectItem),
                start: secs(tk(c.start)), end: secs(tk(c.end)), inPoint: secs(tk(c.inPoint)), outPoint: secs(tk(c.outPoint)), speed: sp || 1
            });
        }
        r = clips.length ? null : parse(projectRushes({}));
        return ok({ music: m.ok ? m : null, musicError: m.ok ? '' : m.error, clips: clips, rushes: r && r.ok ? r.rushes : [] });
    }

    function trackClearExcept(s, ti, a, b, self) {
        var list = clipsOf(s, ti), i;
        for (i = 0; i < list.length; i++) {
            if (list[i].nodeId === self.nodeId) continue;
            if (tk(list[i].start) < b && a < tk(list[i].end)) return false;
        }
        return true;
    }

    // Decale un element ; verifie le resultat (la facon d'appeler move() varie selon les versions).
    function shift(it, delta) {
        var before = tk(it.start), target = before + delta;
        try { it.move(mkTime(delta)); } catch (e) {}
        if (Math.abs(tk(it.start) - target) <= 1) return true;
        if (Math.abs(tk(it.start) - before) <= 1) {
            try { it.move(delta / TICKS); } catch (e2) {}
            if (Math.abs(tk(it.start) - target) <= 1) return true;
        }
        return false;
    }

    // moves : [{ track, start (s), name, delta (s) }] - clips de la timeline, avec leur son lie.
    function moveClips(o) {
        var s = activeSeq(), f = tpf(s), moved = 0, warnings = [], i, k, mv, it, a, b, d, audio, linked;
        for (i = 0; i < o.moves.length; i++) {
            mv = o.moves[i];
            it = findClip(s, mv.track, snap(mv.start * TICKS, f), mv.name);
            if (!it) { warnings.push(mv.name + ' : introuvable'); continue; }
            d = snap(mv.delta * TICKS, f);
            if (!d) { moved++; continue; }
            a = tk(it.start); b = tk(it.end);
            if (a + d < 0) { warnings.push(mv.name + ' : il faudrait le placer avant le d\u00e9but de la s\u00e9quence'); continue; }
            if (!trackClearExcept(s, mv.track, a + d, b + d, it)) { warnings.push(mv.name + ' : la place est occup\u00e9e sur V' + (mv.track + 1)); continue; }
            audio = audioClipsOf(s);
            linked = [];
            for (k = 0; k < audio.length; k++) {
                if (Math.abs(tk(audio[k].item.start) - a) < f / 2 && Math.abs(tk(audio[k].item.end) - b) < f / 2) linked.push(audio[k].item);
            }
            if (!shift(it, d)) { warnings.push(mv.name + ' : Premiere a refus\u00e9 le d\u00e9placement'); continue; }
            for (k = 0; k < linked.length; k++) {
                if (Math.abs(tk(linked[k].start) - (a + d)) > 1 && !shift(linked[k], d)) warnings.push(mv.name + ' : son li\u00e9 non d\u00e9plac\u00e9');
            }
            moved++;
        }
        return ok({ moved: moved, warnings: warnings });
    }

    // ------------------------------------------------------------ public: montage multicam
    // Les cameras synchronisees sont empilees (une piste par camera). A chaque temps,
    // une seule reste active : les autres plans sont desactives (rien n'est supprime).

    function setDisabled(it, v) {
        try { it.disabled = v; } catch (e) { return false; }
        return it.disabled === v;
    }

    // Reactive les plans desactives par RR FX (nom d'origine suivi de " . RR FX off ").
    function multicamEnable(s, tracks, a, b) {
        var n = 0, i, j, list, it, tag = ' \u00b7 RR FX off';
        for (i = 0; i < s.videoTracks.numTracks; i++) {
            if (tracks && !inList(tracks, i)) continue;
            list = clipsOf(s, i);
            for (j = 0; j < list.length; j++) {
                it = list[j];
                if (!(tk(it.start) < b && a < tk(it.end))) continue;
                if (String(it.name).substr(String(it.name).length - tag.length) !== tag) continue;
                setDisabled(it, false);
                try { it.name = String(it.name).substr(0, String(it.name).length - tag.length); } catch (e) {}
                n++;
            }
        }
        return n;
    }

    function inList(list, v) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i] === v) return true;
        return false;
    }

    // Plans d'une piste (hors calques RR FX) avec leurs bornes, lues une fois.
    function spans(s, ti) {
        var list = clipsOf(s, ti), out = [], i;
        for (i = 0; i < list.length; i++) if (!isLayer(list[i])) out.push({ it: list[i], a: tk(list[i].start), b: tk(list[i].end) });
        return out;
    }

    function covers(list, t) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i].a <= t && t < list[i].b) return true;
        return false;
    }

    // Un plan coupe en t (t strictement a l'interieur, pas deja sur une coupe).
    function inside(list, t, f) {
        var i;
        for (i = 0; i < list.length; i++) if (list[i].a < t - f / 2 && t + f / 2 < list[i].b) return true;
        return false;
    }

    function multicamSwitch(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), qs, cams = [], lo = Infinity, hi = -Infinity, i, j, k, c, t, bounds, lists = [], probe;
        var seg = [], pick, prev = -1, seed = (o.seed || 1) % 2147483647, mid, cover, switches = 0, tag = ' \u00b7 RR FX off', a, b, offN = 0, p, x;
        for (i = 0; i < sel.length; i++) {
            c = sel[i].item;
            if (isLayer(c)) continue;
            if (!inList(cams, sel[i].track)) cams.push(sel[i].track);
            lo = Math.min(lo, tk(c.start)); hi = Math.max(hi, tk(c.end));
        }
        cams.sort(function (x1, y1) { return x1 - y1; });
        if (cams.length < 2) return fail('S\u00e9lectionne les plans de deux cam\u00e9ras ou plus, synchronis\u00e9es et empil\u00e9es (une piste par cam\u00e9ra).');
        bounds = [lo];
        for (j = 0; j < o.times.length; j++) {
            t = snap(o.times[j] * TICKS, f);
            if (t > bounds[bounds.length - 1] + f / 2 && t < hi - f / 2) bounds.push(t);
        }
        bounds.push(hi);
        if (bounds.length < 3) return fail('Aucun temps dans la zone s\u00e9lectionn\u00e9e.');
        // Avant de couper quoi que ce soit : ce Premiere sait-il desactiver un plan par script ?
        probe = sel[0].item;
        if (!setDisabled(probe, !probe.disabled)) return fail('Cette version de Premiere ne permet pas de d\u00e9sactiver un plan par script.');
        setDisabled(probe, !probe.disabled);
        multicamEnable(s, cams, lo, hi);
        // Coupe chaque camera a chaque temps (le son n'est pas touche).
        qs = qeSeq();
        for (k = 0; k < cams.length; k++) {
            x = spans(s, cams[k]);
            for (j = 1; j < bounds.length - 1; j++) {
                if (inside(x, bounds[j], f)) qs.getVideoTrackAt(cams[k]).razor(timecodeOf(s, bounds[j]));
            }
        }
        for (k = 0; k < cams.length; k++) lists.push({ track: cams[k], items: spans(s, cams[k]), next: 0 });
        for (j = 0; j < bounds.length - 1; j++) {
            a = bounds[j]; b = bounds[j + 1]; mid = (a + b) / 2;
            cover = [];
            for (k = 0; k < lists.length; k++) if (covers(lists[k].items, mid)) cover.push(cams[k]);
            if (!cover.length) { seg.push(-1); continue; }
            if (o.order === 'random') {
                seed = (seed * 48271) % 2147483647;
                pick = cover[seed % cover.length];
                if (pick === prev && cover.length > 1) pick = cover[(seed + 1) % cover.length];
            } else {
                pick = cams[j % cams.length];
                if (!inList(cover, pick)) pick = cover[j % cover.length];
            }
            if (pick !== prev) switches++;
            prev = pick;
            seg.push(pick);
            // Les listes sont triees : chaque piste avance son curseur au lieu de tout relire.
            for (k = 0; k < lists.length; k++) {
                p = lists[k];
                while (p.next < p.items.length && p.items[p.next].b <= a + f / 2) p.next++;
                if (p.track === pick) continue;
                for (i = p.next; i < p.items.length && p.items[i].a < b - f / 2; i++) {
                    x = p.items[i];
                    if (x.a >= a - f / 2 && x.b <= b + f / 2) {
                        setDisabled(x.it, true);
                        try { x.it.name = x.it.name + tag; } catch (e) {}
                        offN++;
                    }
                }
            }
        }
        return ok({ segments: bounds.length - 1, switches: switches, cams: cams.length, disabled: offN, plan: seg, entry: { kind: 'mc', tracks: cams, a: lo, b: hi } });
    }

    // ------------------------------------------------------------ public: apercu sur la vraie image

    function grabFrames(o) {
        var s = activeSeq(), f = tpf(s), ph = snap(tk(s.getPlayerPosition()), f), ref = refClip(s), track = ref ? ref.track : 0, cut = nearestEdit(s, track, ph), q = qeSeq(), files = [], times, i;
        if (cut === null) cut = ph;
        if (!q || !q.exportFramePNG) return fail('Cette version de Premiere ne permet pas d\'exporter une image par script.');
        times = [Math.max(0, cut - f), cut];
        for (i = 0; i < times.length; i++) {
            files.push(o.folder + '/' + o.prefix + i);
            q.exportFramePNG(timecodeOf(s, times[i]), files[i]);
        }
        return ok({ files: files, cut: secs(cut) });
    }

    // ------------------------------------------------------------ public: textes (MOGRT)

    function setMgtText(item, text) {
        var comp = null, i, p, v, obj;
        try { comp = item.getMGTComponent(); } catch (e) {}
        if (!comp) return false;
        for (i = 0; i < comp.properties.numItems; i++) {
            p = comp.properties[i];
            try { v = p.getValue(); } catch (e2) { continue; }
            if (typeof v !== 'string') continue;
            obj = null;
            if (/^\s*\{/.test(v)) { try { obj = eval('(' + v + ')'); } catch (e3) { obj = null; } }
            if (obj && obj.textEditValue !== undefined) {
                obj.textEditValue = text;
                p.setValue(str(obj), true);
                return true;
            }
            if (!obj && /source|text|texte|titre|title|lyric|parole/i.test(p.displayName)) {
                p.setValue(text, true);
                return true;
            }
        }
        return false;
    }

    // Couleur d'un reglage (rouge, vert, bleu 0 a 255) ; faux si ce n'est pas un reglage de couleur.
    function isColorParam(p) {
        try { var c = p.getColorValue(); return !!(c && c.length >= 3); } catch (e) { return false; }
    }
    function setColorHex(p, hex) {
        if (!hex || !isColorParam(p)) return false;
        try { p.setColorValue(255, parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16), true); return true; } catch (e) { return false; }
    }

    // Style de texte (o.style) : police, taille et majuscules dans le texte du modele ; couleurs,
    // contour, ombre et fond par les reglages que le modele expose (Objets graphiques essentiels).
    // Sinon : Teinte pour la couleur du texte, Ombre portee pour l'ombre (fx.fill, fx.shadow).
    function applyTextStyle(s, ti, a, st, fx, warnings) {
        var item = findItemAt(s, ti, a), comp = null, i, j, p, v, obj, nm, missing = [], c;
        var done = { fill: false, stroke: false, shadow: false, box: false };
        try { comp = item.getMGTComponent(); } catch (e0) {}
        for (i = 0; comp && i < comp.properties.numItems; i++) {
            p = comp.properties[i];
            nm = String(p.displayName || '');
            try { v = p.getValue(); } catch (e1) { v = null; }
            if (typeof v === 'string' && /^\s*\{/.test(v)) {
                obj = null;
                try { obj = eval('(' + v + ')'); } catch (e2) { obj = null; }
                if (obj && obj.textEditValue !== undefined) {
                    if (st.font && obj.fontEditValue !== undefined) obj.fontEditValue = [st.font];
                    if (st.size && obj.fontSizeEditValue !== undefined) obj.fontSizeEditValue = [st.size];
                    if (obj.fontFSAllCapsValue !== undefined) obj.fontFSAllCapsValue = [!!st.caps];
                    try { p.setValue(str(obj), true); } catch (e3) {}
                }
                continue;
            }
            if (/stroke|contour|kontur|trazo|traccia/i.test(nm)) {
                if (typeof v === 'number' && /width|paisseur|largeur|breite|ancho|spessore/i.test(nm)) { if (st.strokeWidth) { try { p.setValue(st.strokeWidth, true); } catch (e4) {} } } else if (typeof v === 'boolean') { try { p.setValue(!!st.stroke, true); } catch (e5) {} } else if (setColorHex(p, st.stroke)) done.stroke = true;
            } else if (/shadow|ombre|schatten|sombra|ombra/i.test(nm)) {
                if (typeof v === 'boolean') { try { p.setValue(!!st.shadow, true); done.shadow = true; } catch (e6) {} }
            } else if (/background|fond|hintergrund|box|fondo|sfondo/i.test(nm)) {
                if (typeof v === 'boolean') { try { p.setValue(!!st.box, true); } catch (e7) {} } else if (setColorHex(p, st.box)) done.box = true;
            } else if (/fill|remplissage|f.llung|relleno|riempimento|colou?r|couleur|farbe/i.test(nm)) {
                if (!done.fill && setColorHex(p, st.fill)) done.fill = true;
            }
        }
        // Replis par effets, sur le clip graphique.
        for (j = 0; j < 2; j++) {
            c = j ? (!done.shadow && st.shadow ? fx.shadow : null) : (!done.fill && st.fill && st.fill !== '#ffffff' ? fx.fill : null);
            if (!c) continue;
            try {
                comp = addEffect(s, ti, a, c, warnings);
                if (comp) { setProps(s, findItemAt(s, ti, a), comp, c, a, tpf(s), warnings); if (j) done.shadow = true; else done.fill = true; }
            } catch (e8) {}
        }
        if (st.stroke && !done.stroke) missing.push('contour');
        if (st.box && !done.box) missing.push('fond');
        if (missing.length) warnings.push('Ce mod\u00e8le de texte ne propose pas : ' + missing.join(', ') + ' (ajoute-le dans ton .mogrt et expose-le dans Objets graphiques essentiels)');
        return done;
    }

    // Un texte : modele .mogrt pose de start a end (s), texte remplace, animation (fx) ajoutee.
    function placeTitle(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], a = snap(o.start * TICKS, f), b = snap(o.end * TICKS, f), ti = o.track, it, j, comp, label = 'RR FX \u00b7 Texte', textSet;
        if (!s.importMGT) return fail('Cette version de Premiere ne permet pas d\'importer un mod\u00e8le de texte par script.');
        if (!(b > a)) return fail('Dur\u00e9e nulle');
        if (ti === null || ti === undefined) {
            // Le modele arrive avec sa propre duree : la piste doit etre libre bien au-dela.
            ti = pickTrack(s, o.minTrack || 0, a, Math.max(b, o.spanEnd ? o.spanEnd * TICKS : b) + 60 * TICKS, warnings);
        }
        it = s.importMGT(o.mogrt, String(a), ti, 0);
        if (!it || !it.start) it = findItemAt(s, ti, a);
        if (!it) return fail('Premiere n\'a pas pos\u00e9 le mod\u00e8le de texte (fichier .mogrt valide ?)');
        if (Math.abs(tk(it.end) - b) > 1) it.end = mkTime(b);
        try { it.name = label; } catch (e) {}
        textSet = setMgtText(findItemAt(s, ti, a), o.text);
        if (!textSet) warnings.push('Texte non remplac\u00e9 : ce mod\u00e8le n\'a pas de champ texte modifiable');
        if (o.style) { try { applyTextStyle(s, ti, a, o.style, o.styleFx || {}, warnings); } catch (e5) { warnings.push('Style du texte : ' + e5.toString()); } }
        // o.pos [x, y] (0 a 1) : position du texte dans l'image (bandeau en bas a gauche...).
        if (o.pos) {
            try { comp = componentByMatch(findItemAt(s, ti, a), 'AE.ADBE Motion'); comp.properties[0].setValue(o.pos, true); } catch (e4) { warnings.push('Position du texte non r\u00e9gl\u00e9e'); }
        }
        for (j = 0; j < (o.fx || []).length; j++) {
            try {
                comp = addEffect(s, ti, a, o.fx[j], warnings);
                if (comp) setProps(s, findItemAt(s, ti, a), comp, o.fx[j], a, f, warnings);
            } catch (err) {
                warnings.push(o.fx[j].names[0] + ' : ' + err.toString());
            }
        }
        return ok({ created: [{ kind: 'adj', track: ti, start: a, name: label }], track: ti, warnings: warnings });
    }

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

    // ------------------------------------------------------------ 2.6 : raccords, coupes, export, archive

    // Debut / fin d'un element deplace de delta ticks (le point d'entree / de sortie suit).
    function trimStart(it, delta) {
        var s0 = tk(it.start), in0 = tk(it.inPoint), sp = 1;
        try { sp = it.getSpeed() || 1; } catch (e) {}
        it.start = mkTime(s0 + delta);
        if (Math.abs(tk(it.inPoint) - in0) < 1 && Math.abs(delta) >= 1) { try { it.inPoint = mkTime(in0 + delta * sp); } catch (e2) {} }
        return Math.abs(tk(it.start) - (s0 + delta)) <= 1;
    }
    function trimEnd(it, delta) {
        var e0 = tk(it.end), out0 = tk(it.outPoint), sp = 1;
        try { sp = it.getSpeed() || 1; } catch (e) {}
        it.end = mkTime(e0 + delta);
        if (Math.abs(tk(it.outPoint) - out0) < 1 && Math.abs(delta) >= 1) { try { it.outPoint = mkTime(out0 + delta * sp); } catch (e2) {} }
        return Math.abs(tk(it.end) - (e0 + delta)) <= 1;
    }
    // Images disponibles avant le point d'entree / apres le point de sortie (poignees).
    function headRoom(it) { return Math.max(0, tk(it.inPoint)); }
    function tailRoom(it) {
        var end = it.projectItem ? mediaEndOf(it.projectItem) : null;
        return end === null ? 0 : Math.max(0, end - tk(it.outPoint));
    }

    function audioAtStart(s, ticks, f) {
        var i, j, l;
        for (i = 0; i < s.audioTracks.numTracks; i++) {
            l = audioItems(s, i);
            for (j = 0; j < l.length; j++) if (Math.abs(tk(l[j].start) - ticks) < f / 2) return { it: l[j], track: i };
        }
        return null;
    }
    function audioAtEnd(s, ticks, track, f) {
        var l = audioItems(s, track), j;
        for (j = 0; j < l.length; j++) if (Math.abs(tk(l[j].end) - ticks) < f / 2) return l[j];
        return null;
    }

    // Coupes entre deux plans selectionnes qui se suivent sur la meme piste video.
    function selectedCuts(s) {
        var sel = selectedVideo(s), f = tpf(s), byTrack = {}, out = [], i, k, l;
        for (i = 0; i < sel.length; i++) {
            if (isLayer(sel[i].item)) continue;
            (byTrack[sel[i].track] = byTrack[sel[i].track] || []).push(sel[i].item);
        }
        for (k in byTrack) {
            if (!byTrack.hasOwnProperty(k)) continue;
            l = byTrack[k];
            l.sort(function (a, b) { return tk(a.start) - tk(b.start); });
            for (i = 1; i < l.length; i++) if (Math.abs(tk(l[i].start) - tk(l[i - 1].end)) < f / 2) out.push({ track: Number(k), a: l[i - 1], b: l[i], t: tk(l[i].start) });
        }
        out.sort(function (p, q) { return p.t - q.t; });
        return out;
    }

    // J-cut (le son du plan suivant arrive avant son image) ou L-cut (le son du plan precedent
    // continue sur le suivant), de o.frames images, sur chaque coupe de la selection.
    function splitEdits(o) {
        var s = activeSeq(), f = tpf(s), cuts = selectedCuts(s), want = Math.max(1, Math.round(o.frames || 12)) * f, created = [], done = 0, passed = 0, i, c, nA, pA, d;
        if (!cuts.length) return fail('S\u00e9lectionne au moins deux plans qui se suivent dans la timeline (avec leur son).');
        for (i = 0; i < cuts.length; i++) {
            c = cuts[i];
            nA = audioAtStart(s, c.t, f);
            pA = nA ? audioAtEnd(s, c.t, nA.track, f) : null;
            if (!nA || !pA) { passed++; continue; }
            if (o.mode === 'l') {
                d = Math.min(want, tailRoom(pA), tk(nA.it.end) - tk(nA.it.start) - f);
                d = Math.floor(d / f) * f;
                if (d < f) { passed++; continue; }
                created.push({ kind: 'atrim', track: nA.track, start: c.t + d, s0: c.t, e0: tk(nA.it.end), name: nA.it.name });
                trimStart(nA.it, d);
                created.push({ kind: 'atrim', track: nA.track, start: tk(pA.start), s0: tk(pA.start), e0: c.t, name: pA.name });
                trimEnd(pA, d);
            } else {
                d = Math.min(want, headRoom(nA.it), tk(pA.end) - tk(pA.start) - f);
                d = Math.floor(d / f) * f;
                if (d < f) { passed++; continue; }
                created.push({ kind: 'atrim', track: nA.track, start: tk(pA.start), s0: tk(pA.start), e0: c.t, name: pA.name });
                trimEnd(pA, -d);
                created.push({ kind: 'atrim', track: nA.track, start: c.t - d, s0: c.t, e0: tk(nA.it.end), name: nA.it.name });
                trimStart(nA.it, -d);
            }
            done++;
        }
        return ok({ cuts: cuts.length, done: done, passed: passed, created: created });
    }

    // Annuler un raccord : debut et fin d'origine.
    function undoTrim(s, e) {
        var it = findAudioAt(s, e.track, e.start);
        if (!it) return false;
        var ds = e.s0 - tk(it.start), de = e.e0 - tk(it.end);
        if (ds) trimStart(it, ds);
        if (de) trimEnd(it, de);
        return true;
    }

    // Coupes de la selection, avec ce qu'il faut pour ecouter les deux cotes.
    function cutList(o) {
        var s = activeSeq(), f = tpf(s), cuts = selectedCuts(s), out = [], i, c, sp1 = 1, sp2 = 1;
        if (!cuts.length) return fail('S\u00e9lectionne au moins deux plans qui se suivent dans la timeline.');
        for (i = 0; i < cuts.length; i++) {
            c = cuts[i];
            try { sp1 = c.a.getSpeed() || 1; sp2 = c.b.getSpeed() || 1; } catch (e) {}
            out.push({
                t: secs(c.t), track: c.track,
                a: { path: c.a.projectItem ? mediaPathOf(c.a.projectItem) : '', out: secs(tk(c.a.outPoint)), speed: sp1, room: secs(tailRoom(c.a)), len: secs(tk(c.a.end) - tk(c.a.start)) },
                b: { path: c.b.projectItem ? mediaPathOf(c.b.projectItem) : '', inP: secs(tk(c.b.inPoint)), speed: sp2, room: secs(headRoom(c.b)), len: secs(tk(c.b.end) - tk(c.b.start)) }
            });
        }
        return ok({ cuts: out, fps: TICKS / f });
    }

    // Deplace une coupe (montage par roulement) : le plan d'avant finit et celui d'apres commence
    // a o.to, sur toutes les pistes coupees au meme endroit (image et son lie).
    function rollAt(s, at, to) {
        var f = tpf(s), d = to - at, moved = 0, i, j, l, A, B, pairs = [];
        function scan(get, n) {
            for (i = 0; i < n; i++) {
                l = get(i);
                A = null; B = null;
                for (j = 0; j < l.length; j++) {
                    if (Math.abs(tk(l[j].end) - at) < f / 2) A = l[j];
                    if (Math.abs(tk(l[j].start) - at) < f / 2) B = l[j];
                }
                if (A && B) pairs.push([A, B]);
            }
        }
        scan(function (k) { return clipsOf(s, k); }, s.videoTracks.numTracks);
        scan(function (k) { return audioItems(s, k); }, s.audioTracks.numTracks);
        for (i = 0; i < pairs.length; i++) {
            A = pairs[i][0]; B = pairs[i][1];
            if (d > 0 && (tailRoom(A) < d || tk(B.end) - tk(B.start) <= d)) continue;
            if (d < 0 && (headRoom(B) < -d || tk(A.end) - tk(A.start) <= -d)) continue;
            // Dans l'ordre qui ne fait jamais chevaucher les deux plans.
            if (d > 0) { trimStart(B, d); trimEnd(A, d); } else { trimEnd(A, d); trimStart(B, d); }
            moved++;
        }
        return moved;
    }
    function rollEdits(o) {
        var s = activeSeq(), f = tpf(s), created = [], done = 0, i, m, at, to;
        for (i = 0; i < (o.moves || []).length; i++) {
            m = o.moves[i];
            at = snap(m.t * TICKS, f); to = snap(m.to * TICKS, f);
            if (Math.abs(to - at) < f) continue;
            if (rollAt(s, at, to)) { done++; created.push({ kind: 'roll', at: to, back: at, name: 'Coupe' }); }
        }
        return ok({ moved: done, created: created });
    }

    // Musiques et sons de la sequence, regroupes par fichier (credits, droits).
    function audioCredits(o) {
        var s = activeSeq(), list = audioClipsOf(s), by = {}, out = [], i, it, p, k, e;
        for (i = 0; i < list.length; i++) {
            it = list[i].item;
            p = it.projectItem ? mediaPathOf(it.projectItem) : '';
            k = p || it.name;
            e = by[k];
            if (!e) { e = by[k] = { name: it.projectItem ? it.projectItem.name : it.name, path: p, uses: 0, seconds: 0, first: Infinity, tracks: {} }; out.push(e); }
            e.uses++;
            e.seconds += secs(tk(it.end) - tk(it.start));
            e.first = Math.min(e.first, secs(tk(it.start)));
            e.tracks['A' + (list[i].track + 1)] = true;
        }
        for (i = 0; i < out.length; i++) {
            var t = [], q;
            for (q in out[i].tracks) if (out[i].tracks.hasOwnProperty(q)) t.push(q);
            out[i].tracks = t.join(' ');
        }
        out.sort(function (a, b) { return a.first - b.first; });
        return ok({ items: out, sequence: s.name });
    }

    // Preglages d'export (Media Encoder) fournis avec Premiere.
    function exportPresets(o) {
        var out = [], base = String(app.path || ''), roots = [base + '/MediaIO/systempresets', base + '/Contents/MediaIO/systempresets'], i;
        function walk(d, depth) {
            var files, j;
            try { files = d.getFiles(); } catch (e) { return; }
            for (j = 0; j < files.length && out.length < 300; j++) {
                if (files[j] instanceof Folder) { if (depth < 3) walk(files[j], depth + 1); }
                else if (/\.epr$/i.test(files[j].name)) out.push({ path: files[j].fsName, name: decodeURI(files[j].name).replace(/\.epr$/i, '') });
            }
        }
        for (i = 0; i < roots.length; i++) {
            try { var d = new Folder(roots[i]); if (d.exists) walk(d, 0); } catch (e) {}
        }
        return ok({ presets: out });
    }

    // Sequences cochees envoyees a Media Encoder, un fichier chacune (o.items : [{ id, file }]).
    function exportQueue(o) {
        var E = app.encoder, queued = [], failed = [], i, s, it, ext, job, dir;
        if (!E || !E.encodeSequence) return fail('Media Encoder est introuvable : installe-le avec ton abonnement Creative Cloud.');
        if (!o.preset) return fail('Choisis un pr\u00e9r\u00e9glage d\'export.');
        dir = new Folder(o.dir);
        if (!dir.exists) dir.create();
        try { if (E.launchEncoder) E.launchEncoder(); } catch (e0) {}
        for (i = 0; i < (o.items || []).length; i++) {
            it = o.items[i];
            s = seqById(it.id);
            if (!s) { failed.push(it.file + ' : s\u00e9quence introuvable'); continue; }
            ext = '';
            try { ext = s.getExportFileExtension ? s.getExportFileExtension(o.preset) : ''; } catch (e1) {}
            if (ext && ext.charAt(0) !== '.') ext = '.' + ext;
            try { job = E.encodeSequence(s, dir.fsName + '/' + it.file + (ext || '.mp4'), o.preset, E.ENCODE_ENTIRE !== undefined ? E.ENCODE_ENTIRE : 0, 1); } catch (e2) { job = null; }
            if (job === null || job === undefined || job === 0 || job === '0') failed.push(it.file); else queued.push({ file: it.file + (ext || '.mp4'), job: String(job) });
        }
        if (queued.length) { try { E.startBatch(); } catch (e3) {} }
        return ok({ queued: queued, failed: failed });
    }

    // Medias poses dans au moins une sequence (archive) : chemins uniques et projet.
    function usedMedia(o) {
        var u = usedItems(), out = [], seen = {}, missing = 0;
        walkItems(app.project.rootItem, function (x) {
            var p = '';
            if (x.type !== 1 || isSeqItem(x)) return true;
            if (!u.ids[x.nodeId] && !u.names[x.name]) return true;
            try { p = x.getMediaPath(); } catch (e) {}
            if (!p) return true;
            if (seen[norm(p)]) return true;
            seen[norm(p)] = true;
            try { if (x.isOffline && x.isOffline()) missing++; } catch (e2) {}
            out.push({ name: x.name, path: p });
            return true;
        });
        return ok({ files: out, project: app.project.path || '', projectName: app.project.name || '', offline: missing });
    }

    return {
        version: VERSION,
        compat: guard(compat),
        markerList: guard(markerList),
        addMarkers: guard(addMarkers),
        clearAll: guard(clearAll),
        musicInfo: guard(musicInfo),
        projectRushes: guard(projectRushes),
        placeRushes: guard(placeRushes),
        cutAtTimes: guard(cutAtTimes),
        multicamSwitch: guard(multicamSwitch),
        placeAsset: guard(placeAsset),
        importAssets: guard(importAssets),
        syncInfo: guard(syncInfo),
        moveClips: guard(moveClips),
        grabFrames: guard(grabFrames),
        placeTitle: guard(placeTitle),
        readBlend: guard(readBlend),
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
        rampApply: guard(rampApply),
        logConvert: guard(logConvert),
        placeGrades: guard(placeGrades),
        rushList: guard(rushList),
        framesBegin: guard(framesBegin),
        framesEnd: guard(framesEnd),
        formatCopy: guard(formatCopy),
        setPlayhead: guard(setPlayhead),
        selfTest: guard(selfTest),
        speechInfo: guard(speechInfo),
        cutSilences: guard(cutSilences),
        duckMusic: guard(duckMusic),
        voiceLevel: guard(voiceLevel),
        gainKeys: guard(gainKeys),
        listSequences: guard(listSequences),
        openSequence: guard(openSequence),
        extractCopy: guard(extractCopy),
        preflight: guard(preflight),
        placeStills: guard(placeStills),
        newFromTemplate: guard(newFromTemplate),
        importToBin: guard(importToBin),
        tidyProject: guard(tidyProject),
        renameItems: guard(renameItems),
        versionSequence: guard(versionSequence),
        fitMusic: guard(fitMusic),
        activityPing: guard(activityPing),
        proxyPresets: guard(proxyPresets),
        makeProxies: guard(makeProxies),
        proxyStatus: guard(proxyStatus),
        setProxies: guard(setProxies),
        deleteSequence: guard(deleteSequence),
        splitEdits: guard(splitEdits),
        cutList: guard(cutList),
        rollEdits: guard(rollEdits),
        audioCredits: guard(audioCredits),
        exportPresets: guard(exportPresets),
        exportQueue: guard(exportQueue),
        usedMedia: guard(usedMedia)
    };
})();
