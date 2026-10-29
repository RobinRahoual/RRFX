// A small fake of Premiere's ExtendScript DOM + QE, enough to run host.jsx.
// Semantics follow the documented behaviour as far as known; the parts nobody
// documents (setter side effects) use the most plausible behaviour.
const vm = require('vm');
const fs = require('fs');
const TICKS = 254016000000;

function makeEnv(fps) {
  const F = TICKS / fps;
  let nodeSeq = 1;
  const nid = () => 'n' + (nodeSeq++);

  class Time {
    constructor() { this._t = 0; }
    get ticks() { return String(Math.round(this._t)); }
    set ticks(v) { this._t = Number(v); }
    get seconds() { return this._t / TICKS; }
    set seconds(v) { this._t = v * TICKS; }
    getFormatted() { return 'T' + Math.round(this._t); }
  }
  const T = t => { const x = new Time(); x._t = t; return x; };
  const val = x => (x instanceof Time ? x._t : x * TICKS);

  const EFFECTS = {
    'Transform': ['AE.ADBE Geometry2', [[0.5, 0.5], [0.5, 0.5], true, 100, 100, 0, 0, 0, 100, true, 0, 0]],
    'Gaussian Blur': ['AE.ADBE Gaussian Blur 2', [0, 1, false]],
    'Directional Blur': ['AE.ADBE Motion Blur', [0, 0]],
    'Brightness & Contrast': ['AE.ADBE Brightness & Contrast 2', [0, 0]],
    'Offset': ['AE.ADBE Offset', [[960, 540], 0]],
    'Wave Warp': ['AE.ADBE Wave Warp', [1, 10, 40, 90, 1, 0, 0, 0]],
    'Lens Distortion': ['AE.ADBE Lens Distortion', [0, 0, 0]],
    'Echo': ['AE.ADBE Echo', [-0.033, 1, 1, 1, 1]],
    'Lumetri Color': ['AE.ADBE Lumetri', [0, null, 0, '', 0, 0, 0, 100, 0]],
    'Auto Reframe': ['AE.ADBE AutoReframe', [0, 1]],
    'Tint': ['AE.ADBE Tint', [[255, 0, 0, 0], [255, 255, 255, 255], 100]],
    'Drop Shadow': ['AE.ADBE Drop Shadow', [[255, 0, 0, 0], 50, 135, 5, 0, false]],
    'Ramp': ['AE.ADBE Ramp', [[0.5, 0], [255, 0, 0, 0], [0.5, 1], [255, 255, 255, 255], 0, 0, 0]]
  };

  class Param {
    constructor(name, v) { this.displayName = name; this.v = v; this.keys = null; }
    isTimeVarying() { return !!this.keys; }
    setTimeVarying(b) { this.keys = b ? [] : null; }
    addKey(t) { if (!(t instanceof Time)) throw new Error('addKey wants Time'); if (!this.keys) throw new Error('not time varying'); if (!this.keys.find(k => k.t === t._t)) this.keys.push({ t: t._t, v: this.v }); this.keys.sort((a, b) => a.t - b.t); }
    setValueAtKey(t, v) { const k = this.keys.find(k => k.t === t._t); if (!k) throw new Error('no key at ' + t._t); k.v = v; }
    getKeys() { return this.keys ? this.keys.map(k => T(k.t)) : null; }
    getValue() { return this.v; }
    getValueAtKey(t) { const k = this.keys && this.keys.find(x => x.t === t._t); if (!k) throw new Error('no key'); return k.v; }
    setValue(v) { if (this.keys) throw new Error('setValue on animated'); this.v = v; }
    setColorValue(a, r, g, b) { this.v = [a, r, g, b]; }
    getColorValue() { if (Array.isArray(this.v) && this.v.length === 4) return this.v; throw new Error('not a colour'); }
    getValueAtTime(t) {
      if (!this.keys || !this.keys.length) return this.v;
      const x = t._t, ks = this.keys;
      if (x <= ks[0].t) return ks[0].v;
      if (x >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
      for (let i = 0; i < ks.length - 1; i++) if (x >= ks[i].t && x <= ks[i + 1].t) {
        const u = (x - ks[i].t) / (ks[i + 1].t - ks[i].t), a = ks[i].v, b = ks[i + 1].v;
        if (typeof a === 'number') return a + (b - a) * u;
        if (Array.isArray(a)) return a.map((q, j) => q + (b[j] - q) * u);
        return a;
      }
    }
  }
  const coll = arr => { const c = arr.slice(); Object.defineProperty(c, 'numItems', { get: () => c.length }); return c; };
  // Display names of the parameters, as Premiere (English) shows them.
  const PARAM_NAMES = {
    'AE.ADBE Geometry2': ['Anchor Point', 'Position', 'Uniform Scale', 'Scale Height', 'Scale Width', 'Skew', 'Skew Axis', 'Rotation', 'Opacity', 'Use Composition\'s Shutter Angle', 'Shutter Angle', 'Sampling'],
    'AE.ADBE Gaussian Blur 2': ['Blurriness', 'Blur Dimensions', 'Repeat Edge Pixels'],
    'AE.ADBE Motion Blur': ['Direction', 'Blur Length'],
    'AE.ADBE Brightness & Contrast 2': ['Brightness', 'Contrast'],
    'AE.ADBE Offset': ['Shift Center To', 'Blend With Original'],
    'AE.ADBE Wave Warp': ['Wave Type', 'Wave Height', 'Wave Width', 'Direction', 'Wave Speed', 'Pinning', 'Phase', 'Antialiasing'],
    'AE.ADBE Lens Distortion': ['Curvature', 'Vertical Decentering', 'Horizontal Decentering'],
    'AE.ADBE Tint': ['Map Black To', 'Map White To', 'Amount to Tint'],
    'Internal Volume Stereo': ['Bypass', 'Level'],
    'AE.ADBE Echo': ['Echo Time (seconds)', 'Number Of Echoes', 'Starting Intensity', 'Decay', 'Echo Operator'],
    // Lumetri : la LUT d'entrée personnalisée est le champ sans nom deux crans après « Basic Correction ».
    'AE.ADBE Lumetri': ['High Dynamic Range', 'Basic Correction', ' ', ' ', ' ', 'Input LUT', 'Input LUT', 'Intensity', 'Temperature']
  };
  let removable = true;
  let secondsOnly = false;
  let speedPercent = false;
  function comp(matchName, displayName, values, owner) {
    const names = PARAM_NAMES[matchName] || [];
    const c = { matchName, displayName, properties: coll(values.map((v, i) => new Param(names[i] || displayName + ' p' + i, v))) };
    if (owner && removable) c.remove = function () { owner.components.splice(owner.components.indexOf(c), 1); };
    return c;
  }

  class Item {
    constructor(seq, pi, start, end, inP, name) {
      this.seq = seq; this.projectItem = pi; this._s = start; this._e = end; this._in = inP; this._speed = 1;
      this._out = inP + (end - start); this.name = name || pi.name; this.nodeId = nid(); this.mediaType = 'Video';
      this.components = coll([comp('AE.ADBE Opacity', 'Opacity', [100, 0]), comp('AE.ADBE Motion', 'Motion', [[0.5, 0.5], 100, 100, true, 0, [0.5, 0.5], 0])]);
      this.selected = false;
      this.disabled = false;
    }
    get start() { return T(this._s); } set start(t) { const d = val(t) - this._s; this._s += d; this._in += d * this._speed; }
    get end() { return T(this._e); } set end(t) { const d = val(t) - this._e; this._e += d; this._out += d * this._speed; }
    get inPoint() { return T(this._in); } set inPoint(t) { this._in = val(t); this._e = this._s + (this._out - this._in) / this._speed; }
    get outPoint() { return T(this._out); } set outPoint(t) { this._out = val(t); this._e = this._s + (this._out - this._in) / this._speed; }
    getSpeed() { return this._speed; }
    isSpeedReversed() { return false; }
    setSelected(b) { this.selected = b; }
    remove() { this.track.items.splice(this.track.items.indexOf(this), 1); }
    move(t) { const d = val(t); this._s += d; this._e += d; }
    getMGTComponent() { return this._mgt || null; }
  }

  class Track {
    constructor(seq, i) { this.seq = seq; this.i = i; this.items = []; }
    get clips() { const c = coll(this.items.slice().sort((a, b) => a._s - b._s)); return c; }
    isLocked() { return false; }
    add(it) { it.track = this; this.items.push(it); return it; }
    overwriteClip(pi, t) {
      // secondsOnly : un Premiere qui n'accepte que des secondes et lit un objet Time comme 0.
      const a = secondsOnly ? (typeof t === 'number' ? t * TICKS : 0) : val(t), dur = pi._outP - pi._inP;
      const b = a + dur;
      // overwrite: trim/remove anything under [a, b]
      this.items.slice().forEach(x => { if (x._s < b && a < x._e) throw new Error('sim: overwrite over an existing clip on V' + (this.i + 1)); });
      this.add(new Item(this.seq, pi, a, b, pi._inP, pi.name));
    }
  }

  const project = {
    rootItem: null, activeSequence: null
  };
  const parents = new Map();
  let subclipCalls = 0;
  function projItem(name, type, dur) {
    const me = {
      name, type, nodeId: nid(), _inP: 0, _outP: dur, _dur: dur, children: coll([]),
      createSubClip(n, t0, t1, hard, takeVideo, takeAudio) {
        subclipCalls++;
        const sub = projItem(n, 1, val(t1) - val(t0));
        sub.path = me.path;
        sub.videoOnly = takeVideo && !takeAudio;
        sub.audioOnly = !takeVideo && takeAudio;
        sub.master = me;
        const parent = parents.get(me) || root;
        parent.children.push(sub); parents.set(sub, parent);
        return sub;
      },
      moveBin(b) {
        const parent = parents.get(me) || (root.children.includes(me) ? root : null);
        if (parent) parent.children.splice(parent.children.indexOf(me), 1);
        b.children.push(me); parents.set(me, b);
      },
      createBin(n) { const b = projItem(n, 2, 0); me.children.push(b); parents.set(b, me); return b; },
      getMediaPath() { return me.path || ''; },
      canProxy() { return me.type === 1 && /\.(mov|mp4)$/i.test(me.path || ''); },
      hasProxy() { return !!me.proxy; },
      attachProxy(p) { me.proxy = p; return true; },
      setInPoint(s) { this._inP = s * TICKS; }, setOutPoint(s) { this._outP = s * TICKS; },
      getInPoint() { return T(this._inP); }, getOutPoint() { return T(this._outP); },
      clearInPoint() { this._inP = 0; }, clearOutPoint() { this._outP = this._dur; }
    };
    return me;
  }
  const root = projItem('root', 3, 0);
  const bin = projItem('Footage', 2, 0);
  const media = projItem('A001.mov', 1, 400 * F);
  const media2 = projItem('B002.mov', 1, 400 * F);
  const song = projItem('song.wav', 1, 3000 * F);
  media.path = '/rushs/A001.mov'; media2.path = '/rushs/B002.mov'; song.path = '/music/song.wav';
  const adj = projItem('Calque de réglage', 1, 125 * F);
  root.children.push(bin, adj);
  bin.children.push(media, media2, song);
  [bin, adj].forEach(x => parents.set(x, root));
  [media, media2, song].forEach(x => parents.set(x, bin));
  project.rootItem = root;

  const seq = {
    name: 'Seq 01', timebase: String(F), frameSizeHorizontal: 1920, frameSizeVertical: 1080,
    _ph: 0, videoTracks: null,
    getPlayerPosition() { return T(this._ph); },
    setPlayerPosition(t) { this._ph = Number(t); },
    getSelection() { const out = []; this.videoTracks.concat(this.audioTracks).forEach(t => t.items.forEach(i => { if (i.selected) out.push(i); })); return out; },
    getSettings() { return { videoFrameRate: T(F), videoDisplayFormat: 101, videoFrameWidth: this.frameSizeHorizontal, videoFrameHeight: this.frameSizeVertical }; },
    setSettings(st) { this.frameSizeHorizontal = st.videoFrameWidth; this.frameSizeVertical = st.videoFrameHeight; },
    sequenceID: 'seq-1',
    projectItem: null,
    // Copie de la séquence (pistes, plans, effets), ajoutée au projet.
    clone() {
      const ns = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this));
      ns.name = this.name + ' Copy'; ns.sequenceID = 'seq-' + nid(); ns._markers = this._markers.slice();
      ns.projectItem = seqItem(ns);
      const copyTracks = list => { const out = coll(list.map((t, i) => { const nt = new Track(ns, i); t.items.forEach(it => { const c = Object.assign(Object.create(Object.getPrototypeOf(it)), it); c.nodeId = nid(); c.seq = ns; c.components = coll(it.components.map(cm => comp(cm.matchName, cm.displayName, cm.properties.map(p => JSON.parse(JSON.stringify(p.v))), c))); nt.add(c); }); return nt; })); Object.defineProperty(out, 'numTracks', { get: () => out.length }); return out; };
      ns.videoTracks = copyTracks(this.videoTracks); ns.audioTracks = copyTracks(this.audioTracks);
      sequences.push(ns);
      return true;
    },
    _markers: [],
    // Les tests posent des nombres (ticks) ; createMarker ajoute des objets marqueur.
    get markers() {
      const self = this;
      self._markers = self._markers.map(x => (typeof x === 'number' ? { _t: x, name: '' } : x));
      self._markers.forEach(m => { m.start = T(m._t); });
      const sorted = () => self._markers.slice().sort((x, y) => x._t - y._t);
      return {
        get numMarkers() { return self._markers.length; },
        getFirstMarker: () => sorted()[0] || null,
        getNextMarker: m => { const l = sorted(); return l[l.indexOf(m) + 1] || null; },
        createMarker(sec) { const m = { _t: Math.round(sec * TICKS), name: '', start: T(Math.round(sec * TICKS)), setColorByIndex(c) { this.color = c; } }; self._markers.push(m); return m; },
        deleteMarker(m) { self._markers.splice(self._markers.indexOf(m), 1); }
      };
    },
    importMGT(path, ticks, vIdx) {
      const pi = projItem(path.split('/').pop(), 1, 250 * F);
      const a = Number(ticks), tr = this.videoTracks[vIdx];
      tr.items.slice().forEach(x => { if (x._s < a + 250 * F && a < x._e) throw new Error('sim: importMGT over a clip'); });
      const it = tr.add(new Item(this, pi, a, a + 250 * F, 0, 'Graphic'));
      it._mgt = { properties: coll(mgtProps ? mgtProps() : [new Param('Source Text', '{"textEditValue":"Title","fontSize":40}'), new Param('Position', [0.5, 0.5])]) };
      mgtCalls.push(path);
      return it;
    },
    unlinkSelection() { this._unlinked = true; }
  };
  // Élément du panneau Projet d'une séquence (même nom qu'elle, rangé à la racine).
  function seqItem(sq) {
    const pi = projItem(sq.name, 1, 0);
    pi.isSequence = () => true;
    Object.defineProperty(pi, 'name', { get: () => sq.name, set: v => { sq.name = v; } });
    root.children.push(pi); parents.set(pi, root);
    return pi;
  }
  seq.projectItem = seqItem(seq);
  seq.videoTracks = coll([new Track(seq, 0), new Track(seq, 1), new Track(seq, 2)]);
  seq.audioTracks = coll([new Track(seq, 0), new Track(seq, 1)]);
  Object.defineProperty(seq.audioTracks, 'numTracks', { get: () => seq.audioTracks.length });
  Object.defineProperty(seq.videoTracks, 'numTracks', { get: () => seq.videoTracks.length });
  project.activeSequence = seq;
  const sequences = coll([seq]);
  Object.defineProperty(sequences, 'numSequences', { get: () => sequences.length });
  project.sequences = sequences;
  project.deleteSequence = sq => { const i = sequences.indexOf(sq); if (i < 0) return false; sequences.splice(i, 1); return true; };
  project.openSequence = id => { const f = sequences.find(x => x.sequenceID === id); if (f) project.activeSequence = f; return !!f; };

  // ---------------- QE
  function qeItem(it) {
    return {
      type: 'Clip', start: { ticks: String(it._s) }, name: it.name,
      addVideoEffect(eff) { const [mn, vals] = EFFECTS[eff.name]; it.components.push(comp(mn, eff.name, JSON.parse(JSON.stringify(vals)), it)); },
      addAudioEffect(eff) { it.components.push(comp('AE.ADBE ' + eff.name, eff.name, [0], it)); },
      setSpeed(v) {
        if (speedPercent) v = v / 100;
        // factor semantics; non-ripple: keep start, clamp end to next clip
        const ins = it._in, srcDur = it._out - it._in;
        it._speed = v;
        let e = it._s + srcDur / v;
        const next = it.track.items.filter(x => x !== it && x._s >= it._s).sort((a, b) => a._s - b._s)[0];
        if (next && e > next._s) e = next._s;
        it._e = e; it._out = ins + (e - it._s) * v;
      }
    };
  }
  function qeTrack(tr) {
    const items = tr.items.slice().sort((a, b) => a._s - b._s);
    const list = [];
    let cur = 0;
    items.forEach(x => { if (x._s > cur) list.push({ type: 'Empty', start: { ticks: String(cur) } }); list.push(qeItem(x)); cur = x._e; });
    return {
      numItems: list.length, getItemAt: k => list[k],
      razor(tc) {
        const t = Number(String(tc).slice(1));
        const it = tr.items.find(x => x._s < t && t < x._e);
        if (!it) return;
        const b = new Item(seq, it.projectItem, t, it._e, it._in + (t - it._s) * it._speed, it.name);
        b._speed = it._speed; b._out = it._out; b.mediaType = it.mediaType;
        it._out = it._in + (t - it._s) * it._speed; it._e = t;
        tr.add(b);
      }
    };
  }
  const frames = [], mgtCalls = [];
  let mgtProps = null;
  let projectSelection = null;
  const qe = {
    project: {
      getActiveSequence() {
        return {
          exportFramePNG(tc, path) { frames.push([Number(String(tc).slice(1)), path]); },
          getAudioTrackAt(i) { return qeTrack(project.activeSequence.audioTracks[i]); },
          getVideoTrackAt(i) { return qeTrack(project.activeSequence.videoTracks[i]); },
          _unused(i) {
            const tr = seq.videoTracks[i];
            const items = tr.items.slice().sort((a, b) => a._s - b._s);
            const list = [];
            let cur = 0;
            items.forEach(x => { if (x._s > cur) list.push({ type: 'Empty', start: { ticks: String(cur) } }); list.push(qeItem(x)); cur = x._e; });
            return {
              numItems: list.length, getItemAt: k => list[k],
              razor(tc) {
                const t = Number(String(tc).slice(1));
                const it = tr.items.find(x => x._s < t && t < x._e);
                if (!it) return;
                const b = new Item(seq, it.projectItem, t, it._e, it._in + (t - it._s) * it._speed, it.name);
                b._speed = it._speed; b._out = it._out;
                it._out = it._in + (t - it._s) * it._speed; it._e = t;
                tr.add(b);
              }
            };
          },
          // Insère n pistes vidéo à l'index donné (les pistes au-dessus remontent).
          addTracks(n, idx, na) {
            const sq = project.activeSequence;
            for (let k = 0; k < n; k++) sq.videoTracks.splice(idx === undefined ? sq.videoTracks.length : idx, 0, new Track(sq, 0));
            sq.videoTracks.forEach((t, i) => { t.i = i; });
            for (let k = 0; k < (na || 0); k++) sq.audioTracks.push(new Track(sq, sq.audioTracks.length));
          }
        };
      },
      getVideoEffectByName(n) { return EFFECTS[n] ? { name: n } : null; },
      getAudioEffectByName(n) { return n === 'DeNoise' ? { name: n } : null; },
      getVideoEffectList() { return Object.keys(EFFECTS); }
    }
  };
  const imports = [];
  project.importFiles = (paths, suppress, targetBin, stills) => {
    imports.push({ paths, stills: !!stills });
    paths.forEach(p => {
      // Séquence d'images : 50 images, cadence imposée ensuite par setOverrideFrameRate.
      const it = projItem(p.split('/').pop(), 1, stills ? 50 * F : /\.(png|jpg)$/i.test(p) ? 125 * F : 60 * F);
      it.path = p;
      if (stills) it.setOverrideFrameRate = r => { it.fps = r; };
      targetBin.children.push(it); parents.set(it, targetBin);
    });
    return true;
  };
  // Media Encoder : les jobs restent en file jusqu'à encoder.finish() (fin de chaque job).
  const encoder = {
    jobs: [], started: false, cb: null,
    launchEncoder() { return true; },
    bind(ev, fn) { if (ev === 'onEncoderJobComplete') this.cb = fn; },
    encodeProjectItem(pi, out, preset) { const id = String(this.jobs.length + 1); this.jobs.push({ id, pi, out, preset }); return id; },
    startBatch() { this.started = true; },
    finish() { this.jobs.forEach(j => this.cb && this.cb(j.id, j.out)); }
  };
  // Dossiers (ExtendScript Folder) : ceux créés par le test, et les préréglages de proxy.
  const folders = new Set(['/Applications/Adobe Premiere Pro 2025/Contents/Settings/IngestPresets/Proxy']);
  const folderFiles = { '/Applications/Adobe Premiere Pro 2025/Contents/Settings/IngestPresets/Proxy': ['H.264%20Low%20Resolution%20Proxy.epr', 'ProRes%20Low%20Resolution%20Proxy.epr'] };
  class Folder {
    constructor(p) { this.fsName = p; }
    get exists() { return folders.has(this.fsName); }
    create() { folders.add(this.fsName); return true; }
    getFiles() { return (folderFiles[this.fsName] || []).map(n => ({ name: n, fsName: this.fsName + '/' + decodeURI(n) })); }
  }
  project.name = 'Projet test.prproj';
  project.path = '/projets/Projet test.prproj';
  let proxiesOn = 0;
  const app = { project, encoder, setEnableProxies(v) { proxiesOn = v; return true; }, getEnableProxies() { return proxiesOn; }, version: '25.6.0', path: '/Applications/Adobe Premiere Pro 2025', enableQE() {}, getCurrentProjectViewSelection() { return projectSelection || [adj]; } };

  const ctx = vm.createContext({ app, qe, Time, Folder });
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'plugin', 'jsx', 'host.jsx'), 'utf8'), ctx);
  // Élément audio avec son réglage de volume (Niveau 0,1778 = 0 dB).
  const audioItem = (sq, pi, a, b, inP, name) => {
    const it = new Item(sq, pi, a, b, inP, name);
    it.mediaType = 'Audio';
    it.components = coll([comp('Internal Volume Stereo', 'Volume', [false, Math.pow(10, -15 / 20)], it)]);
    return it;
  };
  return { ctx, encoder, folders, seq, F, media, media2, adj, Item, audioItem, setRemovable: v => { removable = v; }, setSecondsOnly: v => { secondsOnly = v; }, setSpeedPercent: v => { speedPercent = v; }, setProjectSelection: l => { projectSelection = l; }, frames, mgtCalls, setMgtProps: f => { mgtProps = f; }, song, projItem, imports, Param, subclipCalls: () => subclipCalls, root, bin, setParamNames: (mn, names) => { PARAM_NAMES[mn] = names; }, call: (fn, arg) => JSON.parse(vm.runInContext('RRFX.' + fn + '(' + JSON.stringify(JSON.stringify(arg || {})) + ')', ctx)) };
}

module.exports = { makeEnv, TICKS };
