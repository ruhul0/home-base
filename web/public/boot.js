// Runs before the page paints. The start page saves the resolved theme here whenever it changes.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("boot-theme");
  } catch {
    // Storage can be blocked. The page then starts with the device's light or dark setting.
  }
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", saved || (prefersDark ? "dark" : "light"));
})();
