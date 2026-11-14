    // ============================================================ Textes animes (MOGRT)

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
                    done.text = true;
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
        if ((st.font || st.size || st.caps) && !done.text) missing.push('police et taille (texte non modifiable par script : texte de l\'outil Texte, ou mod\u00e8le sans texte modifiable)');
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
        if (o.look) { try { applyLookTo(s, ti, a, o.look, o.lookFx || [], warnings); } catch (e6) { warnings.push('Style du texte : ' + e6.toString()); } } else if (o.style) { try { applyTextStyle(s, ti, a, o.style, o.styleFx || {}, warnings); } catch (e5) { warnings.push('Style du texte : ' + e5.toString()); } }
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

    // ------------------------------------------------------------ public: capturer une animation de texte

    // L'animation d'un texte deja monte dans la timeline : ses images cles du debut (entree) et de la
    // fin (sortie), echantillonnees image par image, et les reglages fixes de ses effets (lueur,
    // couleur...). Rejouee ensuite sur d'autres textes, quelle que soit leur duree.
    function captureTitle(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), it, S, E, mid, comps, ci, pi, c, mn, intrinsic, p, keys, j, kt, v, k, entry, animated;
        var segIn = { a: null, b: null }, segOut = { a: null, b: null }, list = [], skipped = 0;
        if (!sel.length) return fail('S\u00e9lectionne dans la timeline le texte anim\u00e9 \u00e0 enregistrer.');
        it = sel[0].item;
        S = tk(it.start);
        E = tk(it.end);
        mid = (S + E) / 2;
        comps = it.components;
        for (ci = 0; ci < comps.numItems; ci++) {
            c = comps[ci];
            mn = c.matchName;
            if (/time ?remap/i.test(mn)) continue;
            intrinsic = mn === 'AE.ADBE Motion' ? 'motion' : (mn === 'AE.ADBE Opacity' ? 'opacity' : null);
            entry = { ci: ci, matchName: mn, displayName: c.displayName, intrinsic: intrinsic, anim: [], stat: [] };
            for (pi = 0; pi < c.properties.numItems; pi++) {
                p = c.properties[pi];
                animated = false;
                try {
                    if (p.isTimeVarying()) {
                        keys = p.getKeys();
                        if (keys && keys.length) {
                            animated = true;
                            for (j = 0; j < keys.length; j++) {
                                kt = seqTimeOf(it, tk(keys[j]));
                                k = kt <= mid ? segIn : segOut;
                                if (k.a === null || kt < k.a) k.a = kt;
                                if (k.b === null || kt > k.b) k.b = kt;
                            }
                        }
                    }
                } catch (e) {}
                if (animated) entry.anim.push(pi);
                else if (!intrinsic) {
                    // Reglage fixe d'un effet ajoute (lueur, couleur...) : garde tel quel.
                    try {
                        v = plainValue(p.getValue());
                        if (v.ok) entry.stat.push({ index: pi, name: p.displayName, 'static': v.v }); else skipped++;
                    } catch (e2) { skipped++; }
                }
            }
            if (entry.anim.length || entry.stat.length) list.push(entry);
        }
        if (segIn.a === null && segOut.a === null) return fail('Ce texte n\'a pas d\'images cl\u00e9s : anime-le dans Premiere (Options d\'effet), puis recommence.');
        function sample(sg) {
            var out = [], D, i, x, props, n, pp, vals, jj, vv;
            if (sg.a === null) return null;
            sg.a = snap(sg.a, f);
            sg.b = snap(sg.b, f);
            D = Math.max(1, Math.round((sg.b - sg.a) / f) + 1);
            for (i = 0; i < list.length; i++) {
                x = list[i];
                props = [];
                for (n = 0; n < x.anim.length; n++) {
                    pp = comps[x.ci].properties[x.anim[n]];
                    vals = [];
                    for (jj = 0; jj < D; jj++) {
                        vv = plainValue(pp.getValueAtTime(clipTime(it, sg.a + jj * f)));
                        if (!vv.ok) { vals = null; break; }
                        vals.push(vv.v);
                    }
                    if (vals) props.push({ index: x.anim[n], name: pp.displayName, values: vals }); else skipped++;
                }
                for (n = 0; n < x.stat.length; n++) props.push(x.stat[n]);
                if (props.length) out.push({ matchName: x.matchName, displayName: x.displayName, intrinsic: x.intrinsic, props: props });
            }
            return { frames: D, components: out };
        }
        return ok({ name: it.name, fps: TICKS / f, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical, 'in': sample(segIn), out: sample(segOut), skipped: skipped });
    }

    // ------------------------------------------------------------ public: style d'un texte de la timeline

    // Le " look " d'un texte deja monte : police, taille, majuscules (texte du modele), couleurs,
    // cases et valeurs de ses reglages (Objets graphiques essentiels), et les effets poses dessus
    // (lueur, ombre, contour...) avec leurs valeurs. Reapplique ensuite en un clic sur d'autres
    // textes, ou sur ceux que RR FX pose.
    function textJson(v) {
        var obj = null;
        if (typeof v !== 'string' || !/^\s*\{/.test(v)) return null;
        try { obj = eval('(' + v + ')'); } catch (e) { return null; }
        return obj && obj.textEditValue !== undefined ? obj : null;
    }
    function isGraphicComp(c) {
        var i, v;
        if (/Capsule|AE\.ADBE Text|Graphic/i.test(String(c.matchName))) return true;
        for (i = 0; i < c.properties.numItems; i++) {
            try { v = c.properties[i].getValue(); } catch (e) { continue; }
            if (textJson(v)) return true;
        }
        return false;
    }
    function readLookProps(c, at) {
        var out = [], i, p, nm, v, obj, k, st, col, pv;
        for (i = 0; i < c.properties.numItems; i++) {
            p = c.properties[i];
            nm = String(p.displayName || '');
            try { v = p.isTimeVarying() ? p.getValueAtTime(at) : p.getValue(); } catch (e) { continue; }
            obj = textJson(v);
            if (obj) {
                st = {};
                for (k in obj) {
                    if (!obj.hasOwnProperty(k) || !/^font/.test(k) || k === 'fontTextRunLength') continue;
                    st[k] = obj[k] instanceof Array ? obj[k][0] : obj[k];
                }
                out.push({ name: nm, kind: 'text', value: st });
                continue;
            }
            if (typeof v === 'string') continue;
            col = null;
            if (isColorParam(p)) { try { col = p.getColorValue(); } catch (e2) { col = null; } }
            if (col) { out.push({ name: nm, kind: 'color', value: hex2(col[1]) + hex2(col[2]) + hex2(col[3]) }); continue; }
            if (typeof v === 'boolean') { out.push({ name: nm, kind: 'bool', value: v }); continue; }
            pv = plainValue(v);
            if (pv.ok) out.push({ name: nm, kind: 'num', value: pv.v });
        }
        return out;
    }
    function hex2(n) { n = Math.max(0, Math.min(255, Math.round(Number(n) || 0))); return (n < 16 ? '0' : '') + n.toString(16); }

    function lookOfItem(it, s) {
        var mid = (tk(it.start) + tk(it.end)) / 2, at = clipTime(it, mid), mgt = null, graphics = [], effects = [], comps = it.components, i, c, mn, props, pi, p, v;
        try { mgt = it.getMGTComponent(); } catch (e) {}
        if (mgt) graphics.push({ matchName: '#mgt', displayName: 'MGT', props: readLookProps(mgt, at) });
        for (i = 0; i < comps.numItems; i++) {
            c = comps[i];
            mn = String(c.matchName);
            if (mn === 'AE.ADBE Motion' || mn === 'AE.ADBE Opacity' || /time ?remap/i.test(mn)) continue;
            if (isGraphicComp(c)) {
                // Le composant du modele apparait aussi ici : deja lu par getMGTComponent.
                if (!mgt) graphics.push({ matchName: mn, displayName: c.displayName, props: readLookProps(c, at) });
                continue;
            }
            props = [];
            for (pi = 0; pi < c.properties.numItems; pi++) {
                p = c.properties[pi];
                try { v = plainValue(p.isTimeVarying() ? p.getValueAtTime(at) : p.getValue()); } catch (e2) { continue; }
                if (v.ok) props.push({ index: pi, name: p.displayName, 'static': v.v });
            }
            effects.push({ matchName: mn, displayName: c.displayName, props: props });
        }
        return { name: it.name, graphics: graphics, effects: effects, frameW: s.frameSizeHorizontal, frameH: s.frameSizeVertical };
    }

    function captureTextLook(o) {
        var s = activeSeq(), sel = selectedVideo(s), look, i, n = 0;
        if (!sel.length) return fail('S\u00e9lectionne dans la timeline le texte dont tu veux garder le style.');
        look = lookOfItem(sel[0].item, s);
        for (i = 0; i < look.graphics.length; i++) n += look.graphics[i].props.length;
        if (!n && !look.effects.length) return fail('Ce clip n\'a ni r\u00e9glages de texte ni effets \u00e0 garder (s\u00e9lectionne un texte ou un mod\u00e8le .mogrt).');
        return ok(look);
    }

    // Applique les reglages captures sur un composant : par nom, dans l'ordre (deux " Couleur "...).
    function writeLookProps(c, props) {
        var used = {}, i, j, sp, p, nm, v, obj, k, txt, done = 0;
        for (i = 0; i < props.length; i++) {
            sp = props[i];
            p = null;
            for (j = 0; j < c.properties.numItems; j++) {
                nm = String(c.properties[j].displayName || '');
                if (nm === sp.name && !used[j]) { p = c.properties[j]; used[j] = true; break; }
            }
            if (!p) continue;
            try {
                if (sp.kind === 'text') {
                    obj = textJson(p.getValue());
                    if (!obj) continue;
                    txt = String(obj.textEditValue || '');
                    // Un seul " run " de style pour tout le texte.
                    for (k in obj) if (obj.hasOwnProperty(k) && /^font/.test(k) && obj[k] instanceof Array && obj[k].length > 1) obj[k] = [obj[k][0]];
                    for (k in sp.value) if (sp.value.hasOwnProperty(k)) obj[k] = obj[k] instanceof Array || obj[k] === undefined ? [sp.value[k]] : sp.value[k];
                    if (obj.fontTextRunLength !== undefined) obj.fontTextRunLength = [txt.length];
                    p.setValue(str(obj), true);
                } else if (sp.kind === 'color') {
                    if (!setColorHex(p, '#' + sp.value)) continue;
                } else {
                    if (p.isTimeVarying()) continue;
                    v = sp.value;
                    p.setValue(v, true);
                }
                done++;
            } catch (e) {}
        }
        return done;
    }

    function applyLookTo(s, ti, a, look, fx, warnings) {
        var item = findItemAt(s, ti, a), i, g, c = null, n = 0, comp, j, f = tpf(s);
        if (!item) return 0;
        for (i = 0; i < (look.graphics || []).length; i++) {
            g = look.graphics[i];
            c = null;
            if (g.matchName === '#mgt') { try { c = item.getMGTComponent(); } catch (e) {} }
            if (!c) c = componentByMatch(item, g.matchName === '#mgt' ? 'AE.ADBE Text' : g.matchName);
            if (!c) {
                // Texte de Premiere (outil Texte) <-> modele .mogrt : le premier composant graphique.
                for (j = 0; j < item.components.numItems && !c; j++) if (isGraphicComp(item.components[j])) c = item.components[j];
                if (!c) { try { c = item.getMGTComponent(); } catch (e2) {} }
            }
            if (c) n += writeLookProps(c, g.props);
        }
        // Effets : reutilises s'ils sont deja sur le texte (pas de doublon), sinon ajoutes.
        for (i = 0; i < (fx || []).length; i++) {
            try {
                item = findItemAt(s, ti, a);
                comp = componentByMatch(item, fx[i].matchName) || addEffect(s, ti, a, fx[i], warnings);
                if (comp) { setProps(s, findItemAt(s, ti, a), comp, fx[i], a, f, warnings); n++; }
            } catch (err) { warnings.push(fx[i].names[0] + ' : ' + err.toString()); }
        }
        return n;
    }

    // Style (o.look + o.fx, ou o.style + o.styleFx) sur les textes selectionnes dans la timeline.
    function applyTextLook(o) {
        var s = activeSeq(), sel = selectedVideo(s), warnings = [], done = 0, i, a, ti, n;
        if (!sel.length) return fail('S\u00e9lectionne dans la timeline les textes \u00e0 styler.');
        for (i = 0; i < sel.length; i++) {
            a = tk(sel[i].item.start);
            ti = sel[i].track;
            n = 0;
            try {
                if (o.look) n = applyLookTo(s, ti, a, o.look, o.fx || [], warnings);
                else if (o.style) { applyTextStyle(s, ti, a, o.style, o.styleFx || {}, warnings); n = 1; }
            } catch (e) { warnings.push(sel[i].item.name + ' : ' + e.toString()); }
            if (n) done++;
        }
        if (!done) return fail('Aucun texte modifiable dans la s\u00e9lection (un texte ou un mod\u00e8le .mogrt).');
        return ok({ done: done, total: sel.length, warnings: warnings });
    }

    // ------------------------------------------------------------ public: textes deja dans la timeline

    // Ce que Premiere laisse modifier sur un clip : 'mgt' (modele .mogrt avec ses reglages),
    // 'graphic' (texte fait avec l'outil Texte de Premiere), 'clip' (autre : image, video...).
    function textKindOf(it) {
        var mgt = null, i;
        try { mgt = it.getMGTComponent(); } catch (e) {}
        if (mgt) return 'mgt';
        for (i = 0; i < it.components.numItems; i++) if (isGraphicComp(it.components[i])) return 'graphic';
        return 'clip';
    }

    // Les clips selectionnes (video), avec leur duree en images.
    function selectedTexts(o) {
        var s = activeSeq(), f = tpf(s), sel = selectedVideo(s), out = [], i, it, a;
        if (!sel.length) return fail('S\u00e9lectionne dans la timeline les textes \u00e0 animer ou \u00e0 styler.');
        for (i = 0; i < sel.length; i++) {
            it = sel[i].item;
            a = tk(it.start);
            out.push({ track: sel[i].track, start: a, frames: Math.max(1, Math.round((tk(it.end) - a) / f)), name: String(it.name), kind: textKindOf(it) });
        }
        return ok({ items: out, fps: TICKS / f });
    }

    function hasKeys(c) {
        var i;
        for (i = 0; i < c.properties.numItems; i++) { try { if (c.properties[i].isTimeVarying()) return true; } catch (e) {} }
        return false;
    }
    function clearKeys(c) {
        var i, p;
        for (i = 0; i < c.properties.numItems; i++) {
            p = c.properties[i];
            try { if (p.isTimeVarying()) p.setTimeVarying(false); } catch (e) {}
        }
    }

    // Anime des clips deja montes : o.items [{ track, start, fx }]. Une animation deja posee
    // (effets o.replace animes : Transformer, flous...) est retiree avant, pour ne pas s'empiler ;
    // les images cles de Trajectoire / Opacite sont remplacees si la nouvelle animation s'en sert.
    function animateTexts(o) {
        var s = activeSeq(), f = tpf(s), warnings = [], created = [], done = 0, i, j, k, x, it, comp, fx, entry, mn, removed, before;
        var replace = o.replace || [];
        for (i = 0; i < o.items.length; i++) {
            x = o.items[i];
            it = findItemAt(s, x.track, x.start);
            if (!it) { warnings.push('Clip introuvable sur V' + (x.track + 1)); continue; }
            entry = { kind: 'clip', track: x.track, start: x.start, name: it.name, added: [] };
            removed = 0;
            for (k = it.components.numItems - 1; k >= 0; k--) {
                comp = it.components[k];
                mn = String(comp.matchName);
                for (j = 0; j < replace.length; j++) {
                    if (mn !== replace[j] || !hasKeys(comp)) continue;
                    if (typeof comp.remove === 'function') { try { comp.remove(); removed++; } catch (e0) { clearKeys(comp); } } else clearKeys(comp);
                    // Animation remplacee : l'annulation ne sait pas la remettre (signale, pas compte).
                    entry.lost = (entry.lost || 0) + 1;
                    break;
                }
            }
            before = 0;
            for (j = 0; j < x.fx.length; j++) {
                fx = x.fx[j];
                try {
                    it = findItemAt(s, x.track, x.start);
                    if (fx.intrinsic) {
                        comp = componentByMatch(it, fx.intrinsic === 'motion' ? 'AE.ADBE Motion' : 'AE.ADBE Opacity');
                        if (comp) { keepComp(entry, comp); clearKeys(comp); }
                    } else {
                        comp = addEffect(s, x.track, x.start, fx, warnings);
                        if (comp) entry.added.push(comp.matchName);
                    }
                    if (!comp) { warnings.push((fx.names[0] || fx.matchName) + ' : effet introuvable dans Premiere'); continue; }
                    before += setProps(s, findItemAt(s, x.track, x.start), comp, fx, x.start, f, warnings);
                } catch (err) {
                    warnings.push(String(it.name) + ' \u00b7 ' + (fx.names[0] || fx.matchName) + ' : ' + err.toString());
                }
            }
            if (before) { done++; created.push(entry); }
        }
        if (!done) return fail(warnings.length ? warnings[0] : 'Aucune animation pos\u00e9e.', { warnings: warnings });
        return ok({ done: done, total: o.items.length, created: created, warnings: warnings });
    }

    // Rapport sur le texte selectionne : ce que Premiere en montre aux scripts (pour comprendre
    // pourquoi un style ne passe pas, et l'envoyer).
    function inspectText(o) {
        var s = activeSeq(), sel = selectedVideo(s), it, out = [], mgt = null, i, c, j, p, v, t, list;
        if (!sel.length) return fail('S\u00e9lectionne un texte dans la timeline.');
        it = sel[0].item;
        function describe(c) {
            var props = [];
            for (j = 0; j < c.properties.numItems; j++) {
                p = c.properties[j];
                t = '';
                try {
                    v = p.getValue();
                    t = typeof v;
                    if (v instanceof Array) t = 'array';
                    if (isColorParam(p)) { t = 'color'; v = p.getColorValue(); }
                    v = typeof v === 'string' ? v.substr(0, 400) : str(v);
                } catch (e) { t = 'error'; v = e.toString(); }
                var keyed = false;
                try { keyed = p.isTimeVarying(); } catch (e2) {}
                props.push({ name: String(p.displayName), type: t, keyed: keyed, value: String(v).substr(0, 400) });
            }
            return { matchName: String(c.matchName), displayName: String(c.displayName), props: props };
        }
        try { mgt = it.getMGTComponent(); } catch (e3) {}
        list = it.components;
        for (i = 0; i < list.numItems; i++) out.push(describe(list[i]));
        return ok({
            name: String(it.name), track: sel[0].track, kind: textKindOf(it), app: appVersion(),
            projectItem: it.projectItem ? String(it.projectItem.name) : '', mgt: mgt ? describe(mgt) : null, components: out
        });
    }

    api.selectedTexts = guard(selectedTexts);
    api.animateTexts = guard(animateTexts);
    api.inspectText = guard(inspectText);
    api.captureTextLook = guard(captureTextLook);
    api.applyTextLook = guard(applyTextLook);
    api.captureTitle = guard(captureTitle);
    api.placeTitle = guard(placeTitle);

