import { LIMITS, type PriceBasis } from '@ssandevisthan/contracts';

export interface PriceInput {
  itemPrice: number | null;
  shippingFee: number | null;
  currency: string;
  variantPriceVerified: boolean;
  unconditionalPriceVerified: boolean;
  shippingFeeVerified: boolean;
  priceObservedAt: string | null;
}
export interface NormalizedPrice {
  itemPrice: number | null; shippingFee: number | null; effectivePrice: number | null;
  priceBasis: PriceBasis; reasonCode: 'PRICE_UNKNOWN' | 'STALE_PRICE' | 'VARIANT_PRICE_UNKNOWN' | null;
}
export function normalizePrice(input: PriceInput, now: number): NormalizedPrice {
  const unknown = (reasonCode: NormalizedPrice['reasonCode']): NormalizedPrice => ({ itemPrice: null, shippingFee: null, effectivePrice: null, priceBasis: 'UNKNOWN', reasonCode });
  if (!input.variantPriceVerified) return unknown('VARIANT_PRICE_UNKNOWN');
  if (input.currency !== 'KRW' || !Number.isSafeInteger(input.itemPrice) || input.itemPrice! <= 0 || !input.unconditionalPriceVerified) return unknown('PRICE_UNKNOWN');
  const observed = input.priceObservedAt === null ? NaN : Date.parse(input.priceObservedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now) return unknown('PRICE_UNKNOWN');
  if (now - observed > LIMITS.priceFreshnessMs) return unknown('STALE_PRICE');
  const verifiedShipping = input.shippingFeeVerified && Number.isSafeInteger(input.shippingFee) && input.shippingFee! >= 0;
  if (!verifiedShipping) return { itemPrice: input.itemPrice, shippingFee: null, effectivePrice: null, priceBasis: 'ITEM_PRICE_ONLY', reasonCode: null };
  const total = input.itemPrice! + input.shippingFee!;
  if (!Number.isSafeInteger(total)) return unknown('PRICE_UNKNOWN');
  return { itemPrice: input.itemPrice, shippingFee: input.shippingFee, effectivePrice: total, priceBasis: 'TOTAL_PRICE', reasonCode: null };
}
/** Midrank percentile is calculated over the complete deduplicated price cohort. */
export function calculatePriceScores(prices: readonly number[]): number[] {
  if (prices.some((p) => !Number.isSafeInteger(p) || p <= 0)) throw new Error('INVALID_PRICE');
  if (prices.length < 2 || new Set(prices).size === 1) return prices.map(() => .5);
  const sorted = [...prices].sort((a, b) => a - b), scores = new Map<number, number>();
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[index]) end++;
    const midrank = (index + end) / 2 + 1;
    scores.set(sorted[index]!, 1 - (midrank - 1) / (prices.length - 1));
    index = end + 1;
  }
  return prices.map((price) => scores.get(price)!);
}
