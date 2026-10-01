import { HttpError } from './http.js';
const encoder = new TextEncoder();
export function configurationReady(env) {
  const required = ['APP_ACCESS_KEY', 'SESSION_SIGNING_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL'];
  return (
    required.every((name) => typeof env[name] === 'string' && env[name].trim()) &&
    env.SESSION_SIGNING_KEY.length >= 32 &&
    env.RATE_LIMITER?.idFromName &&
    env.RATE_LIMITER?.get
  );
}
export async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
export async function accessKeyMatches(provided, expected) {
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < 32; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError(401);
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) =>
    character.charCodeAt(0),
  );
}
function signingKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function createSession(env) {
  const configured = Number(env.SESSION_TTL_SECONDS || 900);
  const ttl =
    Number.isInteger(configured) && configured >= 60 && configured <= 1800 ? configured : 900;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = encode(encoder.encode(JSON.stringify({ exp, jti: crypto.randomUUID() })));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(env.SESSION_SIGNING_KEY),
    encoder.encode(payload),
  );
  return {
    token: `${payload}.${encode(new Uint8Array(signature))}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
export async function verifySession(request, env) {
  try {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.length > 2048) throw new Error();
    const segments = auth.slice(7).split('.');
    if (segments.length !== 2) throw new Error();
    const signature = decode(segments[1]);
    if (
      signature.length !== 32 ||
      !(await crypto.subtle.verify(
        'HMAC',
        await signingKey(env.SESSION_SIGNING_KEY),
        signature,
        encoder.encode(segments[0]),
      ))
    )
      throw new Error();
    const payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(decode(segments[0])),
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(payload.exp) ||
      payload.exp <= now ||
      payload.exp > now + 1800 ||
      typeof payload.jti !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(payload.jti)
    )
      throw new Error();
    return payload;
  } catch {
    throw new HttpError(401);
  }
}
export async function consumeLimit(request, env, session) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipId = encode(await sha256(ip));
  const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName('global-limits-v1'));
  let result;
  try {
    result = await limiter.fetch(
      new Request('https://limits.internal/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: ipId,
          session: session?.jti || null,
          kind: session ? 'api' : 'login',
        }),
      }),
    );
  } catch {
    throw new HttpError(503);
  }
  if (result.status === 429)
    throw new HttpError(429, Number(result.headers.get('Retry-After')) || 60);
  if (!result.ok) throw new HttpError(503);
}
