#!/usr/bin/env python3
"""Silero VAD (snakers4/silero-vad, licence MIT) → plugin/js/vendor/silero-model.js : les poids de la
branche 16 kHz (4 convolutions, LSTM, sortie ; la STFT est une FFT) en float16 (base64), lus par plugin/js/vad.js.

    python3 scripts/dev/silero-convert.py silero_vad_16k_op15.onnx

Le modèle est dans le paquet PyPI « silero-vad » (silero_vad/data/silero_vad_16k_op15.onnx).
Outil de développement : il faut les modules Python « onnx » et « numpy ». Le fichier produit est commité."""
import sys, json, base64, hashlib
import numpy as np
import onnx
from onnx import numpy_helper

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'plugin/js/vendor/silero-model.js'
m = onnx.load(src)
w = {i.name: numpy_helper.to_array(i).astype(np.float32) for i in m.graph.initializer}
# La STFT du modèle est une transformée de Fourier (fenêtre de Hann périodique de 256) : vad.js la
# calcule par FFT, ses filtres ne sont pas recopiés (vérifié ici).
B = w['model.stft.forward_basis_buffer'][:, 0, :]
k = np.arange(256)
hann = 0.5 - 0.5 * np.cos(2 * np.pi * k / 256)
ref = np.array([hann * np.cos(2 * np.pi * f * k / 256) for f in range(129)] + [-hann * np.sin(2 * np.pi * f * k / 256) for f in range(129)])
assert np.abs(B - ref).max() < 1e-5, 'STFT inattendue'
names = {
    'c0w': 'model.encoder.0.reparam_conv.weight', 'c0b': 'model.encoder.0.reparam_conv.bias',
    'c1w': 'model.encoder.1.reparam_conv.weight', 'c1b': 'model.encoder.1.reparam_conv.bias',
    'c2w': 'model.encoder.2.reparam_conv.weight', 'c2b': 'model.encoder.2.reparam_conv.bias',
    'c3w': 'model.encoder.3.reparam_conv.weight', 'c3b': 'model.encoder.3.reparam_conv.bias',
    'wih': 'model.decoder.rnn.weight_ih', 'whh': 'model.decoder.rnn.weight_hh',
    'bih': 'model.decoder.rnn.bias_ih', 'bhh': 'model.decoder.rnn.bias_hh',
    'ow': 'model.decoder.decoder.2.weight', 'ob': 'model.decoder.decoder.2.bias',
}
blobs, tensors, off = [], {}, 0
for k, n in names.items():
    a = w[n].astype(np.float16).ravel()
    tensors[k] = {'o': off, 'n': int(a.size), 'dims': list(w[n].shape)}
    blobs.append(a.tobytes())
    off += int(a.size)
data = base64.b64encode(b''.join(blobs)).decode()
sha = hashlib.sha256(open(src, 'rb').read()).hexdigest()
model = {'source': src.split('/')[-1], 'sha256': sha, 'tensors': tensors, 'weights': data}
with open(out, 'w') as f:
    f.write('/* Silero VAD, détection de la voix (https://github.com/snakers4/silero-vad, licence MIT,\n'
            '   Copyright (c) 2020-present Silero Team). Converti par scripts/dev/silero-convert.py : les poids\n'
            '   de la branche 16 kHz en float16 (base64). Lu par plugin/js/vad.js. */\n')
    f.write("(function (root) {\n  'use strict';\n  const model = " + json.dumps(model, separators=(',', ':')) + ";\n")
    f.write("  if (typeof module === 'object' && module.exports) module.exports = model;\n  else root.RRFXSileroModel = model;\n")
    f.write("})(typeof self !== 'undefined' ? self : this);\n")
print(out, off, 'poids', len(data) // 1024, 'Ko')
