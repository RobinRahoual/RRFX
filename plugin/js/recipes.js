/* RR FX : styles de montage. Une recette = tout ce qu'il faut pour un style : clip musical,
   Reels / TikTok, vidéo d'entreprise, interview, aftermovie, mariage, YouTube… Temps forts à
   suivre, rythme des plans, effets enchaînés, look, sons sur les transitions, textes, et les
   étapes à enchaîner. Le mode Express les applique en un clic. Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXRecipes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  /* chain : clés des effets (b: effet intégré, p: overlay fourni), dans l'ordre d'enchaînement.
     beats : détection des temps forts ; cut : un plan tous les N temps ; sfx : son des
     transitions (voir sons.js) ; title : animation des textes ;
     place : où vont les effets (markers : temps forts de la musique ; allcuts : toutes les
     coupes de la séquence) ; steps : étapes proposées (true : cochée par défaut) ;
     captions.words : mots par sous-titre (0 : phrase entière) ; format : copie au format réseau. */
  const CLIP_STEPS = { beats: true, montage: true, convert: true, fix: false, look: true, effects: true, sfx: true, titles: true, format: false };
  const RECIPES = [
    {
      id: 'reels', place: 'markers', name: _T('Reels dynamique'), desc: _T('Coupes sur le son, zooms traversants et pushs, sous-titres mot par mot, version 9:16.'),
      steps: { beats: true, montage: true, convert: true, look: true, effects: true, sfx: true, captions: false, format: true },
      chain: ['b:zoom-through', 'b:push', 'b:pop-in', 'b:flash-glow'], order: 'cycle', frames: 6, intensity: 100,
      look: 'Punchy', beats: { mode: 'hits', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'swoosh', title: 'pop',
      captions: { words: 1 }, format: { id: '9x16', mode: 'reframe' }
    },
    {
      id: 'facecam', place: 'allcuts', name: 'Face cam / UGC', desc: _T('Silences coupés, zoom un plan sur deux, transitions courtes, sous-titres 3 mots, 9:16.'),
      steps: { silences: true, fix: true, look: true, punch: true, effects: true, sfx: true, captions: true, format: true },
      chain: ['b:zoom-smooth', 'b:push'], order: 'cycle', frames: 5, intensity: 90,
      look: 'Punchy', beats: { mode: 'tempo', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'swoosh', title: 'pop',
      captions: { words: 3 }, format: { id: '9x16', mode: 'reframe' }
    },
    {
      id: 'youtube', place: 'allcuts', name: 'YouTube face cam', desc: _T('Silences coupés, zoom un plan sur deux, whip pans et whooshs sur les coupes, couleurs punchy.'),
      steps: { silences: true, fix: true, look: true, punch: true, effects: true, sfx: true, captions: false, lower: false },
      chain: ['b:zoom-smooth', 'b:whip-pan', 'b:push'], order: 'cycle', frames: 6, intensity: 90,
      look: 'Punchy', beats: { mode: 'tempo', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'whoosh', title: 'pop',
      captions: { words: 0 }, format: { id: '9x16', mode: 'reframe' }
    },
    {
      id: 'interview', place: 'allcuts', name: _T('Interview / témoignage'), desc: _T('Blancs retirés, zoom un plan sur deux, fondus doux, bandeau et sous-titres, version verticale sur fond flou.'),
      steps: { silences: true, fix: true, punch: true, effects: true, lower: true, captions: true, format: false },
      chain: ['b:blur-dissolve'], order: 'cycle', frames: 8, intensity: 70,
      look: null, beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'none', title: 'fade',
      captions: { words: 0 }, format: { id: '9x16', mode: 'blur' }
    },
    {
      id: 'corporate', place: 'allcuts', name: _T('Entreprise épuré'), desc: _T('Fondus flous, pushs et zooms doux sur chaque coupe, image propre, bandeau nom et fonction.'),
      steps: { convert: true, fix: true, effects: true, sfx: false, lower: true, captions: false, format: false },
      chain: ['b:blur-dissolve', 'b:push', 'b:zoom-smooth'], order: 'cycle', frames: 12, intensity: 70,
      look: null, beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'whoosh', title: 'slide-up',
      captions: { words: 0 }, format: { id: '4x5', mode: 'blur' }
    },
    {
      id: 'aftermovie', place: 'markers', name: 'Aftermovie', desc: _T('Soirée, festival, séminaire : montage sur la musique, flashs, zooms traversants, leaks dorés.'),
      steps: { beats: true, montage: true, convert: true, fix: true, look: true, effects: true, sfx: true, format: false },
      chain: ['b:flash-white', 'b:zoom-through', 'p:leak-gold', 'b:whip-pan', 'p:flare-warm'], order: 'cycle', frames: 7, intensity: 100,
      look: _T('Été vintage'), beats: { mode: 'hits', every: 2 }, cut: { every: 2, order: 'random', pick: 'random' }, sfx: 'whoosh', title: 'impact',
      format: { id: '9x16', mode: 'reframe' }
    },
    {
      id: 'mariage', place: 'markers', name: _T('Mariage / cérémonie'), desc: _T('Fondus blancs, fondus flous et bokeh, lumière chaude, un plan tous les 4 temps.'),
      steps: { beats: true, montage: true, convert: true, fix: true, look: true, effects: true, sfx: false, format: false },
      chain: ['b:fade-white', 'b:blur-dissolve', 'p:bokeh-warm'], order: 'cycle', frames: 16, intensity: 70,
      look: _T('Film chaud'), beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'none', title: 'fade',
      format: { id: '9x16', mode: 'reframe' }
    },
    {
      id: 'voyage', place: 'markers', steps: CLIP_STEPS, name: _T('Vlog voyage'), desc: _T('Whip pans, flares de soleil, couleurs d\'été.'),
      chain: ['b:whip-pan', 'b:zoom-in', 'p:flare-warm'], order: 'cycle', frames: 8, intensity: 90,
      look: _T('Été vintage'), beats: { mode: 'tempo', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'whoosh', title: 'slide-up'
    },
    {
      id: 'cine', place: 'markers', steps: CLIP_STEPS, name: _T('Cinématique'), desc: _T('Fondus au noir, défocus et motion blur, rythme posé.'),
      chain: ['b:flash-black', 'b:defocus', 'b:echo-blur'], order: 'cycle', frames: 14, intensity: 80,
      look: _T('Ciné désaturé'), beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'whoosh-grave', title: 'blur'
    },
    {
      id: 'rap', place: 'markers', steps: CLIP_STEPS, name: _T('Rap énergique'), desc: _T('Zooms, flashs et basses qui tapent, un plan tous les 2 temps.'),
      chain: ['b:zoom-spin', 'b:flash-white', 'b:shake-bass', 'b:glitch'], order: 'cycle', frames: 6, intensity: 110,
      look: 'Punchy', beats: { mode: 'kicks', every: 2 }, cut: { every: 2, order: 'random', pick: 'random' }, sfx: 'mix', title: 'impact'
    },
    {
      id: 'drill', place: 'markers', steps: CLIP_STEPS, name: _T('Drill sombre'), desc: _T('Secousses, stroboscope et glitch sur un étalonnage nuit.'),
      chain: ['b:shake-impact', 'b:strobe', 'b:glitch', 'b:flash-black'], order: 'random', frames: 5, intensity: 120,
      look: _T('Nuit bleue'), beats: { mode: 'kicks', every: 2 }, cut: { every: 1, order: 'random', pick: 'random' }, sfx: 'impact', title: 'impact'
    },
    {
      id: 'pop', place: 'markers', steps: CLIP_STEPS, name: _T('Pop lumineux'), desc: _T('Glow, zooms doux et light leaks roses, très lumineux.'),
      chain: ['b:flash-glow', 'b:zoom-in', 'b:slide', 'p:leak-pink'], order: 'cycle', frames: 8, intensity: 90,
      look: _T('Clip musical'), beats: { mode: 'hits', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'whoosh', title: 'pop'
    },
    {
      id: 'chill', place: 'markers', steps: CLIP_STEPS, name: 'Chill / lofi', desc: _T('Flous, dézooms lents et lumière chaude, un plan tous les 4 temps.'),
      chain: ['b:defocus', 'b:zoom-out', 'p:leak-warm'], order: 'cycle', frames: 12, intensity: 70,
      look: _T('Film chaud'), beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'none', title: 'fade'
    },
    {
      id: 'retro', place: 'markers', steps: CLIP_STEPS, name: _T('Rétro VHS'), desc: _T('VHS, glitch et vagues, couleurs délavées.'),
      chain: ['p:vhs', 'b:glitch', 'b:wave', 'b:flicker'], order: 'random', frames: 8, intensity: 100,
      look: 'Pastel', beats: { mode: 'snares', every: 2 }, cut: { every: 2, order: 'random', pick: 'random' }, sfx: 'glitch', title: 'impact'
    }
  ];
  const byId = id => RECIPES.find(r => r.id === id) || null;

  /* Recette faite des réglages en cours (enchaînement, look, sons…), pour « Mon style ». */
  function fromSettings(s) {
    const chain = (s.chain && s.chain.keys) || [];
    return {
      id: 'mine', name: _T('Mon style'), desc: chain.length ? chain.length + _T(' effets de ton enchaînement, ton look en cours.') : _T('Compose ton enchaînement dans l\'onglet Effets (Maj + clic).'),
      chain: chain.slice(), order: (s.chain && s.chain.order) || 'cycle', frames: 8, intensity: 100,
      look: null, lookParams: s.color && s.color.params ? s.color.params : null, lookName: (s.color && s.color.name) || _T('Mon look'),
      beats: { mode: (s.beats && s.beats.mode) || 'kicks', every: (s.beats && s.beats.every) || 1 },
      cut: { every: (s.autoEdit && s.autoEdit.every) || 2, order: (s.autoEdit && s.autoEdit.order) || 'sequence', pick: (s.autoEdit && s.autoEdit.pick) || 'random' },
      sfx: s.sfx || 'none', title: (s.titles && s.titles.anim) || 'pop',
      place: 'markers', steps: CLIP_STEPS, captions: { words: (s.speech && s.speech.words) || 0 }, format: { id: (s.formats && s.formats.id) || '9x16', mode: (s.formats && s.formats.mode) || 'reframe' }
    };
  }

  // Les étapes du montage express, dans l'ordre où elles doivent tourner. music : il faut une
  // musique dans la séquence (pour les effets : seulement s'ils suivent les temps forts).
  const STEPS = [
    { id: 'silences', label: _T('Couper les silences'), desc: _T('Les blancs retirés, sur une copie de ta séquence') },
    { id: 'beats', label: _T('Temps forts'), desc: _T('Un marqueur sur chaque temps fort de la musique') },
    { id: 'montage', label: _T('Montage auto'), desc: _T('Tes rushs posés sur le rythme') },
    { id: 'convert', label: _T('Conversion LOG'), desc: _T('Rec.709 avec la LUT de chaque caméra') },
    { id: 'fix', label: _T('Expo et balance auto'), desc: _T('Chaque plan corrigé') },
    { id: 'look', label: 'Look', desc: _T('L\'étalonnage du style sur toute la séquence') },
    { id: 'punch', label: _T('Zoom visage'), desc: _T('Un plan sur deux resserré sur les yeux, qui sont suivis') },
    { id: 'effects', label: _T('Effets'), desc: _T('Les effets du style, enchaînés') },
    { id: 'sfx', label: _T('Sons'), desc: _T('Whooshs et impacts calés sur les transitions') },
    { id: 'titles', label: _T('Paroles'), desc: _T('Les paroles de l\'onglet Textes, une par temps fort') },
    { id: 'captions', label: _T('Sous-titres'), desc: _T('Le .srt de l\'onglet Parole, recalé après la coupe des silences') },
    { id: 'lower', label: _T('Bandeau nom et fonction'), desc: _T('Celui de l\'onglet Parole, au début') },
    { id: 'format', label: _T('Copie format réseau'), desc: _T('Une version verticale ou carrée') }
  ];
  const MUSIC = { beats: true, montage: true, titles: true };
  const needsMusic = (id, r) => !!MUSIC[id] || (id === 'effects' && r.place === 'markers');
  // Étapes proposées par une recette, dans l'ordre d'exécution, avec leur état par défaut.
  const stepsOf = r => STEPS.filter(x => x.id in (r.steps || CLIP_STEPS)).map(x => Object.assign({}, x, { on: !!(r.steps || CLIP_STEPS)[x.id] }));

  return { RECIPES, byId, fromSettings, STEPS, CLIP_STEPS, needsMusic, stepsOf };
});
