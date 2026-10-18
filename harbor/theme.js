/* Light / dark switch. Sets data-theme on <html>, remembers the choice, and drives the #themeBtn button.
   HARBOR_DEFAULT_THEME ('light' or 'dark') applies only until the visitor picks one; without it the OS setting decides. */
(function () {
  var KEY = 'harbor-theme', root = document.documentElement;
  function saved() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; } }
  function effective() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  function paint() {
    var b = document.getElementById('themeBtn'); if (!b) return;
    var dark = effective() === 'dark';
    b.setAttribute('aria-pressed', String(dark));
    b.textContent = dark ? '☀ Light mode' : '☾ Dark mode';
    b.title = 'Switch to ' + (dark ? 'light' : 'dark') + ' mode';
  }
  var s = saved();
  if (s) root.setAttribute('data-theme', s); else if (window.HARBOR_DEFAULT_THEME) root.setAttribute('data-theme', window.HARBOR_DEFAULT_THEME);
  document.addEventListener('DOMContentLoaded', function () {
    paint();
    var b = document.getElementById('themeBtn');
    if (b) b.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked: still switches for this visit */ }
      paint();
    });
  });
})();
