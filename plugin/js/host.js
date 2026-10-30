/* RR FX : pont vers Premiere (ExtendScript) et vers l'environnement CEP.
   Hors de Premiere (simple navigateur), bascule sur RRFXMock : mode démo. */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);
  const VERSION = '2.10.0';
  const cep = root.__adobe_cep__;
  const isMac = /Mac/i.test(navigator.platform || '');

  function systemPath(type) {
    const p = decodeURI(cep.getSystemPath(type));
    return p.replace(/^file:\/{2,3}/, isMac ? '/' : '');
  }

  function evalScript(script) {
    return new Promise(resolve => cep.evalScript(script, resolve));
  }

  // Argument passé à ExtendScript : une chaîne JSON, elle-même écrite comme littéral JS.
  function literal(obj) {
    return JSON.stringify(JSON.stringify(obj === undefined ? {} : obj))
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  async function init() {
    if (!cep) return { demo: true };
    // Après une mise à jour, l'ancien script peut rester chargé dans Premiere : on recharge
    // dès que sa version diffère de celle du panneau.
    const loaded = await evalScript('typeof RRFX === "object" ? String(RRFX.version) : ""');
    if (loaded !== VERSION) {
      const file = systemPath('extension') + '/jsx/host.jsx';
      await evalScript('$.evalFile(' + JSON.stringify(file) + ')');
    }
    const now = await evalScript('typeof RRFX === "object" ? String(RRFX.version) : ""');
    return { demo: false, loaded: now === VERSION, version: now };
  }

  // Messages de Premiere dans la langue du panneau.
  function translated(r) {
    const I = root.RRFXI18n;
    if (!I || I.lang === 'fr' || !r || typeof r !== 'object') return r;
    if (r.error) r.error = I.host(r.error);
    if (Array.isArray(r.warnings)) r.warnings = r.warnings.map(w => I.host(w));
    if (Array.isArray(r.issues)) r.issues.forEach(i => { i.text = I.host(i.text); });
    return r;
  }

  async function call(fn, arg) {
    if (!cep) return translated(await root.RRFXMock.call(fn, arg));
    const r = await evalScript('RRFX.' + fn + '(' + literal(arg) + ')');
    try {
      return translated(JSON.parse(r));
    } catch (e) {
      return { ok: false, error: _T('Réponse inattendue de Premiere : ') + String(r).slice(0, 200) };
    }
  }

  function hostEnv() {
    if (!cep) return null;
    try { return JSON.parse(cep.getHostEnvironment()); } catch (e) { return null; }
  }

  function on(event, fn) {
    if (cep && cep.addEventListener) cep.addEventListener(event, fn);
  }

  function openURL(url) {
    try {
      if (root.cep && root.cep.util && root.cep.util.openURLInDefaultBrowser) {
        root.cep.util.openURLInDefaultBrowser(url);
        return true;
      }
    } catch (e) { /* on tente la fenêtre */ }
    try { root.open(url, '_blank'); return true; } catch (e) { return false; }
  }

  // Menu du panneau (≡ en haut à droite du panneau dans Premiere).
  function setMenu(items, onClick) {
    if (!cep) return;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const xml = '<Menu>' + items.map(i => i.separator ? '<MenuItem Label="---" />'
      : '<MenuItem Id="' + esc(i.id) + '" Label="' + esc(i.label) + '" Enabled="true" Checked="' + (i.checked ? 'true' : 'false') + '"/>').join('') + '</Menu>';
    try { cep.invokeSync('setPanelFlyoutMenu', xml); } catch (e) { return; }
    if (!setMenu.bound) {
      setMenu.bound = true;
      on('com.adobe.csxs.events.flyoutMenuClicked', ev => {
        let data = ev && ev.data;
        if (typeof data === 'string') {
          // Selon la version de CEP : JSON, XML (<menuId>…</menuId>) ou texte brut.
          const xml = /<menuId>([^<]*)<\/menuId>/.exec(data);
          try { data = xml ? { menuId: xml[1] } : JSON.parse(data); } catch (e) { data = { menuId: data }; }
        }
        const id = data && (data.menuId || data.menuName);
        if (id) setMenu.handler(id);
      });
    }
    setMenu.handler = onClick;
  }

  function registerKeys(list) {
    if (!cep || !cep.registerKeyEventsInterest) return;
    try { cep.registerKeyEventsInterest(JSON.stringify(list)); } catch (e) { /* touches gardées par Premiere */ }
  }

  root.RRFXHost = { VERSION, isMac, init, call, hostEnv, on, openURL, setMenu, registerKeys, demo: !cep };
})(typeof self !== 'undefined' ? self : this);
