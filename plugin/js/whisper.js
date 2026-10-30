/* RR FX : transcription par Whisper (outil gratuit, sur ton ordinateur), calculs sans DOM (testés
   sous Node). Deux outils reconnus :
   - whisper.cpp (whisper-cli, rapide, sans Python) avec un modèle ggml téléchargé par RR FX ;
   - openai-whisper (commande « whisper », Python).
   Ce module lit leur résultat JSON (un horodatage par mot), en fait des sous-titres propres, et
   trouve les « euh » et les répétitions au mot près. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXWhisper = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Modèles de whisper.cpp : nom, taille, adresse (Hugging Face, dépôt de whisper.cpp).
  const MODELS = [
    { id: 'base', mb: 148, label: 'Base (148 Mo, rapide)' },
    { id: 'small', mb: 488, label: 'Small (488 Mo, plus juste)' },
    { id: 'medium', mb: 1530, label: 'Medium (1,5 Go, le plus juste, lent)' }
  ];
  const modelUrl = id => 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-' + id + '.bin';
  const modelFile = id => 'ggml-' + id + '.bin';
  // Les noms de l'outil, du plus rapide au plus courant.
  const TOOLS = ['whisper-cli', 'whisper-cpp', 'whisper'];
  const isCpp = exe => !/(^|[\\/])whisper(\.exe)?$/i.test(String(exe || ''));

  /* Début de transcription donné à Whisper : il recopie le style, donc il garde les « euh » au
     lieu de les effacer (Whisper nettoie sinon les hésitations). */
  const PROMPTS = {
    fr: 'Euh, alors, hum, je pense que, euh, on va voir. Bon, euh, voilà.',
    en: 'Umm, let me think, like, hmm... Okay, uh, here\'s what I, um, think.'
  };

  const bare = w => String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']+/g, '');
  // Hésitations (français et anglais). « ben », « bah » restent : ce sont parfois de vrais mots.
  const FILLER = /^(e+u+h+m*|h?e+u+h+|heu+|hu+m+|h+m+|m+h+|mm+|u+m+|u+h+m*|e+r+m+|e+h+m+|a+h+m+)$/;

  /* Le JSON de whisper.cpp (-ojf : tokens horodatés en ms) ou d'openai-whisper (--word_timestamps :
     segments[].words) → [{ text, start, end }] en secondes, un élément par mot. */
  function parse(json) {
    const out = [];
    if (json && Array.isArray(json.transcription)) {
      json.transcription.forEach(seg => {
        const toks = Array.isArray(seg.tokens) ? seg.tokens : [];
        if (!toks.length && seg.text) {
          // Pas de détail par mot : le segment partagé au prorata des lettres.
          spread(seg.text, (seg.offsets.from || 0) / 1000, (seg.offsets.to || 0) / 1000).forEach(w => out.push(w));
          return;
        }
        toks.forEach(t => {
          const text = String(t.text || '');
          if (!text || /^\s*\[_/.test(text) || /^\s*<\|/.test(text)) return;
          const a = ((t.offsets && t.offsets.from) || 0) / 1000, b = ((t.offsets && t.offsets.to) || 0) / 1000;
          const last = out[out.length - 1];
          // Un morceau sans espace devant continue le mot (« bon » + « jour »), la ponctuation aussi.
          if (last && !/^\s/.test(text)) { last.text += text; last.end = Math.max(last.end, b); return; }
          if (!text.trim()) return;
          out.push({ text: text.trim(), start: a, end: Math.max(a, b) });
        });
      });
    } else if (json && Array.isArray(json.segments)) {
      json.segments.forEach(seg => {
        if (Array.isArray(seg.words) && seg.words.length) {
          seg.words.forEach(w => { const text = String(w.word || w.text || '').trim(); if (text) out.push({ text, start: +w.start || 0, end: +w.end || +w.start || 0 }); });
        } else if (seg.text) spread(seg.text, +seg.start || 0, +seg.end || 0).forEach(w => out.push(w));
      });
    }
    return out.filter(w => w.end >= w.start).sort((p, q) => p.start - q.start);
  }
  function spread(text, a, b) {
    const words = String(text).trim().split(/\s+/).filter(Boolean), len = words.reduce((s, w) => s + w.length + 1, 0) || 1;
    let t = a;
    return words.map(w => { const d = (b - a) * (w.length + 1) / len, r = { text: w, start: t, end: t + d }; t += d; return r; });
  }

  /* Mots → sous-titres : une phrase par sous-titre, coupée sur la ponctuation, un blanc
     (gap s), ou quand elle dépasse maxChars caractères ou maxDur s. Les « euh » sont retirés du
     texte (mais pas du son). → [{ start, end, text }] */
  function cues(words, opts) {
    const o = Object.assign({ maxChars: 80, maxDur: 6, gap: 0.7, fillers: false }, opts || {});
    const out = [];
    let cur = null;
    const flush = () => { if (cur && cur.words.length) out.push({ start: cur.start, end: cur.end, text: tidy(cur.words.join(' ')) }); cur = null; };
    words.forEach((w, i) => {
      const prev = words[i - 1];
      if (cur && prev && w.start - prev.end >= o.gap) flush();
      if (!o.fillers && FILLER.test(bare(w.text))) return;
      if (cur && (cur.len + w.text.length + 1 > o.maxChars || w.end - cur.start > o.maxDur)) flush();
      if (!cur) cur = { start: w.start, end: w.end, words: [], len: 0 };
      cur.words.push(w.text);
      cur.len += w.text.length + 1;
      cur.end = w.end;
      if (/[.?!…]["»”]?$/.test(w.text)) flush();
    });
    flush();
    return out.filter(c => c.text);
  }
  // Ponctuation collée par Whisper (« mot , ») et majuscule en début de sous-titre.
  function tidy(t) {
    const s = t.replace(/\s+([,.…])/g, '$1').replace(/\s+/g, ' ').trim().replace(/^[,;:]\s*/, '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* Les « euh » et « hum » de la transcription → [{ a, b, text }] (s), avec une petite marge
     (pad) prise sur les blancs autour, sans mordre sur les mots voisins. */
  function fillers(words, pad) {
    const p = pad === undefined ? 0.05 : pad, out = [];
    words.forEach((w, i) => {
      if (!FILLER.test(bare(w.text))) return;
      const before = words[i - 1], after = words[i + 1];
      out.push({ a: Math.max(before ? before.end : 0, w.start - p), b: Math.min(after ? after.start : Infinity, w.end + p), text: w.text });
    });
    return out;
  }

  /* Répétitions immédiates d'1 à 3 mots (« on va, on va ») → la première occurrence à couper,
     au mot près : [{ a, b, text, exact: true }]. Les « euh » entre les deux ne comptent pas. */
  function repeats(words) {
    const w = words.filter(x => !FILLER.test(bare(x.text))), out = [];
    for (let i = 0; i < w.length; i++) {
      for (let n = 3; n >= 1; n--) {
        if (i + 2 * n > w.length) continue;
        let same = true;
        for (let k = 0; k < n && same; k++) same = bare(w[i + k].text) === bare(w[i + n + k].text) && bare(w[i + k].text) !== '';
        // Un mot d'une lettre répété (« a a ») est souvent voulu : seulement à partir de 2 lettres.
        if (!same || (n === 1 && bare(w[i].text).length < 2)) continue;
        // Les deux occurrences proches (moins de 2 s entre elles).
        if (w[i + n].start - w[i + n - 1].end > 2) continue;
        out.push({ a: w[i].start, b: w[i + n].start, text: w.slice(i, i + n).map(x => x.text).join(' '), exact: true });
        i += n - 1;
        break;
      }
    }
    return out;
  }

  // Arguments de la commande. o : { model, wav, lang ('auto', 'fr'…), out (sans extension), threads, prompt, dir }.
  function args(exe, o) {
    if (isCpp(exe)) {
      const a = ['-m', o.model, '-f', o.wav, '-ojf', '-of', o.out, '-pp', '-l', o.lang || 'auto'];
      if (o.threads) a.push('-t', String(o.threads));
      if (o.prompt) a.push('--prompt', o.prompt);
      return a;
    }
    const a = [o.wav, '--model', o.size || 'base', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', o.dir, '--verbose', 'True'];
    if (o.lang && o.lang !== 'auto') a.push('--language', o.lang);
    if (o.prompt) a.push('--initial_prompt', o.prompt);
    return a;
  }
  // Avancement lu dans la sortie de l'outil (0 à 1), ou null. dur : durée du son (s).
  function progressOf(line, dur) {
    let m = /progress\s*=\s*(\d+)\s*%/.exec(line);
    if (m) return Math.min(1, +m[1] / 100);
    m = /\[(\d+):(\d+)(?::(\d+))?\.(\d+)\s*-->\s*(\d+):(\d+)(?::(\d+))?\.(\d+)\]/.exec(line);
    if (m && dur) {
      const end = m[7] !== undefined ? (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) : (+m[5]) * 60 + (+m[6]);
      return Math.min(1, end / dur);
    }
    return null;
  }

  /* Son pour Whisper : mono 16 kHz (moyenne des échantillons de chaque pas, assez pour la voix). */
  function to16k(samples, sr) {
    if (sr === 16000) return Float32Array.from(samples);
    const k = sr / 16000, n = Math.floor(samples.length / k), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * k), b = Math.max(a + 1, Math.floor((i + 1) * k));
      let s = 0;
      for (let j = a; j < b && j < samples.length; j++) s += samples[j];
      out[i] = s / (b - a);
    }
    return out;
  }

  return { MODELS, TOOLS, PROMPTS, FILLER, modelUrl, modelFile, isCpp, parse, cues, fillers, repeats, args, progressOf, to16k, bare };
});
