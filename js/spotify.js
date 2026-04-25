// Wrapper for Spotify Web API + Web Playback SDK.
// Exposes a small event surface: 'track', 'state', 'analysis'.

import { getAccessToken, getOAuthCallback } from './auth.js';

const API = 'https://api.spotify.com/v1';

export class SpotifyClient extends EventTarget {
  constructor() {
    super();
    this.player = null;
    this.deviceId = null;
    this.currentTrackId = null;
    this.analysisCache = new Map(); // id -> analysis
    this.lastState = null;
  }

  async api(path, opts = {}) {
    const token = await getAccessToken();
    const r = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    if (r.status === 204) return null;
    if (r.status === 429) {
      const wait = parseInt(r.headers.get('Retry-After') || '1', 10) * 1000;
      await new Promise(res => setTimeout(res, wait));
      return this.api(path, opts);
    }
    if (!r.ok) throw new Error('Spotify API ' + r.status + ': ' + await r.text());
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : null;
  }

  async initPlayer({ name = 'Aurora Visualizer', volume = 0.6 } = {}) {
    if (this.player) return this.player;
    await waitForSDK();
    const player = new window.Spotify.Player({
      name,
      getOAuthToken: getOAuthCallback(),
      volume,
    });

    player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id;
      this.dispatchEvent(new CustomEvent('ready', { detail: { device_id } }));
    });
    player.addListener('not_ready', ({ device_id }) => {
      if (this.deviceId === device_id) this.deviceId = null;
    });
    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      this.lastState = state;
      this.dispatchEvent(new CustomEvent('state', { detail: state }));
      const tr = state.track_window?.current_track;
      if (tr && tr.id !== this.currentTrackId) {
        this.currentTrackId = tr.id;
        this.dispatchEvent(new CustomEvent('track', { detail: tr }));
        this.fetchAnalysis(tr.id).then(a => {
          this.dispatchEvent(new CustomEvent('analysis', { detail: { trackId: tr.id, analysis: a } }));
        }).catch(e => console.warn('analysis fetch failed', e));
      }
    });

    const ok = await player.connect();
    if (!ok) throw new Error('Spotify player failed to connect');
    this.player = player;
    return player;
  }

  async transferPlayback({ play = false } = {}) {
    if (!this.deviceId) return;
    await this.api('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [this.deviceId], play }),
    });
  }

  async fetchAnalysis(trackId) {
    if (this.analysisCache.has(trackId)) return this.analysisCache.get(trackId);
    const a = await this.api(`/audio-analysis/${trackId}`);
    this.analysisCache.set(trackId, a);
    return a;
  }

  async play() { return this.player?.resume(); }
  async pause() { return this.player?.pause(); }
  async toggle() { return this.player?.togglePlay(); }
  async next() { return this.player?.nextTrack(); }
  async prev() { return this.player?.previousTrack(); }
  async seek(ms) { return this.player?.seek(ms); }
  async setVolume(v) { return this.player?.setVolume(v); }
  async getCurrentState() { return this.player?.getCurrentState(); }
}

function waitForSDK() {
  if (window.Spotify && window.Spotify.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const iv = setInterval(() => {
      if (window.Spotify && window.Spotify.Player) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('SDK load timeout')); }
    }, 100);
  });
}
