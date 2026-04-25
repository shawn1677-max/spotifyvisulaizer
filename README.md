# Aurora — Spotify Visualizer

A music visualizer for Spotify Premium that runs in your browser. No installer,
no native compile, no audio router needed. Eight visual modes, real-time
beat sync, palette-aware coloring from album art, and a stack of post-effects
(bloom, chromatic aberration, motion trails, film grain).

Optimized to feel right on a MacBook Air M1 in Safari or Chrome at 60 fps.

---

## What you need

1. **Spotify Premium** — required by Spotify for the Web Playback SDK. Free
   accounts cannot use it.
2. **A modern browser** — Safari 16+, Chrome, Edge, or Firefox with WebGL2.
3. **A free Spotify developer account** — registered once, takes ~90 seconds.
   Spotify will not let two different people share an app's Client ID; this is
   their requirement, not ours.

## First-time setup (~2 minutes)

### 1. Host the app

Easiest path is GitHub Pages on this repo:

1. Push this branch to GitHub.
2. Repo → **Settings** → **Pages** → set source to this branch + `/ (root)`.
   Your URL will look like `https://<you>.github.io/<repo>/`.

You can also serve it locally — `python3 -m http.server 8000` from the repo
root works fine for testing — but the Spotify Web Playback SDK requires
HTTPS or `localhost`.

### 2. Register a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. Click **Create app**. Name: anything (e.g. "Aurora"). Description: anything.
   Website: anything.
3. **Redirect URI** — paste exactly the URL the app shows you on first run, e.g.
   `https://<you>.github.io/<repo>/auth/callback.html`. Add the URL once,
   click **Add**, then **Save**.
4. Under **APIs used**, tick **Web API** and **Web Playback SDK**. Save.
5. Open the app's **Settings**. Copy the **Client ID** (not the secret —
   we don't use it).

### 3. Open the app

1. Visit your hosted URL.
2. Paste the Client ID into the setup screen.
3. Click **Sign in with Spotify**, authorize, and you're in.

### 4. Tell Spotify to play through Aurora

Aurora registers itself as a Spotify Connect device named "Aurora Visualizer".

- On a Mac/iPhone Spotify app, hit the device-picker button in the bottom-left
  of the Now Playing bar and pick **Aurora Visualizer**.
- Audio now comes out of the browser tab. The desktop or phone Spotify app
  becomes a remote control — pause/skip there, the visualizer follows.

The big tradeoff: while Aurora is the active device, your laptop speakers
play the music via the browser, not via the Spotify app. That's how the
Web Playback SDK works.

---

## Visualizers

| Mode | Best for |
|---|---|
| **Spectrum Bars** | Loud, percussive tracks |
| **Radial** | Ambient + vocals |
| **Oscilloscope** | Anything melodic |
| **Particles** | Heavy bass / drops |
| **Tunnel** | Driving four-on-the-floor |
| **Kaleidoscope** | Anything; trippy |
| **Aurora** | Slow, atmospheric |
| **Cover Warp** | Whatever you're listening to |

Press `V` to cycle through them, or pick from the settings drawer.

## Hotkeys

| Key | Action |
|---|---|
| `Space` | play / pause |
| `←` / `→` | previous / next track |
| `V` | next visualizer |
| `S` | toggle settings drawer |
| `F` | fullscreen |
| `H` | hide all UI |

## A note on real-time FFT

Spotify's Web Playback SDK encrypts its audio output (EME/DRM), which makes
real-time FFT via `AnalyserNode` impossible on the SDK stream. Aurora drives
visuals from Spotify's [Audio Analysis API][aa] instead — pre-computed beat
markers, bar boundaries, sections, segments with per-segment loudness
envelopes, 12-d pitch chroma, and 12-d timbre coefficients. The result is
**tighter beat sync** than amplitude-based visualizers, at the cost of not
having a literal oscilloscope.

If you want a real spectrum — e.g. driven by your microphone or system audio
captured via [BlackHole][bh] — flip **Audio Source → Mic / system audio** in
the settings drawer. The visualizers automatically switch over.

[aa]: https://developer.spotify.com/documentation/web-api/reference/get-audio-analysis
[bh]: https://github.com/ExistentialAudio/BlackHole

## Project layout

```
index.html              UI shell
css/styles.css          Styling
auth/callback.html      OAuth redirect target
js/
  main.js               Bootstraps everything
  auth.js               PKCE OAuth flow
  spotify.js            Web API + Web Playback SDK wrapper
  features.js           Feature stream (analysis + mic FFT)
  palette.js            Color extraction from album art
  presets.js            localStorage preset save/load
  ui.js                 Drawer, hotkeys, toasts
  gl/renderer.js        WebGL2 + bloom + trails + composite
  visualizers/          One file per visual mode
```

No build step. No bundler. Open the HTML and ES modules do the rest.

## Privacy

- Aurora is a static page. There is no backend, no analytics, no third-party
  scripts beyond Spotify's own SDK.
- Your access token, client ID, and presets live in `localStorage` on the
  device that opened the page.
- `Sign out of Spotify` in the drawer wipes the token. **Change Client ID**
  wipes everything.

## License

MIT.
