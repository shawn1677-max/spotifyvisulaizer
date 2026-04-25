// Per-frame AudioFeatures.
//
// We support two sources:
//   AnalysisSource — driven by Spotify's pre-computed Audio Analysis (no DRM issue).
//                    Produces: bass/mid/treble envelopes, beat phase, downbeat phase,
//                    section energy, 12-d chroma (pitches), 12-d timbre, "spectrum"
//                    of 32 log-bins synthesized from chroma+timbre.
//   MicSource     — getUserMedia + AnalyserNode FFT, real spectrum.
//
// Both expose the same shape so visualizers don't care which is active.

export const NUM_BINS = 64;

export function makeFeatures() {
  return {
    // smoothed envelopes 0..~1
    bass: 0, mid: 0, treble: 0, level: 0, peak: 0,
    // log-binned spectrum 0..1
    spectrum: new Float32Array(NUM_BINS),
    // raw waveform, -1..1 (kept at 256 to fit comfortably in fragment uniforms)
    waveform: new Float32Array(256),
    // 12-d chroma (pitch class energy) 0..1
    chroma: new Float32Array(12),
    // beat info
    beatPhase: 0,         // 0..1 within current beat
    barPhase: 0,          // 0..1 within current bar
    sectionPhase: 0,      // 0..1 within current section
    beatPunch: 0,         // 1.0 on beat onset, exp-decaying to 0
    barPunch: 0,
    sectionPunch: 0,
    bpm: 120,
    timeSignature: 4,
    // section "color" 0..1, derives from timbre
    sectionMood: 0.5,
    // monotonic time
    t: 0,
  };
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Spotify Analysis source ----------

export class AnalysisSource {
  constructor() {
    this.analysis = null;
    this.trackId = null;
    this.startedAt = 0;          // performance.now() reference for position 0
    this.basePositionMs = 0;     // last known SDK position (ms) at lastUpdate
    this.lastUpdate = 0;         // performance.now() at lastUpdate
    this.paused = true;
    this.smoothing = 0.6;
    this.bandGain = { bass: 1, mid: 1, treble: 1 };
    this.beatPunchGain = 1;

    // smoothed values
    this._bass = 0; this._mid = 0; this._treble = 0; this._level = 0;
    this._peak = 0; this._spectrum = new Float32Array(NUM_BINS);
    this._chroma = new Float32Array(12);
    this._beatPunch = 0; this._barPunch = 0; this._sectionPunch = 0;

    // last seen indices (for onset detection)
    this._lastBeatIdx = -1;
    this._lastBarIdx = -1;
    this._lastSectionIdx = -1;
  }

  setAnalysis(trackId, analysis) {
    this.trackId = trackId;
    this.analysis = analysis;
    this._lastBeatIdx = -1;
    this._lastBarIdx = -1;
    this._lastSectionIdx = -1;
  }

  // Called whenever Web Playback emits a state change.
  syncState(state) {
    if (!state) return;
    this.paused = state.paused;
    this.basePositionMs = state.position;
    this.lastUpdate = performance.now();
  }

  positionMs() {
    if (this.paused) return this.basePositionMs;
    return this.basePositionMs + (performance.now() - this.lastUpdate);
  }

  // Binary search for index of segment whose start <= t < start+duration.
  _find(arr, t) {
    if (!arr || !arr.length) return -1;
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].start <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  update(out, dt) {
    out.t += dt;
    if (!this.analysis) {
      this._decayAndCommit(out, dt, /*signal=*/0);
      return;
    }
    const t = this.positionMs() / 1000;

    const a = this.analysis;
    const bIdx = this._find(a.beats, t);
    const barIdx = this._find(a.bars, t);
    const sIdx = this._find(a.sections, t);
    const segIdx = this._find(a.segments, t);

    const beat = bIdx >= 0 ? a.beats[bIdx] : null;
    const bar = barIdx >= 0 ? a.bars[barIdx] : null;
    const section = sIdx >= 0 ? a.sections[sIdx] : null;
    const seg = segIdx >= 0 ? a.segments[segIdx] : null;

    // Beat / bar / section phases
    if (beat) out.beatPhase = clamp((t - beat.start) / Math.max(beat.duration, 0.05));
    if (bar) out.barPhase = clamp((t - bar.start) / Math.max(bar.duration, 0.5));
    if (section) {
      out.sectionPhase = clamp((t - section.start) / Math.max(section.duration, 1));
      out.bpm = section.tempo || a.track?.tempo || 120;
      out.timeSignature = section.time_signature || a.track?.time_signature || 4;
    } else {
      out.bpm = a.track?.tempo || 120;
    }

    // Onset punches
    if (bIdx !== this._lastBeatIdx) { this._beatPunch = 1; this._lastBeatIdx = bIdx; }
    if (barIdx !== this._lastBarIdx) { this._barPunch = 1; this._lastBarIdx = barIdx; }
    if (sIdx !== this._lastSectionIdx) { this._sectionPunch = 1; this._lastSectionIdx = sIdx; }
    const decay = Math.exp(-dt * 4.0);
    this._beatPunch *= decay;
    this._barPunch *= Math.exp(-dt * 2.0);
    this._sectionPunch *= Math.exp(-dt * 0.6);

    // Loudness from segment (dB) → linear envelope.
    let segLoud = -60;
    let segPos = 0;
    if (seg) {
      const sStart = seg.loudness_start ?? -60;
      const sMax = seg.loudness_max ?? -60;
      const tMax = seg.loudness_max_time ?? 0;
      const len = Math.max(seg.duration, 0.05);
      const local = clamp((t - seg.start) / len);
      // Triangle envelope: rise to peak at tMax/len, fall to next-segment start (approximated as sStart).
      const peakAt = clamp(tMax / len, 0.001, 0.999);
      segLoud = local < peakAt
        ? lerp(sStart, sMax, local / peakAt)
        : lerp(sMax, sStart, (local - peakAt) / (1 - peakAt));
      segPos = local;
    }
    // dB → 0..1 (Spotify loudness ~ -60..0; consider -20 as "loud")
    const linLoud = clamp((segLoud + 60) / 60); // 0..1, very compressed

    // Pitch (chroma) and timbre from segment.
    if (seg) {
      const pitches = seg.pitches || [];
      for (let i = 0; i < 12; i++) {
        const v = pitches[i] ?? 0;
        this._chroma[i] = lerp(this._chroma[i], v, 0.25);
      }
      // Timbre[0] is overall loudness, [1] brightness, [2] flatness, [3] attack…
      const timbre = seg.timbre || [];
      const brightness = clamp((timbre[1] ?? 0) / 200 + 0.5);
      const attack = clamp((timbre[3] ?? 0) / 200 + 0.5);
      out.sectionMood = lerp(out.sectionMood, brightness, 0.05);

      // Synthesize a spectrum from chroma + timbre.
      // Lower bins ← bass-ish (loudness + first 2 chroma weighted), upper ← brightness + treble timbre.
      for (let i = 0; i < NUM_BINS; i++) {
        const f = i / (NUM_BINS - 1);  // 0..1 frequency-ish
        const chr = this._chroma[Math.floor(f * 11.999)];
        // Pink-ish slope, beat punch boosts low end, brightness boosts high.
        const lowBoost = (1 - f) * (linLoud * 1.2 + this._beatPunch * 0.6);
        const midBoost = Math.exp(-Math.pow((f - 0.4) / 0.25, 2)) * (linLoud + chr * 0.6);
        const hiBoost = f * (brightness * 0.9 + attack * 0.4);
        const v = clamp(lowBoost * 0.6 + midBoost * 0.7 + hiBoost * 0.6, 0, 1);
        // Smooth
        this._spectrum[i] = lerp(this._spectrum[i], v, 1 - this.smoothing);
      }
    } else {
      // decay
      for (let i = 0; i < NUM_BINS; i++) this._spectrum[i] *= 0.92;
      for (let i = 0; i < 12; i++) this._chroma[i] *= 0.95;
    }

    // Bands from spectrum:
    const bassIdx = Math.floor(NUM_BINS * 0.18);
    const midIdx = Math.floor(NUM_BINS * 0.55);
    let b = 0, m = 0, h = 0;
    for (let i = 0; i < bassIdx; i++) b += this._spectrum[i];
    for (let i = bassIdx; i < midIdx; i++) m += this._spectrum[i];
    for (let i = midIdx; i < NUM_BINS; i++) h += this._spectrum[i];
    b /= bassIdx; m /= (midIdx - bassIdx); h /= (NUM_BINS - midIdx);

    const bg = this.bandGain;
    this._bass = lerp(this._bass, clamp(b * bg.bass), 1 - this.smoothing);
    this._mid = lerp(this._mid, clamp(m * bg.mid), 1 - this.smoothing);
    this._treble = lerp(this._treble, clamp(h * bg.treble), 1 - this.smoothing);

    // overall level & peak
    const lvl = (this._bass + this._mid + this._treble) / 3;
    this._level = lerp(this._level, lvl, 1 - this.smoothing);
    this._peak = Math.max(this._peak * 0.96, lvl);

    // Synthesize a smooth-ish waveform from beat phase and segment loudness for visualizers that want one.
    // Sum of a few sinusoids weighted by chroma — purely visual.
    const wf = out.waveform;
    const N = wf.length;
    const phase = (out.t * 2 * Math.PI) % (2 * Math.PI);
    for (let i = 0; i < N; i++) {
      const x = i / N;
      let v = 0;
      for (let h = 0; h < 6; h++) {
        const k = h + 1;
        const amp = this._chroma[(h * 2) % 12] * 0.4 + 0.05;
        v += amp * Math.sin((x * 6.283 * k) + phase * k);
      }
      v *= (0.4 + this._level * 0.9);
      wf[i] = lerp(wf[i], v, 0.4);
    }

    // commit
    out.bass = this._bass;
    out.mid = this._mid;
    out.treble = this._treble;
    out.level = this._level;
    out.peak = this._peak;
    out.spectrum.set(this._spectrum);
    out.chroma.set(this._chroma);
    out.beatPunch = this._beatPunch * this.beatPunchGain;
    out.barPunch = this._barPunch;
    out.sectionPunch = this._sectionPunch;
  }

  _decayAndCommit(out, dt, signal) {
    this._bass *= 0.94; this._mid *= 0.94; this._treble *= 0.94;
    this._level *= 0.94; this._peak *= 0.94;
    for (let i = 0; i < NUM_BINS; i++) this._spectrum[i] *= 0.92;
    this._beatPunch *= Math.exp(-dt * 4);
    this._barPunch *= Math.exp(-dt * 2);
    this._sectionPunch *= Math.exp(-dt * 0.6);
    out.bass = this._bass; out.mid = this._mid; out.treble = this._treble;
    out.level = this._level; out.peak = this._peak;
    out.spectrum.set(this._spectrum);
    out.chroma.set(this._chroma);
    out.beatPunch = this._beatPunch;
    out.barPunch = this._barPunch;
    out.sectionPunch = this._sectionPunch;
  }
}

// ---------- Mic / system audio source ----------

export class MicSource {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.fftSize = 2048;
    this.bandGain = { bass: 1, mid: 1, treble: 1 };
    this.smoothing = 0.6;
    this.beatPunchGain = 1;
    this._spec = new Float32Array(NUM_BINS);
    this._wave = new Float32Array(256);
    this._fftBuf = null;
    this._timeBuf = null;
    this._bass = 0; this._mid = 0; this._treble = 0; this._level = 0; this._peak = 0;
    this._beatPunch = 0;
    this._lastBassPeak = 0;
    this._lastBeatTime = -1;
    this.bpm = 120;
  }

  async start() {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = this.fftSize;
    an.smoothingTimeConstant = 0.7;
    src.connect(an);
    this.ctx = ctx; this.analyser = an;
    this._fftBuf = new Float32Array(an.frequencyBinCount);
    this._timeBuf = new Float32Array(an.fftSize);
  }

  stop() {
    try { this.ctx?.close(); } catch {}
    this.ctx = null; this.analyser = null;
  }

  update(out, dt) {
    out.t += dt;
    if (!this.analyser) {
      // decay
      this._bass *= 0.94; this._mid *= 0.94; this._treble *= 0.94;
      this._level *= 0.94; this._peak *= 0.94;
      for (let i = 0; i < NUM_BINS; i++) this._spec[i] *= 0.92;
      this._beatPunch *= Math.exp(-dt * 4);
      out.bass = this._bass; out.mid = this._mid; out.treble = this._treble;
      out.level = this._level; out.peak = this._peak;
      out.spectrum.set(this._spec); out.beatPunch = this._beatPunch;
      return;
    }

    this.analyser.getFloatFrequencyData(this._fftBuf);   // dB, ~-100..0
    this.analyser.getFloatTimeDomainData(this._timeBuf); // -1..1

    // Log-bin to NUM_BINS over ~30Hz..15kHz.
    const sr = this.ctx.sampleRate;
    const nyq = sr / 2;
    const lo = 30, hi = 15000;
    const fftLen = this._fftBuf.length;
    for (let i = 0; i < NUM_BINS; i++) {
      const f0 = lo * Math.pow(hi / lo, i / NUM_BINS);
      const f1 = lo * Math.pow(hi / lo, (i + 1) / NUM_BINS);
      const i0 = Math.max(1, Math.floor(f0 / nyq * fftLen));
      const i1 = Math.min(fftLen - 1, Math.ceil(f1 / nyq * fftLen));
      let sum = 0, n = 0;
      for (let k = i0; k <= i1; k++) { sum += this._fftBuf[k]; n++; }
      const dB = n > 0 ? sum / n : -100;
      const v = clamp((dB + 80) / 80); // map -80..0 → 0..1
      this._spec[i] = lerp(this._spec[i], v, 1 - this.smoothing);
    }

    const bassIdx = Math.floor(NUM_BINS * 0.18);
    const midIdx = Math.floor(NUM_BINS * 0.55);
    let b = 0, m = 0, h = 0;
    for (let i = 0; i < bassIdx; i++) b += this._spec[i];
    for (let i = bassIdx; i < midIdx; i++) m += this._spec[i];
    for (let i = midIdx; i < NUM_BINS; i++) h += this._spec[i];
    b /= bassIdx; m /= (midIdx - bassIdx); h /= (NUM_BINS - midIdx);

    const bg = this.bandGain;
    this._bass = lerp(this._bass, clamp(b * bg.bass), 1 - this.smoothing);
    this._mid = lerp(this._mid, clamp(m * bg.mid), 1 - this.smoothing);
    this._treble = lerp(this._treble, clamp(h * bg.treble), 1 - this.smoothing);

    const lvl = (this._bass + this._mid + this._treble) / 3;
    this._level = lerp(this._level, lvl, 0.4);
    this._peak = Math.max(this._peak * 0.96, lvl);

    // Beat detection: simple bass onset (rising edge above moving avg)
    const onset = this._bass - this._lastBassPeak;
    if (onset > 0.08) {
      this._beatPunch = 1;
      const now = out.t;
      if (this._lastBeatTime > 0) {
        const interval = now - this._lastBeatTime;
        if (interval > 0.25 && interval < 1.5) {
          const bpm = 60 / interval;
          this.bpm = lerp(this.bpm, bpm, 0.1);
        }
      }
      this._lastBeatTime = out.t;
    }
    this._lastBassPeak = lerp(this._lastBassPeak, this._bass, 0.06);
    this._beatPunch *= Math.exp(-dt * 4);

    // waveform: downsample timeBuf to 512
    const tb = this._timeBuf;
    const W = out.waveform.length;
    const step = tb.length / W;
    for (let i = 0; i < W; i++) {
      const s = tb[Math.floor(i * step)];
      this._wave[i] = lerp(this._wave[i], s, 0.4);
    }
    out.waveform.set(this._wave);

    out.bass = this._bass; out.mid = this._mid; out.treble = this._treble;
    out.level = this._level; out.peak = this._peak;
    out.spectrum.set(this._spec);
    out.beatPunch = this._beatPunch * this.beatPunchGain;
    out.beatPhase = (out.t * (this.bpm / 60)) % 1;
    out.bpm = this.bpm;
  }
}
