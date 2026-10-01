export function workerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Angiv Workerens HTTPS-adresse i Indstillinger.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('Worker-adressen skal være en HTTPS-origin uden sti, login eller parametre.');
  return url.origin;
}
export function createApi(db, getUrl, fetcher = fetch) {
  async function post(path, data, { login = false, signal } = {}) {
    const origin = workerUrl(getUrl()),
      headers = { 'Content-Type': 'application/json' };
    if (!login) {
      const session = await db.get('session', 'current');
      const expiresAt =
        typeof session?.expiresAt === 'number'
          ? session.expiresAt
          : Date.parse(session?.expiresAt || '');
      if (!session?.token || !(expiresAt > Date.now()) || session.origin !== origin) {
        await db.delete('session', 'current');
        throw new Error('Log ind i Indstillinger for at bruge filmopslag og AI.');
      }
      headers.Authorization = 'Bearer ' + session.token;
    }
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 60000);
    try {
      const response = await fetcher(origin + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 401) await db.delete('session', 'current');
      if (!response.ok) {
        if (response.status === 429)
          throw new Error('Forbrugsgrænsen er nået. Vent lidt og prøv igen. Kladden er gemt.');
        if (response.status === 401 || response.status === 403)
          throw new Error(
            'Adgang blev afvist. Kontrollér login og Workerens tilladte origin i Indstillinger.',
          );
        throw new Error('Filmopslaget kunne ikke gennemføres. Prøv igen. Kladden er gemt.');
      }
      try {
        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Serverens svar kunne ikke læses. Prøv igen.', { cause: error });
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (signal?.aborted) throw new DOMException('Annulleret', 'AbortError');
        throw new Error('Handlingen tog for lang tid. Kladden er gemt.', { cause: error });
      }
      if (error instanceof TypeError)
        throw new Error(
          'Ingen forbindelse til Worker. Kontrollér adresse, netværk og CORS i Indstillinger.',
          { cause: error },
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    post,
    async login(accessKey) {
      const loginOrigin = workerUrl(getUrl());
      let data;
      try {
        data = await post('/session', { accessKey }, { login: true });
      } finally {
        // Drop the transient reference; never persist the access key.
        // eslint-disable-next-line no-useless-assignment
        accessKey = '';
      }
      const expiry =
        typeof data.expiresAt === 'number' ? data.expiresAt : Date.parse(data.expiresAt);
      if (typeof data.token !== 'string' || !data.token || !(expiry > Date.now()))
        throw new Error('Serveren kunne ikke oprette en gyldig session.');
      if (workerUrl(getUrl()) !== loginOrigin)
        throw new Error('Worker-adressen blev ændret. Log ind igen.');
      await db.put('session', {
        id: 'current',
        token: data.token,
        expiresAt: data.expiresAt,
        origin: loginOrigin,
      });
    },
  };
}
