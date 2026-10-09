import { LIMITS } from '@ssandevisthan/contracts';

export class UrlPolicyError extends Error {
  constructor(public readonly code: 'INVALID_URL' | 'UNSAFE_URL' | 'UNSAFE_ADDRESS' | 'DNS_UNVERIFIED' | 'REDIRECT_LIMIT') { super(code); this.name = 'UrlPolicyError'; }
}
function ipv4Bytes(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number);
}
function ipv6Words(value: string): number[] | null {
  if (value.includes('%') || (value.match(/::/g)?.length ?? 0) > 1) return null;
  let address = value.toLowerCase();
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':'), tail = ipv4Bytes(address.slice(colon + 1));
    if (!tail) return null;
    address = `${address.slice(0, colon)}:${(tail[0]! * 256 + tail[1]!).toString(16)}:${(tail[2]! * 256 + tail[3]!).toString(16)}`;
  }
  const compressed = address.includes('::'), halves = address.split('::');
  const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const missing = 8 - left.length - right.length;
  if ((compressed && missing < 1) || (!compressed && missing !== 0)) return null;
  return [...left.map((v) => parseInt(v, 16)), ...Array<number>(missing).fill(0), ...right.map((v) => parseInt(v, 16))];
}
/** Reject special-use networks conservatively. The connection still needs DNS pinning. */
export function isPublicIpAddress(input: string): boolean {
  const value = input.replace(/^\[|\]$/g, '');
  const v4 = ipv4Bytes(value);
  if (v4) {
    const [a, b, c] = v4 as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113));
  }
  const v6 = ipv6Words(value);
  if (!v6) return false;
  // Accept globally routed unicast only. Reject mapped IP, transition, documentation and special allocations.
  return v6[0]! >= 0x2000 && v6[0]! <= 0x3fff
    && !(v6[0] === 0x2001 && (v6[1]! < 0x0200 || v6[1] === 0x0db8))
    && v6[0] !== 0x2002 && v6[0] !== 0x3fff;
}
const sensitiveQuery = /^(?:token|access_token|auth|authorization|api_key|apikey|signature|sig|session|sessionid|jwt|x-amz-(?:credential|signature|security-token))$/i;
export function validatePublicHttpsUrl(input: string): URL {
  if (input.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(input)) throw new UrlPolicyError('INVALID_URL');
  let url: URL;
  try { url = new URL(input); } catch { throw new UrlPolicyError('INVALID_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new UrlPolicyError('UNSAFE_URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') && !host.includes(':') || /(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan)$/.test(host)) throw new UrlPolicyError('UNSAFE_URL');
  if (host.includes(':') || /^[0-9.]+$/.test(host)) {
    if (!isPublicIpAddress(host)) throw new UrlPolicyError('UNSAFE_ADDRESS');
  } else if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) throw new UrlPolicyError('UNSAFE_URL');
  for (const key of url.searchParams.keys()) if (sensitiveQuery.test(key)) throw new UrlPolicyError('UNSAFE_URL');
  url.hostname = host;
  return url;
}
export function validateResolvedAddresses(url: URL, addresses: readonly string[]): void {
  validatePublicHttpsUrl(url.href);
  if (!addresses.length) throw new UrlPolicyError('DNS_UNVERIFIED');
  if (addresses.some((address) => !isPublicIpAddress(address))) throw new UrlPolicyError('UNSAFE_ADDRESS');
}
export function validateRedirect(location: string, current: URL, followed: number): URL {
  if (!Number.isInteger(followed) || followed < 0 || followed >= LIMITS.redirects) throw new UrlPolicyError('REDIRECT_LIMIT');
  return validatePublicHttpsUrl(new URL(location, current).href);
}
export function hostMatches(host: string, domain: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  const boundary = domain.toLowerCase().replace(/\.$/, '');
  return normalized === boundary || normalized.endsWith(`.${boundary}`);
}
/** Only known tracking parameters are removed; unknown and variant parameters survive. */
export function canonicalizeProductUrl(input: string): string {
  const url = validatePublicHttpsUrl(input);
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (/^utm_/i.test(name) || /^(gclid|dclid|fbclid|msclkid)$/i.test(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  return url.href;
}
