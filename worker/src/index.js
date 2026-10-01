import { HttpError, errorResponse, onlyFields, readJson, response } from './http.js';
import {
  accessKeyMatches,
  configurationReady,
  consumeLimit,
  createSession,
  verifySession,
} from './security.js';
import { identifyCover } from './vision.js';
import { lookupBarcode, searchMovie } from './providers.js';
export { RateLimiter } from './limits.js';
const methods = {
  '/health': 'GET',
  '/session': 'POST',
  '/identify-cover': 'POST',
  '/lookup-barcode': 'POST',
  '/search-movie': 'POST',
};
export default {
  async fetch(request, env) {
    let origin;
    try {
      const allowed = env.ALLOWED_ORIGIN;
      if (!allowed || allowed === '*' || request.headers.get('Origin') !== allowed)
        throw new HttpError(403);
      try {
        const url = new URL(allowed);
        if (url.protocol !== 'https:' || url.origin !== allowed) throw new Error();
      } catch {
        throw new HttpError(503);
      }
      origin = allowed;
      const path = new URL(request.url).pathname;
      const method = methods[path];
      if (!method) throw new HttpError(404);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== method)
          throw new HttpError(405);
        const headers = (request.headers.get('Access-Control-Request-Headers') || '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        if (headers.some((header) => !['authorization', 'content-type'].includes(header)))
          throw new HttpError(400);
        return response(null, 204, origin, {
          'Access-Control-Allow-Methods': method,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        });
      }
      if (request.method !== method) throw new HttpError(405);
      if (path === '/health') return response({ ok: true }, 200, origin);
      if (!configurationReady(env)) throw new HttpError(503);
      if (path === '/session') {
        await consumeLimit(request, env);
        const body = await readJson(request, 4096);
        onlyFields(body, ['accessKey']);
        if (typeof body.accessKey !== 'string' || !body.accessKey || body.accessKey.length > 256)
          throw new HttpError(400);
        if (!(await accessKeyMatches(body.accessKey, env.APP_ACCESS_KEY))) throw new HttpError(401);
        return response(await createSession(env), 200, origin);
      }
      const session = await verifySession(request, env);
      const body = await readJson(request, path === '/identify-cover' ? 2_010_000 : 4096);
      await consumeLimit(request, env, session);
      let data;
      if (path === '/identify-cover') data = await identifyCover(body, env);
      else if (path === '/lookup-barcode') data = await lookupBarcode(body, env);
      else data = await searchMovie(body, env);
      return response(data, 200, origin);
    } catch (error) {
      return errorResponse(error, origin);
    }
  },
};
