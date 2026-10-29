/* RR FX : télécommande. Un petit serveur sur l'ordinateur (127.0.0.1, rien n'est ouvert sur le
   réseau) lance les actions de RR FX depuis un Stream Deck, Bitfocus Companion, un raccourci du
   système… : une adresse par action, protégée par un jeton. Marche même quand le panneau n'a pas
   le focus, tant que Premiere est ouvert. Désactivée par défaut (Réglages > Télécommande). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const Keys = root.RRFXShortcuts, { Store } = app;
    const { h, checkbox, picker, row, section } = app.UI;
    const PORT = 47291;

    const newToken = () => {
      const b = new Uint8Array(6);
      (root.crypto || { getRandomValues: a => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    };
    const st = () => {
      const s = app.settings();
      if (!s.remote || typeof s.remote !== 'object') s.remote = {};
      const d = { on: false, port: PORT, token: '', pick: 'express' };
      Object.keys(d).forEach(k => { if (!(k in s.remote)) s.remote[k] = d[k]; });
      if (!s.remote.token) s.remote.token = newToken();
      return s.remote;
    };
    const base = () => 'http://127.0.0.1:' + st().port + '/rrfx/' + st().token + '/';
    const actions = () => Object.keys(Keys.ACTIONS).filter(id => app.services.actionAvailable(id));

    /* Réponse à une requête : chemin /rrfx/<jeton>/<action> → { code, body }. Pure (testable). */
    function answer(path, token, busy, run) {
      const m = /^\/rrfx\/([^/?#]+)\/?([^/?#]*)/.exec(String(path || ''));
      if (!m) return { code: 404, body: { ok: false, error: _T('Adresse inconnue') } };
      if (m[1] !== token) return { code: 403, body: { ok: false, error: _T('Jeton incorrect') } };
      if (!m[2]) return { code: 200, body: { ok: true, actions: actions().map(id => ({ id, label: Keys.ACTIONS[id] })) } };
      if (!Keys.ACTIONS[m[2]] || !app.services.actionAvailable(m[2])) return { code: 404, body: { ok: false, error: _T('Action inconnue : ') + m[2] } };
      if (busy) return { code: 409, body: { ok: false, error: _T('RR FX est occupé') } };
      run(m[2]);
      return { code: 202, body: { ok: true, action: m[2], label: Keys.ACTIONS[m[2]] } };
    }

    let server = null, state = '';
    function stop() {
      if (server) { try { server.close(); } catch (e) { /* déjà fermé */ } }
      server = null;
      state = '';
    }
    function start() {
      stop();
      const http = Store.nodeRequire && Store.nodeRequire('http');
      if (!http) { state = _T('Disponible dans Premiere (mode démo ici).'); return; }
      const x = st();
      server = http.createServer((req, res) => {
        const r = answer(req.url, x.token, app.S.busy, id => setTimeout(() => app.services.runAction(id), 0));
        res.writeHead(r.code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(r.body));
        if (r.code === 202) app.log(_T('Télécommande : ') + r.body.label, 'info');
      });
      server.on('error', e => {
        state = e && e.code === 'EADDRINUSE' ? _T('Le port ') + x.port + _T(' est déjà pris : choisis-en un autre.') : _T('Télécommande arrêtée : ') + app.errorMessage(e);
        app.log(state, 'warn');
        server = null;
        refresh();
      });
      server.listen(x.port, '127.0.0.1', () => { state = _T('En marche sur le port ') + x.port + '.'; refresh(); });
    }
    let refresh = () => {};

    function remoteSection() {
      const x = st(), box = h('div');
      refresh = () => {
        if (!box.isConnected && box.childNodes.length) return;
        box.innerHTML = '';
        box.appendChild(checkbox(_T('Activer la télécommande'), x.on, v => { x.on = v; app.persist(); if (v) start(); else stop(); refresh(); }));
        if (!x.on) {
          box.appendChild(h('div', { class: 'note' }, _T('Lance les actions de RR FX depuis un Stream Deck, Bitfocus Companion, un raccourci clavier du système… même quand le panneau n\'est pas sélectionné. Rien n\'est ouvert sur le réseau : seul cet ordinateur peut l\'utiliser.')));
          return;
        }
        if (state) box.appendChild(h('div', { class: 'note' }, state));
        const port = h('input', { class: 'textfield', type: 'number', min: 1024, max: 65535, value: x.port, 'aria-label': 'Port' });
        port.addEventListener('change', () => { const p = Math.round(+port.value); if (p >= 1024 && p <= 65535) { x.port = p; app.persist(); start(); refresh(); } });
        box.appendChild(row('Port', port));
        const list = actions();
        if (list.indexOf(x.pick) < 0) x.pick = list[0];
        const url = h('input', { class: 'textfield', readonly: true, value: base() + x.pick, 'aria-label': _T('Adresse de l\'action') });
        box.appendChild(row('Action', picker(list.map(id => ({ v: id, label: Keys.ACTIONS[id] })), x.pick, v => { x.pick = v; app.persist(); url.value = base() + v; })));
        const copy = h('button', { class: 'action go' }, _T('Copier l\'adresse'));
        copy.addEventListener('click', () => {
          url.select();
          const done = ok => app.status.finish(ok ? 'ok' : 'warn', ok ? _T('Adresse copiée') : _T('Copie impossible'), ok ? _T('Colle-la dans ton Stream Deck ou Companion.') : _T('Sélectionne l\'adresse et copie-la à la main.'));
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url.value).then(() => done(true), () => done(document.execCommand('copy')));
          else done(document.execCommand('copy'));
        });
        const renew = h('button', { class: 'action quiet', title: _T('Les anciennes adresses ne marcheront plus') }, _T('Nouveau jeton'));
        renew.addEventListener('click', () => { x.token = newToken(); app.persist(); refresh(); });
        box.appendChild(url);
        box.appendChild(h('div', { class: 'row-buttons' }, copy, renew));
        box.appendChild(h('div', { class: 'note' }, _T('Stream Deck : installe un plugin gratuit qui envoie une requête web (« API Ninja », « Web Requests »…), action GET, colle l\'adresse. Companion : module « Generic HTTP ». ') + base() + _T(' (sans action) donne la liste des actions.')));
      };
      refresh();
      return section(_T('Télécommande (Stream Deck, Companion…)'), [box], null, !x.on);
    }

    app.settingsExtras.push(remoteSection);
    app.whenReady.push(() => { if (st().on) start(); });
    root.addEventListener && root.addEventListener('beforeunload', stop);
    app.remote = { answer, start, stop };
  });
})(typeof self !== 'undefined' ? self : this);
