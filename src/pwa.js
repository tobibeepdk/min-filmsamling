import { status } from './ui.js';
export async function registerPwa(beforeUpdate) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register(
      import.meta.env.BASE_URL + 'sw.js',
      { scope: import.meta.env.BASE_URL, updateViaCache: 'none' },
    );
    let requested = false;
    const offer = (worker) => {
      document.querySelector('#update').hidden = false;
      document.querySelector('#install-update').onclick = async () => {
        await beforeUpdate();
        requested = true;
        if (worker.state === 'activated') location.reload();
        else worker.postMessage({ type: 'SKIP_WAITING' });
      };
    };
    if (registration.waiting) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!refreshing && requested) {
        refreshing = true;
        await beforeUpdate();
        location.reload();
      }
    });
    registration.update().catch(() => {});
  } catch {
    status(
      'Samlingen er klar. Offline-installation kunne ikke aktiveres; prøv igen med forbindelse.',
    );
  }
}
