function normalizeAppearance(value = {}) {
  return { theme: value?.theme === 'light' ? 'light' : 'dark', accent: /^#[a-f0-9]{6}$/i.test(value?.accent) ? value.accent : '#ac91ee' };
}
async function readWindowAppearance(window) {
  if (!window || window.isDestroyed()) return normalizeAppearance();
  try {
    return normalizeAppearance(await window.webContents.executeJavaScript(`({theme: document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', accent: getComputedStyle(document.body).getPropertyValue('--accent-color').trim()})`));
  } catch (_) { return normalizeAppearance(); }
}
module.exports = { normalizeAppearance, readWindowAppearance };
