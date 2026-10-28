/* Pour le test d'interface et les captures : met un dossier du disque dans la page sous
   forme de File (avec leur chemin relatif), sans passer par le sélecteur de fichiers. */
'use strict';
const fs = require('fs');
const path = require('path');

function list(dir) {
  const rootName = path.basename(dir), out = [];
  const walk = (d, rel) => fs.readdirSync(d).sort().forEach(n => {
    const full = path.join(d, n), r = rel ? rel + '/' + n : n;
    if (fs.statSync(full).isDirectory()) walk(full, r);
    else out.push({ rel: rootName + '/' + r, b64: fs.readFileSync(full).toString('base64'), mtime: fs.statSync(full).mtimeMs });
  });
  walk(dir, '');
  return out;
}

async function addFolder(page, dir) {
  await page.evaluate(files => {
    const objs = files.map(f => {
      const bin = atob(f.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], f.rel.split('/').pop(), { lastModified: f.mtime });
      Object.defineProperty(file, 'webkitRelativePath', { value: f.rel });
      return file;
    });
    window.RRFXApp.tabs.assets.addFiles(objs);
  }, list(dir));
}

module.exports = { addFolder };
