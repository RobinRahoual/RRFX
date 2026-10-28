/* RR FX — lecture du son des fichiers (sans DOM, testée sous Node avec ffmpeg).
   Lit seulement la partie utile : en-têtes, puis la fenêtre de temps demandée.
   - WAV / RF64 : PCM 8-32 bits et flottant ;
   - MOV / MP4 : son PCM (sowt, twos, in24, in32, fl32, fl64, lpcm, ipcm, fpcm, raw) décodé
     directement ; son AAC (mp4a) renvoyé en flux ADTS, à décoder par le navigateur.
   io : { size() -> Promise<number>, read(position, length) -> Promise<Uint8Array> } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXMedia = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const u16 = (b, o) => (b[o] << 8) | b[o + 1];
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
  const s32 = (b, o) => u32(b, o) | 0;
  const le16 = (b, o) => b[o] | (b[o + 1] << 8);
  const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  // ---------------------------------------------------------------- PCM

  // Octets PCM entrelacés -> mono (moyenne des canaux).
  function pcmToMono(bytes, fmt) {
    const ch = fmt.channels, bps = fmt.bits / 8, frame = ch * bps;
    const frames = Math.floor(bytes.length / frame), out = new Float32Array(frames);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), le = !fmt.bigEndian;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < ch; c++) {
        const o = f * frame + c * bps;
        let v;
        if (fmt.float) v = bps === 8 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
        else if (bps === 1) v = fmt.signed ? dv.getInt8(o) / 128 : (dv.getUint8(o) - 128) / 128;
        else if (bps === 2) v = dv.getInt16(o, le) / 32768;
        else if (bps === 3) {
          let x = le ? bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) : (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2];
          if (x & 0x800000) x -= 0x1000000;
          v = x / 8388608;
        } else v = dv.getInt32(o, le) / 2147483648;
        sum += v;
      }
      out[f] = sum / ch;
    }
    return out;
  }

  // ---------------------------------------------------------------- WAV

  async function probeWav(io, size) {
    const head = await io.read(0, 12);
    const riff = str4(head, 0);
    if ((riff !== 'RIFF' && riff !== 'RF64' && riff !== 'BW64') || str4(head, 8) !== 'WAVE') return null;
    let pos = 12, fmt = null, dataOffset = -1, dataSize = 0, ds64 = null;
    while (pos + 8 <= size) {
      const h = await io.read(pos, 8), id = str4(h, 0);
      let len = le32(h, 4);
      if (id === 'ds64') {
        const b = await io.read(pos + 8, 28);
        ds64 = le32(b, 8) + le32(b, 12) * 4294967296;
      } else if (id === 'fmt ') {
        const b = await io.read(pos + 8, Math.min(len, 40));
        let tag = le16(b, 0);
        if (tag === 0xfffe && len >= 26) tag = le16(b, 24);
        fmt = { tag, channels: le16(b, 2), sampleRate: le32(b, 4), bits: le16(b, 14) };
      } else if (id === 'data') {
        dataOffset = pos + 8;
        dataSize = len === 0xffffffff && ds64 != null ? ds64 : Math.min(len, size - dataOffset);
        break;
      }
      if (len === 0xffffffff) break;
      pos += 8 + len + (len & 1);
    }
    if (!fmt || dataOffset < 0) throw new Error('WAV illisible (morceaux fmt/data manquants)');
    if (fmt.tag !== 1 && fmt.tag !== 3) throw new Error('WAV compressé non pris en charge (format ' + fmt.tag + ')');
    const pcm = { channels: fmt.channels, bits: fmt.bits, float: fmt.tag === 3, bigEndian: false, signed: fmt.bits > 8 };
    const frame = fmt.channels * fmt.bits / 8;
    return { kind: 'wav', codec: 'pcm', sampleRate: fmt.sampleRate, channels: fmt.channels, pcm, dataOffset, frame, duration: dataSize / frame / fmt.sampleRate, frames: Math.floor(dataSize / frame) };
  }

  async function readWav(io, info, t0, t1) {
    const f0 = Math.max(0, Math.floor(t0 * info.sampleRate)), f1 = Math.min(info.frames, Math.ceil(t1 * info.sampleRate));
    if (f1 <= f0) return { samples: new Float32Array(0), sampleRate: info.sampleRate, start: t0 };
    const bytes = await io.read(info.dataOffset + f0 * info.frame, (f1 - f0) * info.frame);
    return { samples: pcmToMono(bytes, info.pcm), sampleRate: info.sampleRate, start: f0 / info.sampleRate };
  }

  // ---------------------------------------------------------------- MP4 / MOV

  function boxes(b, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = u32(b, p), hdr = 8;
      const type = str4(b, p + 4);
      if (size === 1) { size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr) break;
      out.push({ type, start: p, body: p + hdr, end: Math.min(end, p + size) });
      p += size;
    }
    return out;
  }
  const child = (b, box, type) => boxes(b, box.body, box.end).find(x => x.type === type) || null;
  function path(b, box, types) {
    let cur = box;
    for (const t of types) { cur = cur && child(b, cur, t); if (!cur) return null; }
    return cur;
  }
  // Cherche une boîte n'importe où entre start et end (dans une description d'échantillon).
  function scan(b, start, end, type) {
    for (const x of boxes(b, start, end)) {
      if (x.type === type) return x;
      if (x.type === 'wave') { const r = scan(b, x.body, x.end, type); if (r) return r; }
    }
    return null;
  }

  async function topBoxes(io, size) {
    const out = [];
    let p = 0;
    while (p + 8 <= size) {
      const h = await io.read(p, 16);
      let len = u32(h, 0), hdr = 8;
      if (len === 1) { len = u64(h, 8); hdr = 16; } else if (len === 0) len = size - p;
      if (len < hdr) break;
      out.push({ type: str4(h, 4), start: p, body: p + hdr, end: Math.min(size, p + len) });
      p += len;
    }
    return out;
  }

  const PCM_FORMATS = {
    sowt: { bits: 16, bigEndian: false }, twos: { bits: 16, bigEndian: true }, in24: { bits: 24, bigEndian: true },
    in32: { bits: 32, bigEndian: true }, fl32: { bits: 32, bigEndian: true, float: true }, fl64: { bits: 64, bigEndian: true, float: true },
    'raw ': { bits: 8, bigEndian: true, unsigned: true }, NONE: { bits: 16, bigEndian: true }
  };

  function audioTrack(b, moov, movieTimescale) {
    for (const trak of boxes(b, moov.body, moov.end).filter(x => x.type === 'trak')) {
      const mdia = child(b, trak, 'mdia'), hdlr = mdia && child(b, mdia, 'hdlr');
      if (!hdlr || str4(b, hdlr.body + 8) !== 'soun') continue;
      const mdhd = child(b, mdia, 'mdhd'), v = b[mdhd.body];
      const timescale = v === 1 ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
      const stbl = path(b, mdia, ['minf', 'stbl']);
      if (!stbl) continue;
      const stsd = child(b, stbl, 'stsd'), e = stsd.body + 8, entryEnd = e + u32(b, e), format = str4(b, e + 4);
      const ver = u16(b, e + 16);
      let channels = u16(b, e + 24), bits = u16(b, e + 26), rate = u32(b, e + 32) / 65536, kids = e + 36, flags = 0, bpf = 0;
      if (ver === 1) { bpf = u32(b, e + 44); kids = e + 52; }
      if (ver === 2) {
        rate = new DataView(b.buffer, b.byteOffset + e + 40, 8).getFloat64(0, false);
        channels = u32(b, e + 48); bits = u32(b, e + 56); flags = u32(b, e + 60); kids = e + 72;
      }
      if (!rate) rate = timescale;
      // Décalage de présentation (liste de montage) : silence ajouté devant, début des médias.
      let delay = 0, mediaTime = 0;
      const elst = path(b, trak, ['edts', 'elst']);
      if (elst) {
        const ev = b[elst.body], cnt = u32(b, elst.body + 4);
        let o = elst.body + 8;
        for (let i = 0; i < cnt; i++) {
          const dur = ev === 1 ? u64(b, o) : u32(b, o), mt = ev === 1 ? (u32(b, o + 8) === 0xffffffff ? -1 : u64(b, o + 8)) : s32(b, o + 4);
          o += ev === 1 ? 20 : 12;
          if (mt === -1) { delay += dur / movieTimescale; continue; }
          mediaTime = mt;
          break;
        }
      }
      const info = { kind: 'mp4', format, sampleRate: rate, channels, timescale, delay, mediaTime, stbl, entry: { start: e, kids, end: entryEnd } };
      if (format === 'mp4a') {
        const esds = scan(b, kids, entryEnd, 'esds');
        if (!esds) throw new Error('AAC sans configuration (esds)');
        info.codec = 'aac';
        info.asc = parseAsc(b, esds);
        info.sampleRate = info.asc.rate || rate;
        info.channels = info.asc.channels || channels;
        return info;
      }
      let pcm = null;
      if (PCM_FORMATS[format]) {
        const f = PCM_FORMATS[format];
        pcm = { bits: format === 'twos' && bits === 8 ? 8 : f.bits, bigEndian: f.bigEndian, float: !!f.float, signed: !f.unsigned };
        const enda = scan(b, kids, entryEnd, 'enda');
        if (enda && u16(b, enda.body) === 1) pcm.bigEndian = false;
      } else if (format === 'lpcm') {
        pcm = { bits, float: !!(flags & 1), bigEndian: !!(flags & 2), signed: !!(flags & 4) || !(flags & 1) };
      } else if (format === 'ipcm' || format === 'fpcm') {
        const c = scan(b, kids, entryEnd, 'pcmC');
        pcm = { bits: c ? b[c.body + 5] : bits, bigEndian: c ? !(b[c.body + 4] & 1) : true, float: format === 'fpcm', signed: true };
      }
      if (!pcm) throw new Error('Son « ' + format.trim() + ' » non pris en charge');
      pcm.channels = channels;
      info.codec = 'pcm';
      info.pcm = pcm;
      info.frame = bpf || channels * pcm.bits / 8;
      return info;
    }
    throw new Error('Aucune piste son dans ce fichier');
  }

  // AudioSpecificConfig (profil, fréquence, canaux) dans esds.
  function parseAsc(b, esds) {
    let p = esds.body + 4;
    const end = esds.end;
    const len = () => { let n = 0, c; do { c = b[p++]; n = (n << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return n; };
    while (p < end) {
      const tag = b[p++], l = len();
      if (tag === 0x03) { p += 3; continue; }
      if (tag === 0x04) { p += 13; continue; }
      if (tag === 0x05) {
        const a = b[p], c = b[p + 1];
        let objectType = a >> 3, freqIndex = ((a & 7) << 1) | (c >> 7), ch = (c >> 3) & 15, rate = 0;
        const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        if (freqIndex === 15) { rate = ((a & 7) << 21) | (c & 0x7f) << 14 | (b[p + 2] << 6) | (b[p + 3] >> 2); ch = (b[p + 4] >> 3) & 15; } else rate = RATES[freqIndex];
        if (objectType === 31) objectType = 32 + (((a & 7) << 3) | (c >> 5));
        return { objectType, freqIndex, rate, channels: ch };
      }
      p += l;
    }
    throw new Error('Configuration AAC introuvable');
  }

  // Tables d'échantillons (temps, position, taille), par morceau (chunk).
  function sampleTables(b, stbl) {
    const g = t => child(b, stbl, t);
    const stts = g('stts'), stsc = g('stsc'), stsz = g('stsz'), stco = g('stco') || g('co64'), co64 = !g('stco');
    const runs = [];
    for (let i = 0, o = stts.body + 8, n = u32(b, stts.body + 4); i < n; i++, o += 8) runs.push([u32(b, o), u32(b, o + 4)]);
    const chunkRuns = [];
    for (let i = 0, o = stsc.body + 8, n = u32(b, stsc.body + 4); i < n; i++, o += 12) chunkRuns.push([u32(b, o), u32(b, o + 4)]);
    const offsets = [];
    for (let i = 0, o = stco.body + 8, n = u32(b, stco.body + 4); i < n; i++, o += co64 ? 8 : 4) offsets.push(co64 ? u64(b, o) : u32(b, o));
    const uniform = u32(b, stsz.body + 4), count = u32(b, stsz.body + 8);
    const sizeOf = k => (uniform ? uniform : u32(b, stsz.body + 12 + 4 * k));
    return { runs, chunkRuns, offsets, uniform, count, sizeOf };
  }

  // Durée de chaque échantillon : itérateur sur les plages stts.
  function deltas(runs) {
    let r = 0, left = runs.length ? runs[0][0] : 0;
    return () => {
      while (left === 0 && r < runs.length - 1) left = runs[++r][0];
      left--;
      return runs.length ? runs[r][1] : 0;
    };
  }

  function chunkList(t) {
    const out = [];
    let sample = 0;
    for (let c = 0; c < t.offsets.length; c++) {
      let spc = 0;
      for (let i = 0; i < t.chunkRuns.length; i++) if (t.chunkRuns[i][0] <= c + 1) spc = t.chunkRuns[i][1];
      out.push({ offset: t.offsets[c], first: sample, count: spc });
      sample += spc;
    }
    return out;
  }

  async function probeMp4(io, size) {
    const top = await topBoxes(io, size);
    const moovBox = top.find(x => x.type === 'moov');
    if (!moovBox) return null;
    if (moovBox.end - moovBox.start > 96 * 1024 * 1024) throw new Error('En-tête MP4 trop gros');
    const b = await io.read(moovBox.start, moovBox.end - moovBox.start);
    const moov = { type: 'moov', start: 0, body: moovBox.body - moovBox.start, end: b.length };
    const mvhd = child(b, moov, 'mvhd');
    const movieTimescale = mvhd ? (b[mvhd.body] === 1 ? u32(b, mvhd.body + 20) : u32(b, mvhd.body + 12)) : 1000;
    const info = audioTrack(b, moov, movieTimescale);
    const t = sampleTables(b, info.stbl);
    info.chunks = chunkList(t);
    info.tables = t;
    // Temps de début de chaque morceau.
    const next = deltas(t.runs);
    let time = 0, k = 0;
    info.chunks.forEach(c => {
      c.time = time;
      c.bytes = 0;
      c.sizes = info.codec === 'aac' ? [] : null;
      c.times = info.codec === 'aac' ? [] : null;
      for (let i = 0; i < c.count; i++, k++) {
        const d = next(), size = t.sizeOf(k);
        if (info.codec === 'aac') { c.sizes.push(size); c.times.push(time); }
        else c.bytes += info.timescale === info.sampleRate ? Math.max(size, d * info.frame) : (size > 1 ? size : d * info.frame);
        time += d;
      }
      c.end = time;
    });
    info.duration = time / info.timescale;
    info.bytes = b;
    return info;
  }

  const presentation = (info, mediaUnits) => (mediaUnits - info.mediaTime) / info.timescale + info.delay;

  async function readMp4Pcm(io, info, t0, t1) {
    const sr = info.sampleRate, n = Math.max(0, Math.round((t1 - t0) * sr)), out = new Float32Array(n);
    for (const c of info.chunks) {
      const cs = presentation(info, c.time), ce = presentation(info, c.end);
      if (ce <= t0 || cs >= t1 || !c.bytes) continue;
      const mono = pcmToMono(await io.read(c.offset, c.bytes), info.pcm);
      const at = Math.round((cs - t0) * sr);
      for (let i = Math.max(0, -at); i < mono.length && at + i < n; i++) out[at + i] = mono[i];
    }
    return { samples: out, sampleRate: sr, start: t0 };
  }

  // Flux ADTS (en-tête de 7 octets devant chaque trame AAC), décodable par le navigateur.
  function adtsHeader(asc, len) {
    const total = len + 7, h = new Uint8Array(7), profile = Math.max(0, Math.min(3, asc.objectType - 1));
    h[0] = 0xff; h[1] = 0xf1;
    h[2] = (profile << 6) | (asc.freqIndex << 2) | ((asc.channels >> 2) & 1);
    h[3] = ((asc.channels & 3) << 6) | ((total >> 11) & 3);
    h[4] = (total >> 3) & 0xff;
    h[5] = ((total & 7) << 5) | 0x1f;
    h[6] = 0xfc;
    return h;
  }

  async function readMp4Aac(io, info, t0, t1) {
    if (info.asc.freqIndex === 15) throw new Error('Fréquence AAC non standard');
    const frames = [];
    let start = null;
    for (const c of info.chunks) {
      const cs = presentation(info, c.time), ce = presentation(info, c.end);
      if (ce <= t0 - 0.25 || cs >= t1 + 0.1) continue;
      let pos = c.offset;
      for (let i = 0; i < c.sizes.length; i++) {
        const st = presentation(info, c.times[i]);
        if (st >= t0 - 0.25 && st < t1 + 0.1) {
          if (start === null) start = st;
          frames.push({ pos, size: c.sizes[i] });
        }
        pos += c.sizes[i];
      }
    }
    if (!frames.length) return { adts: new Uint8Array(0), sampleRate: info.sampleRate, start: t0 };
    const parts = [];
    let total = 0, i = 0;
    while (i < frames.length) {
      let j = i, end = frames[i].pos + frames[i].size;
      while (j + 1 < frames.length && frames[j + 1].pos === end) { j++; end += frames[j].size; }
      const bytes = await io.read(frames[i].pos, end - frames[i].pos);
      let o = 0;
      for (let k = i; k <= j; k++) {
        parts.push(adtsHeader(info.asc, frames[k].size), bytes.subarray(o, o + frames[k].size));
        o += frames[k].size;
        total += 7 + frames[k].size;
      }
      i = j + 1;
    }
    const adts = new Uint8Array(total);
    let o = 0;
    parts.forEach(p => { adts.set(p, o); o += p.length; });
    return { adts, sampleRate: info.sampleRate, start };
  }

  // ---------------------------------------------------------------- entrée

  async function probe(io) {
    const size = await io.size();
    if (size < 12) throw new Error('Fichier vide');
    const head = await io.read(0, 12);
    if (/RIFF|RF64|BW64/.test(str4(head, 0))) {
      const w = await probeWav(io, size);
      if (w) return w;
    }
    const m = await probeMp4(io, size);
    if (m) return m;
    return { kind: 'other', size };
  }

  // Le son de [t0, t1] : { samples (mono), sampleRate, start } ou, pour l'AAC, { adts, … }.
  async function readWindow(io, info, t0, t1) {
    if (info.kind === 'wav') return readWav(io, info, t0, t1);
    if (info.kind === 'mp4' && info.codec === 'pcm') return readMp4Pcm(io, info, t0, t1);
    if (info.kind === 'mp4' && info.codec === 'aac') return readMp4Aac(io, info, t0, t1);
    throw new Error('Format non lu directement');
  }

  // ---------------------------------------------------------------- accès aux fichiers

  function nodeIO(fs, file) {
    let fd = null, size = null;
    const open = () => { if (fd === null) fd = fs.openSync(file, 'r'); return fd; };
    return {
      async size() { if (size === null) size = fs.statSync(file).size; return size; },
      async read(pos, len) {
        const buf = Buffer.alloc(Math.max(0, len));
        let done = 0;
        while (done < len) {
          const n = fs.readSync(open(), buf, done, len - done, pos + done);
          if (!n) break;
          done += n;
        }
        return new Uint8Array(buf.buffer, buf.byteOffset, done);
      },
      close() { if (fd !== null) { fs.closeSync(fd); fd = null; } }
    };
  }

  function blobIO(blob) {
    return {
      async size() { return blob.size; },
      async read(pos, len) { return new Uint8Array(await blob.slice(pos, pos + len).arrayBuffer()); },
      close() {}
    };
  }

  return { pcmToMono, probe, readWindow, adtsHeader, parseAsc, nodeIO, blobIO, boxes };
});
