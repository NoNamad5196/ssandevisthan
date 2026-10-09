import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { FieldEvidenceSchema, ImageExtractionStageSchema } from '@ssandevisthan/contracts';
import { checkSourceEligibility } from '@ssandevisthan/search-core';

// SYNTHETIC ONLY. The IDs, seller, image, prices and product below are invented
// to exercise the observed public response schema. They are never LIVE results.
const backend = '../../../supabase/shared/';
const { parseMusinsaProduct, selectMusinsaVariant, extractMusinsaCandidate } = await import(`${backend}extractors/musinsa.ts`);
const { configureImages } = await import(`${backend}images.ts`);
const port = '../../../apps/api/src/';
const { normalizeImage, validateImage } = await import(`${port}images.ts`);
configureImages({ normalize: normalizeImage, validate: validateImage });
type Row = Record<string, any>;
const id = 999901, url = `https://www.musinsa.com/products/${id}`, amount = 19_800;
const imageUrl = 'https://image.msscdn.net/thumbnails/images/2026/01/01/abcdef01.jpg';
const envelope = <T,>(value: T) => ({ meta: { result: 'SUCCESS', errorCode: '' }, data: value, error: null });
function source() {
  const company = { name: '합성 판매자', businessNumber: '9999999999', mailOrderReportNumber: '2026-서울-합성', address: '서울 합성 테스트 주소' };
  const price = { salePrice: amount, normalPrice: 25_000, type: 'DEFAULT', currency: 'KRW', partnerDiscountOn: false, partnerInformation: null,
    memberDiscountRate: 0, extraDiscountAmount: 0, isOptionSalePriceVaried: false, optionPrices: {}, couponPrice: amount - 1000, finalPrice: amount - 1000 };
  const flags = { isBuyForMember: false, isAppGoods: false, isOfflineGoods: false };
  const product = { goodsNo: id, goodsNm: '합성 후드 집업', usedProduct: null, goodsSaleType: 'SALE', isOutOfStock: false,
    isIntangibleGoods: false, isRaffle: false, isOnlyGlobalGoods: false, ...flags, isExclusiveMusinsaPay: false, isExclusiveMusinsaHyundaiCard: false,
    memberGrade: null, goodsPrice: price, logisticsPrioritizedInventory: { isOverseasDelivery: false, courierName: 'CJ대한통운' },
    domesticDelivery: { deliveryType: 'PLUS', preferDeliveryCompanyType: 'CJGLS' }, goodsLogisticsInfoV2: [{ isOverseasDelivery: false }], company };
  const color = { no: 100, optionNo: 10, name: 'GREY', isDeleted: false, imageUrl };
  const small = { no: 101, optionNo: 11, name: 'S', isDeleted: false, imageUrl: '' };
  const medium = { no: 102, optionNo: 11, name: 'M', isDeleted: false, imageUrl: '' };
  const options = { ...flags, basic: [
    { no: 10, standardOptionNo: 1, name: '컬러', type: 'basic', displayType: 'COLOR_CHIP', isDeleted: false, optionValues: [color] },
    { no: 11, standardOptionNo: 3, name: '사이즈', type: 'basic', displayType: 'DROPDOWN', isDeleted: false, optionValues: [small, medium] }],
    extra: [], optionItems: [small, medium].map((size, index) => ({ no: 200 + index, goodsNo: id, optionValueNos: [color.no, size.no], optionValues: [color, size], price: 0, activated: true, isDeleted: false })) };
  return { props: { pageProps: { pageUrl: url, isGlobalRequest: false, shared: { loggedIn: false },
    meta: envelope({ goodsNm: product.goodsNm, goodsSaleType: product.goodsSaleType, goodsPrice: structuredClone(price), company: structuredClone(company) }),
    dehydratedState: { queries: [{ queryKey: ['Detail', id], state: { data: envelope(product) } }, { queryKey: ['Options', id], state: { data: envelope(options) } }] } } } };
}
function page(edit: (root: Row, detail: Row, options: Row) => void = () => {}, metas: Record<string, string> = {}) {
  const root = source(), queries = root.props.pageProps.dehydratedState.queries;
  edit(root, queries[0].state.data.data, queries[1].state.data.data);
  const fields = { 'og:url': url, 'product:condition': '신규', 'product:price:currency': 'KRW', 'product:price:amount': String(amount), 'product:retailer_item_id': '합성 판매자', ...metas };
  return `<html>${Object.entries(fields).map(([key, value]) => `<meta property="${key}" content="${value}">`).join('')}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(root)}</script></html>`;
}
function stock(overrides: Row[] = [{}, { domesticDelivery: { deliveryType: 'MANUAL', manualType: 'RESERVE', willReleaseDate: '2026-02-01', preferDeliveryCompanyType: 'CJGLS' } }]) {
  return envelope(overrides.map((row, index) => ({ productId: id, productVariantId: 200 + index, remainQuantity: null, outOfStock: false,
    isRedirect: false, relatedOption: null, domesticDelivery: { deliveryType: 'MANUAL', manualType: 'GENERAL', willReleaseDate: '2026-01-01', preferDeliveryCompanyType: 'CJGLS' }, ...row })));
}

describe('Musinsa public exact option parser — SYNTHETIC responses only', () => {
  it('binds anonymous ordinary price and color-specific image to exact SKU, preserving unknown rental and shipping', () => {
    const parsed = parseMusinsaProduct(page(), url);
    expect(parsed).toMatchObject({ canonicalUrl: url, sourceProductKey: String(id), itemPrice: amount, shippingFee: null, rental: null, domesticSales: true });
    expect(selectMusinsaVariant(parsed, 100, stock())).toEqual({ variantId: 200, colorValueId: 100, sizeValueId: 101, color: 'GREY', size: 'S', imageUrl });
  });
  it('rejects different host, unknown variant parameters and mismatched source identity', () => {
    expect(parseMusinsaProduct(page(), `${url}?utm_source=synthetic`).canonicalUrl).toBe(url);
    expect(() => parseMusinsaProduct(page(), `${url}?optionId=201`)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseMusinsaProduct(page(), url.replace('www.musinsa.com', 'www.11st.co.kr'))).toThrow('PAGE_NOT_PRODUCT');
    expect(() => parseMusinsaProduct(page((_, detail) => { detail.goodsNo = 2; }), url)).toThrow('AMBIGUOUS_PRODUCT');
    expect(() => parseMusinsaProduct(page(undefined, { 'og:url': 'https://www.musinsa.com/products/2' }), url)).toThrow('AMBIGUOUS_PRODUCT');
  });
  it('does not read another Detail query or execute merchant scripts', () => {
    const html = page(root => { root.props.pageProps.dehydratedState.queries[0].queryKey[1] = 2; });
    expect(() => parseMusinsaProduct(html, url)).toThrow('AMBIGUOUS_PRODUCT');
    const good = page() + '<script>globalThis.__MUSINSA_TEST__=true</script>';
    expect(parseMusinsaProduct(good, url).itemPrice).toBe(amount);
    expect((globalThis as Record<string, unknown>).__MUSINSA_TEST__).toBeUndefined();
  });
  it.each([
    ['usedProduct', {}, 'NOT_NEW'], ['isOutOfStock', true, 'OUT_OF_STOCK'], ['goodsSaleType', 'STOP', 'OUT_OF_STOCK'],
    ['isBuyForMember', true, 'CONDITIONAL_PRICE_ONLY'], ['isExclusiveMusinsaPay', true, 'CONDITIONAL_PRICE_ONLY'],
    ['isRaffle', true, 'ELIGIBILITY_UNKNOWN'], ['isOnlyGlobalGoods', true, 'ELIGIBILITY_UNKNOWN'],
  ])('rejects disqualifying product state %s', (key, value, error) => {
    expect(() => parseMusinsaProduct(page((_, detail) => { detail[key as string] = value; }), url)).toThrow(error as string);
  });
  it('rejects session/member prices but never promotes a lower coupon price', () => {
    expect(parseMusinsaProduct(page(), url).itemPrice).toBe(amount);
    expect(() => parseMusinsaProduct(page(root => { root.props.pageProps.shared.loggedIn = true; }), url)).toThrow('CONDITIONAL_PRICE_ONLY');
    expect(() => parseMusinsaProduct(page((root, detail) => { detail.goodsPrice.memberDiscountRate = 5; root.props.pageProps.meta.data.goodsPrice.memberDiscountRate = 5; }), url)).toThrow('CONDITIONAL_PRICE_ONLY');
    expect(() => parseMusinsaProduct(page(undefined, { 'product:price:amount': String(amount - 1000) }), url)).toThrow('CONDITIONAL_PRICE_ONLY');
  });
  it('requires domestic logistics and matching registered seller rather than inferring from Korean currency', () => {
    expect(() => parseMusinsaProduct(page((_, detail) => { detail.logisticsPrioritizedInventory.isOverseasDelivery = true; }), url)).toThrow('ELIGIBILITY_UNKNOWN');
    expect(() => parseMusinsaProduct(page((_, detail) => { detail.goodsLogisticsInfoV2.push({ isOverseasDelivery: true }); }), url)).toThrow('ELIGIBILITY_UNKNOWN');
    expect(() => parseMusinsaProduct(page((_, detail) => { detail.company.name = 'another'; }), url)).toThrow('ELIGIBILITY_UNKNOWN');
  });
  it('requires exact color and size joins, zero option adjustment and the merchant color image', () => {
    expect(() => parseMusinsaProduct(page((_, __, options) => { options.optionItems[0].optionValueNos = [100, 999]; }), url)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseMusinsaProduct(page((_, __, options) => { options.optionItems[0].price = 100; }), url)).toThrow('VARIANT_AMBIGUOUS');
    expect(() => parseMusinsaProduct(page((_, __, options) => { options.basic[0].optionValues[0].imageUrl = 'https://evil.example/fake.jpg'; }), url)).toThrow('IMAGE_UNVERIFIED');
    expect(() => parseMusinsaProduct(page((_, __, options) => { options.optionItems[1].no = options.optionItems[0].no; }), url)).toThrow('VARIANT_AMBIGUOUS');
  });
  it('never treats activated or product-level stock as exact-variant inventory', () => {
    const parsed = parseMusinsaProduct(page(), url);
    expect(() => selectMusinsaVariant(parsed, 100, envelope([]))).toThrow('ELIGIBILITY_UNKNOWN');
    expect(() => selectMusinsaVariant(parsed, 100, stock([{ outOfStock: undefined }]))).toThrow('OUT_OF_STOCK');
    expect(() => selectMusinsaVariant(parsed, 100, stock([{ outOfStock: true }]))).toThrow('OUT_OF_STOCK');
  });
  it.each([
    { domesticDelivery: { deliveryType: 'MANUAL', manualType: 'RESERVE', willReleaseDate: '2026-02-01', preferDeliveryCompanyType: 'CJGLS' } },
    { isRedirect: true }, { relatedOption: { productVariantId: 777 } }, { remainQuantity: 0 }, { remainQuantity: -1 }, { remainQuantity: undefined },
  ])('excludes reserved, replaced and contradictory stock %j', override => {
    expect(() => selectMusinsaVariant(parseMusinsaProduct(page(), url), 100, stock([override]))).toThrow('OUT_OF_STOCK');
  });
  it('rejects foreign or duplicate variant inventory and response errors', () => {
    const parsed = parseMusinsaProduct(page(), url);
    expect(() => selectMusinsaVariant(parsed, 100, stock([{ productId: 2 }]))).toThrow('VARIANT_MISMATCH');
    expect(() => selectMusinsaVariant(parsed, 100, stock([{ productVariantId: 999 }]))).toThrow('VARIANT_MISMATCH');
    expect(() => selectMusinsaVariant(parsed, 100, stock([{}, { productVariantId: 200 }]))).toThrow('VARIANT_MISMATCH');
    expect(() => selectMusinsaVariant(parsed, 100, { ...stock(), error: 'bad' })).toThrow('CONFLICTING_SOURCE');
  });
  it('emits linked v3 evidence without inventing rental or shipping proof; eligibility remains closed', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#888888' } }).webp().toBuffer();
    const fetcher = {
      get: vi.fn(async (input: string, kind: string) => ({ url: input, bytes: kind === 'html' ? new TextEncoder().encode(page()) : bytes, headers: new Headers({ 'content-type': kind === 'html' ? 'text/html' : 'image/webp' }) })),
      postJson: vi.fn(async (input: string) => ({ url: input, bytes: new TextEncoder().encode(JSON.stringify(stock())), headers: new Headers({ 'content-type': 'application/json' }) })),
    };
    const candidate = await extractMusinsaCandidate({ searchId: '00000000-0000-4000-8000-000000000001', candidateId: '00000000-0000-4000-8000-000000000002', url, deadline: Date.now() + 10_000 }, fetcher);
    expect(fetcher.postJson).toHaveBeenCalledWith(`https://goods-detail.musinsa.com/api2/goods/${id}/options/v2/prioritized-inventories`, { optionValueNos: [100] }, expect.any(Number));
    expect(ImageExtractionStageSchema.parse(candidate.imageExtractionStage)).toBe('STATIC_HTML');
    expect(candidate.sourceVariantKey).toBe('200');
    expect(candidate.variant).toMatchObject({ color: 'GREY', size: 'S', availability: 'IN_STOCK' });
    expect(candidate.fieldEvidence.some((e: Row) => ['/rental', '/shippingFee'].includes(e.fieldPath))).toBe(false);
    for (const record of candidate.fieldEvidence) expect(FieldEvidenceSchema.parse(record)).toMatchObject({ productId: candidate.productId, variantId: candidate.variantId, offerId: candidate.offerId, confidence: 'VERIFIED' });
    expect(candidate.fieldEvidence.find((e: Row) => e.fieldPath === '/stockStatus').sourceUrl).toContain('goods-detail.musinsa.com');
    expect(checkSourceEligibility({ ...candidate.eligibility, isClothing: true })).toEqual({ pass: false, reasons: ['ELIGIBILITY_UNKNOWN'] });
  });
});
