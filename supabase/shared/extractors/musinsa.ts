import type { FieldEvidence } from '@ssandevisthan/contracts';
import { canonicalizeProductUrl } from '@ssandevisthan/search-core';
import { AppError, sha256, type Row } from '../runtime.ts';
import { SafeFetcher } from '../safe-fetch.ts';
import { validateMerchantImage } from '../images.ts';

export const MUSINSA_VERSION = 'musinsa-public-exact-option-v3-1';
const fail = (code: string): never => { throw new AppError(code, 422); };
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function data(envelope: unknown): unknown {
  if (!object(envelope) || envelope.meta?.result !== 'SUCCESS' || envelope.meta?.errorCode !== '' || (envelope.error !== undefined && envelope.error !== null)) return fail('CONFLICTING_SOURCE');
  return envelope.data;
}
function attributes(source: string) { return Object.fromEntries([...source.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1], match[3]])); }
function metaValue(html: string, property: string): string {
  const values = [...html.matchAll(/<meta\b([^>]*)>/gi)].map(match => attributes(match[1])).filter(attrs => attrs.property === property).map(attrs => attrs.content);
  if (values.length !== 1 || typeof values[0] !== 'string') return fail('CONFLICTING_SOURCE');
  return values[0].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
export interface MusinsaVariant {
  variantId: number; colorValueId: number; sizeValueId: number; color: string; size: string; imageUrl: string;
}
export interface MusinsaProduct {
  canonicalUrl: string; sourceProductKey: string; title: string; merchant: string; itemPrice: number;
  shippingFee: null; domesticSales: true; rental: boolean | null; variants: MusinsaVariant[]; colorValueIds: number[];
}

/** Merchant SSR JSON and meta declarations only. No merchant JavaScript is
 * executed. A product-level stock flag or activated option is NEVER SKU stock. */
export function parseMusinsaProduct(html: string, pageUrl: string): MusinsaProduct {
  const url = new URL(canonicalizeProductUrl(pageUrl));
  const id = url.pathname.match(/^\/products\/([1-9]\d*)\/?$/)?.[1];
  if (url.hostname !== 'www.musinsa.com' || !id || !positive(Number(id))) return fail('PAGE_NOT_PRODUCT');
  if ([...url.searchParams.keys()].length) return fail('VARIANT_AMBIGUOUS');
  const canonicalUrl = `https://www.musinsa.com/products/${id}`;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match => attributes(match[1]).id === '__NEXT_DATA__');
  if (scripts.length !== 1) return fail('PAGE_NOT_PRODUCT');
  let root: Row;
  try { root = JSON.parse(scripts[0][2]); } catch { return fail('PAGE_NOT_PRODUCT'); }
  const props = root?.props?.pageProps;
  if (!object(props) || props.pageUrl !== canonicalUrl || metaValue(html, 'og:url') !== canonicalUrl) return fail('AMBIGUOUS_PRODUCT');
  if (props.isGlobalRequest !== false || props.shared?.loggedIn !== false) return fail('CONDITIONAL_PRICE_ONLY');
  const queries = props.dehydratedState?.queries;
  if (!Array.isArray(queries)) return fail('PAGE_NOT_PRODUCT');
  function query(key: string): Row {
    const matching = queries.filter(q => Array.isArray(q?.queryKey) && q.queryKey.length === 2 && q.queryKey[0] === key && q.queryKey[1] === Number(id));
    if (matching.length !== 1) return fail('AMBIGUOUS_PRODUCT');
    const result = data(matching[0].state?.data);
    if (!object(result)) return fail('CONFLICTING_SOURCE');
    return result;
  }
  const product = query('Detail'), options = query('Options'), metadata = data(props.meta);
  if (!object(metadata) || product.goodsNo !== Number(id) || !text(product.goodsNm) || product.goodsNm !== metadata.goodsNm) return fail('AMBIGUOUS_PRODUCT');
  if (metaValue(html, 'product:condition') !== '신규' || product.usedProduct !== null) return fail('NOT_NEW');
  if (product.goodsSaleType !== 'SALE' || metadata.goodsSaleType !== 'SALE' || product.isOutOfStock !== false) return fail('OUT_OF_STOCK');
  if (product.isIntangibleGoods !== false || product.isRaffle !== false || product.isOnlyGlobalGoods !== false) return fail('ELIGIBILITY_UNKNOWN');
  const memberFlags = ['isBuyForMember', 'isAppGoods', 'isOfflineGoods'];
  if (memberFlags.some(key => product[key] !== false || options[key] !== false)
    || product.isExclusiveMusinsaPay !== false || product.isExclusiveMusinsaHyundaiCard !== false || product.memberGrade !== null) return fail('CONDITIONAL_PRICE_ONLY');
  const price = product.goodsPrice;
  if (!object(price) || !equal(price, metadata.goodsPrice) || price.type !== 'DEFAULT' || price.currency !== 'KRW'
    || !positive(price.salePrice) || !positive(price.normalPrice) || price.normalPrice < price.salePrice
    || price.partnerDiscountOn !== false || price.partnerInformation !== null || price.memberDiscountRate !== 0
    || price.extraDiscountAmount !== 0 || price.isOptionSalePriceVaried !== false || !object(price.optionPrices) || Object.keys(price.optionPrices).length
    || metaValue(html, 'product:price:currency') !== 'KRW' || metaValue(html, 'product:price:amount') !== String(price.salePrice)) return fail('CONDITIONAL_PRICE_ONLY');
  // salePrice is the anonymous DEFAULT ordinary item price. Coupon/final prices
  // and member-only free shipping never replace it, even if they are lower.
  const logistics = product.logisticsPrioritizedInventory, domestic = product.domesticDelivery, company = product.company;
  if (!object(logistics) || logistics.isOverseasDelivery !== false || !['CJ대한통운', '한진택배'].includes(logistics.courierName)
    || !object(domestic) || !['PLUS', 'MANUAL'].includes(domestic.deliveryType) || !['CJGLS', 'HANJIN'].includes(domestic.preferDeliveryCompanyType)
    || !Array.isArray(product.goodsLogisticsInfoV2) || !product.goodsLogisticsInfoV2.length || product.goodsLogisticsInfoV2.some((row: Row) => row?.isOverseasDelivery !== false)
    || !object(company) || !text(company.name, 200) || !/^\d{10}$/.test(company.businessNumber ?? '')
    || !text(company.mailOrderReportNumber, 100) || !/^(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)\s/.test(company.address ?? '')
    || !equal(company, metadata.company) || metaValue(html, 'product:retailer_item_id') !== company.name) return fail('ELIGIBILITY_UNKNOWN');
  if (!Array.isArray(options.basic) || options.basic.length !== 2 || !Array.isArray(options.extra) || options.extra.length
    || !Array.isArray(options.optionItems) || !options.optionItems.length || options.optionItems.length > 100) return fail('VARIANT_AMBIGUOUS');
  const [colorAxis, sizeAxis] = options.basic;
  if (colorAxis?.standardOptionNo !== 1 || colorAxis.displayType !== 'COLOR_CHIP' || !['컬러', '색상'].includes(colorAxis.name)
    || sizeAxis?.standardOptionNo !== 3 || sizeAxis.displayType !== 'DROPDOWN' || sizeAxis.name !== '사이즈') return fail('VARIANT_AMBIGUOUS');
  const values = new Map<number, Row>();
  for (const axis of [colorAxis, sizeAxis]) {
    if (!positive(axis.no) || axis.isDeleted !== false || axis.type !== 'basic' || !Array.isArray(axis.optionValues) || !axis.optionValues.length) return fail('VARIANT_AMBIGUOUS');
    for (const value of axis.optionValues) {
      if (!object(value) || !positive(value.no) || values.has(value.no) || value.optionNo !== axis.no || value.isDeleted !== false || !text(value.name, 80)) return fail('VARIANT_AMBIGUOUS');
      values.set(value.no, value);
    }
  }
  const variants: MusinsaVariant[] = [], variantIds = new Set<number>(), pairs = new Set<string>();
  for (const item of options.optionItems) {
    if (!object(item) || !positive(item.no) || variantIds.has(item.no) || item.goodsNo !== Number(id) || !Array.isArray(item.optionValueNos) || item.optionValueNos.length !== 2) return fail('VARIANT_AMBIGUOUS');
    variantIds.add(item.no);
    if (item.isDeleted === true || item.activated === false) continue;
    if (item.isDeleted !== false || item.activated !== true || item.price !== 0) return fail('VARIANT_AMBIGUOUS');
    const [color, size] = item.optionValueNos.map((no: number) => values.get(no));
    if (!color || !size || color.optionNo !== colorAxis.no || size.optionNo !== sizeAxis.no || pairs.has(item.optionValueNos.join(':'))) return fail('VARIANT_AMBIGUOUS');
    pairs.add(item.optionValueNos.join(':'));
    if (!Array.isArray(item.optionValues) || item.optionValues.length !== 2 || item.optionValues.some((value: Row, index: number) => {
      const expected = index === 0 ? color : size;
      return value?.no !== expected.no || value?.optionNo !== expected.optionNo || value?.name !== expected.name;
    })) return fail('VARIANT_AMBIGUOUS');
    let image: URL;
    try { image = new URL(color.imageUrl); } catch { return fail('AMBIGUOUS_IMAGE'); }
    if (image.protocol !== 'https:' || image.hostname !== 'image.msscdn.net' || image.port || image.username || image.password || image.search || image.hash
      || !/^\/thumbnails\/images\/\d{4}\/\d{2}\/\d{2}\/[\da-f]+\.(?:jpg|jpeg|png|webp)$/.test(image.pathname)) return fail('IMAGE_UNVERIFIED');
    variants.push({ variantId: item.no, colorValueId: color.no, sizeValueId: size.no, color: color.name, size: size.name, imageUrl: image.href });
  }
  if (!variants.length) return fail('OUT_OF_STOCK');
  return { canonicalUrl, sourceProductKey: id, title: product.goodsNm, merchant: company.name, itemPrice: price.salePrice,
    shippingFee: null, domesticSales: true, rental: null, variants, colorValueIds: colorAxis.optionValues.map((value: Row) => value.no).filter((no: number) => variants.some(variant => variant.colorValueId === no)) };
}

/** The public inventory endpoint is selected by merchant page JavaScript. Its
 * productVariantId is the Options item no, not a color or size value ID.
 * RESERVE/preorder stock is never treated as currently purchasable stock. */
export function selectMusinsaVariant(product: MusinsaProduct, colorValueId: number, response: unknown): MusinsaVariant {
  if (!product.colorValueIds.includes(colorValueId)) return fail('VARIANT_AMBIGUOUS');
  const rows = data(response);
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) return fail('ELIGIBILITY_UNKNOWN');
  const candidates = product.variants.filter(variant => variant.colorValueId === colorValueId), inventory = new Map<number, Row>();
  for (const row of rows) {
    if (!object(row) || row.productId !== Number(product.sourceProductKey) || !positive(row.productVariantId) || inventory.has(row.productVariantId)
      || !candidates.some(variant => variant.variantId === row.productVariantId)) return fail('VARIANT_MISMATCH');
    inventory.set(row.productVariantId, row);
  }
  const selected = candidates.find(variant => {
    const row = inventory.get(variant.variantId), delivery = row?.domesticDelivery;
    return row?.outOfStock === false && row.isRedirect === false && row.relatedOption === null
      && (row.remainQuantity === null || positive(row.remainQuantity)) && delivery?.deliveryType === 'MANUAL' && delivery.manualType === 'GENERAL'
      && /^\d{4}-\d{2}-\d{2}$/.test(delivery.willReleaseDate ?? '') && ['CJGLS', 'HANJIN'].includes(delivery.preferDeliveryCompanyType);
  });
  return selected ?? fail('OUT_OF_STOCK');
}

export async function extractMusinsaCandidate(context: { searchId: string; candidateId: string; url: string; deadline: number }, fetcher: SafeFetcher = new SafeFetcher()): Promise<Row> {
  const page = await fetcher.get(context.url, 'html', context.deadline);
  const parsed = parseMusinsaProduct(new TextDecoder('utf-8', { fatal: true }).decode(page.bytes), page.url);
  const stockUrl = `https://goods-detail.musinsa.com/api2/goods/${parsed.sourceProductKey}/options/v2/prioritized-inventories`;
  let selected: MusinsaVariant | undefined, inventoryBytes: Uint8Array | undefined;
  // Bounded public reads in source order, never cheapest-variant substitution.
  for (const color of parsed.colorValueIds.slice(0, 3)) {
    const stock = await fetcher.postJson(stockUrl, { optionValueNos: [color] }, context.deadline);
    let response: unknown; try { response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stock.bytes)); } catch { return fail('CONFLICTING_SOURCE'); }
    try { selected = selectMusinsaVariant(parsed, color, response); inventoryBytes = stock.bytes; break; }
    catch (error) { if (!(error instanceof AppError) || error.code !== 'OUT_OF_STOCK') throw error; }
  }
  if (!selected || !inventoryBytes) return fail('OUT_OF_STOCK');
  const image = await fetcher.get(selected.imageUrl, 'image', context.deadline); await validateMerchantImage(image.bytes);
  const pageHash = await sha256(page.bytes), imageHash = await sha256(image.bytes), inventoryHash = await sha256(inventoryBytes), now = new Date().toISOString();
  const productId = crypto.randomUUID(), variantId = crypto.randomUUID(), offerId = crypto.randomUUID(), evidence: FieldEvidence[] = [];
  function record(fieldPath: string, value: unknown, locator: string, sourceKind: FieldEvidence['sourceKind'] = 'MERCHANT_METADATA', hash = pageHash, sourceUrl = parsed.canonicalUrl) {
    evidence.push({ id: crypto.randomUUID(), searchId: context.searchId, candidateId: context.candidateId, productId, variantId, offerId, fieldPath, value, sourceUrl, sourceKind,
      extractionMethod: locator, evidenceExcerpt: null, contentSha256: hash, observedAt: now, confidence: 'VERIFIED', extractorVersion: MUSINSA_VERSION });
  }
  record('/title', parsed.title, '__NEXT_DATA__: exact Detail query goodsNo/goodsNm + meta.goodsNm + canonical URL');
  record('/imageUrl', image.url, 'Options exact item ID and color value join; color-specific imageUrl; size-only remaining axis; decoded safe GET', 'MERCHANT_IMAGE', imageHash);
  record('/itemPrice', parsed.itemPrice, 'Anonymous DEFAULT/KRW Detail+meta goodsPrice.salePrice + product:price:amount; exact option item price=0; option price variation false');
  record('/condition', 'NEW', 'product:condition=신규 + Detail.usedProduct=null');
  record('/domesticSales', true, 'Domestic delivery carrier and domestic-only inventory/logistics; identified Korean registered seller agrees with meta');
  record('/domesticShipping', 'CONFIRMED', 'Detail.domesticDelivery + logisticsPrioritizedInventory domestic courier; all logistics isOverseasDelivery=false');
  record('/overseasDirect', false, 'Detail.logisticsPrioritizedInventory and all goodsLogisticsInfoV2 isOverseasDelivery=false');
  record('/variant', String(selected.variantId), 'Options.optionItems.no binds exact color and size optionValueNos');
  record('/stockStatus', 'IN_STOCK', `Public prioritized-inventories: productId=${parsed.sourceProductKey}; productVariantId=${selected.variantId}; outOfStock=false; no redirect/replacement; GENERAL delivery`, 'MERCHANT_METADATA', inventoryHash, stockUrl);
  return { candidateId: context.candidateId, productId, variantId, offerId, resultGroupKey: `musinsa:${parsed.sourceProductKey}`, title: parsed.title, merchant: parsed.merchant,
    source: 'musinsa.com', productUrl: parsed.canonicalUrl, imageUrl: image.url, imageSource: 'merchant_cdn', imageSourceUrl: parsed.canonicalUrl, imageExtractionStage: 'STATIC_HTML',
    variant: { color: selected.color, size: selected.size, availability: 'IN_STOCK', selectionRequired: true }, currency: 'KRW', itemPrice: parsed.itemPrice, shippingFee: null,
    conditionalPrices: [], priceObservedAt: now, imageObservedAt: now, stockObservedAt: now, evidenceIds: evidence.map(record => record.id), fieldEvidence: evidence,
    matchedAttributes: [], differentAttributes: [], unknownAttributes: [], warnings: [], comparison: null,
    price: { variantPriceVerified: true, unconditionalPriceVerified: true, shippingFeeVerified: false },
    eligibility: { isClothing: null, condition: 'NEW', domesticShipping: 'CONFIRMED', domesticSales: true, overseasDirect: false, rental: parsed.rental, stockStatus: 'IN_STOCK',
      productPageVerified: true, imageVerifiedSameProduct: true, imageVerifiedSameVariant: true, isMerchantImage: true, variantVerified: true },
    sourceVariantKey: String(selected.variantId), sourceProductKey: parsed.sourceProductKey, canonicalUrlHash: await sha256(parsed.canonicalUrl), imageHash, observedAt: now };
}
