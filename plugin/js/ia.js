/* RR FX : ce que l'on demande à l'IA locale (Ollama) et comment on lit ses réponses, sans DOM
   (testé sous Node). Chaque demande donne un schéma JSON : Ollama répond dans ce format, et la
   réponse est vérifiée (même nombre de lignes, index valides…) avant d'être utilisée.
   - traduction et correction des sous-titres, ligne par ligne ;
   - titres des chapitres YouTube ;
   - titre, description et hashtags d'une vidéo ;
   - choix des meilleurs extraits pour les réseaux ;
   - description d'un rush (image) et recherche par le sens (embeddings). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXIA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAMES = {
    fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish',
    ro: 'Romanian', tr: 'Turkish', ar: 'Arabic', ru: 'Russian', uk: 'Ukrainian', zh: 'Chinese (simplified)', ja: 'Japanese',
    ko: 'Korean', hi: 'Hindi', id: 'Indonesian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek', cs: 'Czech'
  };
  const langName = c => NAMES[c] || c || 'French';

  const str = { type: 'string' };
  const arr = items => ({ type: 'array', items });
  const obj = (props, req) => ({ type: 'object', properties: props, required: req || Object.keys(props) });
  const LINES = obj({ lines: arr(str) });

  // Groupes d'indices : au plus max lignes et maxChars caractères par demande.
  function groups(texts, max, maxChars) {
    const out = [];
    let cur = [], n = 0;
    texts.forEach((t, i) => {
      const l = String(t || '').length;
      if (cur.length && (cur.length >= (max || 30) || n + l > (maxChars || 3500))) { out.push(cur); cur = []; n = 0; }
      cur.push(i);
      n += l;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // La réponse { lines: [...] } attendue avec exactement n lignes, sinon null.
  function lines(res, n) {
    const l = res && Array.isArray(res.lines) ? res.lines : null;
    if (!l || l.length !== n) return null;
    return l.map(x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim());
  }

  function translate(texts, from, to) {
    return {
      messages: [
        { role: 'system', content: 'You translate video subtitles from ' + langName(from) + ' to ' + langName(to) + '. Translate every line of "lines" separately, in order, keeping the meaning, the tone and the names. Keep each line short and natural, like a subtitle. Never merge or split lines, never add notes. Answer with JSON {"lines": [...]} holding exactly ' + texts.length + ' translated lines.' },
        { role: 'user', content: JSON.stringify({ lines: texts }) }
      ],
      format: LINES
    };
  }

  function correct(texts, lang) {
    return {
      messages: [
        { role: 'system', content: 'You proofread automatic subtitles written in ' + langName(lang) + '. For every line of "lines": fix spelling, grammar, accents, punctuation and obviously misheard words or names. Do not rephrase, shorten or translate; keep the speaker\'s words and filler style. Never merge or split lines. Answer with JSON {"lines": [...]} holding exactly ' + texts.length + ' lines.' },
        { role: 'user', content: JSON.stringify({ lines: texts }) }
      ],
      format: LINES
    };
  }

  // Temps « 1:05 » ou « 1:02:03 » (comme YouTube).
  function stamp(t) {
    const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + r : String(m).padStart(2, '0') + ':' + r;
  }

  // Texte dit entre a et b (s), d'après des sous-titres [{ start, end, text }], au plus max caractères.
  function textBetween(cues, a, b, max) {
    const t = cues.filter(c => c.end > a && c.start < b).map(c => String(c.text).replace(/\s+/g, ' ').trim()).join(' ');
    return t.length > (max || 1500) ? t.slice(0, max || 1500) + '…' : t;
  }

  /* Titres de chapitres : list [{ t, title }] (le titre actuel est un début de phrase), cues les
     sous-titres de la vidéo. */
  function chapters(list, cues, lang, end) {
    const items = list.map((c, i) => ({ start: stamp(c.t), text: textBetween(cues, c.t, i + 1 < list.length ? list[i + 1].t : (end || Infinity), 1200) }));
    return {
      messages: [
        { role: 'system', content: 'You write YouTube chapter titles in ' + langName(lang) + '. For each chapter, from what is said in it, write a clear and catchy title of 2 to 6 words: no quotes, no numbering, no emoji, no timestamp. The first chapter may be an introduction. Answer with JSON {"titles": [...]} holding exactly ' + items.length + ' titles, in order.' },
        { role: 'user', content: JSON.stringify({ chapters: items }) }
      ],
      format: obj({ titles: arr(str) })
    };
  }
  function chapterTitles(res, list) {
    const t = res && Array.isArray(res.titles) ? res.titles : null;
    if (!t || t.length !== list.length) return null;
    return list.map((c, i) => ({ t: c.t, title: String(t[i] || c.title).replace(/^["«\s]+|["»\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80) || c.title }));
  }
  const chapterText = list => list.map(c => stamp(c.t) + ' ' + c.title).join('\n');

  // Le texte d'une longue vidéo ramené à max caractères : début, milieu et fin gardés.
  function digest(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim(), m = max || 12000;
    if (t.length <= m) return t;
    const part = Math.floor(m / 3);
    return t.slice(0, part) + ' […] ' + t.slice(Math.floor(t.length / 2 - part / 2), Math.floor(t.length / 2 + part / 2)) + ' […] ' + t.slice(-part);
  }

  const PLATFORMS = {
    youtube: 'a YouTube video: titles under 70 characters, a description of 3 short paragraphs that makes people want to watch (first line is the hook), then 5 to 10 hashtags',
    reels: 'a vertical short video (Instagram Reels, TikTok, YouTube Shorts): titles under 50 characters, a caption of 1 to 3 punchy sentences with a call to action, then 5 to 12 hashtags',
    linkedin: 'a LinkedIn video post: professional titles, a post of 3 to 5 short paragraphs with a clear takeaway, then 3 to 5 hashtags'
  };
  function publish(text, lang, platform) {
    return {
      messages: [
        { role: 'system', content: 'You are a social media editor. From the transcript of a video, write in ' + langName(lang) + ' the texts to publish it as ' + (PLATFORMS[platform] || PLATFORMS.youtube) + '. Stay faithful to what is said, no invented facts. Answer with JSON {"titles": [3 title ideas], "description": "...", "hashtags": ["#..."]}.' },
        { role: 'user', content: digest(text) }
      ],
      format: obj({ titles: arr(str), description: str, hashtags: arr(str) })
    };
  }
  function publishResult(res) {
    if (!res || typeof res.description !== 'string') return null;
    const tags = (Array.isArray(res.hashtags) ? res.hashtags : []).map(h => '#' + String(h).replace(/^#+/, '').replace(/[\s#]+/g, '')).filter(h => h.length > 1);
    return { titles: (Array.isArray(res.titles) ? res.titles : []).map(t => String(t).trim()).filter(Boolean).slice(0, 5), description: res.description.trim(), hashtags: Array.from(new Set(tags)).slice(0, 15) };
  }

  /* Extraits : candidats [{ a, b, text }] → les count meilleurs, avec une accroche. */
  function extracts(cands, count, lang) {
    return {
      messages: [
        { role: 'system', content: 'You pick the best clips of a long video for short vertical videos (Reels, TikTok, Shorts). A good clip makes sense on its own, starts with a strong hook, holds one complete idea, and ends cleanly. From the numbered candidates, choose the ' + count + ' best, best first, and give each a short hook title in ' + langName(lang) + ' (under 60 characters). Answer with JSON {"picks": [{"index": n, "title": "..."}]}.' },
        { role: 'user', content: JSON.stringify({ candidates: cands.map((c, i) => ({ index: i, seconds: Math.round(c.b - c.a), text: String(c.text || '').slice(0, 900) })) }) }
      ],
      format: obj({ picks: arr(obj({ index: { type: 'integer' }, title: str })) })
    };
  }
  function picks(res, n, count) {
    const p = res && Array.isArray(res.picks) ? res.picks : [], seen = new Set(), out = [];
    p.forEach(x => {
      const i = Math.round(Number(x && x.index));
      if (i >= 0 && i < n && !seen.has(i) && out.length < count) { seen.add(i); out.push({ index: i, title: String((x && x.title) || '').trim().slice(0, 80) }); }
    });
    return out;
  }

  // Description d'un rush (une image) pour la recherche.
  function describe(lang) {
    return {
      messages: [{ role: 'user', content: 'Describe this video shot in ' + langName(lang) + ' in one sentence: place, subject, action, shot size (close-up, wide shot…), light and mood. Then give up to 8 keywords. Answer with JSON {"description": "...", "keywords": ["..."]}.' }],
      format: obj({ description: str, keywords: arr(str) })
    };
  }
  function description(res) {
    if (!res) return '';
    const d = String(res.description || '').trim(), k = (Array.isArray(res.keywords) ? res.keywords : []).map(x => String(x).trim()).filter(Boolean);
    return (d + (k.length ? ' · ' + k.join(', ') : '')).slice(0, 600);
  }

  // Similarité cosinus de deux vecteurs.
  function cosine(a, b) {
    let s = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? s / Math.sqrt(na * nb) : 0;
  }
  // Les k éléments [{ vec }] les plus proches de q, avec leur score.
  function nearest(q, items, k) {
    return items.filter(x => x.vec && x.vec.length).map(x => ({ item: x, score: cosine(q, x.vec) })).sort((p, r) => r.score - p.score).slice(0, k || 8);
  }

  /* Plans de coupe automatiques : pour chaque phrase [{ start, end, vec }], le rush le plus proche
     au-dessus de min, au plus un plan toutes les every s, sans reprendre un rush avant reuse
     autres. → [{ t, dur, rush, score }] */
  function broll(cues, rushes, o) {
    const x = Object.assign({ min: 0.45, every: 8, maxDur: 4, minDur: 1.5, reuse: 3 }, o || {}), out = [], recent = [];
    let next = -Infinity;
    cues.forEach(c => {
      if (c.start < next || !c.vec) return;
      const best = nearest(c.vec, rushes.filter(r => recent.indexOf(r) < 0), 1)[0];
      if (!best || best.score < x.min) return;
      const dur = Math.max(x.minDur, Math.min(x.maxDur, c.end - c.start));
      out.push({ t: c.start, dur, rush: best.item, score: best.score });
      recent.push(best.item);
      if (recent.length > x.reuse) recent.shift();
      next = c.start + Math.max(dur, x.every);
    });
    return out;
  }

  return { NAMES, langName, groups, lines, translate, correct, stamp, textBetween, chapters, chapterTitles, chapterText, digest, PLATFORMS, publish, publishResult, extracts, picks, describe, description, cosine, nearest, broll };
});
