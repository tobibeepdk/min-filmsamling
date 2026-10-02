import { serviceErrorMessage } from '../../shared/service-errors.js';
const messages = {
  400: 'Oplysningerne kunne ikke læses. Kontrollér dem og prøv igen.',
  401: 'Adgangen kunne ikke godkendes. Log ind igen.',
  403: 'Denne adresse har ikke adgang til tjenesten.',
  404: 'Tjenesten findes ikke.',
  405: 'Denne handling er ikke tilladt.',
  413: 'Billedet eller anmodningen er for stor.',
  415: 'Anmodningen skal være JSON.',
  429: 'Grænsen for opslag er nået. Vent lidt og prøv igen.',
  502: 'Opslaget kunne ikke gennemføres. Prøv igen senere.',
  503: 'Tjenesten er ikke klar. Kontrollér Worker-opsætningen.',
};

export class HttpError extends Error {
  constructor(status, retryAfter, code) {
    super(messages[status] || messages[502]);
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = serviceErrorMessage(code) ? code : undefined;
  }
}

export function response(data, status = 200, origin, additional = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000',
    Vary: 'Origin',
    ...additional,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

export function errorResponse(error, origin) {
  const safe = error instanceof HttpError ? error : new HttpError(502);
  return response(
    { error: safe.message, ...(safe.code ? { code: safe.code } : {}) },
    safe.status,
    origin,
    safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {},
  );
}

export async function readJson(request, maximum) {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new HttpError(415);
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new HttpError(413);
  if (!request.body) throw new HttpError(400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400);
  }
}

export function onlyFields(body, fields) {
  if (Object.keys(body).some((field) => !fields.includes(field))) throw new HttpError(400);
}

export async function upstreamJson(
  url,
  options = {},
  { notFoundIsMiss = false, provider = '' } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const result = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (result.status === 404 && notFoundIsMiss) {
      if (result.body) await result.body.cancel();
      return { found: false, code: 'OK', items: [] };
    }
    if (!result.ok) {
      // Only a fixed OpenAI quota code is read. Never return or log its message.
      let quota = false;
      if (provider === 'openai' && result.status === 429) {
        try {
          const body = await readJson(result, 8192);
          quota = ['insufficient_quota', 'billing_hard_limit_reached'].includes(body.error?.code);
        } catch {
          await result.body?.cancel().catch(() => {});
        }
      } else await result.body?.cancel();
      if (quota) throw new HttpError(429, undefined, 'PROVIDER_QUOTA');
    }
    if (result.status === 429) {
      const retry = Number(result.headers.get('Retry-After'));
      throw new HttpError(
        429,
        Number.isFinite(retry) && retry > 0 ? Math.min(Math.ceil(retry), 86_400) : 60,
        'PROVIDER_RATE_LIMIT',
      );
    }
    if (!result.ok) {
      const code =
        result.status === 401
          ? 'PROVIDER_AUTH'
          : result.status === 403 || result.status === 404
            ? 'PROVIDER_ACCESS'
            : [400, 413, 415, 422].includes(result.status)
              ? 'PROVIDER_REQUEST'
              : 'PROVIDER_FAILURE';
      throw new HttpError(502, undefined, code);
    }
    try {
      return await readJson(result, 1_000_000);
    } catch {
      if (controller.signal.aborted) throw new HttpError(502, undefined, 'PROVIDER_TIMEOUT');
      throw new HttpError(502, undefined, 'PROVIDER_RESPONSE');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      undefined,
      controller.signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE',
    );
  } finally {
    clearTimeout(timeout);
  }
}
