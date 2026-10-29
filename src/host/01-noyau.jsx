/* RR FX - Premiere Pro side (ExtendScript, ES3).
   Every public function takes a JSON string and returns a JSON string:
   { ok: true, ... } or { ok: false, error: "..." }.
   Times travel as ticks (numbers); 254016000000 ticks = 1 second. */

var RRFX = (function () {
    var TICKS = 254016000000;
    var VERSION = '2.7.0';
    var adjCache = null;
    // Fonctions publiques : chaque partie ajoute les siennes (api.nom = guard(nom)).
    var api = { version: VERSION };

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

