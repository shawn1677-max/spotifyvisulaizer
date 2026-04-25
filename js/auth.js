// Spotify Authorization Code with PKCE.
// No client secret. All state in localStorage. The page is fully static.

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const STORAGE = {
  clientId: 'aurora.clientId',
  verifier: 'aurora.pkceVerifier',
  token: 'aurora.token',          // { access_token, refresh_token, expires_at, scope }
};

const REDIRECT_URI = new URL('./auth/callback.html', location.href).toString();

export function getRedirectUri() {
  return REDIRECT_URI;
}

export function getClientId() {
  return localStorage.getItem(STORAGE.clientId) || '';
}

export function setClientId(id) {
  localStorage.setItem(STORAGE.clientId, id.trim());
}

export function clearClientId() {
  localStorage.removeItem(STORAGE.clientId);
}

export function isLoggedIn() {
  const t = readToken();
  return !!(t && t.access_token);
}

export function logout() {
  localStorage.removeItem(STORAGE.token);
  localStorage.removeItem(STORAGE.verifier);
}

function readToken() {
  try { return JSON.parse(localStorage.getItem(STORAGE.token) || 'null'); }
  catch { return null; }
}

function writeToken(t) {
  localStorage.setItem(STORAGE.token, JSON.stringify(t));
}

// --- PKCE helpers ---
function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomVerifier(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, 96);
}

async function challenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(hash));
}

// --- Public flow ---

export async function beginLogin() {
  const clientId = getClientId();
  if (!clientId) throw new Error('No Client ID set');
  const verifier = randomVerifier();
  const code_challenge = await challenge(verifier);
  localStorage.setItem(STORAGE.verifier, verifier);
  // Where to come back to after callback redirects:
  sessionStorage.setItem('aurora.returnTo', new URL('./index.html', location.href).toString());

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge,
  });
  location.assign('https://accounts.spotify.com/authorize?' + params.toString());
}

export async function handleRedirect() {
  const url = new URL(location.href);
  const err = url.searchParams.get('error');
  if (err) throw new Error(err);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Missing authorization code');
  const verifier = localStorage.getItem(STORAGE.verifier);
  if (!verifier) throw new Error('Missing PKCE verifier');
  const clientId = getClientId();
  if (!clientId) throw new Error('Missing client id');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('Token exchange failed: ' + text);
  }
  const t = await r.json();
  writeToken({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in * 1000) - 30_000,
    scope: t.scope,
  });
  localStorage.removeItem(STORAGE.verifier);
}

export async function getAccessToken() {
  let t = readToken();
  if (!t) throw new Error('Not signed in');
  if (Date.now() < t.expires_at) return t.access_token;
  // refresh
  const clientId = getClientId();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: clientId,
  });
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    logout();
    throw new Error('Refresh failed; signed out');
  }
  const j = await r.json();
  t = {
    access_token: j.access_token,
    refresh_token: j.refresh_token || t.refresh_token,
    expires_at: Date.now() + (j.expires_in * 1000) - 30_000,
    scope: j.scope || t.scope,
  };
  writeToken(t);
  return t.access_token;
}

// Used by Spotify Web Playback SDK: it asks for a token via callback.
export function getOAuthCallback() {
  return async (cb) => {
    try { cb(await getAccessToken()); }
    catch (e) { console.error('Token callback failed', e); }
  };
}
