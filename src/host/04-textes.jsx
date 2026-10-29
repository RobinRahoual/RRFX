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

    api.placeTitle = guard(placeTitle);

