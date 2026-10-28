/* CutFX — in-panel preview. Approximates the Premiere effects on two synthetic
   shots so parameters can be judged before anything touches the timeline. */
(function (root) {
  'use strict';
  const Core = root.CutFXCore;
  const W = 320, H = 180;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ---------------------------------------------------------------- shots

  function shotA() {
    const c = makeCanvas(W, H), g = c.getContext('2d');
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2b1055'); gr.addColorStop(0.55, '#d76d77'); gr.addColorStop(1, '#ffaf7b');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,236,190,0.95)';
    g.beginPath(); g.arc(W * 0.66, H * 0.56, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a1c4a';
    g.beginPath(); g.moveTo(0, H * 0.72);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, H * 0.72 - 18 * Math.abs(Math.sin(x * 0.021)) - 8 * Math.sin(x * 0.07));
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.fillStyle = '#1d0f2a';
    g.fillRect(0, H * 0.84, W, H * 0.16);
    g.fillStyle = 'rgba(255,200,150,0.35)';
    for (let x = 6; x < W; x += 22) g.fillRect(x, H * 0.88, 10, 3);
    g.fillStyle = '#120818';
    g.beginPath(); g.ellipse(W * 0.3, H * 0.62, 9, 11, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(W * 0.3 - 12, H * 0.66, 24, 32);
    return c;
  }

  function shotB() {
    const c = makeCanvas(W, H), g = c.getContext('2d');
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#0b1a2e'); gr.addColorStop(1, '#1f4068');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(230,240,255,0.9)';
    g.beginPath(); g.arc(W * 0.18, H * 0.2, 12, 0, Math.PI * 2); g.fill();
    const blds = [[10, 70], [42, 110], [80, 60], [112, 130], [150, 90], [190, 120], [228, 75], [262, 140], [298, 95]];
    blds.forEach(([x, hgt], n) => {
      g.fillStyle = n % 2 ? '#0f2238' : '#132b47';
      g.fillRect(x, H - hgt, 30, hgt);
      g.fillStyle = 'rgba(255,214,120,0.85)';
      for (let y = H - hgt + 8; y < H - 10; y += 12) for (let wx = x + 5; wx < x + 26; wx += 9) if (Core.hash(wx * 3 + y, n) > 0.45) g.fillRect(wx, y, 4, 5);
    });
    g.fillStyle = '#00e5ff';
    g.fillRect(0, H - 6, W, 2);
    g.fillStyle = '#ff2e88';
    g.fillRect(0, H - 3, W, 1);
    return c;
  }

  let SHOTS = null;
  function shots() {
    if (!SHOTS) SHOTS = { A: shotA(), B: shotB() };
    return SHOTS;
  }

  // ---------------------------------------------------------------- state

  function baseState() {
    return { scale: 1, px: 0, py: 0, rot: 0, opacity: 1, shutter: 0, blur: 0, dlen: 0, dang: 90, bright: 0, contrast: 0, ox: 0, oy: 0, wave: 0, waveW: 60, lens: 0 };
  }

  function valueAt(pr, i) {
    if (pr.values) return pr.values[Math.max(0, Math.min(pr.values.length - 1, i))];
    return pr.static;
  }

  function pointNorm(v, fx, pr) {
    if (!Array.isArray(v)) return [0.5, 0.5];
    if (pr.raw && (Math.abs(v[0]) > 2 || Math.abs(v[1]) > 2)) return [v[0] / (fx.frameW || 1920), v[1] / (fx.frameH || 1080)];
    return v;
  }

  function stateAt(spec, i) {
    const s = baseState();
    if (!spec) return s;
    spec.forEach(fx => fx.props.forEach(pr => {
      if (!pr.key) return;
      const v = valueAt(pr, i);
      switch (fx.type + '.' + pr.key) {
        case 'transform.scale': case 'motion.scale': s.scale *= v / 100; break;
        case 'transform.position': case 'motion.position': { const p = pointNorm(v, fx, pr); s.px += p[0] - 0.5; s.py += p[1] - 0.5; break; }
        case 'transform.rotation': case 'motion.rotation': s.rot += v; break;
        case 'transform.opacity': case 'opacity.opacity': s.opacity *= v / 100; break;
        case 'transform.shutter': s.shutter = Math.max(s.shutter, v); break;
        case 'gaussian.blur': s.blur += v; break;
        case 'directional.length': s.dlen += v; break;
        case 'directional.direction': s.dang = v; break;
        case 'bc.brightness': s.bright += v; break;
        case 'bc.contrast': s.contrast += v; break;
        case 'offset.center': { const p = pointNorm(v, fx, pr); s.ox += p[0] - 0.5; s.oy += p[1] - 0.5; break; }
        case 'wave.height': s.wave += v; break;
        case 'wave.width': s.waveW = v; break;
        case 'lens.curvature': s.lens += v; break;
        default: break;
      }
    }));
    return s;
  }

  // ---------------------------------------------------------------- render

  const tmp0 = makeCanvas(W, H), tmp1 = makeCanvas(W, H), tmp2 = makeCanvas(W, H);

  // Offset (wrapping edges) then wave warp.
  function warp(img, st) {
    const g0 = tmp0.getContext('2d');
    g0.clearRect(0, 0, W, H);
    const dx = ((st.ox * W) % W + W) % W, dy = ((st.oy * H) % H + H) % H;
    for (const tx of [dx - W, dx]) for (const ty of [dy - H, dy]) g0.drawImage(img, tx, ty);
    if (st.wave <= 0.5) return tmp0;
    const g = tmp1.getContext('2d'), band = 3;
    g.clearRect(0, 0, W, H);
    for (let y = 0; y < H; y += band) {
      const off = Math.sin(y / Math.max(4, st.waveW) * Math.PI * 2) * st.wave * 0.35;
      g.drawImage(tmp0, 0, y, W, band, off, y, W, band);
      g.drawImage(tmp0, 0, y, W, band, off - Math.sign(off || 1) * W, y, W, band);
    }
    return tmp1;
  }

  function drawTransformed(g, src, st, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(W / 2 + st.px * W, H / 2 + st.py * H);
    g.rotate(st.rot * Math.PI / 180);
    const lensScale = 1 + Math.max(0, -st.lens) / 220 + Math.max(0, st.lens) / 400;
    g.scale(st.scale * lensScale, st.scale * lensScale);
    g.drawImage(src, -W / 2, -H / 2);
    g.restore();
  }

  function mix(a, b, t) {
    const o = {};
    for (const k in a) o[k] = a[k] + (b[k] - a[k]) * t;
    return o;
  }

  function render(ctx, img, st, prev) {
    const out = ctx.canvas;
    const sx = out.width / W, sy = out.height / H;
    const g = tmp2.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const src = warp(img, st);
    const filt = [];
    if (st.blur > 0.3) filt.push('blur(' + (st.blur * 0.12).toFixed(2) + 'px)');
    if (Math.abs(st.bright) > 0.5) filt.push('brightness(' + Math.max(0, 1 + st.bright / 55).toFixed(3) + ')');
    if (Math.abs(st.contrast) > 0.5) filt.push('contrast(' + Math.max(0, 1 + st.contrast / 100).toFixed(3) + ')');
    g.filter = filt.length ? filt.join(' ') : 'none';
    const moving = prev && (Math.abs(prev.scale - st.scale) > 0.002 || Math.abs(prev.px - st.px) > 0.001 || Math.abs(prev.py - st.py) > 0.001 || Math.abs(prev.rot - st.rot) > 0.05);
    if (st.shutter > 1 && moving) {
      const n = 7, span = st.shutter / 360;
      for (let j = 0; j < n; j++) drawTransformed(g, src, mix(st, prev, span * j / (n - 1)), 1 / (j + 1));
    } else {
      drawTransformed(g, src, st, 1);
    }
    g.filter = 'none';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.scale(sx, sy);
    if (st.dlen > 1) {
      const n = 8, len = st.dlen * 0.35, a = (st.dang - 90) * Math.PI / 180;
      for (let j = 0; j < n; j++) {
        const d = (j / (n - 1) - 0.5) * len;
        ctx.globalAlpha = 1 / (j + 1);
        ctx.drawImage(tmp2, Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(tmp2, 0, 0);
    }
    if (st.opacity < 0.999) {
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.max(0, st.opacity)).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // A timeline of frames: some A, the PRE window, the POST window, some B.
  function buildTimeline(specs, N, hold) {
    hold = hold == null ? 6 : hold;
    const frames = [];
    for (let i = 0; i < hold; i++) frames.push({ shot: 'A', spec: null, i: 0, zone: 'A' });
    for (let i = 0; i < N.pre; i++) frames.push({ shot: 'A', spec: specs.pre, i, zone: specs.pre ? 'pre' : 'A' });
    for (let i = 0; i < N.post; i++) frames.push({ shot: 'B', spec: specs.post, i, zone: specs.post ? 'post' : 'B' });
    for (let i = 0; i < hold; i++) frames.push({ shot: 'B', spec: null, i: 0, zone: 'B' });
    return frames;
  }

  function renderTimelineFrame(ctx, frames, n) {
    const f = frames[n], p = frames[n - 1];
    const st = stateAt(f.spec, f.i);
    const prev = p && p.shot === f.shot ? stateAt(p.spec, p.i) : null;
    render(ctx, shots()[f.shot], st, prev);
  }

  // ---------------------------------------------------------------- speed ramp scene

  function drawRampScene(ctx, tau, speed) {
    const out = ctx.canvas, g = ctx;
    g.save();
    g.setTransform(out.width / W, 0, 0, out.height / H, 0, 0);
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#12233d'); gr.addColorStop(1, '#3b5b8a');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0d1a2c';
    for (let k = 0; k < 9; k++) {
      const x = ((k * 46 - tau * 1.2) % (9 * 46) + 9 * 46) % (9 * 46) - 30;
      g.fillRect(x, H * 0.38 - (k % 3) * 14, 34, H * 0.4);
    }
    g.fillStyle = '#1b1f27'; g.fillRect(0, H * 0.72, W, H * 0.28);
    g.fillStyle = '#e8c547';
    for (let k = 0; k < 12; k++) {
      const x = ((k * 40 - tau * 7) % 480 + 480) % 480 - 40;
      g.fillRect(x, H * 0.86, 22, 3);
    }
    for (let k = 0; k < 5; k++) {
      const x = ((k * 90 - tau * 5) % 450 + 450) % 450 - 30;
      g.fillStyle = '#2a3242'; g.fillRect(x, H * 0.3, 3, H * 0.42);
      g.fillStyle = 'rgba(255,220,140,0.9)'; g.beginPath(); g.arc(x + 1.5, H * 0.3, 4, 0, Math.PI * 2); g.fill();
    }
    const cx = W * 0.42, cy = H * 0.74;
    g.fillStyle = '#e5484d';
    g.beginPath(); g.roundRect ? g.roundRect(cx - 42, cy - 26, 84, 20, 6) : g.rect(cx - 42, cy - 26, 84, 20); g.fill();
    g.fillStyle = '#c23a3f'; g.beginPath(); g.moveTo(cx - 22, cy - 26); g.lineTo(cx - 12, cy - 40); g.lineTo(cx + 18, cy - 40); g.lineTo(cx + 28, cy - 26); g.fill();
    g.fillStyle = 'rgba(180,220,255,0.8)'; g.fillRect(cx - 9, cy - 37, 12, 10); g.fillRect(cx + 6, cy - 37, 12, 10);
    [cx - 24, cx + 24].forEach(wx => {
      g.fillStyle = '#111'; g.beginPath(); g.arc(wx, cy - 5, 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#bbb'; g.lineWidth = 2;
      const a = tau * 0.9;
      g.beginPath(); g.moveTo(wx + Math.cos(a) * 7, cy - 5 + Math.sin(a) * 7); g.lineTo(wx - Math.cos(a) * 7, cy - 5 - Math.sin(a) * 7); g.stroke();
    });
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(8, 8, 66, 20);
    g.fillStyle = speed > 100.5 ? '#ffb340' : (speed < 99.5 ? '#7cc4ff' : '#e6e6e6');
    g.font = '600 12px system-ui, sans-serif';
    g.fillText(Math.round(speed) + ' %', 16, 22);
    g.restore();
  }

  root.CutFXPreview = { W, H, stateAt, render, buildTimeline, renderTimelineFrame, drawRampScene, shots };
})(typeof self !== 'undefined' ? self : this);
