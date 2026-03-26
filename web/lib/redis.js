import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function storeCapture(id, data, ttlSeconds = 1800) {
  await redis.set(id, JSON.stringify(data), { ex: ttlSeconds });
}

export async function getCapture(id) {
  const data = await redis.get(id);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function deleteCapture(id) {
  await redis.del(id);
}
