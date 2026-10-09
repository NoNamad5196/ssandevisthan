import { LIMITS } from '@ssandevisthan/contracts';
import { canonicalizeProductUrl } from './url.ts';

export interface DiscoveryCandidate {
  url: string; queryOrdinal: number; discoveryRank: number; merchant: string;
  categorySuitable: boolean | null; knownAttributeCount: number;
}
export interface DeduplicatedCandidate extends DiscoveryCandidate { discoveryQueryOrdinals: number[] }
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Query round-robin ensures a fast single source cannot consume the entire candidate pool. */
export function deduplicateDiscovery(input: readonly DiscoveryCandidate[]): DeduplicatedCandidate[] {
  if (input.length > LIMITS.rawUrls) throw new Error('RAW_URL_LIMIT_EXCEEDED');
  const queues = new Map<number, DiscoveryCandidate[]>();
  for (const record of input) {
    if (record.categorySuitable === false) continue;
    let url: string;
    try { url = canonicalizeProductUrl(record.url); } catch { continue; }
    const queue = queues.get(record.queryOrdinal) ?? [];
    queue.push({ ...record, url }); queues.set(record.queryOrdinal, queue);
  }
  for (const queue of queues.values()) queue.sort((a, b) => a.discoveryRank - b.discoveryRank || lexical(a.url, b.url));
  const candidates = new Map<string, DeduplicatedCandidate>();
  const ordinals = [...queues.keys()].sort((a, b) => a - b);
  const longest = Math.max(0, ...[...queues.values()].map((q) => q.length));
  for (let index = 0; index < longest; index++) for (const ordinal of ordinals) {
    const record = queues.get(ordinal)![index];
    if (!record) continue;
    const existing = candidates.get(record.url);
    if (existing) {
      if (!existing.discoveryQueryOrdinals.includes(ordinal)) existing.discoveryQueryOrdinals.push(ordinal);
    } else if (candidates.size < LIMITS.dedupUrls) candidates.set(record.url, { ...record, discoveryQueryOrdinals: [ordinal] });
  }
  return [...candidates.values()];
}
export function selectDiverseCandidates<T extends DiscoveryCandidate>(input: readonly T[], limit: 20 | 30): T[] {
  const sorted = input.filter((c) => c.categorySuitable !== false).sort((a, b) =>
    Number(b.categorySuitable === true) - Number(a.categorySuitable === true)
    || b.knownAttributeCount - a.knownAttributeCount || a.discoveryRank - b.discoveryRank || lexical(a.url, b.url));
  const chosen: T[] = [], overflow: T[] = [], merchantCounts = new Map<string, number>();
  for (const record of sorted) {
    const count = merchantCounts.get(record.merchant) ?? 0;
    if (count < 6 && chosen.length < limit) { chosen.push(record); merchantCounts.set(record.merchant, count + 1); }
    else overflow.push(record);
  }
  return [...chosen, ...overflow.slice(0, Math.max(0, limit - chosen.length))];
}
