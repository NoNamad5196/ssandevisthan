import { type FieldEvidence, type ImageSource, type RejectReason, type SearchMode } from '@ssandevisthan/contracts';

export interface SourceEligibility {
  isClothing: boolean | null;
  condition: 'NEW' | 'USED' | 'UNKNOWN';
  domesticShipping: 'CONFIRMED' | 'REJECTED' | 'UNKNOWN';
  domesticSales: boolean | null;
  overseasDirect: boolean | null;
  rental: boolean | null;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  productPageVerified: boolean;
  imageVerifiedSameProduct: boolean;
  imageVerifiedSameVariant: boolean;
  isMerchantImage: boolean;
  variantVerified: boolean;
}
export function checkSourceEligibility(source: SourceEligibility, mode: SearchMode = 'IMAGE_SIMILAR', imageSource?: ImageSource): { pass: boolean; reasons: RejectReason[] } {
  const reasons: RejectReason[] = [];
  if (mode === 'IMAGE_SIMILAR' && source.isClothing === false) reasons.push('NOT_CLOTHING');
  if (source.condition === 'USED') reasons.push('NOT_NEW');
  if (source.overseasDirect === true) reasons.push('OVERSEAS_DIRECT');
  if (source.rental === true) reasons.push('RENTAL');
  if (source.stockStatus === 'OUT_OF_STOCK') reasons.push('OUT_OF_STOCK');
  if (source.condition !== 'NEW' || source.domesticShipping !== 'CONFIRMED' || source.domesticSales !== true || source.overseasDirect !== false || source.rental !== false || source.stockStatus !== 'IN_STOCK' || (mode === 'IMAGE_SIMILAR' && source.isClothing !== true)) reasons.push('ELIGIBILITY_UNKNOWN');
  if (!source.productPageVerified) reasons.push('PRODUCT_PAGE_UNVERIFIED');
  if (!source.isMerchantImage || !source.imageVerifiedSameProduct || imageSource === 'placeholder' || imageSource === 'search_thumbnail') reasons.push('IMAGE_UNVERIFIED');
  if (!source.variantVerified || !source.imageVerifiedSameVariant) reasons.push('VARIANT_MISMATCH');
  return { pass: !reasons.length, reasons: [...new Set(reasons)] };
}
export interface EvidenceContext { productId: string; offerId: string; variantId: string; productUrl: string; evidenceIds: readonly string[] }
/** Model/search/community claims can never become verified commerce facts. */
export function hasVerifiedFieldEvidence(evidence: readonly FieldEvidence[], context: EvidenceContext, fieldPath: string, value: unknown, observedAt?: string | null): boolean {
  const expectedHost = new URL(context.productUrl).hostname;
  return evidence.some((record) => {
    if (!context.evidenceIds.includes(record.id) || record.confidence !== 'VERIFIED'
      || record.productId !== context.productId || record.variantId !== context.variantId
      || (fieldPath !== '/imageUrl' && record.offerId !== context.offerId)
      || record.fieldPath !== fieldPath || JSON.stringify(record.value) !== JSON.stringify(value)
      || (observedAt !== undefined && record.observedAt !== observedAt)) return false;
    if (!['MERCHANT_PAGE', 'MERCHANT_METADATA', ...(fieldPath === '/imageUrl' ? ['MERCHANT_IMAGE'] : [])].includes(record.sourceKind)) return false;
    try { return new URL(record.sourceUrl).hostname === expectedHost; } catch { return false; }
  });
}
