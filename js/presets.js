// Preset save/load to localStorage. A preset captures all settings
// that affect the look (visualizer, palette, post-fx, sensitivities).

const KEY = 'aurora.presets.v1';

export function loadPresets() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}
export function savePreset(name, data) {
  if (!name) throw new Error('preset name required');
  const all = loadPresets();
  all[name] = { ...data, savedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(all));
}
export function deletePreset(name) {
  const all = loadPresets();
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}
export function listPresetNames() {
  return Object.keys(loadPresets()).sort();
}
