import { describe, expect, it } from 'vitest';
import { normalizeServerAddress } from './address';

describe('normalizeServerAddress', () => {
  it.each([
    ['10.77.224.233', 'http://10.77.224.233:4000'],
    ['  192.168.1.5:5000 ', 'http://192.168.1.5:5000'],
    ['http://10.0.0.2:4000/', 'http://10.0.0.2:4000'],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://abc.trycloudflare.com/', 'https://abc.trycloudflare.com'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeServerAddress(input)).toBe(expected);
  });

  it.each(['', '   ', 'http://', 'not a url at all'])('rejects %j', (input) => {
    expect(normalizeServerAddress(input)).toBeNull();
  });
});
