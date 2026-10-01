// This script is independent of modules so missing bundles still show an error.
(() => {
  function failure() {
    const panel = document.getElementById('fatal');
    if (panel) panel.hidden = false;
    const status = document.getElementById('status');
    if (status) status.textContent = 'Appen kunne ikke starte. Dine gemte film er bevaret.';
  }
  window.addEventListener(
    'error',
    (event) => {
      if (event.target?.tagName === 'SCRIPT' || event.error) failure();
    },
    true,
  );
  window.addEventListener('unhandledrejection', failure);
  setTimeout(() => {
    if (!window.filmsamlingReady) failure();
  }, 12000);
})();
