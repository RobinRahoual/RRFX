/* RR FX : styles de clip. Une recette = tout ce qu'il faut pour un style de clip musical :
   temps forts à suivre, rythme des plans, effets enchaînés, look, sons sur les transitions,
   animation des paroles. Le mode Express les applique en un clic. Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXRecipes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* chain : clés des effets (b: effet intégré, p: overlay fourni), dans l'ordre d'enchaînement.
     beats : détection des temps forts ; cut : un plan tous les N temps ; sfx : son des
     transitions (voir sons.js) ; title : animation des paroles. */
  const RECIPES = [
    {
      id: 'rap', name: 'Rap énergique', desc: 'Zooms, flashs et basses qui tapent, un plan tous les 2 temps.',
      chain: ['b:zoom-spin', 'b:flash-white', 'b:shake-bass', 'b:glitch'], order: 'cycle', frames: 6, intensity: 110,
      look: 'Punchy', beats: { mode: 'kicks', every: 2 }, cut: { every: 2, order: 'random', pick: 'random' }, sfx: 'mix', title: 'impact'
    },
    {
      id: 'drill', name: 'Drill sombre', desc: 'Secousses, stroboscope et glitch sur un étalonnage nuit.',
      chain: ['b:shake-impact', 'b:strobe', 'b:glitch', 'b:flash-black'], order: 'random', frames: 5, intensity: 120,
      look: 'Nuit bleue', beats: { mode: 'kicks', every: 2 }, cut: { every: 1, order: 'random', pick: 'random' }, sfx: 'impact', title: 'impact'
    },
    {
      id: 'pop', name: 'Pop lumineux', desc: 'Glow, zooms doux et light leaks roses, très lumineux.',
      chain: ['b:flash-glow', 'b:zoom-in', 'b:slide', 'p:leak-pink'], order: 'cycle', frames: 8, intensity: 90,
      look: 'Clip musical', beats: { mode: 'hits', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'whoosh', title: 'pop'
    },
    {
      id: 'chill', name: 'Chill / lofi', desc: 'Flous, dézooms lents et lumière chaude, un plan tous les 4 temps.',
      chain: ['b:defocus', 'b:zoom-out', 'p:leak-warm'], order: 'cycle', frames: 12, intensity: 70,
      look: 'Film chaud', beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'none', title: 'fade'
    },
    {
      id: 'voyage', name: 'Vlog voyage', desc: 'Whip pans, flares de soleil, couleurs d\'été.',
      chain: ['b:whip-pan', 'b:zoom-in', 'p:flare-warm'], order: 'cycle', frames: 8, intensity: 90,
      look: 'Été vintage', beats: { mode: 'tempo', every: 2 }, cut: { every: 2, order: 'sequence', pick: 'random' }, sfx: 'whoosh', title: 'slide-up'
    },
    {
      id: 'cine', name: 'Cinématique', desc: 'Fondus au noir, défocus et motion blur, rythme posé.',
      chain: ['b:flash-black', 'b:defocus', 'b:echo-blur'], order: 'cycle', frames: 14, intensity: 80,
      look: 'Ciné désaturé', beats: { mode: 'tempo', every: 4 }, cut: { every: 4, order: 'sequence', pick: 'middle' }, sfx: 'whoosh-grave', title: 'blur'
    },
    {
      id: 'retro', name: 'Rétro VHS', desc: 'VHS, glitch et vagues, couleurs délavées.',
      chain: ['p:vhs', 'b:glitch', 'b:wave', 'b:flicker'], order: 'random', frames: 8, intensity: 100,
      look: 'Pastel', beats: { mode: 'snares', every: 2 }, cut: { every: 2, order: 'random', pick: 'random' }, sfx: 'glitch', title: 'impact'
    }
  ];
  const byId = id => RECIPES.find(r => r.id === id) || null;

  /* Recette faite des réglages en cours (enchaînement, look, sons…), pour « Mon style ». */
  function fromSettings(s) {
    const chain = (s.chain && s.chain.keys) || [];
    return {
      id: 'mine', name: 'Mon style', desc: chain.length ? chain.length + ' effets de ton enchaînement, ton look en cours.' : 'Compose ton enchaînement dans l\'onglet Effets (Maj + clic).',
      chain: chain.slice(), order: (s.chain && s.chain.order) || 'cycle', frames: 8, intensity: 100,
      look: null, lookParams: s.color && s.color.params ? s.color.params : null, lookName: (s.color && s.color.name) || 'Mon look',
      beats: { mode: (s.beats && s.beats.mode) || 'kicks', every: (s.beats && s.beats.every) || 1 },
      cut: { every: (s.autoEdit && s.autoEdit.every) || 2, order: (s.autoEdit && s.autoEdit.order) || 'sequence', pick: (s.autoEdit && s.autoEdit.pick) || 'random' },
      sfx: s.sfx || 'none', title: (s.titles && s.titles.anim) || 'pop'
    };
  }

  // Les étapes du clip express, dans l'ordre où elles doivent tourner.
  const STEPS = [
    { id: 'beats', label: 'Temps forts', desc: 'Un marqueur sur chaque temps fort de la musique' },
    { id: 'montage', label: 'Montage auto', desc: 'Tes rushs posés sur le rythme' },
    { id: 'convert', label: 'Conversion LOG', desc: 'Rec.709 avec la LUT de chaque caméra' },
    { id: 'fix', label: 'Expo et balance auto', desc: 'Chaque plan corrigé' },
    { id: 'look', label: 'Look', desc: 'L\'étalonnage du style sur toute la séquence' },
    { id: 'effects', label: 'Effets', desc: 'Les effets du style, enchaînés sur les temps forts' },
    { id: 'sfx', label: 'Sons', desc: 'Whooshs et impacts calés sur les transitions' },
    { id: 'titles', label: 'Paroles', desc: 'Les paroles de l\'onglet Textes, une par temps fort' },
    { id: 'format', label: 'Copie 9:16', desc: 'Une version Reels / TikTok recadrée' }
  ];

  return { RECIPES, byId, fromSettings, STEPS };
});
