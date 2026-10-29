`astronaute-320x180.gray` : image 320 × 180 en niveaux de gris (un octet par pixel), faite à partir
de la photo officielle de l'astronaute Eileen Collins (NASA, domaine public, reprise dans
scikit-image sous le nom `astronaut.png`), réduite et posée sur un fond gris. Sert aux tests du
détecteur de visage (`tests/faces.test.js`).

`yunet-astronaute.json` : les sorties du réseau YuNet calculées par onnxruntime 1.20.1 sur cette image
(préparée comme dans `plugin/js/yunet.js`). `tests/yunet.test.js` vérifie que le moteur JavaScript du
panneau donne les mêmes nombres.
