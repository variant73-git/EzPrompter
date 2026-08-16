import { describe, expect, it, vi } from 'vitest';
import { assertPublicReferenceUrl, isPrivateReferenceHost } from './public-reference-url.js';

describe('public reference URL guard', () => {
  it('blocks loopback, private networks, and local hostnames', () => {
    expect(isPrivateReferenceHost('localhost')).toBe(true);
    expect(isPrivateReferenceHost('127.0.0.1')).toBe(true);
    expect(isPrivateReferenceHost('10.1.2.3')).toBe(true);
    expect(isPrivateReferenceHost('192.168.1.4')).toBe(true);
    expect(isPrivateReferenceHost('reference.example')).toBe(false);
  });

  it('resolves public hosts and rejects DNS answers pointing to private space', async () => {
    const publicLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertPublicReferenceUrl('https://reference.example/path#hero', { resolve: publicLookup })).resolves.toBe('https://reference.example/path');
    const privateLookup = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertPublicReferenceUrl('https://metadata.example', { resolve: privateLookup })).rejects.toThrow('private_reference_url');
  });
});
