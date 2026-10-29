/* RR FX : catalogue des outils gratuits qui tournent sur l'ordinateur (IA locale comprise), et ce
   qu'il faut pour les installer en un clic, calculs sans DOM (testés sous Node).
   Chaque outil est optionnel : RR FX marche sans, et propose de l'installer quand on en a besoin.
   Façons d'installer (« how », par système : win, mac-arm64, mac-x64, mac, any) :
   - file : un seul exécutable à télécharger ;
   - archive : un .zip / .tar.gz décompressé dans Documents/RRFX/Outils/<outil> ;
   - wheel : l'exécutable pris dans un paquet de PyPI (un .whl est un .zip), sans Python ;
   - pip : un paquet Python, installé dans un environnement à part (Documents/RRFX/Outils/python) ;
   - brew : Homebrew sur Mac, s'il est là.
   Le panneau (outils-panel.js) fait les téléchargements et lance les commandes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXLibres = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GH = (repo, tag, file) => 'https://github.com/' + repo + '/releases/download/' + tag + '/' + file;
  const HF = p => 'https://huggingface.co/' + p;

  /* Voix de Piper (voix off témoin) : modèle .onnx + sa config .onnx.json, sur Hugging Face. */
  const VOICES = [
    { id: 'fr_FR-siwis-medium', label: 'Française (Siwis)', lang: 'fr', path: 'rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium', mb: 63 },
    { id: 'fr_FR-tom-medium', label: 'Français (Tom)', lang: 'fr', path: 'rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium/fr_FR-tom-medium', mb: 63 },
    { id: 'en_US-lessac-medium', label: 'English (Lessac)', lang: 'en', path: 'rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium', mb: 63 }
  ];

  /* Modèles d'Ollama : texte (traduction, titres, extraits, correction), image (description des
     rushs) et « embeddings » (recherche par le sens). */
  const OLLAMA_MODELS = {
    text: [
      { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B (4,7 Go, conseillé)', gb: 4.7 },
      { id: 'qwen2.5:3b', label: 'Qwen 2.5 3B (1,9 Go, ordinateur modeste)', gb: 1.9 },
      { id: 'mistral-nemo', label: 'Mistral Nemo 12B (7,1 Go, le plus juste)', gb: 7.1 }
    ],
    vision: [
      { id: 'gemma3:4b', label: 'Gemma 3 4B (3,3 Go, conseillé)', gb: 3.3 },
      { id: 'moondream', label: 'Moondream (1,7 Go, rapide)', gb: 1.7 }
    ],
    embed: [
      { id: 'bge-m3', label: 'BGE-M3 (1,2 Go, multilingue)', gb: 1.2 },
      { id: 'nomic-embed-text', label: 'Nomic Embed (0,3 Go, anglais surtout)', gb: 0.3 }
    ]
  };

  /* Les outils. what : ce que l'outil apporte (affiché) ; uses : où il sert dans RR FX ;
     mb : taille approximative ; exe : noms possibles de l'exécutable ; minPy : Python minimum. */
  const TOOLS = [
    {
      id: 'ffmpeg', name: 'ffmpeg', icon: '🎞', license: 'LGPL / GPL', mb: 80, site: 'https://ffmpeg.org',
      what: 'Lit et écrit tous les formats vidéo et son.',
      uses: ['Son des fichiers que RR FX ne lit pas seul (MP3, MXF, Opus…)', 'Ralentis fluides, agrandissement et détourage (images des plans)'],
      exe: ['ffmpeg'],
      how: { any: { type: 'wheel', pkg: 'imageio-ffmpeg', member: '^imageio_ffmpeg/binaries/ffmpeg-[^/]+$', rename: 'ffmpeg' } }
    },
    {
      id: 'ollama', name: 'Ollama', icon: '🧠', license: 'MIT', mb: 1500, site: 'https://ollama.com',
      what: 'Une IA de texte et d\'image sur ton ordinateur (Qwen, Gemma, Mistral…), rien n\'est envoyé en ligne.',
      uses: ['Traduction des sous-titres', 'Titres des chapitres YouTube', 'Titre, description et hashtags', 'Choix des extraits pour les réseaux', 'Correction des sous-titres', 'Recherche dans les rushs et plans de coupe automatiques'],
      exe: ['ollama'],
      how: {
        win: { type: 'archive', url: GH('ollama/ollama', 'v0.40.13', 'ollama-windows-amd64.zip') },
        mac: { type: 'archive', url: GH('ollama/ollama', 'v0.40.13', 'ollama-darwin.tgz') }
      }
    },
    {
      id: 'whisper', name: 'Whisper', icon: '🗣', license: 'MIT', mb: 10, site: 'https://github.com/ggml-org/whisper.cpp',
      what: 'Écrit tout ce qui est dit, mot par mot.',
      uses: ['Sous-titres (.srt) automatiques', '« Euh » et répétitions au mot près', 'Extraits, chapitres et textes par l\'IA'],
      exe: ['whisper-cli', 'whisper-cpp', 'main', 'whisper'],
      how: {
        win: { type: 'archive', url: GH('ggml-org/whisper.cpp', 'v1.7.6', 'whisper-bin-x64.zip') },
        mac: { type: 'brew', formula: 'whisper-cpp', fallback: { type: 'pip', pkg: 'openai-whisper', exe: 'whisper' } }
      }
    },
    {
      id: 'diarize', name: 'sherpa-onnx', icon: '👥', license: 'Apache 2.0', mb: 40, site: 'https://github.com/k2-fsa/sherpa-onnx',
      what: 'Reconnaît qui parle, même avec un seul micro.',
      uses: ['Podcast multicam : la caméra sur celui qui parle'],
      exe: ['sherpa-onnx-offline-speaker-diarization'],
      how: { any: { type: 'wheel', pkg: 'sherpa-onnx-bin', member: '(^|/)(bin|Scripts)/sherpa-onnx-offline-speaker-diarization(\\.exe)?$' } },
      models: [
        { id: 'segmentation', url: GH('k2-fsa/sherpa-onnx', 'speaker-segmentation-models', 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'), extract: true, file: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx', mb: 7 },
        { id: 'embedding', url: GH('k2-fsa/sherpa-onnx', 'speaker-recongition-models', 'wespeaker_en_voxceleb_resnet34_LM.onnx'), file: 'wespeaker_en_voxceleb_resnet34_LM.onnx', mb: 25 }
      ]
    },
    {
      id: 'deepfilter', name: 'DeepFilterNet', icon: '🎙', license: 'MIT / Apache 2.0', mb: 28, site: 'https://github.com/Rikorose/DeepFilterNet',
      what: 'Enlève le bruit de fond d\'une voix (souffle, clim, rue, vent).',
      uses: ['Parole › Débruiter la voix'],
      exe: ['deep-filter'],
      how: {
        win: { type: 'file', url: GH('Rikorose/DeepFilterNet', 'v0.5.6', 'deep-filter-0.5.6-x86_64-pc-windows-msvc.exe'), rename: 'deep-filter' },
        'mac-arm64': { type: 'file', url: GH('Rikorose/DeepFilterNet', 'v0.5.6', 'deep-filter-0.5.6-aarch64-apple-darwin'), rename: 'deep-filter' },
        'mac-x64': { type: 'file', url: GH('Rikorose/DeepFilterNet', 'v0.5.6', 'deep-filter-0.5.6-x86_64-apple-darwin'), rename: 'deep-filter' },
        linux: { type: 'file', url: GH('Rikorose/DeepFilterNet', 'v0.5.6', 'deep-filter-0.5.6-x86_64-unknown-linux-musl'), rename: 'deep-filter' }
      }
    },
    {
      id: 'demucs', name: 'Demucs', icon: '🥁', license: 'MIT', mb: 1200, site: 'https://github.com/adefossez/demucs', minPy: [3, 10],
      what: 'Sépare la voix, la batterie, la basse et le reste d\'un morceau ou d\'un rush.',
      uses: ['Musique › Séparer les pistes', 'Temps forts calculés sur la batterie seule', 'Enlever la musique d\'un rush (garder la voix)'],
      exe: ['demucs'],
      how: { any: { type: 'pip', pkg: 'demucs' } }
    },
    {
      id: 'beatthis', name: 'Beat This!', icon: '🎚', license: 'MIT', mb: 1200, site: 'https://github.com/CPJKU/beat_this', minPy: [3, 10],
      what: 'Trouve les temps et les premiers temps de mesure, même sur les morceaux difficiles.',
      uses: ['Musique › Analyse des temps forts par l\'IA'],
      exe: ['beat_this'],
      how: { any: { type: 'pip', pkg: 'beat-this' } }
    },
    {
      id: 'rembg', name: 'rembg', icon: '✂', license: 'MIT', mb: 500, site: 'https://github.com/danielgatis/rembg', minPy: [3, 11],
      what: 'Détoure une personne image par image.',
      uses: ['Textes › Texte derrière le sujet'],
      exe: ['rembg'],
      how: { any: { type: 'pip', pkg: 'rembg[cpu,cli]' } }
    },
    {
      id: 'rife', name: 'RIFE', icon: '🐢', license: 'MIT', mb: 412, site: 'https://github.com/nihui/rife-ncnn-vulkan',
      what: 'Invente les images intermédiaires : ralentis fluides sans saccade.',
      uses: ['Rampe › Ralenti fluide (IA)'],
      exe: ['rife-ncnn-vulkan'],
      how: {
        win: { type: 'archive', url: GH('nihui/rife-ncnn-vulkan', '20221029', 'rife-ncnn-vulkan-20221029-windows.zip') },
        mac: { type: 'archive', url: GH('nihui/rife-ncnn-vulkan', '20221029', 'rife-ncnn-vulkan-20221029-macos.zip') },
        linux: { type: 'archive', url: GH('nihui/rife-ncnn-vulkan', '20221029', 'rife-ncnn-vulkan-20221029-ubuntu.zip') }
      }
    },
    {
      id: 'realesrgan', name: 'Real-ESRGAN', icon: '🔍', license: 'BSD-3', mb: 45, site: 'https://github.com/xinntao/Real-ESRGAN',
      what: 'Agrandit une image ou une vidéo basse définition en gardant les détails.',
      uses: ['Bibliothèque › Agrandir un plan (IA)'],
      exe: ['realesrgan-ncnn-vulkan'],
      how: {
        win: { type: 'archive', url: GH('xinntao/Real-ESRGAN', 'v0.2.5.0', 'realesrgan-ncnn-vulkan-20220424-windows.zip') },
        mac: { type: 'archive', url: GH('xinntao/Real-ESRGAN', 'v0.2.5.0', 'realesrgan-ncnn-vulkan-20220424-macos.zip') },
        linux: { type: 'archive', url: GH('xinntao/Real-ESRGAN', 'v0.2.5.0', 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip') }
      }
    },
    {
      id: 'piper', name: 'Piper', icon: '🔈', license: 'GPL-3.0 (outil séparé)', mb: 60, site: 'https://github.com/OHF-Voice/piper1-gpl', minPy: [3, 9],
      what: 'Une voix de synthèse naturelle, en français et en anglais.',
      uses: ['Parole › Voix off témoin'],
      exe: ['piper'],
      how: { any: { type: 'pip', pkg: 'piper-tts' } }
    }
  ];

  const byId = id => TOOLS.find(t => t.id === id) || null;

  // Système : 'win', 'mac-arm64', 'mac-x64' ou 'linux'.
  function plat(platform, arch) {
    if (platform === 'win32') return 'win';
    if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    return 'linux';
  }
  // La façon d'installer pour ce système (la plus précise d'abord), ou null.
  function howFor(tool, p) {
    const h = tool.how || {};
    return h[p] || h[p.split('-')[0]] || h.any || null;
  }

  // Le bon paquet .whl de PyPI pour ce système, parmi les fichiers d'une version (pypi.org/pypi/<nom>/json).
  function pickWheel(files, p) {
    const list = (files || []).filter(f => /\.whl$/.test(f.filename || ''));
    const tests = {
      win: [/win_amd64\.whl$/],
      'mac-arm64': [/macosx_\d+_\d+_arm64\.whl$/, /universal2\.whl$/, /macosx_\d+_\d+_(x86_64|intel)/],
      'mac-x64': [/macosx_\d+_\d+_(x86_64|intel)/, /universal2\.whl$/],
      linux: [/manylinux[^-]*x86_64[^-]*\.whl$/]
    }[p] || [];
    for (const re of tests) {
      const f = list.find(x => re.test(x.filename));
      if (f) return f;
    }
    return list.find(x => /-none-any\.whl$/.test(x.filename)) || null;
  }

  // Nom de l'exécutable sur ce système.
  const exeName = (name, win) => (win && !/\.exe$/i.test(name) ? name + '.exe' : name);

  /* Environnement Python de RR FX : chemins de python et des commandes installées dedans. */
  function venv(dir, win) {
    const bin = win ? dir + '\\Scripts\\' : dir + '/bin/';
    return { python: bin + exeName('python', win), exe: name => bin + exeName(name, win), bin: bin.slice(0, -1) };
  }

  // « Python 3.12.4 » → [3, 12, 4], sinon null.
  function pyVersion(text) {
    const m = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
    return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
  }
  const atLeast = (v, min) => !!v && (v[0] > min[0] || (v[0] === min[0] && v[1] >= (min[1] || 0)));

  /* Où chercher Python. → [{ cmd, args }] (args avant les nôtres : « py -3 »). */
  function pythonCandidates(platform, env) {
    const e = env || {};
    if (platform === 'win32') {
      const local = e.LOCALAPPDATA || '', docs = (e.USERPROFILE || '') + '\\Documents\\RRFX\\Outils';
      const versions = ['313', '312', '311', '310'];
      return [{ cmd: docs + '\\python312\\python.exe', args: [] }]
        .concat(versions.map(v => ({ cmd: local + '\\Programs\\Python\\Python' + v + '\\python.exe', args: [] })))
        .concat([{ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] }, { cmd: 'python3', args: [] }]);
    }
    const fw = ['3.13', '3.12', '3.11', '3.10'].map(v => ({ cmd: '/Library/Frameworks/Python.framework/Versions/' + v + '/bin/python3', args: [] }));
    return [{ cmd: '/opt/homebrew/bin/python3', args: [] }, { cmd: '/usr/local/bin/python3', args: [] }].concat(fw, [{ cmd: 'python3', args: [] }]);
  }
  // Installateur officiel de Python, s'il en faut un.
  const PYTHON = {
    version: '3.12.10',
    win: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe',
    mac: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-macos11.pkg',
    // Installation silencieuse, pour l'utilisateur seul, dans un dossier de RR FX (Windows).
    winArgs: dir => ['/passive', 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=0', 'Include_test=0', 'Shortcuts=0', 'TargetDir=' + dir]
  };

  // Arguments de pip pour installer des paquets dans l'environnement de RR FX.
  const pipArgs = pkgs => ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', '--no-input'].concat(pkgs);
  // Une ligne de pip → ce qui est en cours (court), ou null.
  function pipStep(line) {
    const l = String(line || '').trim();
    let m = /^Collecting\s+([^\s<>=!~;[]+)/.exec(l);
    if (m) return { what: m[1] };
    m = /^Downloading\s+(\S+)\s+\(([\d.]+\s*[kMG]B)\)/.exec(l);
    if (m) return { what: m[1].replace(/^.*\//, '').replace(/-[\d.]+-.*$/, ''), size: m[2] };
    if (/^Installing collected packages/.test(l)) return { what: 'installation', last: true };
    return null;
  }

  // Le premier fichier d'une liste dont le nom (sans dossier) fait partie des exécutables attendus.
  function findExe(files, names, win) {
    const want = names.map(n => exeName(n, win).toLowerCase());
    for (const n of want) {
      const hit = files.find(f => String(f).replace(/^.*[\\/]/, '').toLowerCase() === n);
      if (hit) return hit;
    }
    return '';
  }

  /* -------------------------------------------------------------- lignes de commande */

  // Son d'un média (extrait [a, a + d] s) en WAV : mono 16 kHz (analyse, IA) ou stéréo 44,1 kHz.
  function ffAudio(input, out, o) {
    const x = o || {}, a = ['-hide_banner', '-nostdin', '-y'];
    if (x.start > 0) a.push('-ss', x.start.toFixed(3));
    if (x.dur > 0) a.push('-t', x.dur.toFixed(3));
    a.push('-i', input, '-vn', '-ac', String(x.channels || 1), '-ar', String(x.rate || 16000), '-c:a', 'pcm_s16le', out);
    return a;
  }
  // Images d'un plan (extrait [start, start + dur] s), numérotées dans dir. height : hauteur maxi.
  function ffFrames(input, dir, o) {
    const x = o || {}, a = ['-hide_banner', '-nostdin', '-y'];
    if (x.start > 0) a.push('-ss', x.start.toFixed(3));
    if (x.dur > 0) a.push('-t', x.dur.toFixed(3));
    a.push('-i', input);
    const vf = [];
    if (x.fps) vf.push('fps=' + x.fps);
    if (x.height) vf.push('scale=-2:\'min(' + x.height + ',ih)\'');
    if (vf.length) a.push('-vf', vf.join(','));
    a.push('-an', dir + '/%06d.png');
    return a;
  }
  // Une image d'un média (à at s), réduite à 512 px de large, en JPEG.
  function ffThumb(input, out, o) {
    const x = o || {}, a = ['-hide_banner', '-nostdin', '-y'];
    if (x.at > 0) a.push('-ss', x.at.toFixed(3));
    a.push('-i', input, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '3', out);
    return a;
  }
  // Images numérotées → vidéo. alpha : ProRes 4444 avec transparence (.mov), sinon H.264 (.mp4).
  function ffEncode(dir, out, o) {
    const x = o || {}, a = ['-hide_banner', '-nostdin', '-y', '-framerate', String(x.fps || 25), '-i', dir + '/%06d.png'];
    if (x.audio) a.push('-i', x.audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-shortest');
    // scale : facteur de taille (Real-ESRGAN agrandit ×4, ramené ensuite à ×2 par exemple).
    if (x.scale && Math.abs(x.scale - 1) > 1e-3) a.push('-vf', 'scale=trunc(iw*' + x.scale + '/2)*2:-2:flags=lanczos');
    if (x.alpha) a.push('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0');
    else a.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p');
    a.push(out);
    return a;
  }
  // Durée et cadence lues dans la sortie de « ffmpeg -i » (stderr). → { dur, fps } ou des 0.
  function ffProbe(text) {
    const t = String(text || ''), d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t), f = /,\s*([\d.]+)\s*(?:fps|tbr)/.exec(t);
    return { dur: d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : 0, fps: f ? +f[1] : 0 };
  }
  // Avancement d'ffmpeg (« time=00:01:02.50 ») sur une durée connue → 0 à 1, ou null.
  function ffProgress(line, dur) {
    const m = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(line || ''));
    if (!m || !dur) return null;
    return Math.min(1, ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) / dur);
  }

  // sherpa-onnx : qui parle quand. num : nombre de personnes (0 : deviné).
  function diarizeArgs(o) {
    const a = ['--segmentation.pyannote-model=' + o.segmentation, '--embedding.model=' + o.embedding];
    if (o.num > 0) a.push('--clustering.num-clusters=' + o.num);
    else a.push('--clustering.cluster-threshold=' + (o.threshold || 0.9));
    if (o.threads) a.push('--segmentation.num-threads=' + o.threads, '--embedding.num-threads=' + o.threads);
    a.push(o.wav);
    return a;
  }
  // Sortie de sherpa-onnx (« 0.318 -- 6.865 speaker_00 ») → [{ a, b, speaker }] triés.
  function parseDiarization(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(l => {
      const m = /^\s*([\d.]+)\s*--\s*([\d.]+)\s+speaker_(\d+)/.exec(l);
      if (m && +m[2] > +m[1]) out.push({ a: +m[1], b: +m[2], speaker: +m[3] });
    });
    return out.sort((p, q) => p.a - q.a);
  }

  // Beat This! : fichier .beats (« temps<TAB>numéro », 1 = premier temps) → { beats, downbeats }.
  function parseBeats(text) {
    const beats = [], downbeats = [];
    String(text || '').split(/\r?\n/).forEach(l => {
      const m = /^\s*([\d.]+)\s+(\d+)/.exec(l);
      if (!m) return;
      beats.push(+m[1]);
      if (+m[2] === 1) downbeats.push(+m[1]);
    });
    return { beats, downbeats };
  }

  // Demucs : séparation d'un fichier, une piste par instrument (ou voix / reste).
  function demucsArgs(o) {
    const a = ['-n', o.model || 'htdemucs', '-o', o.out, '--filename', '{stem}.{ext}'];
    if (o.two) a.push('--two-stems', o.two);
    a.push(o.input);
    return a;
  }
  // Demucs : « 45%|████ » → 0,45.
  function percentOf(line) {
    const m = /(\d{1,3})%\|/.exec(String(line || ''));
    return m ? Math.min(1, +m[1] / 100) : null;
  }

  /* RIFE : images intermédiaires. count : nombre d'images voulues en sortie (seuls les modèles
     v4 en acceptent un nombre quelconque) ; model : dossier du modèle. */
  const rifeArgs = o => ['-i', o.input, '-o', o.output, '-n', String(o.count), '-m', o.model, '-f', '%06d.png'];
  /* Real-ESRGAN : un dossier d'images agrandies ×4 (modèle pour les vraies images, pas le dessin
     animé) ; ffmpeg ramène ensuite à la taille voulue. models : dossier des modèles. */
  const esrganArgs = o => ['-i', o.input, '-o', o.output, '-n', o.model || 'realesrgan-x4plus', '-s', '4', '-m', o.models, '-f', 'png'];
  // Avancement des outils ncnn (« 42.50% ») → 0 à 1, ou null.
  function ncnnProgress(line) {
    const m = /(\d{1,3}(?:\.\d+)?)%/.exec(String(line || ''));
    return m ? Math.min(1, +m[1] / 100) : null;
  }
  /* DeepFilterNet : le fichier WAV débruité, même nom, dans le dossier out. atten : réduction
     maximale du bruit en dB (100 : tout le bruit ; 20 à 30 : plus naturel, un peu d'ambiance). */
  const deepFilterArgs = o => ['-o', o.out, '--atten-lim-db', String(o.atten || 100), o.input];
  // Piper : texte (un fichier, une phrase par ligne) → WAV.
  const piperArgs = o => ['-m', o.model, '-f', o.out, '-i', o.text, '--sentence-silence', String(o.pause || 0.3)];
  // rembg : un dossier d'images détourées (PNG transparents), modèle local de silhouettes.
  const rembgArgs = o => ['p', '-m', o.model || 'u2net_human_seg', o.input, o.output];

  // Taille lisible (Mo / Go).
  const size = mb => (mb >= 1000 ? (mb / 1000).toFixed(1).replace('.', ',') + ' Go' : Math.round(mb) + ' Mo');

  return {
    TOOLS, VOICES, OLLAMA_MODELS, PYTHON, HF, byId, plat, howFor, pickWheel, exeName, venv, pyVersion, atLeast,
    pythonCandidates, pipArgs, pipStep, findExe, ffAudio, ffFrames, ffThumb, ffEncode, ffProbe, ffProgress,
    diarizeArgs, parseDiarization, parseBeats, demucsArgs, percentOf, rifeArgs, esrganArgs, ncnnProgress,
    deepFilterArgs, piperArgs, rembgArgs, size
  };
});
