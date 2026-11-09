// Applied before first paint to avoid a light/dark flash. Kept outside the module bundle (CSP: no inline scripts).
(function () {
  try {
    var pref = localStorage.getItem('cops-theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
