// Tiny palette extractor. Downsamples cover art and picks 5 prominent colors
// using a quick k-means-ish bucketing in HSL space.

export const PRESETS = {
  neon:    [[0.95,0.20,0.85],[0.20,0.95,0.85],[1.00,0.85,0.10],[1.00,0.30,0.50],[0.30,0.80,1.00]],
  sunset:  [[1.00,0.45,0.25],[0.95,0.20,0.55],[0.40,0.10,0.55],[1.00,0.85,0.50],[0.20,0.10,0.30]],
  aqua:    [[0.10,0.80,0.95],[0.20,0.40,0.95],[0.50,0.95,0.85],[0.90,0.95,0.95],[0.05,0.20,0.40]],
  mono:    [[1.00,1.00,1.00],[0.80,0.80,0.80],[0.55,0.55,0.55],[0.30,0.30,0.30],[0.10,0.10,0.10]],
  forest:  [[0.20,0.55,0.30],[0.10,0.30,0.20],[0.60,0.80,0.30],[0.85,0.85,0.45],[0.05,0.15,0.10]],
  ember:   [[0.95,0.30,0.10],[0.65,0.10,0.10],[1.00,0.65,0.20],[0.20,0.05,0.05],[1.00,0.85,0.55]],
};

export async function extractFromImageURL(url) {
  if (!url) return PRESETS.neon;
  try {
    const img = await loadImage(url);
    return extractFromImage(img);
  } catch {
    return PRESETS.neon;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function extractFromImage(img) {
  const W = 64, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  // Bucket by (h coarse, s coarse, l coarse). Skip near-greys & near-black pixels.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i+1] / 255, b = data[i+2] / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const l = (max + min) / 2;
    if (l < 0.05 || l > 0.97) continue;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2*l - 1));
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const key = (Math.round(h / 20) * 20) + ',' + Math.round(s * 4) + ',' + Math.round(l * 6);
    let bin = buckets.get(key);
    if (!bin) { bin = { r:0, g:0, b:0, n:0, sat:s, lit:l }; buckets.set(key, bin); }
    bin.r += r; bin.g += g; bin.b += b; bin.n += 1;
  }
  // sort by count, prefer some saturation
  const bins = [...buckets.values()].map(b => ({
    r: b.r/b.n, g: b.g/b.n, bl: b.b/b.n, n: b.n, score: b.n * (0.3 + b.sat),
  }));
  bins.sort((a, b) => b.score - a.score);
  const picks = bins.slice(0, 5).map(b => [b.r, b.g, b.bl]);
  while (picks.length < 5) picks.push([0.6, 0.6, 0.6]);
  return picks;
}
