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
    'Echo': ['AE.ADBE Echo', [-0.033, 1, 1, 1, 1]]
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
    'AE.ADBE Echo': ['Echo Time (seconds)', 'Number Of Echoes', 'Starting Intensity', 'Decay', 'Echo Operator']
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
    }
    get start() { return T(this._s); } set start(t) { const d = val(t) - this._s; this._s += d; this._in += d * this._speed; }
    get end() { return T(this._e); } set end(t) { const d = val(t) - this._e; this._e += d; this._out += d * this._speed; }
    get inPoint() { return T(this._in); } set inPoint(t) { this._in = val(t); this._e = this._s + (this._out - this._in) / this._speed; }
    get outPoint() { return T(this._out); } set outPoint(t) { this._out = val(t); this._e = this._s + (this._out - this._in) / this._speed; }
    getSpeed() { return this._speed; }
    isSpeedReversed() { return false; }
    setSelected(b) { this.selected = b; }
    remove() { this.track.items.splice(this.track.items.indexOf(this), 1); }
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
        sub.videoOnly = takeVideo && !takeAudio;
        const parent = parents.get(me) || root;
        parent.children.push(sub); parents.set(sub, parent);
        return sub;
      },
      moveBin(b) {
        const parent = parents.get(me);
        if (parent) parent.children.splice(parent.children.indexOf(me), 1);
        b.children.push(me); parents.set(me, b);
      },
      createBin(n) { const b = projItem(n, 2, 0); me.children.push(b); parents.set(b, me); return b; },
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
  const adj = projItem('Calque de réglage', 1, 125 * F);
  root.children.push(bin, adj);
  bin.children.push(media, media2);
  [bin, adj].forEach(x => parents.set(x, root));
  [media, media2].forEach(x => parents.set(x, bin));
  project.rootItem = root;

  const seq = {
    name: 'Seq 01', timebase: String(F), frameSizeHorizontal: 1920, frameSizeVertical: 1080,
    _ph: 0, videoTracks: null,
    getPlayerPosition() { return T(this._ph); },
    getSelection() { const out = []; this.videoTracks.forEach(t => t.items.forEach(i => { if (i.selected) out.push(i); })); return out; },
    getSettings() { return { videoFrameRate: T(F), videoDisplayFormat: 101 }; },
    _markers: [],
    get markers() {
      const list = this._markers.slice().sort((a, b) => a - b).map(t => ({ start: T(t) }));
      return { numMarkers: list.length, getFirstMarker: () => list[0] || null, getNextMarker: m => list[list.indexOf(m) + 1] || null };
    },
    unlinkSelection() { this._unlinked = true; }
  };
  seq.videoTracks = coll([new Track(seq, 0), new Track(seq, 1), new Track(seq, 2)]);
  Object.defineProperty(seq.videoTracks, 'numTracks', { get: () => seq.videoTracks.length });
  project.activeSequence = seq;

  // ---------------- QE
  function qeItem(it) {
    return {
      type: 'Clip', start: { ticks: String(it._s) }, name: it.name,
      addVideoEffect(eff) { const [mn, vals] = EFFECTS[eff.name]; it.components.push(comp(mn, eff.name, JSON.parse(JSON.stringify(vals)), it)); },
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
  const qe = {
    project: {
      getActiveSequence() {
        return {
          getVideoTrackAt(i) {
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
          addTracks(n, idx) {
            for (let k = 0; k < n; k++) seq.videoTracks.splice(idx === undefined ? seq.videoTracks.length : idx, 0, new Track(seq, 0));
            seq.videoTracks.forEach((t, i) => { t.i = i; });
          }
        };
      },
      getVideoEffectByName(n) { return EFFECTS[n] ? { name: n } : null; },
      getVideoEffectList() { return Object.keys(EFFECTS); }
    }
  };
  const app = { project, version: '25.6.0', enableQE() {}, getCurrentProjectViewSelection() { return [adj]; } };

  const ctx = vm.createContext({ app, qe, Time });
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'plugin', 'jsx', 'host.jsx'), 'utf8'), ctx);
  return { ctx, seq, F, media, media2, adj, Item, setRemovable: v => { removable = v; }, setSecondsOnly: v => { secondsOnly = v; }, setSpeedPercent: v => { speedPercent = v; }, subclipCalls: () => subclipCalls, root, bin, setParamNames: (mn, names) => { PARAM_NAMES[mn] = names; }, call: (fn, arg) => JSON.parse(vm.runInContext('CutFX.' + fn + '(' + JSON.stringify(JSON.stringify(arg || {})) + ')', ctx)) };
}

module.exports = { makeEnv, TICKS };
