#!/usr/bin/env python3
"""YuNet (OpenCV Zoo, licence MIT) → plugin/js/vendor/yunet-model.js : le graphe (opérations, attributs)
et les poids en float32 (base64), lus par plugin/js/yunet.js sans dépendance.

    python3 scripts/dev/yunet-convert.py face_detection_yunet_2023mar.onnx

Outil de développement : il faut le module Python « onnx ». Le fichier produit est commité."""
import sys, json, base64, hashlib
import numpy as np
import onnx
from onnx import numpy_helper

src = sys.argv[1]
m = onnx.load(src)
inits = {i.name: numpy_helper.to_array(i).astype(np.float32 if numpy_helper.to_array(i).dtype.kind == 'f' else np.int64) for i in m.graph.initializer}
blobs, tensors, off = [], {}, 0
used = set()
nodes = []
for n in m.graph.node:
    attrs = {}
    for a in n.attribute:
        v = onnx.helper.get_attribute_value(a)
        if isinstance(v, bytes): v = v.decode()
        if hasattr(v, 'tolist'): v = v.tolist()
        attrs[a.name] = v if not isinstance(v, (list, tuple)) else list(v)
    nodes.append({'op': n.op_type, 'in': list(n.input), 'out': list(n.output), 'at': attrs})
    for i in n.input:
        if i in inits: used.add(i)
for name in sorted(used):
    a = inits[name]
    if a.dtype == np.int64:
        tensors[name] = {'ints': a.reshape(-1).tolist(), 'dims': list(a.shape)}
        continue
    b = a.astype('<f4').tobytes()
    tensors[name] = {'o': off // 4, 'n': a.size, 'dims': list(a.shape)}
    blobs.append(b); off += len(b)
data = b''.join(blobs)
model = {'source': 'face_detection_yunet_2023mar.onnx', 'sha256': hashlib.sha256(open(src, 'rb').read()).hexdigest(),
         'input': m.graph.input[0].name, 'outputs': [o.name for o in m.graph.output], 'nodes': nodes, 'tensors': tensors}
out = ('/* YuNet, détecteur de visage d\'OpenCV Zoo (https://github.com/opencv/opencv_zoo, licence MIT,\n'
       '   Copyright (c) 2020-2023 Shiqi Yu / OpenCV). Converti par scripts/dev/yunet-convert.py : le graphe et\n'
       '   les poids (float32, base64). Lu par plugin/js/yunet.js. */\n'
       '(function (root) {\n  \'use strict\';\n  const model = ' + json.dumps(model, separators=(',', ':'), ensure_ascii=True) + ';\n'
       '  model.weights = \'' + base64.b64encode(data).decode() + '\';\n'
       '  if (typeof module === \'object\' && module.exports) module.exports = model;\n  else root.RRFXYuNetModel = model;\n'
       '})(typeof self !== \'undefined\' ? self : this);\n')
open('plugin/js/vendor/yunet-model.js', 'w').write(out)
print('plugin/js/vendor/yunet-model.js', len(out), 'octets,', len(nodes), 'opérations,', len(tensors), 'tenseurs')
