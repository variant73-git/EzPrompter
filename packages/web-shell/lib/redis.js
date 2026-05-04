import { Redis } from '@upstash/redis';

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required.');
  _redis = new Redis({ url, token });
  return _redis;
}

export const redis = new Proxy(function () {}, {
  get(_t, prop) { return getRedis()[prop]; }
});

export async function storeCapture(id, data, ttlSeconds = 1800) {
  await getRedis().set(id, JSON.stringify(data), { ex: ttlSeconds });
}

export async function getCapture(id) {
  const data = await getRedis().get(id);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function deleteCapture(id) {
  await getRedis().del(id);
}
