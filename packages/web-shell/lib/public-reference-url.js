import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

export function isPrivateReferenceHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIP(host) === 4) return privateIpv4(host);
  if (isIP(host) === 6) return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.');
  return false;
}

export async function assertPublicReferenceUrl(value, { resolve = lookup } = {}) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('invalid_reference_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateReferenceHost(parsed.hostname)) throw new Error('private_reference_url');
  const records = await resolve(parsed.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateReferenceHost(record.address))) throw new Error('private_reference_url');
  parsed.hash = '';
  return parsed.toString();
}
