// Aurora — Spotify Visualizer entry.

import { beginLogin, isLoggedIn, getClientId, setClientId, clearClientId, logout, getRedirectUri } from './auth.js';
import { SpotifyClient } from './spotify.js';
import { AnalysisSource, MicSource, makeFeatures } from './features.js';
import { Renderer } from './gl/renderer.js';
import { VISUALIZERS } from './visualizers/index.js';
import { extractFromImageURL, PRESETS } from './palette.js';
import { UI, showToast, bindHotkeys } from './ui.js';

const SETTINGS_KEY = 'aurora.settings.v1';

class App {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.spotify = null;
    this.renderer = null;
    this.ui = null;

    this.analysisSrc = new AnalysisSource();
    this.micSrc = null;
    this.features = makeFeatures();
    this.options = this._defaultOptions();

    this.viz = null;
    this.activeVizId = 'particles';
    this.palette = PRESETS.neon;
    this.coverImage = null;
    this.coverObjectUrl = null;
  }

  _defaultOptions() {
    return {
      visualizer: 'particles',
      palette: 'auto',
      background: 'palette',
      bands: { bass: 1, mid: 1, treble: 1 },
      smoothing: 0.6,
      beatPunch: 1,
      source: 'analysis',
      fx: {
        bloom: true, bloomAmount: 0.8,
        chroma: false, grain: false,
        trails: false, trailAmount: 0.85,
      },
    };
  }

  async start() {
    // Setup screen?
    const $setup = document.getElementById('setup');
    const $login = document.getElementById('login');
    const redirect = getRedirectUri();
    document.getElementById('redirect-display').textContent = redirect;
    document.getElementById('copy-redirect').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(redirect); showToast('Copied'); }
      catch { showToast('Copy failed — copy manually'); }
    });

    document.getElementById('setup-save').addEventListener('click', () => {
      const v = document.getElementById('setup-clientid').value.trim();
      if (!v) return showToast('Paste a Client ID');
      setClientId(v);
      $setup.classList.add('hidden');
      this._afterClientIdReady();
    });

    document.getElementById('btn-login').addEventListener('click', () => beginLogin().catch(e => showToast('Login failed: ' + e.message)));
    document.getElementById('btn-login-reset').addEventListener('click', (e) => {
      e.preventDefault();
      clearClientId();
      logout();
      location.reload();
    });

    if (!getClientId()) {
      $setup.classList.remove('hidden');
      return;
    }
    this._afterClientIdReady();
  }

  _afterClientIdReady() {
    const $login = document.getElementById('login');
    if (!isLoggedIn()) {
      $login.classList.remove('hidden');
      return;
    }
    $login.classList.add('hidden');
    this._boot();
  }

  async _boot() {
    // Build renderer
    try {
      this.renderer = new Renderer(this.canvas);
    } catch (e) {
      showToast('WebGL2 init failed: ' + e.message, 6000);
      return;
    }

    // Build UI
    this.ui = new UI(this);
    this.ui.setVisualizers(VISUALIZERS, this.activeVizId);

    // Restore options
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved) { this.options = { ...this._defaultOptions(), ...saved }; }
    } catch {}
    this.ui.applySnapshot({ ...this.options, visualizer: this.options.visualizer });
    this.activeVizId = this.options.visualizer || this.activeVizId;

    // Start visualizer
    this._instantiateViz(this.activeVizId);
    this.ui.setActiveVisualizer(this.activeVizId);

    // Hotkeys
    bindHotkeys({
      togglePlay: () => this.spotify?.toggle(),
      next: () => this.spotify?.next(),
      prev: () => this.spotify?.prev(),
      toggleSettings: () => this.ui.toggleDrawer(),
      nextViz: () => this._cycleViz(),
      toggleFullscreen: () => this._toggleFullscreen(),
      toggleUI: () => document.body.classList.toggle('ui-hidden'),
    });

    // Spotify
    this.spotify = new SpotifyClient();
    this.spotify.addEventListener('ready', () => {
      this.spotify.transferPlayback({ play: false }).then(() => {
        showToast('Aurora is ready. Hit play in Spotify, then ⏯ here.');
      }).catch(e => console.warn('transfer failed', e));
    });
    this.spotify.addEventListener('state', (e) => {
      this.analysisSrc.syncState(e.detail);
    });
    this.spotify.addEventListener('track', (e) => this._onTrack(e.detail));
    this.spotify.addEventListener('analysis', (e) => {
      this.analysisSrc.setAnalysis(e.detail.trackId, e.detail.analysis);
    });

    try {
      await this.spotify.initPlayer();
    } catch (e) {
      showToast('Spotify SDK failed: ' + e.message, 5000);
    }

    // Start the loop
    this._lastT = performance.now();
    this._loop();
  }

  _instantiateViz(id) {
    const V = VISUALIZERS.find(v => v.id === id) || VISUALIZERS[0];
    if (this.viz?.leave) this.viz.leave();
    this.viz = new V(this.renderer);
    this.viz.setPalette(this.palette);
    if (this.viz.setCoverImage && this.coverImage) this.viz.setCoverImage(this.coverImage);
    if (this.viz.enter) this.viz.enter();
    this.activeVizId = V.id;
    this.options.visualizer = V.id;
    this._persistOptions();
  }

  setVisualizer(id) {
    this._instantiateViz(id);
    this.ui?.setActiveVisualizer(id);
  }

  _cycleViz() {
    const i = VISUALIZERS.findIndex(v => v.id === this.activeVizId);
    const next = VISUALIZERS[(i + 1) % VISUALIZERS.length];
    this.setVisualizer(next.id);
    showToast(next.name);
  }

  applyOptions(opts) {
    this.options = { ...this.options, ...opts };
    this._persistOptions();
    // sensitivity
    const s = this.options;
    this.analysisSrc.bandGain = { ...s.bands };
    this.analysisSrc.smoothing = s.smoothing;
    this.analysisSrc.beatPunchGain = s.beatPunch;
    if (this.micSrc) {
      this.micSrc.bandGain = { ...s.bands };
      this.micSrc.smoothing = s.smoothing;
      this.micSrc.beatPunchGain = s.beatPunch;
    }
    // source switch
    if (s.source === 'mic' && !this.micSrc) {
      this._enableMic().catch(e => showToast('Mic failed: ' + e.message));
    } else if (s.source !== 'mic' && this.micSrc) {
      this.micSrc.stop();
      this.micSrc = null;
    }
    // palette
    this._refreshPalette();
  }

  _persistOptions() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.options));
  }

  async _enableMic() {
    this.micSrc = new MicSource();
    this.micSrc.bandGain = { ...this.options.bands };
    this.micSrc.smoothing = this.options.smoothing;
    this.micSrc.beatPunchGain = this.options.beatPunch;
    await this.micSrc.start();
    showToast('Mic input active');
  }

  async _onTrack(track) {
    this.ui?.setNowPlaying(track);
    // load cover image for visualizer
    const url = (track.album?.images || []).slice().sort((a,b) => b.width - a.width)[0]?.url;
    if (url) {
      try {
        const img = await loadImg(url);
        this.coverImage = img;
        if (this.viz?.setCoverImage) this.viz.setCoverImage(img);
        // palette
        if (this.options.palette === 'auto') {
          this.palette = await extractFromImageURL(url);
          this._propagatePalette();
        }
      } catch (e) {
        console.warn('cover load failed', e);
      }
    }
  }

  _refreshPalette() {
    const p = this.options.palette;
    if (p === 'auto') return; // wait for track event
    this.palette = PRESETS[p] || PRESETS.neon;
    this._propagatePalette();
  }

  _propagatePalette() {
    if (this.viz) this.viz.setPalette(this.palette);
  }

  logout() {
    logout();
    location.reload();
  }
  resetClientId() {
    if (!confirm('Reset Spotify Client ID? You will need to re-enter it.')) return;
    clearClientId();
    logout();
    location.reload();
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  _loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;
    const t = now / 1000;

    // pick source
    const src = this.options.source === 'mic' && this.micSrc ? this.micSrc : this.analysisSrc;
    src.update(this.features, dt);

    // render
    this.renderer.beginFrame();
    this.viz?.render(this.features, t);
    this.renderer.endFrame({
      bloom: this.options.fx.bloom,
      bloomAmount: this.options.fx.bloomAmount,
      chroma: this.options.fx.chroma,
      grain: this.options.fx.grain,
      trails: this.options.fx.trails,
      trailAmount: this.options.fx.trailAmount,
      time: t,
    });

    requestAnimationFrame(this._loop);
  }
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const app = new App();
window.addEventListener('DOMContentLoaded', () => app.start());
