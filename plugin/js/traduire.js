/* RR FX : traduire les sous-titres (onglet Parole). Le .srt chargé est traduit sous-titre par
   sous-titre, les timings restent les mêmes : on peut ensuite poser la version traduite,
   l'enregistrer en .srt, ou revenir à l'original. Le texte part chez le service choisi
   (MyMemory gratuit, ou DeepL avec ta clé) : le panneau le dit. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const T = root.RRFXTraduction, Sp = root.RRFXSpeech, { Store } = app;
    const { h, picker, row, actionGroup } = app.UI;

    const st = () => {
      const s = app.settings();
      if (!s.translate || typeof s.translate !== 'object') s.translate = {};
      const d = { from: 'fr', to: 'en', service: 'mymemory', key: '', email: '', original: '', lang: '' };
      Object.keys(d).forEach(k => { if (!(k in s.translate)) s.translate[k] = d[k]; });
      return s.translate;
    };
    const langName = c => (T.LANGS.find(l => l[0] === c) || [c, c])[1];

    /* Requête web : par Node dans Premiere (pas de blocage CORS), sinon fetch. → { status, json } */
    function request(r) {
      const https = Store.nodeRequire && Store.nodeRequire('https');
      if (https) {
        return new Promise((resolve, reject) => {
          const u = new URL(r.url), body = r.body ? Buffer.from(r.body, 'utf8') : null;
          const req = https.request({ method: r.method, hostname: u.hostname, path: u.pathname + u.search, headers: Object.assign({ 'User-Agent': 'RRFX' }, r.headers || {}, body ? { 'Content-Length': body.length } : {}) }, res => {
            const parts = [];
            res.on('data', c => parts.push(c));
            res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { json = null; } resolve({ status: res.statusCode, json }); });
            res.on('error', reject);
          });
          req.on('error', reject);
          req.setTimeout(30000, () => req.destroy(new Error(_T('Le service de traduction ne répond pas.'))));
          if (body) req.write(body);
          req.end();
        });
      }
      return fetch(r.url, { method: r.method, headers: r.headers, body: r.body }).then(res => res.json().catch(() => null).then(json => ({ status: res.status, json })));
    }

    async function translateTexts(texts, x) {
      const out = new Array(texts.length);
      if (x.service === 'deepl') {
        if (!String(x.key).trim()) throw new Error(_T('Colle ta clé API DeepL (compte gratuit sur deepl.com/pro-api).'));
        const groups = T.batches(texts, 50, 20000);
        for (let g = 0; g < groups.length; g++) {
          if (app.S.cancel) break;
          app.status.progress(g, groups.length, 'DeepL');
          const idx = groups[g], r = await request(T.deeplRequest(idx.map(i => texts[i]), x.from, x.to, x.key));
          if (r.status !== 200) throw new Error(T.httpError(r.status, 'deepl'));
          T.deeplParse(r.json, idx.length).forEach((t, k) => { out[idx[k]] = t; });
        }
        return out;
      }
      // MyMemory : un sous-titre par requête, trois à la fois.
      let next = 0, done = 0;
      const worker = async () => {
        while (next < texts.length && !app.S.cancel) {
          const i = next++;
          if (!texts[i]) { out[i] = ''; done++; continue; }
          const r = await request(T.myMemoryRequest(texts[i], x.from, x.to, x.email));
          if (r.status !== 200) throw new Error(T.httpError(r.status, 'mymemory'));
          out[i] = T.myMemoryParse(r.json);
          app.status.progress(++done, texts.length, 'MyMemory');
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return out;
    }

    function translate(refresh) {
      const x = st(), sp = app.speech.settings();
      return app.runTask(_T('Traduction des sous-titres'), async () => {
        const cues = Sp.parseSubtitles(sp.srt);
        if (!cues.length) return { kind: 'error', title: _T('Pas de sous-titres'), detail: _T('Importe ou colle d\'abord un .srt (section Sous-titres).') };
        if (x.from === x.to) return { kind: 'warn', title: _T('Même langue'), detail: _T('Choisis une autre langue d\'arrivée.') };
        const texts = cues.map(c => T.oneLine(c.text));
        app.status.phase(_T('Traduction (') + langName(x.from) + ' → ' + langName(x.to) + ')');
        const tr = await translateTexts(texts, x);
        if (app.S.cancel) return { kind: 'warn', title: _T('Traduction arrêtée'), detail: _T('Les sous-titres n\'ont pas changé.') };
        if (!x.original) x.original = sp.srt;
        sp.srt = T.toSrt(T.apply(cues, tr));
        x.lang = x.to;
        app.persist();
        if (refresh) refresh();
        return { kind: 'ok', title: app.plural(cues.length, _T('sous-titre traduit'), _T('sous-titres traduits')) + _T(' en ') + langName(x.to).toLowerCase(), detail: _T('Mêmes timings. « Poser les sous-titres » pose la version traduite ; « Revenir à l\'original » remet l\'autre.') };
      }, true);
    }

    app.extras.speech.push({
      id: 'traduire', title: _T('Traduire les sous-titres'), nav: _T('Traduire'), tool: [_T('Traduire les sous-titres'), () => translate()],
      render: use => {
        const x = st(), box = h('div');
        const draw = () => {
          box.innerHTML = '';
          const langs = T.LANGS.map(([v, label]) => ({ v, label }));
          box.appendChild(row(_T('De'), picker(langs, x.from, v => { x.from = v; app.persist(); })));
          box.appendChild(row(_T('Vers'), picker(langs, x.to, v => { x.to = v; app.persist(); })));
          box.appendChild(row('Service', actionGroup([{ v: 'mymemory', label: _T('MyMemory (gratuit)') }, { v: 'deepl', label: _T('DeepL (clé)') }], x.service, v => { x.service = v; app.persist(); draw(); })));
          if (x.service === 'deepl') {
            const key = h('input', { class: 'textfield', type: 'password', value: x.key, placeholder: _T('Clé API DeepL (…:fx pour le compte gratuit)'), 'aria-label': _T('Clé API DeepL') });
            key.addEventListener('input', () => { x.key = key.value.trim(); app.persist(); });
            box.appendChild(key);
          } else {
            const mail = h('input', { class: 'textfield', type: 'email', value: x.email, placeholder: _T('Ton e-mail (facultatif : 50 000 caractères par jour au lieu de 5 000)'), 'aria-label': _T('E-mail pour MyMemory') });
            mail.addEventListener('input', () => { x.email = mail.value.trim(); app.persist(); });
            box.appendChild(mail);
          }
          const cues = Sp.parseSubtitles(app.speech.settings().srt);
          const go = h('button', { class: 'action go' }, _T('Traduire'));
          go.addEventListener('click', use('traduire', () => translate(draw)));
          const save = h('button', { class: 'action', disabled: !cues.length }, _T('Enregistrer le .srt…'));
          save.addEventListener('click', () => {
            const out = Store.saveBinary([new TextEncoder().encode(app.speech.settings().srt)], 'sous-titres' + (x.lang ? '.' + x.lang : '') + '.srt', 'srt', _T('Enregistrer les sous-titres'));
            if (out) app.status.finish('ok', _T('Sous-titres enregistrés'), out);
          });
          const back = x.original ? h('button', { class: 'action quiet' }, _T('Revenir à l\'original')) : null;
          if (back) back.addEventListener('click', () => { app.speech.settings().srt = x.original; x.original = ''; x.lang = ''; app.persist(); app.switchTab('speech'); });
          box.appendChild(h('div', { class: 'row-buttons wrap' }, go, save, back));
          box.appendChild(h('div', { class: 'note' }, (cues.length ? app.plural(cues.length, _T('sous-titre')) + ', ' + T.chars(cues) + _T(' caractères') + (x.lang ? _T(' · en ') + langName(x.lang).toLowerCase() : '') + '. ' : '') + _T('Le texte est envoyé à ') + (x.service === 'deepl' ? 'DeepL' : 'MyMemory') + _T(' pour être traduit ; les timings ne bougent pas.')));
        };
        draw();
        return [box];
      }
    });
    app.actions.translateCaptions = () => translate();
  });
})(typeof self !== 'undefined' ? self : this);
