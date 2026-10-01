import { HttpError, errorResponse, readJson, response } from './http.js';
const DAY = 86_400_000;
function configured(env, name, fallback) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new HttpError(503);
  return value;
}
export class RateLimiter {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }
  async fetch(request) {
    try {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/consume')
        throw new HttpError(405);
      const { kind, ip, session } = await readJson(request, 2048);
      if (
        !['login', 'api'].includes(kind) ||
        typeof ip !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(ip) ||
        (kind === 'api' && !/^[a-f0-9-]{36}$/.test(session))
      )
        throw new HttpError(400);
      const now = Date.now();
      const minuteExpiry = Math.floor(now / 60_000) * 60_000 + 60_000;
      const dayExpiry = Math.floor(now / DAY) * DAY + DAY;
      const counter = (key, name, fallback, expiresAt) => ({
        key: `counter:${key}`,
        limit: configured(this.env, name, fallback),
        expiresAt,
      });
      const counters =
        kind === 'login'
          ? [
              counter(`login:ip:minute:${ip}`, 'LOGIN_RATE_LIMIT_PER_MINUTE', 5, minuteExpiry),
              counter(`login:ip:day:${ip}`, 'LOGIN_DAILY_LIMIT', 50, dayExpiry),
            ]
          : [
              counter('global:day', 'DAILY_LIMIT', 100, dayExpiry),
              counter(`api:ip:minute:${ip}`, 'IP_RATE_LIMIT_PER_MINUTE', 30, minuteExpiry),
              counter(`api:ip:day:${ip}`, 'IP_DAILY_LIMIT', 200, dayExpiry),
              counter(`api:session:minute:${session}`, 'RATE_LIMIT_PER_MINUTE', 10, minuteExpiry),
              counter(`api:session:day:${session}`, 'SESSION_DAILY_LIMIT', 100, dayExpiry),
            ];
      const retryAfter = await this.storage.transaction(async (transaction) => {
        const stored = await transaction.get(counters.map(({ key }) => key));
        const active = counters.map((entry) => ({
          ...entry,
          count: stored.get(entry.key)?.expiresAt > now ? stored.get(entry.key).count : 0,
        }));
        const exhausted = active.filter(({ count, limit }) => count >= limit);
        if (exhausted.length)
          return Math.ceil(Math.max(...exhausted.map(({ expiresAt }) => expiresAt - now)) / 1000);
        await transaction.put(
          Object.fromEntries(
            active.map(({ key, count, expiresAt }) => [key, { count: count + 1, expiresAt }]),
          ),
        );
        return 0;
      });
      if (!(await this.storage.getAlarm())) await this.storage.setAlarm(now + 3_600_000);
      return retryAfter
        ? response({ allowed: false }, 429, null, { 'Retry-After': String(retryAfter) })
        : response({ allowed: true });
    } catch (error) {
      return errorResponse(error);
    }
  }
  async alarm() {
    let startAfter;
    let remaining = false;
    do {
      const page = await this.storage.list({
        prefix: 'counter:',
        limit: 1000,
        ...(startAfter ? { startAfter } : {}),
      });
      if (!page.size) break;
      const expired = [...page]
        .filter(([, value]) => value.expiresAt <= Date.now())
        .map(([key]) => key);
      // Cloudflare accepts at most 128 keys per asynchronous delete call.
      for (let offset = 0; offset < expired.length; offset += 128) {
        await this.storage.delete(expired.slice(offset, offset + 128));
      }
      if (expired.length < page.size) remaining = true;
      startAfter = [...page.keys()].at(-1);
      if (page.size < 1000) break;
    } while (startAfter);
    if (remaining) await this.storage.setAlarm(Date.now() + 3_600_000);
  }
}
