/* RR FX : les petits scripts Python que RR FX écrit dans son dossier de travail puis lance avec
   l'environnement Python d'un outil (Réglages › Outils gratuits). Ils ne font qu'appeler les
   bibliothèques (transformers, msclap) et écrivent des fichiers simples (PNG, lignes JSON) :
   tout le reste (images du plan, vidéo finale, pose dans Premiere) est fait par le panneau.
   Chaque script écrit « PROGRESS i n » pour l'avancement. Testés : compilation Python (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXPy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEVICE = [
    'def device():',
    '    if torch.cuda.is_available():',
    '        return "cuda"',
    '    mps = getattr(torch.backends, "mps", None)',
    '    return "mps" if mps is not None and mps.is_available() else "cpu"'
  ].join('\n');

  /* SAM 2 (transformers, mode flux : une image à la fois, la mémoire reste petite).
     python rrfx_sam.py <images> <masques> <x0> <y0> <x1> <y1> <modèle>
     Le rectangle (pixels de la première image) désigne l'objet ; chaque masque PNG (blanc = objet)
     porte le nom de son image. */
  const SAM = [
    'import glob, os, sys',
    'import numpy as np',
    'import torch',
    'from PIL import Image',
    'from transformers import Sam2VideoModel, Sam2VideoProcessor',
    DEVICE,
    'src, out = sys.argv[1], sys.argv[2]',
    'box = [float(v) for v in sys.argv[3:7]]',
    'name = sys.argv[7]',
    'dev = device()',
    'dtype = torch.bfloat16 if dev == "cuda" else torch.float32',
    'model = Sam2VideoModel.from_pretrained(name).to(dev, dtype=dtype)',
    'proc = Sam2VideoProcessor.from_pretrained(name)',
    'session = proc.init_video_session(inference_device=dev, dtype=dtype)',
    'files = sorted(glob.glob(os.path.join(src, "*.png")))',
    'os.makedirs(out, exist_ok=True)',
    'with torch.inference_mode():',
    '    for i, f in enumerate(files):',
    '        img = Image.open(f).convert("RGB")',
    '        inputs = proc(images=img, device=dev, return_tensors="pt")',
    '        if i == 0:',
    '            proc.add_inputs_to_inference_session(inference_session=session, frame_idx=0, obj_ids=1, input_boxes=[[box]], original_size=inputs.original_sizes[0])',
    '        res = model(inference_session=session, frame=inputs.pixel_values[0].to(dtype))',
    '        masks = proc.post_process_masks([res.pred_masks], original_sizes=inputs.original_sizes, binarize=False)[0]',
    '        m = (masks[0, 0].float().cpu().numpy() > 0.0).astype(np.uint8) * 255',
    '        Image.fromarray(m, "L").save(os.path.join(out, os.path.basename(f)))',
    '        print("PROGRESS %d %d" % (i + 1, len(files)), flush=True)'
  ].join('\n') + '\n';

  /* Flou d'arrière-plan façon portrait (Depth Anything V2) : ce qui est près reste net, le reste est
     flouté selon la profondeur. python rrfx_depth.py <images> <sortie> <flou px> <mise au point 0-1> <modèle>
     Les bornes de profondeur sont lissées d'une image à l'autre (pas de pompage). */
  const DEPTH = [
    'import glob, os, sys',
    'import numpy as np',
    'import torch',
    'from PIL import Image, ImageFilter',
    'from transformers import AutoImageProcessor, AutoModelForDepthEstimation',
    DEVICE,
    'src, out = sys.argv[1], sys.argv[2]',
    'blur, focus, name = float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]',
    'dev = device()',
    'proc = AutoImageProcessor.from_pretrained(name)',
    'model = AutoModelForDepthEstimation.from_pretrained(name).to(dev).eval()',
    'files = sorted(glob.glob(os.path.join(src, "*.png")))',
    'os.makedirs(out, exist_ok=True)',
    'lo = hi = None',
    'with torch.inference_mode():',
    '    for i, f in enumerate(files):',
    '        img = Image.open(f).convert("RGB")',
    '        w, h = img.size',
    '        inputs = proc(images=img, return_tensors="pt").to(dev)',
    '        pred = model(**inputs)',
    '        depth = proc.post_process_depth_estimation(pred, target_sizes=[(h, w)])[0]["predicted_depth"].float().cpu().numpy()',
    '        a, b = float(np.percentile(depth, 2)), float(np.percentile(depth, 98))',
    '        lo = a if lo is None else lo * 0.85 + a * 0.15',
    '        hi = b if hi is None else hi * 0.85 + b * 0.15',
    '        near = np.clip((depth - lo) / max(hi - lo, 1e-6), 0.0, 1.0)',
    '        # Net au-dessus de la mise au point, de plus en plus flou en s\'éloignant.',
    '        sharp = np.clip((near - (focus - 0.2)) / 0.2, 0.0, 1.0)',
    '        mask = Image.fromarray((sharp * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(max(1.0, w / 640.0)))',
    '        soft = img.filter(ImageFilter.GaussianBlur(blur * w / 1920.0))',
    '        Image.composite(img, soft, mask).save(os.path.join(out, os.path.basename(f)))',
    '        print("PROGRESS %d %d" % (i + 1, len(files)), flush=True)'
  ].join('\n') + '\n';

  /* CLAP (msclap) : sens d'un son ou d'un texte, en vecteur.
     python rrfx_clap.py audio <liste.json> <sortie.jsonl>  → une ligne {"path", "vec"} par son ;
     python rrfx_clap.py text <textes.json> <sortie.jsonl>  → une ligne {"text", "vec"} par texte.
     Le son est lu par librosa (44,1 kHz mono, 30 s au plus) ; le passage de 7 s le plus fort est
     gardé (le modèle écoute 7 s). */
  const CLAP = [
    'import json, sys',
    'import numpy as np',
    'import torch',
    'import librosa',
    'from msclap import CLAP',
    'mode, src, out = sys.argv[1], sys.argv[2], sys.argv[3]',
    'items = json.load(open(src, encoding="utf-8"))',
    'clap = CLAP(version="2023", use_cuda=torch.cuda.is_available())',
    'SR, N = 44100, 7 * 44100',
    'def clip(path):',
    '    y, _ = librosa.load(path, sr=SR, mono=True, duration=30)',
    '    if len(y) == 0:',
    '        raise ValueError("son vide")',
    '    if len(y) < N:',
    '        y = np.tile(y, int(np.ceil(N / len(y))))[:N]',
    '    elif len(y) > N:',
    '        hop = SR // 2',
    '        e = [float(np.mean(y[s:s + N] ** 2)) for s in range(0, len(y) - N + 1, hop)]',
    '        s = int(np.argmax(e)) * hop',
    '        y = y[s:s + N]',
    '    return y.astype(np.float32)',
    'with open(out, "w", encoding="utf-8") as f:',
    '    if mode == "text":',
    '        vecs = clap.get_text_embeddings(items).cpu().numpy()',
    '        for t, v in zip(items, vecs):',
    '            f.write(json.dumps({"text": t, "vec": [round(float(x), 5) for x in v]}) + "\\n")',
    '    else:',
    '        for i, p in enumerate(items):',
    '            try:',
    '                t = torch.tensor(clip(p)).reshape(1, 1, N)',
    '                if torch.cuda.is_available():',
    '                    t = t.cuda()',
    '                v = clap._get_audio_embeddings(t)[0].cpu().numpy()',
    '                f.write(json.dumps({"path": p, "vec": [round(float(x), 5) for x in v]}) + "\\n")',
    '            except Exception as err:',
    '                f.write(json.dumps({"path": p, "error": str(err)}) + "\\n")',
    '            f.flush()',
    '            print("PROGRESS %d %d" % (i + 1, len(items)), flush=True)'
  ].join('\n') + '\n';

  const SCRIPTS = { 'rrfx_sam.py': SAM, 'rrfx_depth.py': DEPTH, 'rrfx_clap.py': CLAP };

  // « PROGRESS 12 40 » → 0,3 ; sinon null.
  function progress(line) {
    const m = /^PROGRESS\s+(\d+)\s+(\d+)/.exec(String(line || '').trim());
    return m && +m[2] > 0 ? Math.min(1, +m[1] / +m[2]) : null;
  }
  // Lignes JSON d'un fichier de sortie (les lignes illisibles sont ignorées).
  function jsonLines(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(l => { if (!l.trim()) return; try { out.push(JSON.parse(l)); } catch (e) { /* ligne coupée */ } });
    return out;
  }

  return { SCRIPTS, progress, jsonLines };
});
