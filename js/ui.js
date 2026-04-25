// UI wiring: drawer, now-playing, hotkeys, toast.

import { loadPresets, savePreset, deletePreset, listPresetNames } from './presets.js';

export function showToast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

export function bindHotkeys({ togglePlay, next, prev, toggleSettings, nextViz, toggleFullscreen, toggleUI }) {
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay?.(); break;
      case 'ArrowRight': next?.(); break;
      case 'ArrowLeft': prev?.(); break;
      case 's': case 'S': toggleSettings?.(); break;
      case 'v': case 'V': nextViz?.(); break;
      case 'f': case 'F': toggleFullscreen?.(); break;
      case 'h': case 'H': toggleUI?.(); break;
    }
  });
}

export class UI {
  constructor(app) {
    this.app = app;
    this.drawer = document.getElementById('drawer');
    this.nowEl = document.getElementById('now');
    this.cover = document.getElementById('np-cover');
    this.titleEl = document.getElementById('np-title');
    this.artistEl = document.getElementById('np-artist');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnDrawerClose = document.getElementById('drawer-close');

    this.btnPlay = document.getElementById('btn-play');
    this.btnNext = document.getElementById('btn-next');
    this.btnPrev = document.getElementById('btn-prev');

    this.btnLogout = document.getElementById('btn-logout');
    this.btnResetClient = document.getElementById('btn-reset-clientid');

    this.vizGrid = document.getElementById('viz-grid');

    // Option controls
    this.optPalette = document.getElementById('opt-palette');
    this.optBg = document.getElementById('opt-bg');
    this.optBass = document.getElementById('opt-bass');
    this.optMid = document.getElementById('opt-mid');
    this.optTreble = document.getElementById('opt-treble');
    this.optSmooth = document.getElementById('opt-smooth');
    this.optPunch = document.getElementById('opt-punch');
    this.optSource = document.getElementById('opt-source');

    this.fxBloom = document.getElementById('fx-bloom');
    this.fxBloomAmt = document.getElementById('fx-bloom-amt');
    this.fxChroma = document.getElementById('fx-chroma');
    this.fxGrain = document.getElementById('fx-grain');
    this.fxTrails = document.getElementById('fx-trails');
    this.fxTrailsAmt = document.getElementById('fx-trails-amt');

    this.presetName = document.getElementById('preset-name');
    this.presetList = document.getElementById('preset-list');
    this.presetSave = document.getElementById('preset-save');
    this.presetLoad = document.getElementById('preset-load');
    this.presetDelete = document.getElementById('preset-delete');

    this._wire();
    this.refreshPresetList();
  }

  _wire() {
    this.btnSettings.addEventListener('click', () => this.toggleDrawer());
    this.btnDrawerClose.addEventListener('click', () => this.toggleDrawer(false));
    this.btnPlay.addEventListener('click', () => this.app.spotify?.toggle());
    this.btnNext.addEventListener('click', () => this.app.spotify?.next());
    this.btnPrev.addEventListener('click', () => this.app.spotify?.prev());

    this.btnLogout.addEventListener('click', () => this.app.logout());
    this.btnResetClient.addEventListener('click', () => this.app.resetClientId());

    const saveOpt = () => this.app.applyOptions(this.snapshot());
    [this.optPalette, this.optBg, this.optSource].forEach(el => el.addEventListener('change', saveOpt));
    [this.optBass, this.optMid, this.optTreble, this.optSmooth, this.optPunch].forEach(el => el.addEventListener('input', saveOpt));
    [this.fxBloom, this.fxChroma, this.fxGrain, this.fxTrails].forEach(el => el.addEventListener('change', saveOpt));
    [this.fxBloomAmt, this.fxTrailsAmt].forEach(el => el.addEventListener('input', saveOpt));

    this.presetSave.addEventListener('click', () => {
      const name = this.presetName.value.trim();
      if (!name) return showToast('Name your preset first');
      savePreset(name, this.snapshot());
      this.presetName.value = '';
      this.refreshPresetList();
      showToast('Saved preset: ' + name);
    });
    this.presetLoad.addEventListener('click', () => {
      const name = this.presetList.value;
      if (!name) return;
      const p = loadPresets()[name];
      if (!p) return;
      this.applySnapshot(p);
      this.app.applyOptions(this.snapshot());
      showToast('Loaded: ' + name);
    });
    this.presetDelete.addEventListener('click', () => {
      const name = this.presetList.value;
      if (!name) return;
      deletePreset(name);
      this.refreshPresetList();
      showToast('Deleted: ' + name);
    });
  }

  toggleDrawer(force) {
    const show = force === undefined ? this.drawer.classList.contains('hidden') : force;
    this.drawer.classList.toggle('hidden', !show);
  }

  setVisualizers(list, activeId) {
    this.vizGrid.innerHTML = '';
    for (const V of list) {
      const b = document.createElement('button');
      b.dataset.id = V.id;
      b.innerHTML = `<span class="viz-name">${V.name}</span><span class="viz-desc">${V.desc || ''}</span>`;
      if (V.id === activeId) b.classList.add('active');
      b.addEventListener('click', () => {
        this.app.setVisualizer(V.id);
      });
      this.vizGrid.appendChild(b);
    }
  }

  setActiveVisualizer(id) {
    [...this.vizGrid.children].forEach(b => b.classList.toggle('active', b.dataset.id === id));
  }

  setNowPlaying(track) {
    if (!track) { this.nowEl.classList.add('hidden'); return; }
    this.nowEl.classList.remove('hidden');
    this.titleEl.textContent = track.name || '—';
    this.artistEl.textContent = (track.artists || []).map(a => a.name).join(', ');
    const art = (track.album?.images || []).slice().sort((a,b) => a.width - b.width).pop();
    this.cover.src = art?.url || '';
  }

  refreshPresetList() {
    const names = listPresetNames();
    this.presetList.innerHTML = '';
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      this.presetList.appendChild(o);
    }
  }

  snapshot() {
    return {
      visualizer: this.app.activeVizId,
      palette: this.optPalette.value,
      background: this.optBg.value,
      bands: {
        bass: parseFloat(this.optBass.value),
        mid: parseFloat(this.optMid.value),
        treble: parseFloat(this.optTreble.value),
      },
      smoothing: parseFloat(this.optSmooth.value),
      beatPunch: parseFloat(this.optPunch.value),
      source: this.optSource.value,
      fx: {
        bloom: this.fxBloom.checked,
        bloomAmount: parseFloat(this.fxBloomAmt.value),
        chroma: this.fxChroma.checked,
        grain: this.fxGrain.checked,
        trails: this.fxTrails.checked,
        trailAmount: parseFloat(this.fxTrailsAmt.value),
      },
    };
  }

  applySnapshot(s) {
    if (!s) return;
    if (s.visualizer) this.app.setVisualizer(s.visualizer);
    if (s.palette) this.optPalette.value = s.palette;
    if (s.background) this.optBg.value = s.background;
    if (s.bands) {
      this.optBass.value = s.bands.bass;
      this.optMid.value = s.bands.mid;
      this.optTreble.value = s.bands.treble;
    }
    if (s.smoothing !== undefined) this.optSmooth.value = s.smoothing;
    if (s.beatPunch !== undefined) this.optPunch.value = s.beatPunch;
    if (s.source) this.optSource.value = s.source;
    if (s.fx) {
      this.fxBloom.checked = !!s.fx.bloom;
      this.fxBloomAmt.value = s.fx.bloomAmount ?? 0.8;
      this.fxChroma.checked = !!s.fx.chroma;
      this.fxGrain.checked = !!s.fx.grain;
      this.fxTrails.checked = !!s.fx.trails;
      this.fxTrailsAmt.value = s.fx.trailAmount ?? 0.85;
    }
  }
}
