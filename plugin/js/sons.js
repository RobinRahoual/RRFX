/* RR FX : sons fournis (whooshs, impacts, riser, glitch), fabriqués par le plugin lui-même :
   rien à télécharger, aucun droit à gérer. Ils se posent sur les transitions, calés sur la
   coupe (le moment fort du son tombe pile dessus). Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXSons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SR = 48000, TAU = Math.PI * 2;

  function noise(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  }

  // Filtre passe-bande (variable d'état) dont la fréquence peut bouger à chaque échantillon.
  function svf() {
    let lp = 0, bp = 0;
    return (x, freq, q) => {
      const f = 2 * Math.sin(Math.PI * Math.min(0.45, freq / SR));
      const hp = x - lp - bp / q;
      bp += f * hp; lp += f * bp;
      return bp;
    };
  }

  const smooth = t => t * t * (3 - 2 * t);

  // Chaque son : durée (s), instant fort (s, posé sur la coupe), fabrication.
  const SOUNDS = [
    {
      id: 'whoosh', name: 'Whoosh', kind: 'whoosh', dur: 0.9, peak: 0.55,
      make(n) {
        const r = noise(3), f = svf(), x = new Float32Array(n), P = 0.55 * SR;
        for (let i = 0; i < n; i++) {
          const up = i < P ? smooth(i / P) : Math.exp(-(i - P) / (0.12 * SR));
          x[i] = f(r(), 300 + 2600 * up, 1.6) * up * 1.6;
        }
        return x;
      }
    },
    {
      id: 'whoosh-grave', name: 'Whoosh grave', kind: 'whoosh', dur: 1.3, peak: 0.8,
      make(n) {
        const r = noise(5), f = svf(), x = new Float32Array(n), P = 0.8 * SR;
        for (let i = 0; i < n; i++) {
          const up = i < P ? smooth(i / P) : Math.exp(-(i - P) / (0.18 * SR));
          x[i] = f(r(), 120 + 900 * up, 1.2) * up * 2.2 + 0.25 * Math.sin(TAU * (45 + 25 * up) * i / SR) * up;
        }
        return x;
      }
    },
    {
      id: 'swoosh', name: 'Swoosh aigu', kind: 'whoosh', dur: 0.5, peak: 0.3,
      make(n) {
        const r = noise(7), f = svf(), x = new Float32Array(n), P = 0.3 * SR;
        for (let i = 0; i < n; i++) {
          const up = i < P ? smooth(i / P) : Math.exp(-(i - P) / (0.06 * SR));
          x[i] = f(r(), 1500 + 6000 * up, 2.2) * up * 1.3;
        }
        return x;
      }
    },
    {
      id: 'impact', name: 'Impact', kind: 'impact', dur: 2.2, peak: 0,
      make(n) {
        const r = noise(11), lp = svf(), x = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR, fr = 32 + 70 * Math.exp(-t * 9);
          ph += TAU * fr / SR;
          x[i] = Math.sin(ph) * Math.exp(-t * 2.4) * 1.1 + lp(r(), 900 * Math.exp(-t * 5) + 80, 0.8) * Math.exp(-t * 7) * 1.4 + r() * Math.exp(-t * 60) * 0.5;
        }
        return x;
      }
    },
    {
      id: 'hit', name: 'Hit court', kind: 'impact', dur: 0.6, peak: 0,
      make(n) {
        const r = noise(13), f = svf(), x = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          ph += TAU * (60 + 140 * Math.exp(-t * 30)) / SR;
          x[i] = Math.sin(ph) * Math.exp(-t * 9) + f(r(), 2500, 0.9) * Math.exp(-t * 35) * 0.9;
        }
        return x;
      }
    },
    {
      id: 'riser', name: 'Riser', kind: 'riser', dur: 2.6, peak: 2.4,
      make(n) {
        const r = noise(17), f = svf(), x = new Float32Array(n), P = 2.4 * SR;
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const up = i < P ? Math.pow(i / P, 2) : Math.exp(-(i - P) / (0.03 * SR));
          ph += TAU * (180 + 1400 * up) / SR;
          x[i] = (f(r(), 400 + 7000 * up, 2.5) * 1.2 + 0.35 * Math.sin(ph)) * up;
        }
        return x;
      }
    },
    {
      id: 'glitch', name: 'Glitch', kind: 'glitch', dur: 0.45, peak: 0.05,
      make(n) {
        const r = noise(19), x = new Float32Array(n);
        let hold = 0, v = 0, period = 40;
        for (let i = 0; i < n; i++) {
          if (--hold <= 0) { hold = Math.floor(400 + (r() + 1) * 1200); period = Math.floor(8 + (r() + 1) * 60); v = r() > 0.3 ? 0.7 : 0; }
          x[i] = v * ((i % period) < period / 2 ? 1 : -1) * Math.exp(-i / n * 2.5);
        }
        return x;
      }
    }
  ];
  const byId = id => SOUNDS.find(s => s.id === id) || null;

  // Échantillons d'un son, crête ramenée à -3 dBFS, petits fondus aux bords.
  function render(id) {
    const s = byId(id);
    if (!s) throw new Error('Son inconnu : ' + id);
    const n = Math.round(s.dur * SR), x = s.make(n), fade = Math.round(0.004 * SR), hard = s.kind === 'impact';
    // Fondus aux bords (pas de clic), sauf l'attaque des impacts ; puis crête à -3 dBFS.
    for (let i = 0; i < n; i++) x[i] *= Math.min(1, hard ? Infinity : i / fade, (n - 1 - i) / fade);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    const k = peak > 0 ? 0.708 / peak : 1;
    for (let i = 0; i < n; i++) x[i] *= k;
    return x;
  }

  // WAV 16 bits mono.
  function wav(x) {
    const data = new Uint8Array(44 + x.length * 2), v = new DataView(data.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) data[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), true);
    return data;
  }

  /* Sons à poser pour une liste de coupes (secondes) : [{ id, times }], chaque son avancé de
     son instant fort. choice : 'whoosh', 'impact', 'mix' (whooshs variés, impact sur les
     coupes marquées fortes), ou l'id d'un son. strong : indices des coupes fortes (drops). */
  function plan(cuts, choice, strong) {
    const out = new Map(), hard = new Set(strong || []);
    const whooshs = SOUNDS.filter(s => s.kind === 'whoosh');
    cuts.forEach((t, i) => {
      let s;
      if (choice === 'mix') s = hard.has(i) ? byId('impact') : whooshs[i % whooshs.length];
      else if (choice === 'whoosh') s = byId('whoosh');
      else if (choice === 'impact') s = byId('hit');
      else s = byId(choice);
      if (!s) return;
      const at = Math.max(0, t - s.peak);
      if (!out.has(s.id)) out.set(s.id, []);
      out.get(s.id).push(Math.round(at * 1000) / 1000);
    });
    return Array.from(out, ([id, times]) => ({ id, times }));
  }

  return { SR, SOUNDS, byId, render, wav, plan };
});
