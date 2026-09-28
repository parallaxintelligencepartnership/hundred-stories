// The landing splash gate (src/site/splash.ts plays it). Loaded synchronously in the head of
// index.html only, right after theme.js, so the class lands before first paint: the CSP forbids
// inline scripts. It marks <html> splash-pending when the visitor has not asked for reduced
// motion or to save data and has not seen the splash this session. It does nothing else; with
// no JavaScript the class never appears and the overlay stays hidden.
(function () {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) {
    return;
  }
  try {
    if (navigator.connection && navigator.connection.saveData === true) return;
  } catch (e) {
    return;
  }
  try {
    if (sessionStorage.getItem('hs.splash') === 'seen') return;
  } catch (e) {
    return;
  }
  try {
    document.documentElement.classList.add('splash-pending');
  } catch (e) {}
})();
